/**
 * Serial-number service.
 *
 * Every serial row carries its own event history. Status changes that move a
 * unit between the warehouse and the field also write a signed stock movement,
 * so the ledger and the serial count never disagree.
 */
'use strict';

const mongoose = require('mongoose');
const SerialNo = require('../models/SerialNo');
const Item = require('../models/Item');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const StockMovement = require('../models/StockMovement');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const itemService = require('./itemService');
const branchInventoryService = require('./branchInventoryService');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { escapeRegex, createPagination } = require('../utils/pagination');
const { text } = require('../utils/inputs');
const { toPaisa } = require('../utils/money');
const { addYears } = require('../utils/dates');
const {
  parseSerialBarcodeInput,
  normalizeSerial,
  normalizeBarcode,
  isValidSerial,
  isValidBarcode,
} = require('../utils/serials');
const { SERIAL_STATUSES, SERIAL_ON_HAND_STATUSES } = require('../config/inventory');

const MAX_SEARCH_LENGTH = 80;
const EPSILON = 0.000001;

function isTruthy(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
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

function movingAverageCost(currentStock, currentAvgPaisa, receivedQty, receivedCostPaisa) {
  const stock = Number(currentStock || 0);
  const qty = Number(receivedQty || 0);
  const total = stock + qty;
  if (total <= 0) return Number(receivedCostPaisa || 0);
  return Math.round(
    (stock * Number(currentAvgPaisa || 0) + qty * Number(receivedCostPaisa || 0)) / total
  );
}

async function nextRegistrationReference() {
  const seq = await Counter.next('serial_registration');
  return `SR-${String(seq).padStart(4, '0')}`;
}

function cleanSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LENGTH);
}

function isOnHand(status) {
  return SERIAL_ON_HAND_STATUSES.includes(status);
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

async function buildSerialFilter({ search, status, item, supplier, customer } = {}) {
  const filter = {};

  if (SERIAL_STATUSES.includes(status)) filter.status = status;
  if (item && mongoose.isValidObjectId(item)) filter.item = item;
  if (supplier && mongoose.isValidObjectId(supplier)) filter.supplier = supplier;
  if (customer && mongoose.isValidObjectId(customer)) filter.customer = customer;

  const term = cleanSearch(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    const clauses = [{ serial: regex }, { barcode: regex }, { project: regex }, { notes: regex }];
    if (!item) {
      const ids = await itemIdsForSearch(term);
      if (ids.length) clauses.push({ item: mongoose.trusted({ $in: ids }) });
    }
    filter.$or = clauses;
  }

  return filter;
}

async function paginateSerials({ search, status, item, supplier, customer, page, limit } = {}) {
  const filter = await buildSerialFilter({ search, status, item, supplier, customer });

  const total = await SerialNo.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const serials = await SerialNo.find(filter)
    .sort({ createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .populate('item', 'sku name unit category')
    .populate('supplier', 'code name')
    .populate('customer', 'code name')
    .populate('purchase', 'number')
    .lean();

  return { serials, total, pagination };
}

async function getSerialStats() {
  const [rows, barcoded] = await Promise.all([
    SerialNo.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    SerialNo.countDocuments({ barcode: mongoose.trusted({ $type: 'string' }) }),
  ]);

  const byStatus = {};
  let total = 0;
  for (const row of rows) {
    byStatus[row._id] = row.count;
    total += row.count;
  }

  return { total, byStatus, barcoded };
}

/**
 * Accept either a Mongo id or a serial string.
 * @param {string} identifier
 */
async function getSerialDocumentOrThrow(identifier) {
  const value = String(identifier || '').trim();
  if (!value) throw ApiError.notFound('Serial number not found.');

  let serial = null;
  if (mongoose.isValidObjectId(value)) serial = await SerialNo.findById(value);
  if (!serial) {
    const normalized = normalizeSerial(value);
    serial = await SerialNo.findOne({
      $or: [{ serial: normalized }, { barcode: normalized }],
    });
  }
  if (!serial) throw ApiError.notFound('Serial number not found.');
  return serial;
}

async function getSerialDetail(identifier, actor) {
  const serial = await getSerialDocumentOrThrow(identifier);
  await serial.populate([
    { path: 'item', select: 'sku name category brand model unit hasSerial currentStock location' },
    { path: 'supplier', select: 'code name company phone city' },
    { path: 'customer', select: 'code name phone' },
    { path: 'purchase', select: 'number invoiceNo purchaseDate supplier' },
    { path: 'events.user', select: 'name' },
  ]);

  const movements = await StockMovement.find({
    $or: [
      { serials: serial._id },
      { referenceId: serial._id, referenceType: 'serial' },
    ],
  })
    .sort({ occurredAt: -1, createdAt: -1 })
    .populate('createdBy', 'name')
    .populate('supplier', 'code name')
    .populate('customer', 'code name')
    .lean();

  // Serial history is available to every signed-in role. Strip movement
  // costs here (rather than relying on the EJS template to hide a column) so
  // purchase prices never reach an unauthorised response.
  itemService.applyMovementVisibility(movements, actor);

  return { serial, movements };
}

/**
 * Change a serial's lifecycle status. Moving between the warehouse group
 * (in_stock, defective) and the deployed group (issued, installed, returned)
 * creates a ±1 ledger movement.
 */
async function changeStatus(identifier, input, actor, req) {
  const serial = await getSerialDocumentOrThrow(identifier);
  const nextStatus = String(input.status || '');

  if (!SERIAL_STATUSES.includes(nextStatus)) {
    throw ApiError.badRequest('Select a valid serial status.');
  }
  if (nextStatus === serial.status) {
    throw ApiError.conflict('The serial is already in that status.');
  }

  const item = await Item.findById(serial.item);
  if (!item) throw ApiError.conflict('The item for this serial no longer exists.');

  let customer = null;
  if (input.customer) {
    if (!mongoose.isValidObjectId(input.customer)) {
      throw ApiError.badRequest('Select a valid customer.');
    }
    customer = await Customer.findById(input.customer).select('_id name code');
    if (!customer) throw ApiError.badRequest('Select a valid customer.');
  }

  const wasOnHand = isOnHand(serial.status);
  const willBeOnHand = isOnHand(nextStatus);

  // Deployed statuses keep a customer link; warehouse statuses clear it.
  const deployed = ['issued', 'installed'].includes(nextStatus);
  const nextCustomer = deployed ? customer || serial.customer || null : null;
  const nextProject = deployed ? text(input.project, 120) || serial.project : '';

  const now = new Date();
  const previousStatus = serial.status;
  let movement = null;

  if (wasOnHand !== willBeOnHand) {
    const delta = willBeOnHand ? 1 : -1;
    const newStock = Number(item.currentStock || 0) + delta;

    if (newStock < -EPSILON) {
      throw ApiError.conflict(
        `${item.sku} has no stock to remove. Correct the stock ledger before changing this serial.`
      );
    }

    let type = delta > 0 ? 'IN' : 'OUT';
    if (delta < 0 && nextStatus === 'returned') type = 'RETURN';

    movement = await StockMovement.create({
      item: item._id,
      type,
      qty: delta,
      unitCostPaisa: Number(item.avgCostPaisa || 0),
      balanceAfter: newStock,
      reference: serial.serial,
      referenceType: 'serial',
      referenceId: serial._id,
      supplier: serial.supplier || null,
      customer: nextCustomer || null,
      serials: [serial._id],
      location: text(input.location, 100) || serial.location,
      notes: text(input.note, 500),
      occurredAt: now,
      createdBy: actor ? actor._id : null,
    });

    await Item.updateOne({ _id: item._id }, { $set: { currentStock: newStock } });
  }

  serial.status = nextStatus;
  serial.customer = nextCustomer;
  serial.project = nextProject;
  if (input.location !== undefined) serial.location = text(input.location, 100);
  if (nextStatus === 'issued') serial.issuedAt = now;
  if (nextStatus === 'installed') serial.installedAt = now;
  if (nextStatus === 'returned') serial.returnedAt = now;

  serial.events.push({
    status: nextStatus,
    at: now,
    note: text(input.note, 300),
    customer: nextCustomer ? nextCustomer._id || nextCustomer : null,
    project: nextProject,
    reference: movement ? movement.reference : '',
    user: actor ? actor._id : null,
  });

  await serial.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.SERIAL_STATUS_CHANGED,
    'serials',
    serial._id,
    { status: previousStatus },
    { status: nextStatus, customer: nextCustomer ? nextCustomer._id : null },
    {
      req,
      description: `Serial ${serial.serial}: ${previousStatus} → ${nextStatus}`,
    }
  );

  return { serial, movement };
}

/**
 * Validate that none of the serials or barcodes are already on record.
 * Soft-deleted rows are ignored by the model's default filter, so a deleted
 * unit can be registered again.
 */
async function assertSerialsAvailable(rows) {
  const serials = rows.map((row) => row.serial);
  const barcodes = rows.map((row) => row.barcode).filter(Boolean);
  const clauses = [{ serial: mongoose.trusted({ $in: serials }) }];
  if (barcodes.length) clauses.push({ barcode: mongoose.trusted({ $in: barcodes }) });

  const existing = await SerialNo.find({ $or: clauses })
    .select('serial barcode')
    .lean();
  if (!existing.length) return;

  const serialSet = new Set(serials);
  const barcodeSet = new Set(barcodes);
  const serialHits = existing.filter((row) => serialSet.has(row.serial)).map((row) => row.serial);
  const barcodeHits = existing
    .filter((row) => row.barcode && barcodeSet.has(row.barcode))
    .map((row) => row.barcode);

  const parts = [];
  if (serialHits.length) {
    parts.push(`serial already on record: ${serialHits.slice(0, 3).join(', ')}`);
  }
  if (barcodeHits.length) {
    parts.push(`barcode already on record: ${barcodeHits.slice(0, 3).join(', ')}`);
  }
  throw ApiError.conflict(parts.join('; ') || 'One of the serials is already on record.');
}

/**
 * Register serial numbers (and optional barcodes) for any product.
 *
 * When `addToStock` is set the units are also received into a branch: an IN
 * movement is written, the branch balance moves and the item total plus
 * moving-average cost are updated. Without it the serials are only registered
 * (useful when the stock balance already exists).
 */
async function registerSerials(input, actor, req) {
  const item = await itemService.getItemDocumentOrThrow(input.item);
  const parsed = parseSerialBarcodeInput(input.serials);

  if (parsed.tooMany) {
    throw ApiError.badRequest('A single registration can hold at most 500 serial numbers.');
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
  if (!parsed.rows.length) {
    throw ApiError.badRequest('Enter at least one serial number.');
  }

  await assertSerialsAvailable(parsed.rows);

  let supplier = null;
  if (input.supplier) {
    if (!mongoose.isValidObjectId(input.supplier)) {
      throw ApiError.badRequest('Select a valid supplier.');
    }
    supplier = await Supplier.findById(input.supplier).select('_id name code');
    if (!supplier) throw ApiError.badRequest('Select a valid supplier.');
  }

  const addToStock = isTruthy(input.addToStock);
  let branch = null;
  if (addToStock) {
    branch = await branchInventoryService.getAccessibleBranch(actor, input.branch);
  }

  const unitCostPaisa =
    addToStock && itemService.canViewCosts(actor) ? parseUnitCost(input.unitCost) : 0;
  const receivedAt = new Date();
  const reference = await nextRegistrationReference();
  const location = text(input.location, 100) || (branch ? branch.name : '');
  const notes = text(input.notes, 500);
  const qty = parsed.rows.length;

  const docs = parsed.rows.map(({ serial, barcode }) => ({
    serial,
    barcode: barcode || null,
    item: item._id,
    supplier: supplier ? supplier._id : null,
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
        note: addToStock
          ? `Registered and received via ${reference}`
          : `Registered via ${reference} (stock already on record)`,
        reference,
        user: actor ? actor._id : null,
      },
    ],
    notes,
    createdBy: actor ? actor._id : null,
  }));

  let createdSerials = [];
  try {
    createdSerials = await SerialNo.insertMany(docs, { ordered: true });
  } catch (err) {
    if (err && err.code === 11000) {
      throw ApiError.conflict(
        'One of the serials or barcodes was just used by another user. Try again.'
      );
    }
    throw err;
  }

  let movement = null;
  let newStock = Number(item.currentStock || 0);

  if (addToStock) {
    const oldStock = Number(item.currentStock || 0);
    const oldAvg = Number(item.avgCostPaisa || 0);
    const receivedCost = unitCostPaisa > 0 ? unitCostPaisa : oldAvg;
    const newAvg = movingAverageCost(oldStock, oldAvg, qty, receivedCost);

    const branchBalance = await branchInventoryService.addStock(branch._id, item._id, qty);
    newStock = await branchInventoryService.syncItemTotal(item._id);

    movement = await StockMovement.create({
      item: item._id,
      branch: branch._id,
      type: 'IN',
      qty,
      unitCostPaisa: receivedCost,
      balanceAfter: Number(branchBalance.quantity || 0),
      reference,
      referenceType: 'other',
      supplier: supplier ? supplier._id : null,
      serials: createdSerials.map((serial) => serial._id),
      location,
      notes: notes || `Serial registration ${reference}`,
      occurredAt: receivedAt,
      createdBy: actor ? actor._id : null,
    });

    const itemUpdate = { currentStock: newStock, avgCostPaisa: newAvg, hasSerial: true };
    if (unitCostPaisa > 0) itemUpdate.lastPurchasePricePaisa = unitCostPaisa;
    await Item.updateOne({ _id: item._id }, { $set: itemUpdate });
  } else if (!item.hasSerial) {
    await Item.updateOne({ _id: item._id }, { $set: { hasSerial: true } });
  }

  await logAction(
    actor,
    AUDIT_ACTIONS.SERIAL_REGISTERED,
    'serials',
    createdSerials[0] ? createdSerials[0]._id : null,
    null,
    {
      item: item.sku,
      count: qty,
      barcodes: parsed.rows.filter((row) => row.barcode).length,
      reference,
      addedToStock: addToStock,
      branch: branch ? branch.code : null,
      newStock,
    },
    {
      req,
      description: `Registered ${qty} serial${qty === 1 ? '' : 's'} for ${item.sku} (${reference})`,
    }
  );

  return { item, serials: createdSerials, movement, newStock, reference, qty, branch };
}

/**
 * Edit a serial's identifiers and setup fields. Product changes are blocked
 * while the unit is on hand so the two items' stock balances cannot drift.
 */
async function updateSerial(identifier, input, actor, req) {
  const serial = await getSerialDocumentOrThrow(identifier);
  const before = {
    serial: serial.serial,
    barcode: serial.barcode || null,
    item: serial.item,
    location: serial.location,
    notes: serial.notes,
  };

  const nextSerial = normalizeSerial(input.serial || serial.serial);
  if (!isValidSerial(nextSerial)) {
    throw ApiError.badRequest('Serial number must be 2–60 characters using letters, digits and . _ / - only.');
  }

  const nextBarcode =
    input.barcode === undefined ? serial.barcode || null : normalizeBarcode(input.barcode) || null;
  if (nextBarcode && !isValidBarcode(nextBarcode)) {
    throw ApiError.badRequest('Barcode must be 2–80 characters using letters, digits and . _ / + : # - only.');
  }

  let nextItem = serial.item;
  if (input.item && String(input.item) !== String(serial.item)) {
    if (isOnHand(serial.status)) {
      throw ApiError.conflict(
        'Move this unit out of stock before changing its product, so stock balances stay correct.'
      );
    }
    const item = await itemService.getItemDocumentOrThrow(input.item);
    nextItem = item._id;
  }

  const conflictClauses = [];
  if (nextSerial !== serial.serial) conflictClauses.push({ serial: nextSerial });
  if (nextBarcode && nextBarcode !== serial.barcode) conflictClauses.push({ barcode: nextBarcode });
  if (conflictClauses.length) {
    const existing = await SerialNo.findOne({
      _id: { $ne: serial._id },
      $or: conflictClauses,
    })
      .select('serial barcode')
      .lean();
    if (existing) {
      if (existing.serial === nextSerial) {
        throw ApiError.conflict(`Serial ${nextSerial} is already on record.`);
      }
      throw ApiError.conflict(`Barcode ${nextBarcode} is already on record.`);
    }
  }

  if (input.supplier !== undefined) {
    if (!input.supplier) {
      serial.supplier = null;
    } else {
      if (!mongoose.isValidObjectId(input.supplier)) {
        throw ApiError.badRequest('Select a valid supplier.');
      }
      const supplier = await Supplier.findById(input.supplier).select('_id');
      if (!supplier) throw ApiError.badRequest('Select a valid supplier.');
      serial.supplier = supplier._id;
    }
  }

  serial.serial = nextSerial;
  serial.barcode = nextBarcode;
  serial.item = nextItem;
  if (input.location !== undefined) serial.location = text(input.location, 100);
  if (input.notes !== undefined) serial.notes = text(input.notes, 500);

  try {
    await serial.save();
  } catch (err) {
    if (err && err.code === 11000) {
      throw ApiError.conflict('That serial number or barcode is already on record.');
    }
    throw err;
  }

  await logAction(
    actor,
    AUDIT_ACTIONS.SERIAL_UPDATED,
    'serials',
    serial._id,
    before,
    {
      serial: serial.serial,
      barcode: serial.barcode || null,
      item: serial.item,
      location: serial.location,
      notes: serial.notes,
    },
    {
      req,
      description: `Updated serial ${serial.serial}${serial.barcode ? ` (barcode ${serial.barcode})` : ''}`,
    }
  );

  return { serial };
}

async function listSerialOptionsForItem(itemId, limit = 500) {
  if (!mongoose.isValidObjectId(itemId)) return [];
  return SerialNo.find({ item: itemId })
    .select('serial barcode status customer project')
    .sort({ serial: 1 })
    .limit(limit)
    .lean();
}

async function listSupplierOptions(limit = 500) {
  return Supplier.find()
    .select('code name company')
    .sort({ name: 1 })
    .limit(limit)
    .lean();
}

module.exports = {
  buildSerialFilter,
  paginateSerials,
  getSerialStats,
  getSerialDocumentOrThrow,
  getSerialDetail,
  registerSerials,
  updateSerial,
  changeStatus,
  listSerialOptionsForItem,
  listSupplierOptions,
};
