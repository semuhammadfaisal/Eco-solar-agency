/**
 * Stock service — ledger, adjustments, supplier returns and valuation.
 *
 * The ledger is append-only. Item.currentStock is a cached balance updated in
 * the same request as the movement; the ledger remains the source of truth for
 * how that balance was reached.
 */
'use strict';

const mongoose = require('mongoose');
const Item = require('../models/Item');
const Supplier = require('../models/Supplier');
const Purchase = require('../models/Purchase');
const SerialNo = require('../models/SerialNo');
const StockMovement = require('../models/StockMovement');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const itemService = require('./itemService');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { escapeRegex, createPagination } = require('../utils/pagination');
const { text } = require('../utils/inputs');
const { toPaisa } = require('../utils/money');
const { parseDateKey, addYears } = require('../utils/dates');
const { parseSerialInput, parseSerialBarcodeInput } = require('../utils/serials');
const branchInventoryService = require('./branchInventoryService');
const {
  STOCK_MOVEMENT_TYPES,
  ITEM_CATEGORIES,
  SERIAL_ON_HAND_STATUSES,
} = require('../config/inventory');

const MAX_SEARCH_LENGTH = 80;
const EPSILON = 0.000001;

function cleanSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LENGTH);
}

function parseQty(value, label, allowZero = false) {
  if (value === '' || value === null || value === undefined) {
    if (allowZero) return 0;
    throw ApiError.badRequest(`Enter a ${label}.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number === 0)) {
    throw ApiError.badRequest(`Enter a valid ${label}.`);
  }
  return number;
}

async function itemIdsForSearch(term) {
  if (!term) return [];
  const regex = new RegExp(escapeRegex(term), 'i');
  const items = await Item.find({ $or: [{ sku: regex }, { name: regex }] })
    .select('_id')
    .limit(200)
    .lean();
  return items.map((item) => item._id);
}

async function buildMovementFilter({ search, item, type, from, to } = {}) {
  const filter = {};

  if (item && mongoose.isValidObjectId(item)) filter.item = item;
  if (STOCK_MOVEMENT_TYPES.includes(type)) filter.type = type;

  if (from || to) {
    filter.occurredAt = {};
    const start = parseDateKey(from);
    if (start) filter.occurredAt.$gte = start;
    const end = parseDateKey(to);
    if (end) filter.occurredAt.$lt = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    if (!Object.keys(filter.occurredAt).length) delete filter.occurredAt;
  }

  const term = cleanSearch(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    const ids = item
      ? []
      : await itemIdsForSearch(term);
    const clauses = [{ reference: regex }, { notes: regex }, { location: regex }];
    if (ids.length) clauses.push({ item: mongoose.trusted({ $in: ids }) });
    filter.$or = clauses;
  }

  return filter;
}

async function paginateMovements({ search, item, type, from, to, page, limit } = {}, actor) {
  const filter = await buildMovementFilter({ search, item, type, from, to });

  const total = await StockMovement.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const movements = await StockMovement.find(filter)
    .sort({ occurredAt: -1, createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .populate('item', 'sku name unit hasSerial currentStock minStock')
    .populate('supplier', 'code name')
    .populate('customer', 'code name')
    .populate('createdBy', 'name')
    .lean();

  itemService.applyMovementVisibility(movements, actor);

  return { movements, total, pagination };
}

/** Header numbers for the ledger page. */
async function getStockOverview(actor) {
  const [totalItems, lowStock, outOfStock, movementTotals, stockTotals] = await Promise.all([
    Item.countDocuments({}),
    Item.countDocuments({ $expr: mongoose.trusted({ $lte: ['$currentStock', '$minStock'] }) }),
    Item.countDocuments({ currentStock: mongoose.trusted({ $lte: 0 }) }),
    StockMovement.aggregate([
      { $match: { type: 'IN' } },
      { $group: { _id: null, units: { $sum: '$qty' } } },
    ]),
    Item.aggregate([
      { $match: { deletedAt: null } },
      {
        $group: {
          _id: null,
          units: { $sum: '$currentStock' },
          valuePaisa: { $sum: { $multiply: ['$currentStock', '$avgCostPaisa'] } },
        },
      },
    ]),
  ]);

  const stock = stockTotals[0] || { units: 0, valuePaisa: 0 };
  const inflow = movementTotals[0] || { units: 0 };

  const summary = {
    totalItems,
    lowStock,
    outOfStock,
    totalUnits: stock.units || 0,
    unitsReceived: inflow.units || 0,
  };

  if (itemService.canViewCosts(actor)) {
    summary.totalValuePaisa = Math.round(stock.valuePaisa || 0);
  }

  return summary;
}

/** Item detail for the item-centric ledger view. */
async function getItemLedger(itemId, { from, to, page, limit } = {}, actor) {
  const item = await itemService.getItemOrThrow(itemId, actor);
  const filter = await buildMovementFilter({ item: item._id, from, to });

  const total = await StockMovement.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const movements = await StockMovement.find(filter)
    .sort({ occurredAt: -1, createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .populate('supplier', 'code name')
    .populate('customer', 'code name')
    .populate('createdBy', 'name')
    .lean();

  itemService.applyMovementVisibility(movements, actor);

  return { item, movements, total, pagination };
}

async function nextReturnNumber() {
  const seq = await Counter.next('supplier_return');
  return `RET-${String(seq).padStart(4, '0')}`;
}

async function nextReceiptNumber() {
  const seq = await Counter.next('stock_receipt');
  return `REC-${String(seq).padStart(4, '0')}`;
}

/**
 * Weighted moving-average cost after receiving stock.
 * Pure helper so the arithmetic is unit-tested without a database.
 */
function movingAverageCost(currentStock, currentAvgPaisa, receivedQty, receivedCostPaisa) {
  const stock = Number(currentStock || 0);
  const qty = Number(receivedQty || 0);
  const total = stock + qty;
  if (total <= 0) return Number(receivedCostPaisa || 0);
  return Math.round(
    (stock * Number(currentAvgPaisa || 0) + qty * Number(receivedCostPaisa || 0)) / total
  );
}

function parseUnitCost(value) {
  if (value === '' || value === null || value === undefined) return 0;
  try {
    const paisa = toPaisa(value);
    if (paisa < 0) throw new Error('negative');
    return paisa;
  } catch (_err) {
    throw ApiError.badRequest('Enter a valid unit cost.');
  }
}

/**
 * Receive new units into a branch outside of a purchase order.
 *
 * This is the "stock in" shortcut used when goods arrive without a PO (walk-in
 * purchase, stock transfer from a shop, opening stock). It still writes a real
 * IN ledger row, moves the branch balance, updates the catalogue total and the
 * moving-average cost, and creates serial records for serialised items.
 */
async function receiveStock(input, actor, req) {
  const item = await itemService.getItemDocumentOrThrow(input.item);
  const branch = await branchInventoryService.getAccessibleBranch(actor, input.branch);

  const qty = parseQty(input.qty, 'quantity');
  if (item.hasSerial && !Number.isInteger(qty)) {
    throw ApiError.badRequest('Serial-tracked stock must be received in whole units.');
  }

  const unitCostPaisa = itemService.canViewCosts(actor) ? parseUnitCost(input.unitCost) : 0;
  const receivedAt = new Date();
  const reference = await nextReceiptNumber();
  const location = text(input.location, 100) || branch.name;
  const sourceReference = text(input.reference, 120);
  const notes = text(input.notes, 500);

  let serialDocs = [];
  let createdSerials = [];

  if (item.hasSerial) {
    const parsed = parseSerialBarcodeInput(input.serials);

    if (parsed.tooMany) {
      throw ApiError.badRequest('A single receipt can hold at most 500 serial numbers.');
    }
    if (parsed.invalid.length) {
      throw ApiError.badRequest(`Invalid serial or barcode: ${parsed.invalid.slice(0, 3).join(', ')}`);
    }
    if (parsed.duplicates.length) {
      throw ApiError.badRequest(`Duplicate serial number: ${parsed.duplicates.slice(0, 3).join(', ')}`);
    }
    if (parsed.duplicateBarcodes.length) {
      throw ApiError.badRequest(`Duplicate barcode: ${parsed.duplicateBarcodes.slice(0, 3).join(', ')}`);
    }
    if (parsed.rows.length !== qty) {
      throw ApiError.badRequest(
        `Enter exactly ${qty} serial number${qty === 1 ? '' : 's'} for this receipt.`
      );
    }

    const serials = parsed.rows.map((row) => row.serial);
    const barcodes = parsed.rows.map((row) => row.barcode).filter(Boolean);
    const clauses = [{ serial: mongoose.trusted({ $in: serials }) }];
    if (barcodes.length) clauses.push({ barcode: mongoose.trusted({ $in: barcodes }) });

    const existing = await SerialNo.find({ $or: clauses })
      .select('serial barcode')
      .lean();
    if (existing.length) {
      throw ApiError.conflict(
        `Serial or barcode already on record: ${existing
          .slice(0, 3)
          .map((row) => row.barcode || row.serial)
          .join(', ')}`
      );
    }

    serialDocs = parsed.rows.map(({ serial, barcode }) => ({
      serial,
      barcode: barcode || null,
      item: item._id,
      status: 'in_stock',
      location,
      receivedAt,
      productWarrantyEnd:
        Number(item.productWarrantyYears || 0) > 0
          ? addYears(receivedAt, item.productWarrantyYears)
          : null,
      performanceWarrantyEnd:
        Number(item.performanceWarrantyYears || 0) > 0
          ? addYears(receivedAt, item.performanceWarrantyYears)
          : null,
      events: [
        {
          status: 'in_stock',
          at: receivedAt,
          note: `Received via ${reference}`,
          reference,
          user: actor ? actor._id : null,
        },
      ],
      notes: sourceReference ? `Supplier document: ${sourceReference}` : '',
      createdBy: actor ? actor._id : null,
    }));

    try {
      createdSerials = await SerialNo.insertMany(serialDocs, { ordered: true });
    } catch (err) {
      if (err && err.code === 11000) {
        throw ApiError.conflict(
          'One of the serial numbers was just used by another receipt. Try again.'
        );
      }
      throw err;
    }
  }

  const oldStock = Number(item.currentStock || 0);
  const oldAvg = Number(item.avgCostPaisa || 0);
  const receivedCost = unitCostPaisa > 0 ? unitCostPaisa : oldAvg;
  const newAvg = movingAverageCost(oldStock, oldAvg, qty, receivedCost);

  const branchBalance = await branchInventoryService.addStock(branch._id, item._id, qty);
  const newStock = await branchInventoryService.syncItemTotal(item._id);

  const movement = await StockMovement.create({
    item: item._id,
    branch: branch._id,
    type: 'IN',
    qty,
    unitCostPaisa: receivedCost,
    balanceAfter: Number(branchBalance.quantity || 0),
    reference,
    referenceType: 'other',
    serials: createdSerials.map((serial) => serial._id),
    location,
    notes: [sourceReference ? `Ref: ${sourceReference}` : '', notes]
      .filter(Boolean)
      .join(' — ')
      .slice(0, 500),
    occurredAt: receivedAt,
    createdBy: actor ? actor._id : null,
  });

  const itemUpdate = { currentStock: newStock, avgCostPaisa: newAvg };
  if (unitCostPaisa > 0) itemUpdate.lastPurchasePricePaisa = unitCostPaisa;
  await Item.updateOne({ _id: item._id }, { $set: itemUpdate });

  await logAction(
    actor,
    AUDIT_ACTIONS.STOCK_RECEIVED,
    'stock',
    movement._id,
    { currentStock: oldStock },
    { currentStock: newStock, reference, branch: branch.code, qty },
    { req, description: `Received ${qty} × ${item.sku} at ${branch.name} (${reference})` }
  );

  return { movement, item, branch, qty, newStock, serials: createdSerials };
}

/**
 * Return stock to a supplier. Serialised items require the exact serials being
 * returned; those serials move to the `returned` status.
 */
async function returnToSupplier(input, actor, req) {
  const supplier = mongoose.isValidObjectId(input.supplier)
    ? await Supplier.findById(input.supplier)
    : null;
  if (!supplier) throw ApiError.badRequest('Select a valid supplier.');

  const item = await itemService.getItemDocumentOrThrow(input.item);
  const qty = parseQty(input.qty, 'quantity');

  if (item.hasSerial && !Number.isInteger(qty)) {
    throw ApiError.badRequest('Serial-tracked returns must be a whole number.');
  }

  const newStock = Number(item.currentStock || 0) - qty;
  if (newStock < -EPSILON) {
    throw ApiError.conflict(
      `Only ${Number(item.currentStock || 0)} ${item.unit} of ${item.sku} are on hand.`
    );
  }

  const reason = text(input.reason, 300);
  if (!reason) throw ApiError.badRequest('A reason is required for a supplier return.');

  let purchase = null;
  if (input.purchase && mongoose.isValidObjectId(input.purchase)) {
    purchase = await Purchase.findOne({
      _id: input.purchase,
      supplier: supplier._id,
      'items.item': item._id,
    }).select('_id number');
    if (!purchase) {
      throw ApiError.badRequest('The selected purchase does not include this item from this supplier.');
    }
  }

  let serialDocs = [];
  if (item.hasSerial) {
    const parsed = parseSerialInput(input.serials);
    if (parsed.tooMany) {
      throw ApiError.badRequest('A single return can hold at most 500 serial numbers.');
    }
    if (parsed.invalid.length) {
      throw ApiError.badRequest(`Invalid serial number: ${parsed.invalid.slice(0, 3).join(', ')}`);
    }
    if (parsed.duplicates.length) {
      throw ApiError.badRequest(`Duplicate serial number: ${parsed.duplicates.slice(0, 3).join(', ')}`);
    }
    if (parsed.serials.length !== qty) {
      throw ApiError.badRequest(
        `Select exactly ${qty} serial number${qty === 1 ? '' : 's'} for this return.`
      );
    }

    serialDocs = await SerialNo.find({
      serial: mongoose.trusted({ $in: parsed.serials }),
      item: item._id,
    });

    if (serialDocs.length !== parsed.serials.length) {
      throw ApiError.badRequest('One or more serial numbers do not belong to this item.');
    }

    const notOnHand = serialDocs.filter(
      (serial) => !SERIAL_ON_HAND_STATUSES.includes(serial.status)
    );
    if (notOnHand.length) {
      throw ApiError.conflict(
        `Only in-stock or defective serials can be returned to a supplier: ${notOnHand
          .slice(0, 3)
          .map((serial) => serial.serial)
          .join(', ')}`
      );
    }
  }

  const reference = await nextReturnNumber();
  const occurredAt = new Date();

  for (const serial of serialDocs) {
    serial.status = 'returned';
    serial.returnedAt = occurredAt;
    serial.customer = null;
    serial.project = '';
    serial.events.push({
      status: 'returned',
      at: occurredAt,
      note: `Returned to supplier ${supplier.code} — ${reason}`,
      reference,
      user: actor ? actor._id : null,
    });
    await serial.save();
  }

  const movement = await StockMovement.create({
    item: item._id,
    type: 'RETURN',
    qty: -qty,
    unitCostPaisa: Number(item.avgCostPaisa || 0),
    balanceAfter: newStock,
    reference,
    referenceType: 'supplier_return',
    referenceId: purchase ? purchase._id : null,
    supplier: supplier._id,
    serials: serialDocs.map((serial) => serial._id),
    location: text(input.location, 100),
    notes: reason,
    occurredAt,
    createdBy: actor ? actor._id : null,
  });

  await Item.updateOne({ _id: item._id }, { $set: { currentStock: newStock } });

  await logAction(
    actor,
    AUDIT_ACTIONS.STOCK_RETURNED,
    'stock',
    movement._id,
    { currentStock: Number(item.currentStock || 0) },
    { currentStock: newStock, reference, supplier: supplier.code },
    {
      req,
      description: `Returned ${qty} × ${item.sku} to ${supplier.name} (${reference})`,
    }
  );

  return { movement, item, supplier, newStock, serials: serialDocs };
}

/** Stock value grouped by category, plus the per-item breakdown. */
async function getValuationReport({ category } = {}) {
  const match = { deletedAt: null };
  if (ITEM_CATEGORIES.includes(category)) match.category = category;

  const [items, categoryRows] = await Promise.all([
    Item.find(match)
      .select(
        'sku name category brand model unit currentStock minStock avgCostPaisa location hasSerial'
      )
      .sort({ category: 1, name: 1 })
      .lean(),
    Item.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$category',
          itemCount: { $sum: 1 },
          units: { $sum: '$currentStock' },
          valuePaisa: { $sum: { $multiply: ['$currentStock', '$avgCostPaisa'] } },
        },
      },
      { $sort: { valuePaisa: -1 } },
    ]),
  ]);

  for (const item of items) {
    item.stockValuePaisa = Math.round(
      Number(item.currentStock || 0) * Number(item.avgCostPaisa || 0)
    );
    item.isLowStock = Number(item.currentStock || 0) <= Number(item.minStock || 0);
  }

  const totals = items.reduce(
    (acc, item) => {
      acc.itemCount += 1;
      acc.totalUnits += Number(item.currentStock || 0);
      acc.totalValuePaisa += item.stockValuePaisa;
      if (item.isLowStock) acc.lowStock += 1;
      return acc;
    },
    { itemCount: 0, totalUnits: 0, totalValuePaisa: 0, lowStock: 0 }
  );

  return { items, categories: categoryRows, totals };
}

async function listRecentReturns(limit = 20, actor = null) {
  const movements = await StockMovement.find({ type: 'RETURN' })
    .sort({ occurredAt: -1 })
    .limit(limit)
    .populate('item', 'sku name unit')
    .populate('supplier', 'code name')
    .populate('createdBy', 'name')
    .lean();

  itemService.applyMovementVisibility(movements, actor);
  return movements;
}

module.exports = {
  buildMovementFilter,
  paginateMovements,
  getStockOverview,
  getItemLedger,
  receiveStock,
  movingAverageCost,
  returnToSupplier,
  getValuationReport,
  listRecentReturns,
  nextReturnNumber,
  nextReceiptNumber,
};
