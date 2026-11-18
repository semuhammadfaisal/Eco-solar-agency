'use strict';

const mongoose = require('mongoose');
const Quotation = require('../models/Quotation');
const Sale = require('../models/Sale');
const Customer = require('../models/Customer');
const Survey = require('../models/Survey');
const SystemConfig = require('../models/SystemConfig');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { text } = require('../utils/inputs');
const { paginate, escapeRegex } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { can } = require('../config/permissions');
const { getSettings } = require('./settingsService');
const { calculateSystem } = require('./profitService');
const { buildQuotationPdf } = require('./quotationPdfService');
const { sendQuotationEmail } = require('./emailService');
const accountingService = require('./accountingService');
const {
  nextQuotationNumber,
  nextSaleNumber,
  nextInvoiceNumber,
  formatQuotationNumber,
} = require('./numberingService');
const { QUOTATION_STATUSES, PAYMENT_OPTIONS, DEFAULT_MILESTONES } = require('../config/quotations');

function applySalesScope(filter, actor) {
  if (actor && actor.role === 'sales') {
    filter.assignedTo = actor._id;
  }
  return filter;
}

/**
 * Strips confidential costs and profit figures for users without costs/profit permissions (e.g. Sales).
 */
function sanitizeQuotationForRole(quotation, user) {
  if (!quotation) return quotation;
  const role = typeof user === 'string' ? user : user && user.role;
  const canSeeCosts = can(role, 'costs.view');
  const canSeeProfit = can(role, 'profit.view');

  if (canSeeCosts && canSeeProfit) {
    return quotation;
  }

  const copy = JSON.parse(JSON.stringify(quotation));

  if (Array.isArray(copy.items)) {
    copy.items = copy.items.map((it) => {
      if (!canSeeCosts) {
        delete it.unitCostPaisa;
        delete it.totalCostPaisa;
      }
      return it;
    });
  }

  if (!canSeeCosts) {
    delete copy.laborCostPaisa;
    delete copy.transportCostPaisa;
    delete copy.netMeteringCostPaisa;
    delete copy.additionalCostPaisa;
    delete copy.totalItemCostPaisa;
    delete copy.totalBaseCostPaisa;
  }

  if (!canSeeProfit) {
    delete copy.salesCommissionRateBps;
    delete copy.salesCommissionPaisa;
    delete copy.netProfitPaisa;
    delete copy.netProfitMarginPercent;
  }

  return copy;
}

/**
 * List quotations with filters, sales scoping, pagination, and conversion metrics.
 */
async function listQuotations(query = {}, user) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 20));

  const filter = {};
  applySalesScope(filter, user);

  if (query.status && QUOTATION_STATUSES.includes(query.status)) {
    filter.status = query.status;
  }

  if (query.assignedTo && mongoose.isValidObjectId(query.assignedTo) && (!user || user.role !== 'sales')) {
    filter.assignedTo = query.assignedTo;
  }

  if (query.customer && mongoose.isValidObjectId(query.customer)) {
    filter.customer = query.customer;
  }

  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(`${query.from}T00:00:00+05:00`);
    if (query.to) filter.createdAt.$lt = new Date(`${query.to}T23:59:59.999+05:00`);
  }

  const search = text(query.search, 80);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { quotationNumber: regex },
      { 'systemSummary.systemType': regex },
    ];
  }

  const [total, rawQuotes, aggregateMetrics] = await Promise.all([
    Quotation.countDocuments(filter),
    Quotation.find(filter)
      .populate('customer', 'name code phone city')
      .populate('assignedTo', 'name')
      .populate('sale', 'saleNumber invoiceNumber status')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    computeQuotationMetrics(user),
  ]);

  const quotations = rawQuotes.map((q) => sanitizeQuotationForRole(q, user));

  return {
    quotations,
    total,
    pagination: paginate(total, page, limit),
    metrics: aggregateMetrics,
  };
}

/**
 * Computes pipeline metrics, total quoted volume, and conversion rate.
 */
async function computeQuotationMetrics(user) {
  const baseFilter = { deletedAt: null };
  applySalesScope(baseFilter, user);

  const stats = await Quotation.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: null,
        totalQuotes: { $sum: 1 },
        approvedQuotes: {
          $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] },
        },
        draftQuotes: {
          $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] },
        },
        pipelineValuePaisa: {
          $sum: {
            $cond: [{ $in: ['$status', ['sent', 'approved']] }, '$finalPricePaisa', 0],
          },
        },
        approvedValuePaisa: {
          $sum: {
            $cond: [{ $eq: ['$status', 'approved'] }, '$finalPricePaisa', 0],
          },
        },
        totalCostPaisa: { $sum: '$totalBaseCostPaisa' },
        totalProfitPaisa: { $sum: '$netProfitPaisa' },
      },
    },
  ]);

  const row = stats[0] || {
    totalQuotes: 0,
    approvedQuotes: 0,
    draftQuotes: 0,
    pipelineValuePaisa: 0,
    approvedValuePaisa: 0,
    totalCostPaisa: 0,
    totalProfitPaisa: 0,
  };

  const actionableCount = row.totalQuotes - row.draftQuotes;
  const conversionRate =
    actionableCount > 0
      ? Number(((row.approvedQuotes / actionableCount) * 100).toFixed(1))
      : (row.totalQuotes > 0 ? Number(((row.approvedQuotes / row.totalQuotes) * 100).toFixed(1)) : 0);

  const canSeeProfit = can(user, 'profit.view');

  return {
    totalQuotes: row.totalQuotes,
    approvedQuotes: row.approvedQuotes,
    conversionRate,
    pipelineValuePaisa: row.pipelineValuePaisa,
    approvedValuePaisa: row.approvedValuePaisa,
    ...(canSeeProfit
      ? {
          totalCostPaisa: row.totalCostPaisa,
          totalProfitPaisa: row.totalProfitPaisa,
        }
      : {}),
  };
}

/**
 * Get quotation by ID or throw 404, scoped by sales assignment.
 */
async function getQuotationOrThrow(id, user) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('Quotation not found.');
  }

  const query = { _id: id };
  applySalesScope(query, user);

  const quotation = await Quotation.findOne(query)
    .populate('customer')
    .populate('survey')
    .populate('systemConfig')
    .populate('assignedTo', 'name email phone')
    .populate('createdBy', 'name')
    .populate('sale')
    .populate('statusHistory.changedBy', 'name')
    .lean();

  if (!quotation) {
    throw ApiError.notFound('Quotation not found.');
  }

  // Also fetch all sibling revisions of this quotationNumber
  const revisions = await Quotation.find({ quotationNumber: quotation.quotationNumber })
    .select('quotationNumber revision status finalPricePaisa createdAt isLatestRevision')
    .sort({ revision: 1 })
    .lean();

  quotation.allRevisions = revisions;

  return sanitizeQuotationForRole(quotation, user);
}

/**
 * Formats milestones for installment payment plans.
 */
function normalizePaymentPlan(paymentOption, rawPlan = [], finalPricePaisa = 0) {
  if (paymentOption !== 'installment') {
    return [
      {
        label: '100% Advance Payment on Booking',
        percent: 100,
        amountPaisa: finalPricePaisa,
        dueDate: null,
        notes: 'Full payment via bank transfer / cheque upon contract execution',
      },
    ];
  }

  if (Array.isArray(rawPlan) && rawPlan.length) {
    return rawPlan.map((ms) => {
      const pct = Math.max(0, Math.min(100, Number(ms.percent) || 0));
      return {
        label: text(ms.label, 120) || 'Payment Milestone',
        percent: pct,
        amountPaisa: Math.round(finalPricePaisa * (pct / 100)),
        dueDate: ms.dueDate ? new Date(ms.dueDate) : null,
        notes: text(ms.notes, 200),
      };
    });
  }

  // Default standard 50 / 40 / 10 milestone schedule
  return DEFAULT_MILESTONES.map((ms) => ({
    label: ms.label,
    percent: ms.percent,
    amountPaisa: Math.round(finalPricePaisa * (ms.percent / 100)),
    dueDate: null,
    notes: '',
  }));
}

/**
 * Normalizes line items snapshot for storage.
 */
function normalizeQuotationItems(rawLines = []) {
  if (!Array.isArray(rawLines)) return [];

  return rawLines.map((line) => {
    const snap = line.itemSnapshot || line || {};
    const qty = Math.max(0.01, Number(line.qty) || 1);
    const unitSellingPricePaisa = line.unitSellingPricePaisa !== undefined && line.unitSellingPricePaisa !== null && line.unitSellingPricePaisa !== ''
      ? Math.max(0, Math.round(Number(line.unitSellingPricePaisa) || 0))
      : Math.max(0, Math.round((Number(line.unitSellingPrice) || 0) * 100));
    const unitCostPaisa = line.unitCostPaisa !== undefined && line.unitCostPaisa !== null && line.unitCostPaisa !== ''
      ? Math.max(0, Math.round(Number(line.unitCostPaisa) || 0))
      : Math.max(0, Math.round((Number(line.unitCost) || 0) * 100));

    return {
      item: mongoose.isValidObjectId(line.item) ? line.item : null,
      itemSnapshot: {
        sku: snap.sku || '',
        name: snap.name || 'Component Item',
        category: snap.category || 'other',
        brand: snap.brand || '',
        model: snap.model || '',
        unit: snap.unit || 'pcs',
        wattage: snap.wattage !== undefined ? snap.wattage : null,
        capacityKw: snap.capacityKw !== undefined ? snap.capacityKw : null,
        warrantyYears: snap.warrantyYears !== undefined ? snap.warrantyYears : null,
      },
      qty,
      unitCostPaisa,
      unitSellingPricePaisa,
      totalCostPaisa: Math.round(qty * unitCostPaisa),
      totalSellingPricePaisa: Math.round(qty * unitSellingPricePaisa),
      notes: text(line.notes, 300),
      isOptionalExtra: Boolean(line.isOptionalExtra),
    };
  });
}

/**
 * Create a new Quotation from form data or preloaded SystemConfig.
 */
async function createQuotation(payload, actor, req) {
  if (!payload.customer || !mongoose.isValidObjectId(payload.customer)) {
    throw ApiError.badRequest('Select a valid customer.');
  }

  const customer = await Customer.findById(payload.customer);
  if (!customer) throw ApiError.badRequest('Customer not found.');

  const settings = await getSettings();
  const quotationNumber = await nextQuotationNumber();

  // Assigned salesperson: sales users are pinned to themselves; owner/manager can assign
  let assignedTo = actor._id;
  if (actor.role !== 'sales' && payload.assignedTo && mongoose.isValidObjectId(payload.assignedTo)) {
    assignedTo = payload.assignedTo;
  }

  const items = normalizeQuotationItems(payload.items);
  if (!items.length) {
    throw ApiError.badRequest('At least one item line is required for quotation.');
  }

  // Calculate pricing using authoritative profit service
  const laborCostPaisa = payload.laborCost !== undefined && payload.laborCost !== ''
    ? toPaisa(payload.laborCost)
    : Math.max(0, Math.round(Number(payload.laborCostPaisa) || 0));

  const transportCostPaisa = payload.transportCost !== undefined && payload.transportCost !== ''
    ? toPaisa(payload.transportCost)
    : Math.max(0, Math.round(Number(payload.transportCostPaisa) || 0));

  const netMeteringCostPaisa = payload.netMeteringCost !== undefined && payload.netMeteringCost !== ''
    ? toPaisa(payload.netMeteringCost)
    : Math.max(0, Math.round(Number(payload.netMeteringCostPaisa) || 0));

  const additionalCostPaisa = payload.additionalCost !== undefined && payload.additionalCost !== ''
    ? toPaisa(payload.additionalCost)
    : Math.max(0, Math.round(Number(payload.additionalCostPaisa) || 0));

  const discountType = payload.discountType === 'amount' ? 'amount' : 'percent';
  let discountValue = 0;
  if (discountType === 'amount') {
    discountValue = payload.discountValue !== undefined && payload.discountValue !== ''
      ? toPaisa(payload.discountValue)
      : Math.max(0, Math.round(Number(payload.discountPaisa) || 0));
  } else {
    discountValue = Math.min(100, Math.max(0, Number(payload.discountValue) || 0));
  }

  const calc = calculateSystem(
    {
      lines: items,
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

  // Validity: default to 15 days from today if not specified
  let validUntil;
  if (payload.validUntil) {
    validUntil = new Date(payload.validUntil);
  } else {
    validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 15);
  }

  const paymentOption = payload.paymentOption === 'installment' ? 'installment' : 'cash';
  const paymentPlan = normalizePaymentPlan(paymentOption, payload.paymentPlan, calc.finalPricePaisa);

  const quotation = await Quotation.create({
    quotationNumber,
    revision: 1,
    isLatestRevision: true,
    customer: customer._id,
    survey: mongoose.isValidObjectId(payload.survey) ? payload.survey : null,
    systemConfig: mongoose.isValidObjectId(payload.systemConfig) ? payload.systemConfig : null,
    assignedTo,
    systemSummary: {
      capacityKw: calc.capacityKw,
      systemType: payload.systemType || 'on_grid',
      panelCount: calc.panelCount,
      inverterCapacityKw: calc.inverterCapacityKw,
      batteryCapacityKwh: calc.batteryCapacityKwh,
      estimatedUnits: calc.estimatedUnits,
    },
    items,
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
    paymentOption,
    paymentPlan,
    quotationDate: payload.quotationDate ? new Date(payload.quotationDate) : new Date(),
    validUntil,
    terms: payload.terms || settings.quotationTerms || '',
    warrantyTerms: payload.warrantyTerms || '',
    includeUrdu: Boolean(payload.includeUrdu),
    urduNotes: text(payload.urduNotes, 2000),
    status: 'draft',
    statusHistory: [
      {
        status: 'draft',
        changedAt: new Date(),
        changedBy: actor._id,
        reason: 'Quotation created',
      },
    ],
    createdBy: actor._id,
  });

  await logAction(
    actor,
    AUDIT_ACTIONS.QUOTATION_CREATED,
    'quotations',
    quotation._id,
    null,
    quotation.toObject(),
    { req, description: `Quotation ${quotation.quotationNumber} created for ${customer.name}` }
  );

  return quotation;
}

/**
 * Duplicate a quotation as a new revision (e.g. Rev 2).
 */
async function duplicateAsNewRevision(id, actor, req) {
  const existing = await Quotation.findById(id);
  if (!existing) throw ApiError.notFound('Quotation not found.');

  // Check sales ownership
  if (actor.role === 'sales' && String(existing.assignedTo) !== String(actor._id)) {
    throw ApiError.forbidden('You can only duplicate quotations assigned to you.');
  }

  // Find current highest revision for this quotationNumber
  const highest = await Quotation.findOne({ quotationNumber: existing.quotationNumber })
    .sort({ revision: -1 })
    .select('revision');

  const nextRevision = (highest ? highest.revision : existing.revision) + 1;

  // Mark all previous revisions as not latest
  await Quotation.updateMany(
    { quotationNumber: existing.quotationNumber },
    { $set: { isLatestRevision: false } }
  );

  const newDocData = existing.toObject();
  delete newDocData._id;
  delete newDocData.createdAt;
  delete newDocData.updatedAt;
  delete newDocData.__v;
  delete newDocData.sale;

  newDocData.revision = nextRevision;
  newDocData.isLatestRevision = true;
  newDocData.parentQuotation = existing._id;
  newDocData.status = 'draft';
  newDocData.createdBy = actor._id;
  newDocData.quotationDate = new Date();

  // Extend validity 15 days
  const valid = new Date();
  valid.setDate(valid.getDate() + 15);
  newDocData.validUntil = valid;

  newDocData.statusHistory = [
    {
      status: 'draft',
      changedAt: new Date(),
      changedBy: actor._id,
      reason: `Duplicated as Revision ${nextRevision} from Revision ${existing.revision}`,
    },
  ];

  const revisionQuotation = await Quotation.create(newDocData);

  await logAction(
    actor,
    AUDIT_ACTIONS.QUOTATION_REVISION_CREATED,
    'quotations',
    revisionQuotation._id,
    { parentId: existing._id, revision: existing.revision },
    revisionQuotation.toObject(),
    {
      req,
      description: `Quotation ${revisionQuotation.quotationNumber} Rev ${nextRevision} created`,
    }
  );

  return revisionQuotation;
}

/**
 * Update status of quotation (Draft -> Sent -> Approved / Rejected).
 * ON APPROVAL:
 * - Creates a Sale record!
 */
async function updateQuotationStatus(id, newStatus, reason, actor, req) {
  if (!QUOTATION_STATUSES.includes(newStatus)) {
    throw ApiError.badRequest('Invalid quotation status.');
  }

  const quotation = await Quotation.findById(id).populate('customer');
  if (!quotation) throw ApiError.notFound('Quotation not found.');

  // Sales ownership
  if (actor.role === 'sales' && String(quotation.assignedTo) !== String(actor._id)) {
    throw ApiError.forbidden('You can only update status for your assigned quotations.');
  }

  const before = quotation.toObject();
  const prevStatus = quotation.status;

  quotation.status = newStatus;
  quotation.statusHistory.push({
    status: newStatus,
    changedAt: new Date(),
    changedBy: actor._id,
    reason: text(reason, 500) || `Status changed to ${newStatus}`,
  });

  let createdSale = null;

  // On approval, create a Sale/Project record.
  if (newStatus === 'approved' && !quotation.sale) {
    const saleNumber = await nextSaleNumber();
    const invoiceNumber = await nextInvoiceNumber();

    createdSale = await Sale.create({
      saleNumber,
      invoiceNumber,
      quotation: quotation._id,
      customer: quotation.customer ? quotation.customer._id : quotation.customer,
      survey: quotation.survey,
      assignedTo: quotation.assignedTo,
      amountPaisa: quotation.finalPricePaisa,
      totalCostPaisa: quotation.totalBaseCostPaisa,
      expectedProfitPaisa: quotation.netProfitPaisa,
      profitMarginPercent: quotation.netProfitMarginPercent,
      paymentType: quotation.paymentOption,
      paymentPlan: (quotation.paymentPlan || []).map((ms) => ({
        label: ms.label,
        percent: ms.percent,
        amountPaisa: ms.amountPaisa,
        dueDate: ms.dueDate,
        isPaid: false,
        notes: ms.notes,
      })),
      systemSummary: quotation.systemSummary,
      itemsSnapshot: quotation.items,
      status: 'confirmed',
      notes: `Generated upon approval of quotation ${quotation.quotationNumber} (Rev ${quotation.revision}). Reason: ${reason || 'Approved by customer'}`,
      approvedBy: actor._id,
      approvedAt: new Date(),
      createdBy: actor._id,
    });

    quotation.sale = createdSale._id;

    // Step 10: Auto-post double-entry journal entry for sale approval
    try {
      await accountingService.postSaleApproval(createdSale, actor, req);
    } catch (accErr) {
      console.error('[accounting] postSaleApproval error:', accErr.message);
    }

    await logAction(
      actor,
      AUDIT_ACTIONS.SALE_CREATED,
      'sales',
      createdSale._id,
      null,
      createdSale.toObject(),
      {
        req,
        description: `Sale ${createdSale.saleNumber} created from quotation ${quotation.quotationNumber}`,
      }
    );

  }

  await quotation.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.QUOTATION_STATUS_CHANGED,
    'quotations',
    quotation._id,
    { status: prevStatus },
    { status: newStatus },
    { req, description: `Quotation ${quotation.quotationNumber} marked ${newStatus}: ${reason || ''}` }
  );

  return { quotation, sale: createdSale };
}

/**
 * Send quotation PDF via email.
 */
async function emailQuotation(id, { recipientEmail, subject, message }, actor, req) {
  const quotation = await Quotation.findById(id).populate('customer');
  if (!quotation) throw ApiError.notFound('Quotation not found.');

  // Sales ownership
  if (actor.role === 'sales' && String(quotation.assignedTo) !== String(actor._id)) {
    throw ApiError.forbidden('You can only email your assigned quotations.');
  }

  const settings = await getSettings();
  const pdfBuffer = await buildQuotationPdf(quotation, settings);

  const emailResult = await sendQuotationEmail({
    quotation,
    recipientEmail,
    subject,
    message,
    pdfBuffer,
    settings,
  });

  // Automatically update status to sent if draft
  if (quotation.status === 'draft') {
    quotation.status = 'sent';
    quotation.statusHistory.push({
      status: 'sent',
      changedAt: new Date(),
      changedBy: actor._id,
      reason: `Emailed PDF to ${recipientEmail}`,
    });
    await quotation.save();
  }

  await logAction(
    actor,
    AUDIT_ACTIONS.QUOTATION_EMAILED,
    'quotations',
    quotation._id,
    null,
    { recipient: recipientEmail, subject },
    { req, description: `Quotation ${quotation.quotationNumber} emailed to ${recipientEmail}` }
  );

  return emailResult;
}

/**
 * Soft delete a quotation.
 */
async function softDeleteQuotation(id, actor, req) {
  const quotation = await Quotation.findById(id);
  if (!quotation) throw ApiError.notFound('Quotation not found.');

  if (actor.role === 'sales' && String(quotation.assignedTo) !== String(actor._id)) {
    throw ApiError.forbidden('You can only delete your own quotations.');
  }

  await quotation.softDelete(actor._id);

  await logAction(
    actor,
    AUDIT_ACTIONS.QUOTATION_DELETED,
    'quotations',
    quotation._id,
    quotation.toObject(),
    null,
    { req, description: `Quotation ${quotation.quotationNumber} deleted` }
  );

  return quotation;
}

module.exports = {
  formatQuotationNumber,
  nextQuotationNumber,
  nextSaleNumber,
  nextInvoiceNumber,
  listQuotations,
  getQuotationOrThrow,
  createQuotation,
  duplicateAsNewRevision,
  updateQuotationStatus,
  emailQuotation,
  softDeleteQuotation,
  sanitizeQuotationForRole,
  computeQuotationMetrics,
  normalizePaymentPlan,
};
