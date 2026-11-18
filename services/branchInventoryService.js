'use strict';

const mongoose = require('mongoose');
const Branch = require('../models/Branch');
const BranchStock = require('../models/BranchStock');
const Item = require('../models/Item');
const ApiError = require('../utils/ApiError');

const EPSILON = 0.000001;

async function ensureMainBranch(actor = null) {
  let branch = await Branch.findOne({ type: 'main' }).sort({ createdAt: 1 });
  if (branch) return branch;
  try {
    branch = await Branch.create({
      code: 'MAIN',
      name: 'Main Agency',
      type: 'main',
      isActive: true,
      createdBy: actor && actor._id ? actor._id : null,
    });
  } catch (err) {
    if (err && err.code === 11000) branch = await Branch.findOne({ code: 'MAIN' });
    else throw err;
  }
  return branch;
}

async function getAccessibleBranch(actor, requestedId = null) {
  const isRestricted = actor && ['shopkeeper', 'sales'].includes(actor.role) && actor.branch;
  const id = isRestricted ? actor.branch : requestedId || (actor && actor.branch);
  if (id) {
    if (!mongoose.isValidObjectId(id)) throw ApiError.badRequest('Select a valid branch.');
    const branch = await Branch.findOne({ _id: id, isActive: true });
    if (!branch) throw ApiError.badRequest('The selected branch is not active.');
    return branch;
  }
  return ensureMainBranch(actor);
}

async function listBranches({ activeOnly = true } = {}) {
  await ensureMainBranch();
  const filter = activeOnly ? { isActive: true } : {};
  return Branch.find(filter).sort({ type: 1, name: 1 }).lean();
}

async function ensureLegacyBalance(itemId, branchId) {
  let balance = await BranchStock.findOne({ branch: branchId, item: itemId });
  if (balance) return balance;

  const [item, main] = await Promise.all([Item.findById(itemId), ensureMainBranch()]);
  if (!item) throw ApiError.notFound('Item not found.');
  const initial = String(main._id) === String(branchId) ? Number(item.currentStock || 0) : 0;
  try {
    balance = await BranchStock.create({
      branch: branchId,
      item: itemId,
      quantity: initial,
      minStock: Number(item.minStock || 0),
    });
  } catch (err) {
    if (err && err.code === 11000) balance = await BranchStock.findOne({ branch: branchId, item: itemId });
    else throw err;
  }
  return balance;
}

async function addStock(branchId, itemId, quantity) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw ApiError.badRequest('Quantity must be greater than zero.');
  const main = await ensureMainBranch();
  await ensureLegacyBalance(itemId, main._id);
  if (String(main._id) !== String(branchId)) await ensureLegacyBalance(itemId, branchId);
  return BranchStock.findOneAndUpdate(
    { branch: branchId, item: itemId },
    { $inc: { quantity: qty } },
    { new: true }
  );
}

async function deductStock(branchId, itemId, quantity) {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) throw ApiError.badRequest('Quantity must be greater than zero.');
  const main = await ensureMainBranch();
  await ensureLegacyBalance(itemId, main._id);
  if (String(main._id) !== String(branchId)) await ensureLegacyBalance(itemId, branchId);
  const row = await BranchStock.findOneAndUpdate(
    { branch: branchId, item: itemId, quantity: { $gte: qty - EPSILON } },
    { $inc: { quantity: -qty } },
    { new: true }
  );
  if (!row) throw ApiError.conflict('Insufficient stock at the selected branch.');
  if (Math.abs(row.quantity) < EPSILON) {
    row.quantity = 0;
    await row.save();
  }
  return row;
}

async function syncItemTotal(itemId) {
  const rows = await BranchStock.aggregate([
    { $match: { item: new mongoose.Types.ObjectId(String(itemId)) } },
    { $group: { _id: null, total: { $sum: '$quantity' } } },
  ]);
  const total = rows[0] ? Number(rows[0].total || 0) : 0;
  await Item.updateOne({ _id: itemId }, { $set: { currentStock: total } });
  return total;
}

async function transferStock(sourceId, destinationId, itemId, quantity) {
  if (String(sourceId) === String(destinationId)) {
    throw ApiError.badRequest('Source and destination branches must be different.');
  }
  const source = await deductStock(sourceId, itemId, quantity);
  try {
    const destination = await addStock(destinationId, itemId, quantity);
    await syncItemTotal(itemId);
    return { source, destination };
  } catch (err) {
    await addStock(sourceId, itemId, quantity);
    throw err;
  }
}

/**
 * Per-branch balances for one item, used on the item detail page.
 * Items that pre-date branch stock only have a catalogue total, so the main
 * branch inherits that total until a branch movement creates real rows.
 */
async function branchBalancesForItem(itemId, fallbackTotal = 0) {
  if (!mongoose.isValidObjectId(itemId)) return [];

  const [branches, rows] = await Promise.all([
    Branch.find({ isActive: true }).sort({ type: 1, name: 1 }).lean(),
    BranchStock.find({ item: itemId }).lean(),
  ]);

  const byBranch = new Map(
    rows.map((row) => [String(row.branch), Number(row.quantity || 0)])
  );

  if (!rows.length) {
    const main = branches.find((branch) => branch.type === 'main');
    if (main) byBranch.set(String(main._id), Number(fallbackTotal || 0));
  }

  return branches.map((branch) => ({
    branch,
    quantity: byBranch.get(String(branch._id)) || 0,
  }));
}

async function balancesForBranch(branchId, { search = '' } = {}) {
  const branch = await Branch.findById(branchId).lean();
  if (!branch) throw ApiError.notFound('Branch not found.');
  const term = String(search || '').trim();
  const itemFilter = term
    ? { $or: [{ sku: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { name: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }, { brand: new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }] }
    : {};
  const items = await Item.find(itemFilter).sort({ name: 1 }).limit(1000).lean();
  const rows = await BranchStock.find({ branch: branchId, item: { $in: items.map((i) => i._id) } }).lean();
  const byItem = new Map(rows.map((row) => [String(row.item), row]));
  const isMain = branch.type === 'main';
  return {
    branch,
    items: items.map((item) => {
      const balance = byItem.get(String(item._id));
      return { ...item, branchStock: balance ? Number(balance.quantity || 0) : (isMain ? Number(item.currentStock || 0) : 0) };
    }),
  };
}

module.exports = {
  ensureMainBranch,
  getAccessibleBranch,
  listBranches,
  ensureLegacyBalance,
  addStock,
  deductStock,
  syncItemTotal,
  transferStock,
  branchBalancesForItem,
  balancesForBranch,
};
