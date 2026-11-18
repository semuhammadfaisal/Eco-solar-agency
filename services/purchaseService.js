/**
 * Purchase service — purchase orders (PO) and goods-received notes (GRN).
 *
 * Receiving stock is the only place that raises an item's stock from a
 * purchase. It writes one StockMovement per received line, creates serial rows
 * for serialised items, updates the item's moving-average cost and appends a
 * receipt snapshot to the purchase document.
 *
 * There are no multi-document transactions on the supported MongoDB setup, so
 * every input is validated before the first write.
 */
'use strict';

const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');
const Item = require('../models/Item');
const Supplier = require('../models/Supplier');
const SerialNo = require('../models/SerialNo');
const StockMovement = require('../models/StockMovement');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { escapeRegex, createPagination } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { text } = require('../utils/inputs');
const { toDay, parseDateKey, addYears } = require('../utils/dates');
const { parseSerialInput } = require('../utils/serials');
const { PURCHASE_STATUSES, PAYMENT_STATUSES } = require('../config/inventory');
const accountingService = require('./accountingService');
const branchInventoryService = require('./branchInventoryService');

const MAX_SEARCH_LENGTH = 80;
const EPSILON = 0.000001;

function cleanSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LENGTH);
}

function parseMoney(value, label) {
  if (value === '' || value === null || value === undefined) return 0;
  try {
    const paisa = toPaisa(value);
    if (paisa < 0) throw new Error('negative');
    return paisa;
  } catch (_err) {
    throw ApiError.badRequest(`Enter a valid ${label}.`);
  }
}

function parseQty(value, label) {
  if (value === '' || value === null || value === undefined) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw ApiError.badRequest(`Enter a valid ${label}.`);
  }
  return number;
}

function derivePaymentStatus(paidPaisa, totalPaisa) {
  if (totalPaisa <= 0) return 'unpaid';
  if (paidPaisa >= totalPaisa) return 'paid';
  return paidPaisa > 0 ? 'partial' : 'unpaid';
}

function decoratePurchase(purchase) {
  if (!purchase) return purchase;
  const total = Number(purchase.totalPaisa || 0);
  const paid = Number(purchase.paidPaisa || 0);
  purchase.outstandingPaisa = Math.max(0, total - paid);
  purchase.receivedPaisa = (purchase.items || []).reduce(
    (sum, line) => sum + Math.round(Number(line.qty || 0) * Number(line.unitCostPaisa || 0)),
    0
  );
  purchase.receivedUnits = (purchase.items || []).reduce(
    (sum, line) => sum + Number(line.receivedQty || 0),
    0
  );
  purchase.orderedUnits = (purchase.items || []).reduce(
    (sum, line) => sum + Number(line.qty || 0),
    0
  );
  purchase.isFullyReceived =
    Array.isArray(purchase.items) &&
    purchase.items.length > 0 &&
    purchase.items.every(
      (line) => Number(line.receivedQty || 0) + EPSILON >= Number(line.qty || 0)
    );
  return purchase;
}

/** Supplier ids matching a free-text search (so supplier name works in the list). */
async function supplierIdsForSearch(term) {
  if (!term) return [];
  const regex = new RegExp(escapeRegex(term), 'i');
  const suppliers = await Supplier.find({
    $or: [{ name: regex }, { company: regex }, { code: regex }, { phone: regex }],
  })
    .select('_id')
    .limit(200)
    .lean();
  return suppliers.map((supplier) => supplier._id);
}

async function buildPurchaseFilter({ search, status, paymentStatus, supplier, from, to } = {}) {
  const filter = {};

  if (PURCHASE_STATUSES.includes(status)) filter.status = status;
  if (PAYMENT_STATUSES.includes(paymentStatus)) filter.paymentStatus = paymentStatus;
  if (supplier && mongoose.isValidObjectId(supplier)) filter.supplier = supplier;

  if (from || to) {
    filter.purchaseDate = {};
    const start = parseDateKey(from);
    if (start) filter.purchaseDate.$gte = start;
    const end = parseDateKey(to);
    if (end) {
      filter.purchaseDate.$lt = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
    if (!Object.keys(filter.purchaseDate).length) delete filter.purchaseDate;
  }

  const term = cleanSearch(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    const supplierIds = await supplierIdsForSearch(term);
    const clauses = [{ number: regex }, { invoiceNo: regex }, { notes: regex }];
    if (supplierIds.length) clauses.push({ supplier: mongoose.trusted({ $in: supplierIds }) });
    filter.$or = clauses;
  }

  return filter;
}

async function paginatePurchases({
  search,
  status,
  paymentStatus,
  supplier,
  from,
  to,
  page,
  limit,
} = {}) {
  const filter = await buildPurchaseFilter({
    search,
    status,
    paymentStatus,
    supplier,
    from,
    to,
  });

  const total = await Purchase.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const items = await Purchase.find(filter)
    .sort({ purchaseDate: -1, createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .populate('supplier', 'code name company city')
    .populate('createdBy', 'name')
    .lean();

  items.forEach(decoratePurchase);

  return { items, total, pagination };
}

async function getPurchaseStats() {
  const [rows] = await Purchase.aggregate([
    { $match: { deletedAt: null } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        ordered: { $sum: { $cond: [{ $eq: ['$status', 'ordered'] }, 1, 0] } },
        partial: { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
        received: { $sum: { $cond: [{ $eq: ['$status', 'received'] }, 1, 0] } },
        payablePaisa: {
          $sum: {
            $cond: [
              { $ne: ['$status', 'cancelled'] },
              {
                $max: [
                  0,
                  { $subtract: ['$totalPaisa', { $ifNull: ['$paidPaisa', 0] }] },
                ],
              },
              0,
            ],
          },
        },
      },
    },
  ]);

  const row = rows || {};
  return {
    total: row.total || 0,
    ordered: row.ordered || 0,
    partial: row.partial || 0,
    received: row.received || 0,
    payablePaisa: Math.round(row.payablePaisa || 0),
  };
}

async function getPurchaseDocumentOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Purchase order not found.');
  const purchase = await Purchase.findById(id);
  if (!purchase) throw ApiError.notFound('Purchase order not found.');
  return purchase;
}

async function getPurchaseDetail(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Purchase order not found.');
  const purchase = await Purchase.findById(id)
    .populate('supplier', 'code name company contactName phone email city address')
    .populate('createdBy', 'name')
    .populate('receipts.receivedBy', 'name')
    .lean();

  if (!purchase) throw ApiError.notFound('Purchase order not found.');
  decoratePurchase(purchase);

  const serialRows = await SerialNo.find({ purchase: purchase._id })
    .select('serial item status createdAt')
    .populate('item', 'sku name')
    .sort({ serial: 1 })
    .lean();

  const serialsByLine = new Map();
  for (const serial of serialRows) {
    const key = String(serial.item && serial.item._id ? serial.item._id : serial.item);
    if (!serialsByLine.has(key)) serialsByLine.set(key, []);
    serialsByLine.get(key).push(serial);
  }

  return { purchase, serials: serialRows, serialsByLine };
}

/**
 * Validate and normalise the lines submitted on the PO form.
 * @param {object} input Request body
 * @returns {Promise<Array<object>>}
 */
async function normalizeLines(input) {
  const rawLines = Array.isArray(input.items) ? input.items : [];
  if (!rawLines.length) throw ApiError.badRequest('Add at least one item to the purchase order.');

  const requested = [];
  const seen = new Set();

  for (const raw of rawLines) {
    const itemId = raw && raw.item;
    if (!itemId) continue;
    if (!mongoose.isValidObjectId(itemId)) {
      throw ApiError.badRequest('Select a valid item on every purchase line.');
    }
    if (seen.has(String(itemId))) {
      throw ApiError.badRequest('The same item appears on more than one line. Combine the quantities.');
    }
    seen.add(String(itemId));

    const qty = parseQty(raw.qty, 'quantity');
    if (qty <= 0) throw ApiError.badRequest('Every line must have a quantity greater than zero.');
    const unitCostPaisa = parseMoney(raw.unitCost, 'unit cost');
    if (unitCostPaisa <= 0) {
      throw ApiError.badRequest('Every line must have a unit cost greater than zero.');
    }

    requested.push({ item: itemId, qty, unitCostPaisa });
  }

  if (!requested.length) {
    throw ApiError.badRequest('Add at least one item to the purchase order.');
  }

  const items = await Item.find({
    _id: mongoose.trusted({ $in: requested.map((line) => line.item) }),
  }).lean();
  const byId = new Map(items.map((item) => [String(item._id), item]));

  return requested.map((line) => {
    const item = byId.get(String(line.item));
    if (!item) throw ApiError.badRequest('One of the selected items no longer exists.');

    if (item.hasSerial && !Number.isInteger(line.qty)) {
      throw ApiError.badRequest(
        `${item.sku} is serial-tracked, so its quantity must be a whole number.`
      );
    }

    return {
      item: item._id,
      sku: item.sku,
      name: item.name,
      unit: item.unit,
      qty: line.qty,
      unitCostPaisa: line.unitCostPaisa,
      receivedQty: 0,
      hasSerial: Boolean(item.hasSerial),
    };
  });
}

function resolvePaidAmount(input, totalPaisa) {
  let paid = null;
  if (input.paidAmount !== undefined && input.paidAmount !== '') {
    paid = parseMoney(input.paidAmount, 'amount paid');
  } else if (input.paymentStatus === 'paid') {
    paid = totalPaisa;
  } else if (input.paymentStatus === 'unpaid') {
    paid = 0;
  }

  if (paid === null) paid = 0;
  return Math.min(totalPaisa, Math.max(0, paid));
}

async function nextPurchaseNumber() {
  const seq = await Counter.next('purchase');
  return `PO-${String(seq).padStart(4, '0')}`;
}

async function nextReceiptNumber() {
  const seq = await Counter.next('grn');
  return `GRN-${String(seq).padStart(4, '0')}`;
}

async function assertSupplier(supplierId) {
  if (!mongoose.isValidObjectId(supplierId)) {
    throw ApiError.badRequest('Select a valid supplier.');
  }
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw ApiError.badRequest('Select a valid supplier.');
  return supplier;
}

async function createPurchase(input, actor, req) {
  const supplier = await assertSupplier(input.supplier);
  const items = await normalizeLines(input);
  const totalPaisa = items.reduce(
    (sum, line) => sum + Math.round(Number(line.qty) * Number(line.unitCostPaisa)),
    0
  );
  const paidPaisa = resolvePaidAmount(input, totalPaisa);

  const purchase = new Purchase({
    number: await nextPurchaseNumber(),
    supplier: supplier._id,
    invoiceNo: text(input.invoiceNo, 60),
    purchaseDate: toDay(input.purchaseDate) || new Date(),
    status: 'ordered',
    paymentStatus: derivePaymentStatus(paidPaisa, totalPaisa),
    items,
    totalPaisa,
    paidPaisa,
    notes: text(input.notes, 1000),
    createdBy: actor ? actor._id : null,
  });

  await purchase.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.PURCHASE_CREATED,
    'purchases',
    purchase._id,
    null,
    purchase.toObject(),
    { req, description: `Created purchase order ${purchase.number} for ${supplier.name}` }
  );

  return purchase;
}

async function updatePurchase(id, input, actor, req) {
  const purchase = await getPurchaseDocumentOrThrow(id);
  if (purchase.status !== 'ordered' || (purchase.receipts || []).length > 0) {
    throw ApiError.conflict('Only an unreceived purchase order can be edited.');
  }

  const supplier = await assertSupplier(input.supplier);
  const items = await normalizeLines(input);
  const totalPaisa = items.reduce(
    (sum, line) => sum + Math.round(Number(line.qty) * Number(line.unitCostPaisa)),
    0
  );

  if (totalPaisa < Number(purchase.paidPaisa || 0)) {
    throw ApiError.conflict(
      'The new total is less than the amount already paid. Record the correct payment before editing.'
    );
  }

  const before = purchase.toObject();
  const paidPaisa = resolvePaidAmount(input, totalPaisa);

  purchase.supplier = supplier._id;
  purchase.invoiceNo = text(input.invoiceNo, 60);
  purchase.purchaseDate = toDay(input.purchaseDate) || purchase.purchaseDate;
  purchase.items = items;
  purchase.totalPaisa = totalPaisa;
  purchase.paidPaisa = paidPaisa;
  purchase.paymentStatus = derivePaymentStatus(paidPaisa, totalPaisa);
  purchase.notes = text(input.notes, 1000);

  await purchase.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.PURCHASE_UPDATED,
    'purchases',
    purchase._id,
    before,
    purchase.toObject(),
    { req, description: `Updated purchase order ${purchase.number}` }
  );

  return purchase;
}

async function cancelPurchase(id, actor, req) {
  const purchase = await getPurchaseDocumentOrThrow(id);
  if (purchase.status === 'cancelled') throw ApiError.conflict('This purchase order is already cancelled.');
  if (purchase.status === 'received') {
    throw ApiError.conflict('A fully received purchase order cannot be cancelled.');
  }
  if ((purchase.receipts || []).length > 0) {
    throw ApiError.conflict('Stock has already been received against this order, so it cannot be cancelled.');
  }

  const before = purchase.toObject();
  purchase.status = 'cancelled';
  await purchase.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.PURCHASE_CANCELLED,
    'purchases',
    purchase._id,
    before,
    purchase.toObject(),
    { req, description: `Cancelled purchase order ${purchase.number}` }
  );

  return purchase;
}

async function recordPayment(id, input, actor, req) {
  const purchase = await getPurchaseDocumentOrThrow(id);
  if (purchase.status === 'cancelled') {
    throw ApiError.conflict('Cannot record a payment against a cancelled purchase order.');
  }

  const amount = parseMoney(input.amount, 'payment amount');
  if (amount <= 0) throw ApiError.badRequest('Enter a payment amount greater than zero.');

  const outstanding = Math.max(0, Number(purchase.totalPaisa || 0) - Number(purchase.paidPaisa || 0));
  if (amount > outstanding) {
    throw ApiError.badRequest(
      `The payment exceeds the outstanding balance of ${(outstanding / 100).toFixed(2)} PKR.`
    );
  }

  const before = purchase.toObject();
  purchase.paidPaisa = Number(purchase.paidPaisa || 0) + amount;
  purchase.paymentStatus = derivePaymentStatus(purchase.paidPaisa, purchase.totalPaisa);
  await purchase.save();

  // Step 10: Auto-post supplier payment in double-entry ledger
  try {
    const isCash = String(input.paymentMethod || '').toLowerCase() === 'cash';
    await accountingService.postSupplierPayment(
      {
        supplierId: purchase.supplier,
        amountPaisa: amount,
        paymentAccountCode: isCash ? '1010' : '1020',
        reference: purchase.number,
        notes: `PO Payment: ${purchase.number}`,
      },
      actor,
      req
    );
  } catch (accErr) {
    console.error('[accounting] purchase recordPayment error:', accErr.message);
  }

  await logAction(
    actor,
    AUDIT_ACTIONS.PURCHASE_PAYMENT_RECORDED,
    'purchases',
    purchase._id,
    before,
    purchase.toObject(),
    {
      req,
      description: `Recorded a payment of ${(amount / 100).toFixed(2)} PKR on ${purchase.number}`,
    }
  );

  return purchase;
}

/**
 * Receive stock against a PO and create the GRN.
 *
 * Input shape (indexed by purchase line position):
 *   received[0]=10, serials[0]=one serial per line, receivedAt=YYYY-MM-DD
 *
 * @returns {Promise<{purchase: object, receipt: object, serialCount: number}>}
 */
async function receivePurchase(id, input, actor, req) {
  const purchase = await getPurchaseDocumentOrThrow(id);

  if (purchase.status === 'cancelled') {
    throw ApiError.conflict('A cancelled purchase order cannot receive stock.');
  }
  if (purchase.status === 'received' || purchase.isFullyReceived) {
    throw ApiError.conflict('Every line on this purchase order has already been received.');
  }

  const supplier = await Supplier.findById(purchase.supplier);
  if (!supplier) throw ApiError.badRequest('The supplier for this purchase no longer exists.');

  const receivedAt = toDay(input.receivedAt) || new Date();
  const receiptBranch = await branchInventoryService.getAccessibleBranch(actor, input.branch || purchase.branch);
  const location = text(input.location, 100) || receiptBranch.name;

  const receivedValues = Array.isArray(input.received) ? input.received : [];
  const serialInputs = Array.isArray(input.serials) ? input.serials : [];

  const entries = [];
  const allSerials = new Map(); // serial -> line index

  purchase.items.forEach((line, index) => {
    const qty = parseQty(receivedValues[index], 'received quantity');
    if (qty <= 0) return;

    const remaining = Number(line.qty || 0) - Number(line.receivedQty || 0);
    if (qty > remaining + EPSILON) {
      throw ApiError.badRequest(
        `Cannot receive ${qty} of ${line.sku}; only ${remaining} remains outstanding.`
      );
    }

    let serials = [];
    if (line.hasSerial) {
      if (!Number.isInteger(qty)) {
        throw ApiError.badRequest(`Received quantity for ${line.sku} must be a whole number.`);
      }

      const parsed = parseSerialInput(serialInputs[index]);
      if (parsed.tooMany) {
        throw ApiError.badRequest(`A single line can hold at most 500 serial numbers.`);
      }
      if (parsed.invalid.length) {
        throw ApiError.badRequest(
          `Invalid serial number for ${line.sku}: ${parsed.invalid.slice(0, 3).join(', ')}`
        );
      }
      if (parsed.duplicates.length) {
        throw ApiError.badRequest(
          `Duplicate serial number for ${line.sku}: ${parsed.duplicates.slice(0, 3).join(', ')}`
        );
      }
      if (parsed.serials.length !== qty) {
        throw ApiError.badRequest(
          `${line.sku} needs exactly ${qty} serial number${qty === 1 ? '' : 's'}, but ${parsed.serials.length} were supplied.`
        );
      }

      for (const serial of parsed.serials) {
        if (allSerials.has(serial)) {
          throw ApiError.badRequest(`Serial ${serial} appears on more than one line.`);
        }
        allSerials.set(serial, index);
      }
      serials = parsed.serials;
    }

    entries.push({ index, line, qty, serials });
  });

  if (!entries.length) {
    throw ApiError.badRequest('Enter a quantity to receive on at least one line.');
  }

  // Reject serials that already exist anywhere, including soft-deleted rows,
  // so a serial number can never point at two different units.
  if (allSerials.size) {
    const existing = await SerialNo.find({
      serial: mongoose.trusted({ $in: [...allSerials.keys()] }),
    })
      .setOptions({ withDeleted: true })
      .select('serial')
      .lean();

    if (existing.length) {
      throw ApiError.conflict(
        `These serial numbers already exist: ${existing
          .slice(0, 5)
          .map((row) => row.serial)
          .join(', ')}`
      );
    }
  }

  const itemIds = [...new Set(entries.map((entry) => String(entry.line.item)))];
  const itemDocs = await Item.find({
    _id: mongoose.trusted({ $in: itemIds.map((itemId) => new mongoose.Types.ObjectId(itemId)) }),
  }).lean();
  const itemById = new Map(itemDocs.map((item) => [String(item._id), item]));

  for (const itemId of itemIds) {
    if (!itemById.has(String(itemId))) {
      throw ApiError.conflict('One of the items on this order no longer exists. Cancel the order instead.');
    }
  }

  const receiptNumber = await nextReceiptNumber();
  const now = new Date();

  const receiptLines = [];
  const serialDocs = [];
  const movementDocs = [];

  // Work out the new balance and moving-average cost per line before writing.
  const runningStock = new Map(
    itemDocs.map((item) => [String(item._id), Number(item.currentStock || 0)])
  );
  const runningAvg = new Map(
    itemDocs.map((item) => [String(item._id), Number(item.avgCostPaisa || 0)])
  );

  for (const entry of entries) {
    const itemId = String(entry.line.item);
    const item = itemById.get(itemId);
    const currentStock = runningStock.get(itemId) || 0;
    const currentAvg = runningAvg.get(itemId) || 0;
    const receivedValue = Math.round(entry.qty * Number(entry.line.unitCostPaisa || 0));

    const newStock = currentStock + entry.qty;
    const newAvg = newStock > 0 ? Math.round((currentStock * currentAvg + receivedValue) / newStock) : 0;

    runningStock.set(itemId, newStock);
    runningAvg.set(itemId, newAvg);

    entry.newStock = newStock;
    entry.newAvg = newAvg;
    entry.itemDoc = item;

    receiptLines.push({
      item: entry.line.item,
      qty: entry.qty,
      unitCostPaisa: entry.line.unitCostPaisa,
    });

    for (const serial of entry.serials) {
      serialDocs.push({
        serial,
        item: entry.line.item,
        purchase: purchase._id,
        purchaseLineId: entry.line._id,
        supplier: supplier._id,
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
            note: `Received on ${receiptNumber}`,
            reference: receiptNumber,
            user: actor ? actor._id : null,
          },
        ],
        createdBy: actor ? actor._id : null,
      });
    }

    movementDocs.push({
      item: entry.line.item,
      branch: receiptBranch._id,
      type: 'IN',
      qty: entry.qty,
      unitCostPaisa: entry.line.unitCostPaisa,
      balanceAfter: newStock,
      reference: receiptNumber,
      referenceType: 'purchase',
      referenceId: purchase._id,
      supplier: supplier._id,
      location,
      occurredAt: receivedAt,
      createdBy: actor ? actor._id : null,
    });
  }

  // 1. Serial rows first. A duplicate key here leaves stock untouched.
  let createdSerials = [];
  if (serialDocs.length) {
    try {
      createdSerials = await SerialNo.insertMany(serialDocs, { ordered: true });
    } catch (err) {
      if (err && err.code === 11000) {
        throw ApiError.conflict('One of the serial numbers was just used by another receipt. Try again.');
      }
      throw err;
    }

    const bySerial = new Map(createdSerials.map((doc) => [doc.serial, doc]));
    for (const movement of movementDocs) {
      const lineIndex = entries.findIndex(
        (entry) => String(entry.line.item) === String(movement.item)
      );
      if (lineIndex === -1) continue;
      const entry = entries[lineIndex];
      if (!entry.serials.length) continue;
      movement.serials = entry.serials
        .map((serial) => bySerial.get(serial))
        .filter(Boolean)
        .map((doc) => doc._id);
    }
  }

  // 2. Ledger rows and item balances.
  for (let index = 0; index < entries.length; index += 1) {
    const branchBalance = await branchInventoryService.addStock(receiptBranch._id, entries[index].line.item, entries[index].qty);
    movementDocs[index].balanceAfter = branchBalance.quantity;
  }
  if (movementDocs.length) await StockMovement.insertMany(movementDocs, { ordered: true });

  for (const entry of entries) {
    await Item.updateOne(
      { _id: entry.line.item },
      {
        $set: {
          currentStock: entry.newStock,
          avgCostPaisa: entry.newAvg,
          lastPurchasePricePaisa: entry.line.unitCostPaisa,
        },
      }
    );
    entry.line.receivedQty = Number(entry.line.receivedQty || 0) + entry.qty;
  }

  // 3. Snapshot the GRN on the purchase and advance its status.
  if (!purchase.invoiceNo && input.invoiceNo) purchase.invoiceNo = text(input.invoiceNo, 60);

  const receipt = {
    number: receiptNumber,
    receivedAt,
    receivedBy: actor ? actor._id : null,
    branch: receiptBranch._id,
    notes: text(input.notes, 500),
    lines: receiptLines,
  };
  purchase.receipts.push(receipt);
  purchase.branch = receiptBranch._id;
  purchase.status = purchase.isFullyReceived ? 'received' : 'partial';
  await purchase.save();

  // Step 10: Auto-post Inventory Asset debit and Accounts Payable credit for GRN
  try {
    const receivedTotalPaisa = entries.reduce(
      (sum, e) => sum + e.qty * (e.line.unitCostPaisa || 0),
      0
    );
    if (receivedTotalPaisa > 0) {
      await accountingService.createJournalEntry(
        {
          date: receivedAt,
          memo: `Goods Received Note (${receiptNumber}) on PO ${purchase.number}`,
          referenceType: 'purchase',
          referenceId: purchase._id,
          lines: [
            {
              accountCode: '1040',
              debitPaisa: receivedTotalPaisa,
              creditPaisa: 0,
              description: `Inventory Asset GRN ${receiptNumber}`,
            },
            {
              accountCode: '2010',
              debitPaisa: 0,
              creditPaisa: receivedTotalPaisa,
              description: `Accounts Payable GRN ${receiptNumber} (${supplier.name})`,
            },
          ],
          actor,
        },
        { req }
      );
    }
  } catch (accErr) {
    console.error('[accounting] receivePurchase post error:', accErr.message);
  }

  await logAction(
    actor,
    AUDIT_ACTIONS.PURCHASE_RECEIVED,
    'purchases',
    purchase._id,
    null,
    {
      receipt: receiptNumber,
      status: purchase.status,
      lines: receiptLines,
      serials: createdSerials.length,
    },
    {
      req,
      description: `Received ${receiptNumber} against ${purchase.number} (${createdSerials.length} serials)`,
    }
  );

  return { purchase, receipt, serialCount: createdSerials.length, itemCount: entries.length };
}

/** Serial rows for a purchase, grouped by purchase line item. */
async function listPurchaseSerials(purchaseId) {
  return SerialNo.find({ purchase: purchaseId })
    .select('serial item status customer project createdAt')
    .populate({ path: 'item', select: 'sku name' })
    .sort({ serial: 1 })
    .lean();
}

module.exports = {
  buildPurchaseFilter,
  paginatePurchases,
  getPurchaseStats,
  getPurchaseDocumentOrThrow,
  getPurchaseDetail,
  createPurchase,
  updatePurchase,
  cancelPurchase,
  recordPayment,
  receivePurchase,
  listPurchaseSerials,
  nextPurchaseNumber,
  nextReceiptNumber,
  derivePaymentStatus,
  decoratePurchase,
};
