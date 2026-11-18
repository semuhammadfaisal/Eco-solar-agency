/**
 * Inventory item service.
 *
 * Security rule: purchase price and moving-average cost are only ever sent to
 * roles with `purchase_prices.view` (owner, accountant, storekeeper). The
 * stripping happens here, before documents reach a controller or view.
 */
'use strict';

const mongoose = require('mongoose');
const Item = require('../models/Item');
const Brand = require('../models/Brand');
const SerialNo = require('../models/SerialNo');
const StockMovement = require('../models/StockMovement');
const Purchase = require('../models/Purchase');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { can } = require('../config/permissions');
const { escapeRegex, createPagination } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { text, optionalNumber } = require('../utils/inputs');
const {
  ITEM_CATEGORIES,
  ITEM_CATEGORY_LABELS,
  ITEM_CATEGORY_BADGES,
  ITEM_CATEGORY_ICONS,
  ITEM_UNITS,
} = require('../config/inventory');
const branchInventory = require('./branchInventoryService');

const MAX_SEARCH_LENGTH = 80;
const MAX_LIST = 500;

const ITEM_COST_FIELDS = [
  'purchasePricePaisa',
  'avgCostPaisa',
  'stockValuePaisa',
  'lastPurchasePricePaisa',
];

const MOVEMENT_COST_FIELDS = ['unitCostPaisa'];

function cleanSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LENGTH);
}

function canViewCosts(actor) {
  return can(actor, 'purchase_prices.view');
}

function stripFields(entity, fields) {
  if (!entity) return entity;
  for (const field of fields) delete entity[field];
  return entity;
}

function stripItemCosts(item) {
  return stripFields(item, ITEM_COST_FIELDS);
}

function stripMovementCosts(movement) {
  return stripFields(movement, MOVEMENT_COST_FIELDS);
}

function decorateItem(item) {
  if (!item) return item;
  const stock = Number(item.currentStock || 0);
  const min = Number(item.minStock || 0);
  item.isLowStock = stock <= min;
  item.isOutOfStock = stock <= 0;
  item.stockValuePaisa = Math.round(stock * Number(item.avgCostPaisa || 0));
  return item;
}

function applyItemVisibility(items, actor) {
  const list = Array.isArray(items) ? items : [items];
  list.forEach((item) => {
    if (!item) return;
    decorateItem(item);
    if (!canViewCosts(actor)) stripItemCosts(item);
  });
  return items;
}

function applyMovementVisibility(movements, actor) {
  if (canViewCosts(actor)) return movements;
  const list = Array.isArray(movements) ? movements : [movements];
  list.forEach((movement) => stripMovementCosts(movement));
  return movements;
}

function buildItemFilter({ search, category, brand, stock } = {}) {
  const filter = {};

  if (ITEM_CATEGORIES.includes(category)) filter.category = category;
  if (brand) filter.brand = brand;

  if (stock === 'low') {
    filter.$expr = mongoose.trusted({ $lte: ['$currentStock', '$minStock'] });
  } else if (stock === 'out') {
    filter.currentStock = mongoose.trusted({ $lte: 0 });
  } else if (stock === 'in') {
    filter.currentStock = mongoose.trusted({ $gt: 0 });
  }

  const term = cleanSearch(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    filter.$or = [
      { sku: regex },
      { name: regex },
      { brand: regex },
      { model: regex },
      { specs: regex },
    ];
  }

  return filter;
}

async function paginateItems({ search, category, brand, stock, page, limit } = {}, actor) {
  const filter = buildItemFilter({ search, category, brand, stock });
  const total = await Item.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const items = await Item.find(filter)
    .sort({ name: 1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .lean();

  applyItemVisibility(items, actor);

  return { items, total, pagination };
}

async function listBrands() {
  const brands = await Item.distinct('brand', {
    brand: mongoose.trusted({ $ne: '' }),
  });
  return brands.filter(Boolean).sort((a, b) => a.localeCompare(b));
}

async function listItemOptions({ serialOnly = false, limit = MAX_LIST } = {}) {
  const filter = {};
  if (serialOnly) filter.hasSerial = true;

  return Item.find(filter)
    .select('sku name unit hasSerial currentStock minStock category')
    .sort({ name: 1 })
    .limit(limit)
    .lean();
}

/**
 * Item options for the purchase form. This is only called from purchase
 * routes, which are already restricted to purchase-price roles.
 */
async function listPurchaseItemOptions(limit = MAX_LIST) {
  return Item.find()
    .select('sku name unit hasSerial purchasePricePaisa avgCostPaisa')
    .sort({ name: 1 })
    .limit(limit)
    .lean();
}

/**
 * Inventory catalogue used by quotation, package and system-builder forms.
 * Cost fields are removed before the data reaches roles that cannot view them.
 */
async function listItemsForSelector(actor, limit = MAX_LIST) {
  const items = await Item.find()
    .select(
      'sku name category brand model unit wattage capacityKw hasSerial currentStock ' +
        'sellingPricePaisa wholesalePricePaisa retailPricePaisa maxDiscountPercent purchasePricePaisa avgCostPaisa productWarrantyYears'
    )
    .sort({ category: 1, name: 1 })
    .limit(limit)
    .lean();

  items.forEach((item) => {
    item.warrantyYears = Number(item.productWarrantyYears || 0);
  });
  applyItemVisibility(items, actor);
  return items;
}

async function getItemDocumentOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Item not found.');
  const item = await Item.findById(id);
  if (!item) throw ApiError.notFound('Item not found.');
  return item;
}

async function getItemOrThrow(id, actor) {
  const item = await getItemDocumentOrThrow(id);
  const plain = item.toObject({ virtuals: true });
  applyItemVisibility(plain, actor);
  return plain;
}

async function getItemDetail(id, actor) {
  const item = await getItemOrThrow(id, actor);

  const [movements, serialRows, serials, branchBalances] = await Promise.all([
    StockMovement.find({ item: item._id })
      .sort({ occurredAt: -1, createdAt: -1 })
      .limit(50)
      .populate('createdBy', 'name')
      .lean(),
    SerialNo.aggregate([
      { $match: { deletedAt: null, item: new mongoose.Types.ObjectId(id) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    SerialNo.find({ item: item._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('serial status customer project productWarrantyEnd createdAt')
      .lean(),
    branchInventory.branchBalancesForItem(id, Number(item.currentStock || 0)),
  ]);

  const serialStats = {};
  let serialCount = 0;
  for (const row of serialRows) {
    serialStats[row._id] = row.count;
    serialCount += row.count;
  }

  applyMovementVisibility(movements, actor);

  return { item, movements, serials, serialStats, serialCount, branchBalances };
}

/** Header counters for the item list. */
async function getInventorySummary(actor) {
  const [totalItems, lowStock, outOfStock, totals] = await Promise.all([
    Item.countDocuments({}),
    Item.countDocuments({ $expr: mongoose.trusted({ $lte: ['$currentStock', '$minStock'] }) }),
    Item.countDocuments({ currentStock: mongoose.trusted({ $lte: 0 }) }),
    Item.aggregate([
      { $match: { deletedAt: null } },
      {
        $group: {
          _id: null,
          totalUnits: { $sum: '$currentStock' },
          totalValuePaisa: {
            $sum: { $multiply: ['$currentStock', '$avgCostPaisa'] },
          },
        },
      },
    ]),
  ]);

  const row = totals[0] || { totalUnits: 0, totalValuePaisa: 0 };
  const summary = {
    totalItems,
    lowStock,
    outOfStock,
    totalUnits: row.totalUnits || 0,
  };

  if (canViewCosts(actor)) {
    summary.totalValuePaisa = Math.round(row.totalValuePaisa || 0);
  }

  return summary;
}

/**
 * Item counts, units and low-stock counts per category. The Inventory page
 * uses this to render the category shelf above the catalogue table.
 */
async function getCategorySummary() {
  const rows = await Item.aggregate([
    { $match: { deletedAt: null } },
    {
      $group: {
        _id: '$category',
        itemCount: { $sum: 1 },
        units: { $sum: { $ifNull: ['$currentStock', 0] } },
        lowStock: {
          $sum: {
            $cond: [
              { $lte: [{ $ifNull: ['$currentStock', 0] }, { $ifNull: ['$minStock', 0] }] },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const byKey = new Map(rows.map((row) => [row._id, row]));

  return ITEM_CATEGORIES.map((key) => {
    const row = byKey.get(key) || {};
    return {
      key,
      label: ITEM_CATEGORY_LABELS[key] || key,
      badge: ITEM_CATEGORY_BADGES[key] || 'secondary',
      icon: ITEM_CATEGORY_ICONS[key] || 'bi-box',
      itemCount: row.itemCount || 0,
      units: row.units || 0,
      lowStock: row.lowStock || 0,
    };
  });
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

function parseYears(value, label) {
  const number = optionalNumber(value);
  if (number === null) return 0;
  if (number < 0 || number > 50) {
    throw ApiError.badRequest(`${label} must be between 0 and 50 years.`);
  }
  return Math.round(number);
}

function parseStock(value, label) {
  const number = optionalNumber(value);
  if (number === null) return 0;
  if (number < 0) throw ApiError.badRequest(`${label} cannot be negative.`);
  return number;
}

function normalizeItemInput(input = {}, actor, existing = null) {
  const sku = text(input.sku, 40).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]{1,39}$/.test(sku)) {
    throw ApiError.badRequest('SKU must be 2–40 characters using letters, digits and . _ / - only.');
  }

  const name = text(input.name, 150);
  if (!name) throw ApiError.badRequest('Item name is required.');

  const hasSerial = ['1', 'true', 'on', 'yes'].includes(
    String(input.hasSerial || '').toLowerCase()
  );

  const data = {
    sku,
    name,
    category: ITEM_CATEGORIES.includes(input.category) ? input.category : 'other',
    brand: text(input.brand, 100),
    model: text(input.model, 100),
    unit: ITEM_UNITS.includes(input.unit) ? input.unit : 'pcs',
    wattage: optionalNumber(input.wattage),
    capacityKw: optionalNumber(input.capacityKw),
    specs: text(input.specs, 2000),
    hasSerial,
    minStock: parseStock(input.minStock, 'Minimum stock'),
    sellingPricePaisa: parseMoney(input.sellingPrice, 'selling price'),
    wholesalePricePaisa: parseMoney(input.wholesalePrice, 'wholesale price'),
    retailPricePaisa: parseMoney(input.retailPrice, 'retail price'),
    maxDiscountPercent: Math.min(100, Math.max(0, optionalNumber(input.maxDiscountPercent) || 0)),
    brandRef: mongoose.isValidObjectId(input.brandRef) ? input.brandRef : null,
    productWarrantyYears: parseYears(input.productWarrantyYears, 'Product warranty'),
    performanceWarrantyYears: parseYears(
      input.performanceWarrantyYears,
      'Performance warranty'
    ),
    location: text(input.location, 100),
    notes: text(input.notes, 1000),
  };

  // Purchase prices are only accepted from roles allowed to see them.
  if (canViewCosts(actor)) {
    data.purchasePricePaisa = parseMoney(input.purchasePrice, 'purchase price');
  } else if (existing) {
    data.purchasePricePaisa = existing.purchasePricePaisa;
  } else {
    data.purchasePricePaisa = 0;
  }

  if (data.wattage !== null && (data.wattage < 0 || data.wattage > 1000000)) {
    throw ApiError.badRequest('Wattage must be between 0 and 1,000,000 W.');
  }
  if (data.capacityKw !== null && (data.capacityKw < 0 || data.capacityKw > 1000000)) {
    throw ApiError.badRequest('Capacity must be between 0 and 1,000,000 kW.');
  }

  return data;
}

async function assertSkuAvailable(sku, excludeId = null) {
  const filter = { sku };
  if (excludeId) filter._id = mongoose.trusted({ $ne: excludeId });
  const existing = await Item.findOne(filter).select('_id');
  if (existing) throw ApiError.conflict(`SKU ${sku} is already used by another item.`);
}

async function createItem(input, actor, req) {
  const data = normalizeItemInput(input, actor);
  if (data.brandRef) {
    const brand = await Brand.findById(data.brandRef).select('name');
    if (brand) data.brand = brand.name;
  }
  await assertSkuAvailable(data.sku);

  const item = new Item({
    ...data,
    currentStock: 0,
    avgCostPaisa: 0,
    createdBy: actor ? actor._id : null,
  });

  await item.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.ITEM_CREATED,
    'items',
    item._id,
    null,
    item.toObject(),
    { req, description: `Created item ${item.sku} — ${item.name}` }
  );

  return item;
}

async function updateItem(id, input, actor, req) {
  const item = await getItemDocumentOrThrow(id);
  const before = item.toObject();
  const data = normalizeItemInput(input, actor, item);
  if (data.brandRef) {
    const brand = await Brand.findById(data.brandRef).select('name');
    if (brand) data.brand = brand.name;
  }

  if (data.hasSerial !== Boolean(item.hasSerial)) {
    if (Number(item.currentStock || 0) !== 0) {
      throw ApiError.conflict(
        'Serial tracking can only be changed while stock is zero. Adjust stock to zero first.'
      );
    }
    const serialCount = await SerialNo.countDocuments({ item: item._id });
    if (serialCount > 0) {
      throw ApiError.conflict(
        'This item already has serial records. Serial tracking cannot be turned off.'
      );
    }
  }

  await assertSkuAvailable(data.sku, item._id);

  Object.assign(item, data);
  await item.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.ITEM_UPDATED,
    'items',
    item._id,
    before,
    item.toObject(),
    { req, description: `Updated item ${item.sku} — ${item.name}` }
  );

  return item;
}

async function softDeleteItem(id, actor, req) {
  const item = await getItemDocumentOrThrow(id);

  if (Number(item.currentStock || 0) !== 0) {
    throw ApiError.conflict('This item still has stock on hand. Adjust it to zero before deleting.');
  }

  const serialCount = await SerialNo.countDocuments({ item: item._id });
  if (serialCount > 0) {
    throw ApiError.conflict('This item has serial records and cannot be deleted.');
  }

  const openPurchases = await Purchase.countDocuments({
    'items.item': item._id,
    status: mongoose.trusted({ $in: ['ordered', 'partial'] }),
  });
  if (openPurchases > 0) {
    throw ApiError.conflict(
      'This item appears on open purchase orders. Receive or cancel them before deleting it.'
    );
  }

  const before = item.toObject();
  await item.softDelete(actor ? actor._id : null);

  await logAction(
    actor,
    AUDIT_ACTIONS.ITEM_DELETED,
    'items',
    item._id,
    before,
    { deletedAt: item.deletedAt },
    { req, description: `Deleted item ${item.sku} — ${item.name}` }
  );

  return item;
}

/** Used by purchaseService while creating a PO. */
async function findItemsByIds(ids) {
  return Item.find({ _id: mongoose.trusted({ $in: ids }) }).lean();
}

module.exports = {
  ITEM_COST_FIELDS,
  MOVEMENT_COST_FIELDS,
  canViewCosts,
  stripItemCosts,
  stripMovementCosts,
  applyItemVisibility,
  applyMovementVisibility,
  decorateItem,
  buildItemFilter,
  paginateItems,
  listBrands,
  listItemOptions,
  listPurchaseItemOptions,
  listItemsForSelector,
  getItemOrThrow,
  getItemDocumentOrThrow,
  getItemDetail,
  getInventorySummary,
  getCategorySummary,
  createItem,
  updateItem,
  softDeleteItem,
  findItemsByIds,
};
