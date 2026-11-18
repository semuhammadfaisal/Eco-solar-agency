'use strict';

const mongoose = require('mongoose');
const Sale = require('../models/Sale');
const Customer = require('../models/Customer');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { text } = require('../utils/inputs');
const { paginate, escapeRegex } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { can } = require('../config/permissions');
const {
  SALE_STATUSES,
  PAYMENT_OPTIONS,
  DEFAULT_MILESTONES,
} = require('../config/quotations');
const { SYSTEM_TYPES } = require('../config/systems');
const { nextSaleNumber, nextInvoiceNumber } = require('./numberingService');
const customerService = require('./customerService');
const accountingService = require('./accountingService');

const PROJECT_SCOPES = Object.freeze(['all', 'ongoing', 'completed', 'cancelled']);
const ONGOING_STATUSES = Object.freeze(['confirmed', 'in_progress']);

function sanitizeSaleForRole(sale, user) {
  if (!sale) return sale;
  const role = typeof user === 'string' ? user : user && user.role;
  const canSeeCosts = can(role, 'costs.view');
  const canSeeProfit = can(role, 'profit.view');

  if (canSeeCosts && canSeeProfit) return sale;

  const copy = JSON.parse(JSON.stringify(sale));
  if (!canSeeCosts) {
    delete copy.totalCostPaisa;
  }
  if (!canSeeProfit) {
    delete copy.expectedProfitPaisa;
    delete copy.profitMarginPercent;
  }
  return copy;
}

/** Status filter for a project tab (All / Ongoing / Completed / Cancelled). */
function statusFilterForScope(scope) {
  if (scope === 'ongoing') return { $in: ONGOING_STATUSES };
  if (scope === 'completed' || scope === 'cancelled') return scope;
  return null;
}

/**
 * Aggregate project counts and contract value for the tab badges and KPIs.
 * Aggregations bypass the soft-delete plugin, hence the explicit filter.
 */
async function getProjectStats(baseFilter = {}) {
  const rows = await Sale.aggregate([
    { $match: { ...baseFilter, deletedAt: null } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        amountPaisa: { $sum: '$amountPaisa' },
      },
    },
  ]);

  const stats = {
    total: 0,
    confirmed: 0,
    inProgress: 0,
    ongoing: 0,
    completed: 0,
    cancelled: 0,
    contractValuePaisa: 0,
  };

  for (const row of rows) {
    stats.total += row.count;
    if (row._id === 'confirmed') stats.confirmed = row.count;
    if (row._id === 'in_progress') stats.inProgress = row.count;
    if (row._id === 'completed') stats.completed = row.count;
    if (row._id === 'cancelled') stats.cancelled = row.count;
    if (row._id !== 'cancelled') stats.contractValuePaisa += row.amountPaisa || 0;
  }

  stats.ongoing = stats.confirmed + stats.inProgress;
  return stats;
}

/**
 * List projects with tab scope, filters, sales scoping and pagination.
 */
async function listSales(query = {}, user) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 20));

  const baseFilter = {};
  if (user && user.role === 'sales') {
    baseFilter.assignedTo = user._id;
  }

  const filter = { ...baseFilter };

  const scope = PROJECT_SCOPES.includes(query.scope) ? query.scope : 'all';

  if (query.status && SALE_STATUSES.includes(query.status)) {
    filter.status = query.status;
  } else {
    const scopedStatus = statusFilterForScope(scope);
    if (scopedStatus) filter.status = scopedStatus;
  }

  if (query.customer && mongoose.isValidObjectId(query.customer)) {
    filter.customer = query.customer;
  }

  if (query.assignedTo && mongoose.isValidObjectId(query.assignedTo) && !(user && user.role === 'sales')) {
    filter.assignedTo = query.assignedTo;
  }

  const search = text(query.search, 80);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    const matchingCustomers = await Customer.find({
      $or: [{ name: regex }, { phone: regex }, { code: regex }],
    })
      .select('_id')
      .limit(200)
      .lean();

    filter.$or = [
      { saleNumber: regex },
      { invoiceNumber: regex },
      { projectTitle: regex },
      { notes: regex },
    ];
    if (matchingCustomers.length) {
      filter.$or.push({ customer: { $in: matchingCustomers.map((c) => c._id) } });
    }
  }

  const [total, rawSales, stats] = await Promise.all([
    Sale.countDocuments(filter),
    Sale.find(filter)
      .populate('customer', 'name code phone city')
      .populate('quotation', 'quotationNumber revision')
      .populate('assignedTo', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    getProjectStats(baseFilter),
  ]);

  const sales = rawSales.map((s) => sanitizeSaleForRole(s, user));

  return {
    sales,
    total,
    stats,
    scope,
    pagination: paginate(total, page, limit),
  };
}

/**
 * Get sale by ID or throw 404.
 */
async function getSaleOrThrow(id, user) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('Sale record not found.');
  }

  const query = { _id: id };
  if (user && user.role === 'sales') {
    query.assignedTo = user._id;
  }

  const sale = await Sale.findOne(query)
    .populate('customer')
    .populate('quotation')
    .populate('survey')
    .populate('assignedTo', 'name email phone')
    .populate('approvedBy', 'name')
    .lean();

  if (!sale) throw ApiError.notFound('Sale record not found.');

  return sanitizeSaleForRole(sale, user);
}

/**
 * Update project status.
 */
async function updateSaleStatus(id, status, notes, actor, req) {
  if (!SALE_STATUSES.includes(status)) {
    throw ApiError.badRequest('Invalid project status.');
  }

  const sale = await Sale.findById(id);
  if (!sale) throw ApiError.notFound('Sale record not found.');

  // Sales users may only advance their own projects.
  if (actor.role === 'sales' && String(sale.assignedTo) !== String(actor._id)) {
    throw ApiError.forbidden('You can only update your own projects.');
  }

  const before = { status: sale.status };
  sale.status = status;
  if (notes) sale.notes = text(notes, 3000);
  await sale.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.SALE_STATUS_CHANGED,
    'sales',
    sale._id,
    before,
    { status: sale.status },
    { req, description: `Project ${sale.saleNumber} status updated to ${status}` }
  );

  return sale;
}

/* -------------------------------------------------------------------------- */
/* Direct project creation                                                    */
/* -------------------------------------------------------------------------- */

function parseMoney(value, label, { allowZero = false } = {}) {
  let paisa;
  try {
    paisa = toPaisa(String(value === undefined || value === null ? '' : value).trim());
  } catch (_err) {
    throw ApiError.badRequest(`${label} must be a valid amount.`);
  }
  if (paisa < 0) throw ApiError.badRequest(`${label} cannot be negative.`);
  if (!allowZero && paisa === 0) throw ApiError.badRequest(`${label} must be greater than zero.`);
  return paisa;
}

function optionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

/** Read milestone rows from either a nested array or parallel form arrays. */
function buildMilestoneInput(payload = {}) {
  if (Array.isArray(payload.milestones) && payload.milestones.length) {
    return payload.milestones.map((row) => ({
      label: text(row.label, 120),
      percent: Number(row.percent) || 0,
      dueDate: row.dueDate || null,
    }));
  }

  const labels = asArray(payload.milestoneLabel);
  const percents = asArray(payload.milestonePercent);
  const dueDates = asArray(payload.milestoneDueDate);
  const rowCount = Math.max(labels.length, percents.length, dueDates.length);

  const rows = [];
  for (let i = 0; i < rowCount; i += 1) {
    const label = text(labels[i], 120);
    const percent = Number(percents[i]) || 0;
    if (!label && percent <= 0) continue;
    rows.push({ label, percent, dueDate: dueDates[i] || null });
  }
  return rows;
}

/**
 * Build the milestone schedule for a directly-created project.
 * Cash contracts become a single 100% advance milestone.
 */
function normalizeProjectMilestones(paymentType, rawPlan, amountPaisa) {
  const total = Math.max(0, Math.round(Number(amountPaisa) || 0));

  if (paymentType !== 'installment') {
    return [
      {
        label: '100% Advance Payment on Booking',
        percent: 100,
        amountPaisa: total,
        dueDate: null,
        isPaid: false,
        notes: 'Full payment via bank transfer / cheque upon contract execution',
      },
    ];
  }

  const rows = (Array.isArray(rawPlan) ? rawPlan : [])
    .map((row) => ({
      label: text(row.label, 120) || 'Payment Milestone',
      percent: Math.max(0, Math.min(100, Number(row.percent) || 0)),
      dueDate: optionalDate(row.dueDate),
      notes: text(row.notes, 200),
    }))
    .filter((row) => row.percent > 0);

  if (!rows.length) {
    return DEFAULT_MILESTONES.map((milestone) => ({
      label: milestone.label,
      percent: milestone.percent,
      amountPaisa: Math.round(total * (milestone.percent / 100)),
      dueDate: null,
      isPaid: false,
      notes: '',
    }));
  }

  const totalPercent = rows.reduce((sum, row) => sum + row.percent, 0);
  if (totalPercent > 100) {
    throw ApiError.badRequest('Payment milestone percentages cannot exceed 100%.');
  }

  return rows.map((row) => ({
    label: row.label,
    percent: row.percent,
    amountPaisa: Math.round(total * (row.percent / 100)),
    dueDate: row.dueDate,
    isPaid: false,
    notes: row.notes,
  }));
}

function normalizeSystemSummary(payload = {}) {
  const capacityKw = Number(payload.capacityKw);
  if (!Number.isFinite(capacityKw) || capacityKw <= 0) {
    throw ApiError.badRequest('System capacity must be greater than zero.');
  }

  const numberOrZero = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  return {
    capacityKw,
    systemType: SYSTEM_TYPES.includes(payload.systemType) ? payload.systemType : 'on_grid',
    panelCount: Math.round(numberOrZero(payload.panelCount)),
    inverterCapacityKw: numberOrZero(payload.inverterCapacityKw),
    batteryCapacityKwh: numberOrZero(payload.batteryCapacityKwh),
    estimatedUnits: { daily: 0, monthly: 0, yearly: 0 },
  };
}

async function resolveProjectCustomer(payload, actor, req) {
  if (payload.customerMode === 'new') {
    const name = text(payload.name, 120);
    const phone = text(payload.phone, 20);
    if (!name) throw ApiError.badRequest('Customer name is required for a new customer.');
    if (!phone) throw ApiError.badRequest('Customer phone number is required.');

    const customer = await customerService.createCustomer(
      {
        name,
        phone,
        whatsapp: payload.whatsapp,
        cnic: payload.cnic,
        address: payload.address,
        city: payload.city,
        area: payload.area,
        type: payload.customerType,
        source: payload.customerSource,
        assignedTo: actor.role === 'sales' ? actor._id : payload.assignedTo,
        notes: payload.customerNotes,
      },
      actor,
      req
    );
    return customer._id;
  }

  if (!mongoose.isValidObjectId(payload.customer)) {
    throw ApiError.badRequest('Select an existing customer or create a new one.');
  }

  const customer = await Customer.findOne({ _id: payload.customer }).select('_id');
  if (!customer) throw ApiError.notFound('Customer not found.');
  return customer._id;
}

async function resolveProjectAssignee(value, actor) {
  // Sales users can only own their own projects.
  if (actor.role === 'sales') return actor._id;

  if (value && mongoose.isValidObjectId(value)) {
    const user = await User.findOne({ _id: value, isActive: true }).select('_id');
    if (!user) throw ApiError.badRequest('Select an active salesperson.');
    return user._id;
  }

  return actor._id;
}

/**
 * Start a project directly, without a quotation.
 *
 * Creates (or reuses) the customer, generates SAL/INV numbers, stores the
 * system snapshot and milestone schedule, posts the contract journal entry
 * and writes an audit trail. Quotation-approved projects continue to be
 * created by quotationService.updateQuotationStatus().
 */
async function createProject(payload = {}, actor, req) {
  if (!actor) throw ApiError.forbidden('Sign in to start a project.');

  const amountPaisa = parseMoney(payload.amount, 'Contract amount');
  const customerId = await resolveProjectCustomer(payload, actor, req);
  const assignedTo = await resolveProjectAssignee(payload.assignedTo, actor);
  const systemSummary = normalizeSystemSummary(payload);

  const canSeeCosts = can(actor, 'costs.view');
  let totalCostPaisa = 0;
  if (
    canSeeCosts &&
    payload.estimatedCost !== undefined &&
    payload.estimatedCost !== null &&
    payload.estimatedCost !== ''
  ) {
    totalCostPaisa = parseMoney(payload.estimatedCost, 'Estimated project cost', {
      allowZero: true,
    });
  }

  const expectedProfitPaisa = totalCostPaisa > 0 ? amountPaisa - totalCostPaisa : 0;
  const profitMarginPercent =
    totalCostPaisa > 0 && amountPaisa > 0
      ? Math.round((expectedProfitPaisa / amountPaisa) * 10000) / 100
      : 0;

  const paymentType = PAYMENT_OPTIONS.includes(payload.paymentType)
    ? payload.paymentType
    : 'cash';
  const paymentPlan = normalizeProjectMilestones(
    paymentType,
    buildMilestoneInput(payload),
    amountPaisa
  );

  const saleNumber = await nextSaleNumber();
  const invoiceNumber = await nextInvoiceNumber();

  const sale = await Sale.create({
    saleNumber,
    invoiceNumber,
    quotation: null,
    origin: 'direct',
    projectTitle: text(payload.projectTitle, 120),
    customer: customerId,
    assignedTo,
    amountPaisa,
    totalCostPaisa,
    expectedProfitPaisa,
    profitMarginPercent,
    paymentType,
    paymentPlan,
    systemSummary,
    itemsSnapshot: [],
    status: 'confirmed',
    startDate: optionalDate(payload.startDate) || new Date(),
    notes: text(payload.notes, 3000),
    approvedBy: actor._id,
    approvedAt: new Date(),
    createdBy: actor._id,
  });

  try {
    await accountingService.postSaleApproval(sale, actor, req);
  } catch (accErr) {
    console.error('[accounting] postSaleApproval error:', accErr.message);
  }

  await logAction(
    actor,
    AUDIT_ACTIONS.SALE_CREATED,
    'sales',
    sale._id,
    null,
    sale.toObject(),
    {
      req,
      description: `Project ${sale.saleNumber} started directly for customer ${customerId}`,
    }
  );

  return sale;
}

module.exports = {
  listSales,
  getSaleOrThrow,
  updateSaleStatus,
  createProject,
  sanitizeSaleForRole,
  normalizeProjectMilestones,
  statusFilterForScope,
};
