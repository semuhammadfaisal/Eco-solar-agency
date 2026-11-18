/**
 * Supplier service.
 *
 * Payable balance is always derived:
 *   opening balance + Σ(live purchase totals) − Σ(payments)
 * so it can never disagree with the purchase records.
 */
'use strict';

const mongoose = require('mongoose');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { escapeRegex, createPagination } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { text, optionalNumber } = require('../utils/inputs');

const MAX_SEARCH_LENGTH = 80;
const MAX_LIST = 500;

function cleanSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LENGTH);
}

function buildSupplierFilter({ search, city } = {}) {
  const filter = {};
  if (city) filter.city = city;

  const term = cleanSearch(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    filter.$or = [
      { code: regex },
      { name: regex },
      { company: regex },
      { contactName: regex },
      { phone: regex },
      { whatsapp: regex },
      { email: regex },
      { city: regex },
      { ntn: regex },
    ];
  }

  return filter;
}

/**
 * Total purchased / paid per supplier.
 * @param {Array<import('mongoose').Types.ObjectId>} ids
 * @returns {Promise<Map<string, {totalPaisa: number, paidPaisa: number, count: number}>>}
 */
async function purchaseTotalsForSuppliers(ids) {
  const map = new Map();
  if (!ids.length) return map;

  const rows = await Purchase.aggregate([
    {
      $match: {
        deletedAt: null,
        status: mongoose.trusted({ $ne: 'cancelled' }),
        supplier: mongoose.trusted({ $in: ids }),
      },
    },
    {
      $group: {
        _id: '$supplier',
        totalPaisa: { $sum: '$totalPaisa' },
        paidPaisa: { $sum: '$paidPaisa' },
        count: { $sum: 1 },
      },
    },
  ]);

  for (const row of rows) {
    map.set(String(row._id), {
      totalPaisa: row.totalPaisa || 0,
      paidPaisa: row.paidPaisa || 0,
      count: row.count || 0,
    });
  }
  return map;
}

function withBalance(supplier, totals) {
  const summary = totals || { totalPaisa: 0, paidPaisa: 0, count: 0 };
  const opening = Number(supplier.openingBalancePaisa || 0);
  return {
    ...supplier,
    purchaseTotalPaisa: summary.totalPaisa,
    purchasePaidPaisa: summary.paidPaisa,
    purchaseCount: summary.count,
    payablePaisa: opening + summary.totalPaisa - summary.paidPaisa,
  };
}

async function paginateSuppliers({ search, city, page, limit } = {}) {
  const filter = buildSupplierFilter({ search, city });
  const total = await Supplier.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const items = await Supplier.find(filter)
    .sort({ name: 1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .lean();

  const totals = await purchaseTotalsForSuppliers(items.map((item) => item._id));
  const rows = items.map((item) => withBalance(item, totals.get(String(item._id))));

  return { items: rows, total, pagination };
}

async function listCities() {
  const cities = await Supplier.distinct('city', {
    city: mongoose.trusted({ $ne: '' }),
  });
  return cities.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function listSupplierOptions(limit = MAX_LIST) {
  return Supplier.find()
    .select('code name company phone city openingBalancePaisa')
    .sort({ name: 1 })
    .limit(limit)
    .lean();
}

async function getSupplierOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Supplier not found.');
  const supplier = await Supplier.findById(id);
  if (!supplier) throw ApiError.notFound('Supplier not found.');
  return supplier;
}

async function getSupplierDetail(id) {
  const supplier = await getSupplierOrThrow(id);

  const purchases = await Purchase.find({ supplier: supplier._id })
    .sort({ purchaseDate: -1, createdAt: -1 })
    .limit(200)
    .populate('createdBy', 'name')
    .lean();

  const live = purchases.filter((purchase) => purchase.status !== 'cancelled');
  const stats = {
    openingPaisa: Number(supplier.openingBalancePaisa || 0),
    purchaseTotalPaisa: live.reduce((sum, row) => sum + Number(row.totalPaisa || 0), 0),
    paidPaisa: live.reduce((sum, row) => sum + Number(row.paidPaisa || 0), 0),
    purchaseCount: live.length,
  };
  stats.payablePaisa =
    stats.openingPaisa + stats.purchaseTotalPaisa - stats.paidPaisa;

  return { supplier, purchases, stats };
}

function parseMoney(value, label, allowEmpty = true) {
  if (allowEmpty && (value === '' || value === null || value === undefined)) return 0;
  try {
    const paisa = toPaisa(value);
    if (paisa < 0) throw new Error('negative');
    return paisa;
  } catch (_err) {
    throw ApiError.badRequest(`Enter a valid ${label}.`);
  }
}

function normalizeSupplierInput(input = {}) {
  return {
    name: text(input.name, 150),
    company: text(input.company, 150),
    contactName: text(input.contactName, 120),
    phone: text(input.phone, 20),
    whatsapp: text(input.whatsapp, 20),
    email: text(input.email, 190).toLowerCase(),
    address: text(input.address, 250),
    city: text(input.city, 80),
    ntn: text(input.ntn, 30),
    paymentTermsDays: Math.min(
      365,
      Math.max(0, Math.round(optionalNumber(input.paymentTermsDays) || 0))
    ),
    openingBalancePaisa: parseMoney(input.openingBalance, 'opening balance'),
    notes: text(input.notes, 1000),
  };
}

async function nextSupplierCode() {
  const seq = await Counter.next('supplier');
  return `SUP-${String(seq).padStart(4, '0')}`;
}

async function createSupplier(input, actor, req) {
  const data = normalizeSupplierInput(input);
  if (!data.name) throw ApiError.badRequest('Supplier name is required.');

  const supplier = new Supplier({
    ...data,
    code: await nextSupplierCode(),
    createdBy: actor ? actor._id : null,
  });

  await supplier.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.SUPPLIER_CREATED,
    'suppliers',
    supplier._id,
    null,
    supplier.toObject(),
    { req, description: `Created supplier ${supplier.code} — ${supplier.name}` }
  );

  return supplier;
}

async function updateSupplier(id, input, actor, req) {
  const supplier = await getSupplierOrThrow(id);
  const before = supplier.toObject();
  const data = normalizeSupplierInput(input);
  if (!data.name) throw ApiError.badRequest('Supplier name is required.');

  Object.assign(supplier, data);
  await supplier.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.SUPPLIER_UPDATED,
    'suppliers',
    supplier._id,
    before,
    supplier.toObject(),
    { req, description: `Updated supplier ${supplier.code} — ${supplier.name}` }
  );

  return supplier;
}

async function softDeleteSupplier(id, actor, req) {
  const supplier = await getSupplierOrThrow(id);

  const livePurchases = await Purchase.countDocuments({
    supplier: supplier._id,
    status: mongoose.trusted({ $ne: 'cancelled' }),
  });
  if (livePurchases > 0) {
    throw ApiError.conflict(
      'This supplier has live purchase orders. Cancel or archive them before deleting the supplier.'
    );
  }

  const before = supplier.toObject();
  await supplier.softDelete(actor ? actor._id : null);

  await logAction(
    actor,
    AUDIT_ACTIONS.SUPPLIER_DELETED,
    'suppliers',
    supplier._id,
    before,
    { deletedAt: supplier.deletedAt },
    { req, description: `Deleted supplier ${supplier.code} — ${supplier.name}` }
  );

  return supplier;
}

module.exports = {
  buildSupplierFilter,
  paginateSuppliers,
  listCities,
  listSupplierOptions,
  getSupplierOrThrow,
  getSupplierDetail,
  createSupplier,
  updateSupplier,
  softDeleteSupplier,
  nextSupplierCode,
};
