'use strict';

const mongoose = require('mongoose');
const SystemConfig = require('../models/SystemConfig');
const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const Package = require('../models/Package');
const Item = require('../models/Item');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { text, escapeRegex } = require('../utils/inputs');
const { paginate } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { getSettings } = require('./settingsService');
const { calculateSystem, applyRoleVisibility } = require('./profitService');
const { can } = require('../config/permissions');
const { SYSTEM_TYPES, APPROVAL_STATUSES } = require('../config/systems');

async function nextSystemConfigNumber() {
  const seq = await Counter.next('system_config');
  return `SYS-${String(seq).padStart(4, '0')}`;
}

/**
 * Resolves item details from the database for lines passed to builder.
 */
async function resolveLineItems(rawLines = []) {
  if (!Array.isArray(rawLines) || !rawLines.length) return [];

  const itemIds = rawLines
    .map((l) => l.item || l.itemId)
    .filter((id) => mongoose.isValidObjectId(id));

  const dbItems = await Item.find({ _id: { $in: itemIds } }).lean();
  const itemMap = new Map(dbItems.map((it) => [String(it._id), it]));

  const lines = [];
  for (const raw of rawLines) {
    const itemId = raw.item || raw.itemId;
    const dbItem = itemMap.get(String(itemId));
    if (!dbItem) continue;

    const qty = Math.max(0, Number(raw.qty) || 0);
    if (qty <= 0) continue;

    // Unit selling price: accept override if provided and positive, otherwise default to item catalogue price
    let unitSellingPricePaisa =
      raw.unitSellingPrice !== undefined && raw.unitSellingPrice !== ''
        ? toPaisa(raw.unitSellingPrice)
        : Number(raw.unitSellingPricePaisa);

    if (!Number.isFinite(unitSellingPricePaisa) || unitSellingPricePaisa < 0) {
      unitSellingPricePaisa = dbItem.sellingPricePaisa || 0;
    }

    // Cost is strictly derived from server inventory records (moving average or purchase price)
    const unitCostPaisa = dbItem.avgCostPaisa || dbItem.purchasePricePaisa || 0;

    lines.push({
      item: dbItem._id,
      itemSnapshot: {
        sku: dbItem.sku,
        name: dbItem.name,
        category: dbItem.category,
        brand: dbItem.brand,
        model: dbItem.model,
        unit: dbItem.unit,
        wattage: dbItem.wattage,
        capacityKw: dbItem.capacityKw,
      },
      qty,
      unitCostPaisa,
      unitSellingPricePaisa,
      notes: text(raw.notes, 300),
    });
  }

  return lines;
}

/**
 * List System Configurations with pagination and filters.
 */
async function listSystemConfigs(query = {}, user) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 20));

  const filter = {};
  if (query.customer && mongoose.isValidObjectId(query.customer)) {
    filter.customer = query.customer;
  }
  if (query.survey && mongoose.isValidObjectId(query.survey)) {
    filter.survey = query.survey;
  }
  if (query.systemType && SYSTEM_TYPES.includes(query.systemType)) {
    filter.systemType = query.systemType;
  }
  if (query.approvalStatus && APPROVAL_STATUSES.includes(query.approvalStatus)) {
    filter.approvalStatus = query.approvalStatus;
  }

  const search = text(query.search, 80);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: regex }, { number: regex }];
  }

  const [total, configs] = await Promise.all([
    SystemConfig.countDocuments(filter),
    SystemConfig.find(filter)
      .populate('customer', 'name code phone city')
      .populate('survey', 'number scheduledAt')
      .populate('createdBy', 'name')
      .populate('approvedBy', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  const sanitized = configs.map((cfg) => applyRoleVisibility(cfg, user));

  return {
    configs: sanitized,
    total,
    pagination: paginate(total, page, limit),
  };
}

/**
 * Get single SystemConfig or throw 404, with role-based visibility.
 */
async function getSystemConfigOrThrow(id, user) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('System configuration not found.');
  }

  const config = await SystemConfig.findById(id)
    .populate('customer', 'name code phone whatsapp address city disco electricityReferenceNo type')
    .populate('survey', 'number scheduledAt recommendedKw systemType roofType')
    .populate('package', 'name code capacityKw')
    .populate('createdBy', 'name role')
    .populate('approvedBy', 'name role')
    .lean();

  if (!config) {
    throw ApiError.notFound('System configuration not found.');
  }

  return applyRoleVisibility(config, user);
}

/**
 * Calculate system configuration without saving (for live Alpine.js preview).
 */
async function previewCalculation(payload, user) {
  const settings = await getSettings();
  const lines = await resolveLineItems(payload.lines);

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

  const discountType = payload.discountType === 'amount' ? 'amount' : 'percent';
  let discountValue = 0;
  if (discountType === 'amount') {
    discountValue =
      payload.discountValue !== undefined && payload.discountValue !== ''
        ? toPaisa(payload.discountValue)
        : Math.round(Number(payload.discountPaisa) || 0);
  } else {
    discountValue = Math.min(100, Math.max(0, Number(payload.discountValue) || 0));
  }

  const calculation = calculateSystem(
    {
      lines,
      laborCostPaisa,
      transportCostPaisa,
      netMeteringCostPaisa,
      additionalCostPaisa,
      discountType,
      discountValue,
      salesCommissionRateBps: Number(payload.salesCommissionRateBps) || 0,
    },
    settings
  );

  return applyRoleVisibility(calculation, user);
}

/**
 * Create and persist a new SystemConfig.
 */
async function createSystemConfig(payload, actor, req) {
  const name = text(payload.name, 180);
  if (!name) throw ApiError.badRequest('Configuration name is required.');

  const settings = await getSettings();
  const lines = await resolveLineItems(payload.lines);
  if (!lines.length) {
    throw ApiError.badRequest('Add at least one item to the system configuration.');
  }

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

  const discountType = payload.discountType === 'amount' ? 'amount' : 'percent';
  let discountValue = 0;
  if (discountType === 'amount') {
    discountValue =
      payload.discountValue !== undefined && payload.discountValue !== ''
        ? toPaisa(payload.discountValue)
        : Math.round(Number(payload.discountPaisa) || 0);
  } else {
    discountValue = Math.min(100, Math.max(0, Number(payload.discountValue) || 0));
  }

  const calc = calculateSystem(
    {
      lines,
      laborCostPaisa,
      transportCostPaisa,
      netMeteringCostPaisa,
      additionalCostPaisa,
      discountType,
      discountValue,
      salesCommissionRateBps: Number(payload.salesCommissionRateBps) || 0,
    },
    settings
  );

  const number = await nextSystemConfigNumber();
  const systemType = SYSTEM_TYPES.includes(payload.systemType)
    ? payload.systemType
    : 'on_grid';

  // Check approval rules
  let approvalStatus = 'none';
  let approvedBy = null;
  let approvedAt = null;

  const isOwner = actor && actor.role === 'owner';

  if (calc.requiresApproval) {
    if (isOwner) {
      approvalStatus = 'approved';
      approvedBy = actor._id;
      approvedAt = new Date();
    } else {
      approvalStatus = 'pending';
    }
  }

  const config = await SystemConfig.create({
    number,
    name,
    customer: mongoose.isValidObjectId(payload.customer) ? payload.customer : null,
    survey: mongoose.isValidObjectId(payload.survey) ? payload.survey : null,
    package: mongoose.isValidObjectId(payload.package) ? payload.package : null,
    systemType,
    capacityKw: calc.capacityKw,
    panelCount: calc.panelCount,
    inverterCapacityKw: calc.inverterCapacityKw,
    batteryCapacityKwh: calc.batteryCapacityKwh,
    estimatedUnits: calc.estimatedUnits,
    lines: calc.lines,
    laborCostPaisa: calc.laborCostPaisa,
    transportCostPaisa: calc.transportCostPaisa,
    netMeteringCostPaisa: calc.netMeteringCostPaisa,
    additionalCostPaisa: calc.additionalCostPaisa,
    totalItemCostPaisa: calc.totalItemCostPaisa,
    totalItemSellingPricePaisa: calc.totalItemSellingPricePaisa,
    totalBaseCostPaisa: calc.totalBaseCostPaisa,
    grossPricePaisa: calc.grossPricePaisa,
    discountType: calc.discountType,
    discountValue: calc.discountValue,
    discountPaisa: calc.discountPaisa,
    discountPercent: calc.discountPercent,
    salesCommissionRateBps: calc.salesCommissionRateBps,
    salesCommissionPaisa: calc.salesCommissionPaisa,
    finalPricePaisa: calc.finalPricePaisa,
    netProfitPaisa: calc.netProfitPaisa,
    netProfitMarginPercent: calc.netProfitMarginPercent,
    warnings: calc.warnings,
    requiresApproval: calc.requiresApproval,
    approvalStatus,
    approvedBy,
    approvedAt,
    remarks: text(payload.remarks, 3000),
    createdBy: actor ? actor._id : null,
  });

  await logAction(
    actor,
    AUDIT_ACTIONS.SYSTEM_CONFIG_CREATED,
    'system_configs',
    config._id,
    null,
    config.toObject(),
    {
      req,
      description: `System configuration ${config.number} (${config.name}) created. Status: ${approvalStatus}`,
    }
  );

  return config;
}

/**
 * Approve system configuration (Owner only).
 */
async function approveSystemConfig(id, notes, actor, req) {
  if (!actor || actor.role !== 'owner') {
    throw ApiError.forbidden('Only owners can approve system pricing and discounts.');
  }

  const config = await SystemConfig.findById(id);
  if (!config) throw ApiError.notFound('Configuration not found.');

  const before = config.toObject();
  config.approvalStatus = 'approved';
  config.approvedBy = actor._id;
  config.approvedAt = new Date();
  if (notes) config.approvalNotes = text(notes, 1000);

  await config.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.SYSTEM_CONFIG_APPROVED,
    'system_configs',
    config._id,
    before,
    config.toObject(),
    { req, description: `System configuration ${config.number} approved by owner` }
  );

  return config;
}

/**
 * Reject system configuration (Owner only).
 */
async function rejectSystemConfig(id, notes, actor, req) {
  if (!actor || actor.role !== 'owner') {
    throw ApiError.forbidden('Only owners can reject system pricing.');
  }

  const config = await SystemConfig.findById(id);
  if (!config) throw ApiError.notFound('Configuration not found.');

  const before = config.toObject();
  config.approvalStatus = 'rejected';
  config.approvedBy = actor._id;
  config.approvedAt = new Date();
  config.approvalNotes = text(notes || 'Rejected by owner', 1000);

  await config.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.SYSTEM_CONFIG_REJECTED,
    'system_configs',
    config._id,
    before,
    config.toObject(),
    { req, description: `System configuration ${config.number} rejected by owner` }
  );

  return config;
}

/**
 * Soft delete system configuration.
 */
async function softDeleteSystemConfig(id, actor, req) {
  const config = await SystemConfig.findById(id);
  if (!config) throw ApiError.notFound('Configuration not found.');

  await config.softDelete(actor ? actor._id : null);

  await logAction(
    actor,
    AUDIT_ACTIONS.SYSTEM_CONFIG_DELETED,
    'system_configs',
    config._id,
    config.toObject(),
    null,
    { req, description: `System configuration ${config.number} deleted` }
  );

  return config;
}

module.exports = {
  nextSystemConfigNumber,
  listSystemConfigs,
  getSystemConfigOrThrow,
  previewCalculation,
  createSystemConfig,
  approveSystemConfig,
  rejectSystemConfig,
  softDeleteSystemConfig,
};
