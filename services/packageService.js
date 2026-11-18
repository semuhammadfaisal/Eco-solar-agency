'use strict';

const mongoose = require('mongoose');
const Package = require('../models/Package');
const Item = require('../models/Item');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { text, optionalNumber } = require('../utils/inputs');
const { paginate, escapeRegex } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { can } = require('../config/permissions');
const { SYSTEM_TYPES } = require('../config/systems');

async function nextPackageCode() {
  const seq = await Counter.next('package');
  return `PKG-${String(seq).padStart(4, '0')}`;
}

/**
 * Validates and formats item lines for a package.
 */
async function normalizePackageItems(rawItems = []) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    return [];
  }

  const items = [];
  for (const entry of rawItems) {
    const itemId = entry.item || entry.itemId;
    if (!itemId || !mongoose.isValidObjectId(itemId)) continue;

    const qty = Number(entry.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;

    items.push({
      item: itemId,
      qty,
      notes: text(entry.notes, 300),
    });
  }

  return items;
}

/**
 * List packages with filtering and pagination.
 */
async function listPackages(query = {}, user) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 20));

  const filter = {};
  if (query.systemType && SYSTEM_TYPES.includes(query.systemType)) {
    filter.systemType = query.systemType;
  }
  if (query.status === 'active') {
    filter.isActive = true;
  } else if (query.status === 'inactive') {
    filter.isActive = false;
  }

  const search = text(query.search, 80);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: regex }, { code: regex }, { description: regex }];
  }

  const [total, packages] = await Promise.all([
    Package.countDocuments(filter),
    Package.find(filter)
      .populate('items.item', 'name sku category brand model wattage capacityKw sellingPricePaisa')
      .populate('createdBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return {
    packages,
    total,
    pagination: paginate(total, page, limit),
  };
}

/**
 * Get active package templates for dropdown selection.
 */
async function listActivePackages() {
  return Package.find({ isActive: true })
    .select('code name systemType capacityKw description laborCostPaisa transportCostPaisa netMeteringCostPaisa')
    .sort({ capacityKw: 1, name: 1 })
    .lean();
}

/**
 * Get package by ID or throw 404.
 */
async function getPackageOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('Package not found.');
  }

  const pkg = await Package.findById(id)
    .populate('items.item')
    .populate('createdBy', 'name')
    .lean();

  if (!pkg) {
    throw ApiError.notFound('Package not found.');
  }

  return pkg;
}

/**
 * Get package specifically formatted for the interactive System Builder.
 */
async function getPackageForBuilder(id, user) {
  const pkg = await getPackageOrThrow(id);
  const canSeeCosts = can(user, 'costs.view');

  const lines = (pkg.items || [])
    .filter((entry) => Boolean(entry.item))
    .map((entry) => {
      const it = entry.item;
      return {
        item: it._id,
        itemSnapshot: {
          sku: it.sku,
          name: it.name,
          category: it.category,
          brand: it.brand,
          model: it.model,
          unit: it.unit,
          wattage: it.wattage,
          capacityKw: it.capacityKw,
        },
        qty: entry.qty,
        currentStock: it.currentStock || 0,
        unitSellingPricePaisa: it.sellingPricePaisa || 0,
        unitCostPaisa: canSeeCosts ? (it.avgCostPaisa || it.purchasePricePaisa || 0) : 0,
        notes: entry.notes || '',
      };
    });

  return {
    id: pkg._id,
    code: pkg.code,
    name: pkg.name,
    systemType: pkg.systemType,
    capacityKw: pkg.capacityKw,
    description: pkg.description,
    laborCostPaisa: canSeeCosts ? pkg.laborCostPaisa : 0,
    transportCostPaisa: canSeeCosts ? pkg.transportCostPaisa : 0,
    netMeteringCostPaisa: canSeeCosts ? pkg.netMeteringCostPaisa : 0,
    additionalCostPaisa: canSeeCosts ? pkg.additionalCostPaisa : 0,
    defaultDiscountPercent: pkg.defaultDiscountPercent || 0,
    lines,
  };
}

/**
 * Create a new Package template.
 */
async function createPackage(payload, actor, req) {
  const name = text(payload.name, 150);
  if (!name) throw ApiError.badRequest('Package name is required.');

  const capacityKw = optionalNumber(payload.capacityKw);
  if (!capacityKw || capacityKw <= 0) {
    throw ApiError.badRequest('Enter a valid system capacity in kW.');
  }

  const systemType = SYSTEM_TYPES.includes(payload.systemType)
    ? payload.systemType
    : 'on_grid';

  const code = payload.code ? text(payload.code, 30).toUpperCase() : await nextPackageCode();
  const items = await normalizePackageItems(payload.items);

  const laborCostPaisa =
    payload.laborCost !== undefined && payload.laborCost !== ''
      ? toPaisa(payload.laborCost)
      : Math.round(Number(payload.laborCostPaisa) || 0);

  const transportCostPaisa =
    payload.transportCost !== undefined && payload.transportCost !== ''
      ? toPaisa(payload.transportCost)
      : Math.round(Number(payload.transportCostPaisa) || 0);

  const netMeteringCostPaisa =
    payload.netMeteringCost !== undefined && payload.netMeteringCost !== ''
      ? toPaisa(payload.netMeteringCost)
      : Math.round(Number(payload.netMeteringCostPaisa) || 0);

  const additionalCostPaisa =
    payload.additionalCost !== undefined && payload.additionalCost !== ''
      ? toPaisa(payload.additionalCost)
      : Math.round(Number(payload.additionalCostPaisa) || 0);

  const defaultDiscountPercent = Math.min(
    100,
    Math.max(0, Number(payload.defaultDiscountPercent) || 0)
  );

  const pkg = await Package.create({
    code,
    name,
    systemType,
    capacityKw,
    description: text(payload.description, 2000),
    items,
    laborCostPaisa,
    transportCostPaisa,
    netMeteringCostPaisa,
    additionalCostPaisa,
    defaultDiscountPercent,
    isActive: payload.isActive !== false && payload.isActive !== '0' && payload.isActive !== 'false',
    createdBy: actor ? actor._id : null,
  });

  await logAction(
    actor,
    AUDIT_ACTIONS.PACKAGE_CREATED,
    'packages',
    pkg._id,
    null,
    pkg.toObject(),
    { req, description: `Package ${pkg.code} (${pkg.name}) created` }
  );

  return pkg;
}

/**
 * Update an existing package template.
 */
async function updatePackage(id, payload, actor, req) {
  const pkg = await Package.findById(id);
  if (!pkg) throw ApiError.notFound('Package not found.');

  const before = pkg.toObject();

  if (payload.name !== undefined) {
    const name = text(payload.name, 150);
    if (!name) throw ApiError.badRequest('Package name cannot be empty.');
    pkg.name = name;
  }

  if (payload.systemType && SYSTEM_TYPES.includes(payload.systemType)) {
    pkg.systemType = payload.systemType;
  }

  if (payload.capacityKw !== undefined) {
    const kw = optionalNumber(payload.capacityKw);
    if (kw && kw > 0) pkg.capacityKw = kw;
  }

  if (payload.description !== undefined) {
    pkg.description = text(payload.description, 2000);
  }

  if (payload.items !== undefined) {
    pkg.items = await normalizePackageItems(payload.items);
  }

  if (payload.laborCost !== undefined && payload.laborCost !== '') {
    pkg.laborCostPaisa = toPaisa(payload.laborCost);
  } else if (payload.laborCostPaisa !== undefined) {
    pkg.laborCostPaisa = Math.max(0, Math.round(Number(payload.laborCostPaisa) || 0));
  }

  if (payload.transportCost !== undefined && payload.transportCost !== '') {
    pkg.transportCostPaisa = toPaisa(payload.transportCost);
  } else if (payload.transportCostPaisa !== undefined) {
    pkg.transportCostPaisa = Math.max(0, Math.round(Number(payload.transportCostPaisa) || 0));
  }

  if (payload.netMeteringCost !== undefined && payload.netMeteringCost !== '') {
    pkg.netMeteringCostPaisa = toPaisa(payload.netMeteringCost);
  } else if (payload.netMeteringCostPaisa !== undefined) {
    pkg.netMeteringCostPaisa = Math.max(0, Math.round(Number(payload.netMeteringCostPaisa) || 0));
  }

  if (payload.additionalCost !== undefined && payload.additionalCost !== '') {
    pkg.additionalCostPaisa = toPaisa(payload.additionalCost);
  } else if (payload.additionalCostPaisa !== undefined) {
    pkg.additionalCostPaisa = Math.max(0, Math.round(Number(payload.additionalCostPaisa) || 0));
  }

  if (payload.defaultDiscountPercent !== undefined) {
    pkg.defaultDiscountPercent = Math.min(
      100,
      Math.max(0, Number(payload.defaultDiscountPercent) || 0)
    );
  }

  if (payload.isActive !== undefined) {
    pkg.isActive =
      payload.isActive !== false && payload.isActive !== '0' && payload.isActive !== 'false';
  }

  await pkg.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.PACKAGE_UPDATED,
    'packages',
    pkg._id,
    before,
    pkg.toObject(),
    { req, description: `Package ${pkg.code} updated` }
  );

  return pkg;
}

/**
 * Soft delete package template.
 */
async function softDeletePackage(id, actor, req) {
  const pkg = await Package.findById(id);
  if (!pkg) throw ApiError.notFound('Package not found.');

  await pkg.softDelete(actor ? actor._id : null);

  await logAction(
    actor,
    AUDIT_ACTIONS.PACKAGE_DELETED,
    'packages',
    pkg._id,
    pkg.toObject(),
    null,
    { req, description: `Package ${pkg.code} (${pkg.name}) deleted` }
  );

  return pkg;
}

module.exports = {
  listPackages,
  listActivePackages,
  getPackageOrThrow,
  getPackageForBuilder,
  createPackage,
  updatePackage,
  softDeletePackage,
  normalizePackageItems,
  nextPackageCode,
};
