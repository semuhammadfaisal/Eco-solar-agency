'use strict';

const mongoose = require('mongoose');
const StockTransfer = require('../models/StockTransfer');
const StockMovement = require('../models/StockMovement');
const Item = require('../models/Item');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { text } = require('../utils/inputs');
const { toPaisa } = require('../utils/money');
const branchInventory = require('./branchInventoryService');

async function nextNumber() {
  const seq = await Counter.next(`stock_transfer_${new Date().getFullYear()}`);
  return `TRF-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`;
}

function arrays(input, key) {
  const value = input[key];
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

/**
 * Branch price the destination pays per unit. Blank falls back to the item's
 * retail/selling price, then its cost, so the form can prefill a sensible
 * number while still allowing an explicit zero for free transfers.
 */
function defaultBranchPrice(item) {
  return Number(item.retailPricePaisa || item.sellingPricePaisa || item.avgCostPaisa || 0);
}

function parseBranchPrice(value, fallbackPaisa) {
  if (value === '' || value === null || value === undefined) {
    return Math.max(0, Math.round(Number(fallbackPaisa) || 0));
  }

  let paisa;
  try {
    paisa = toPaisa(String(value));
  } catch (_err) {
    throw ApiError.badRequest('Enter a valid branch price.');
  }
  if (!Number.isFinite(paisa) || paisa < 0) {
    throw ApiError.badRequest('Branch price cannot be negative.');
  }
  return paisa;
}

async function createTransfer(input, actor) {
  const source = await branchInventory.getAccessibleBranch(actor, input.sourceBranch);
  if (!mongoose.isValidObjectId(input.destinationBranch)) throw ApiError.badRequest('Select a destination branch.');
  const destination = await branchInventory.getAccessibleBranch(null, input.destinationBranch);
  if (String(source._id) === String(destination._id)) throw ApiError.badRequest('Select two different branches.');

  const itemIds = arrays(input, 'item');
  const quantities = arrays(input, 'quantity');
  const branchPrices = arrays(input, 'branchPrice');
  const requested = [];
  for (let index = 0; index < itemIds.length; index += 1) {
    if (!mongoose.isValidObjectId(itemIds[index])) continue;
    const quantity = Number(quantities[index]);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    requested.push({ index, itemId: itemIds[index], quantity });
  }
  if (!requested.length) throw ApiError.badRequest('Add at least one product and quantity.');

  const itemDocs = await Item.find({ _id: { $in: requested.map((row) => row.itemId) } });
  const itemMap = new Map(itemDocs.map((item) => [String(item._id), item]));
  const reserved = [];
  try {
    for (const row of requested) {
      const item = itemMap.get(String(row.itemId));
      if (!item) throw ApiError.badRequest('One of the selected products no longer exists.');
      if (item.hasSerial) throw ApiError.badRequest(`${item.sku} is serial-tracked; serial transfer selection is required before it can be moved.`);
      const balances = await branchInventory.transferStock(source._id, destination._id, item._id, row.quantity);
      reserved.push({ item, quantity: row.quantity, branchPriceInput: branchPrices[row.index], balances });
    }
  } catch (err) {
    for (const row of reserved.reverse()) {
      await branchInventory.transferStock(destination._id, source._id, row.item._id, row.quantity).catch(() => {});
    }
    throw err;
  }

  // Work out cost, branch value and profit per line before anything is written.
  const priced = reserved.map((row) => {
    const unitCostPaisa = Math.round(Number(row.item.avgCostPaisa || 0));
    const branchPricePaisa = parseBranchPrice(row.branchPriceInput, defaultBranchPrice(row.item));
    return {
      ...row,
      unitCostPaisa,
      branchPricePaisa,
      profitPaisa: Math.round((branchPricePaisa - unitCostPaisa) * row.quantity),
    };
  });

  const totalCostPaisa = Math.round(priced.reduce((sum, row) => sum + row.unitCostPaisa * row.quantity, 0));
  const totalBranchValuePaisa = Math.round(priced.reduce((sum, row) => sum + row.branchPricePaisa * row.quantity, 0));
  const totalProfitPaisa = totalBranchValuePaisa - totalCostPaisa;

  let transfer = null;
  try {
    const number = await nextNumber();
    transfer = await StockTransfer.create({
      number, sourceBranch: source._id, destinationBranch: destination._id, status: 'received',
      items: priced.map((row) => ({
        item: row.item._id,
        sku: row.item.sku,
        name: row.item.name,
        unit: row.item.unit,
        quantity: row.quantity,
        unitCostPaisa: row.unitCostPaisa,
        branchPricePaisa: row.branchPricePaisa,
        profitPaisa: row.profitPaisa,
      })),
      totalCostPaisa,
      totalBranchValuePaisa,
      totalProfitPaisa,
      notes: text(input.notes, 1000), transferredAt: new Date(), createdBy: actor._id, receivedBy: actor._id,
    });

    const movements = [];
    for (const row of priced) {
      movements.push({ item: row.item._id, branch: source._id, sourceBranch: source._id, destinationBranch: destination._id, type: 'OUT', qty: -row.quantity, unitCostPaisa: row.unitCostPaisa, balanceAfter: row.balances.source.quantity, reference: number, referenceType: 'transfer', referenceId: transfer._id, location: source.name, occurredAt: transfer.transferredAt, createdBy: actor._id });
      movements.push({ item: row.item._id, branch: destination._id, sourceBranch: source._id, destinationBranch: destination._id, type: 'IN', qty: row.quantity, unitCostPaisa: row.unitCostPaisa, balanceAfter: row.balances.destination.quantity, reference: number, referenceType: 'transfer', referenceId: transfer._id, location: destination.name, occurredAt: transfer.transferredAt, createdBy: actor._id });
    }
    await StockMovement.insertMany(movements);
    return transfer;
  } catch (err) {
    if (transfer) await StockTransfer.updateOne({ _id: transfer._id }, { $set: { status: 'cancelled' } }).catch(() => {});
    for (const row of reserved.reverse()) {
      await branchInventory.transferStock(destination._id, source._id, row.item._id, row.quantity).catch(() => {});
    }
    throw err;
  }
}

async function listTransfers(actor) {
  const filter = actor && ['shopkeeper', 'sales'].includes(actor.role) && actor.branch
    ? { $or: [{ sourceBranch: actor.branch }, { destinationBranch: actor.branch }] }
    : {};
  return StockTransfer.find(filter).populate('sourceBranch destinationBranch', 'code name').populate('createdBy', 'name').sort({ transferredAt: -1 }).limit(300).lean();
}

/** One transfer with its branches and users, restricted to the actor's branch. */
async function getTransfer(id, actor) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Transfer not found.');

  const transfer = await StockTransfer.findById(id)
    .populate('sourceBranch destinationBranch', 'code name type')
    .populate('createdBy receivedBy', 'name')
    .lean();
  if (!transfer) throw ApiError.notFound('Transfer not found.');

  if (actor && ['shopkeeper', 'sales'].includes(actor.role) && actor.branch) {
    const branch = String(actor.branch);
    const sourceId = String(transfer.sourceBranch && transfer.sourceBranch._id);
    const destinationId = String(transfer.destinationBranch && transfer.destinationBranch._id);
    if (sourceId !== branch && destinationId !== branch) {
      throw ApiError.forbidden('You can only view transfers for your branch.');
    }
  }

  return transfer;
}

module.exports = { createTransfer, listTransfers, getTransfer, parseBranchPrice, defaultBranchPrice };
