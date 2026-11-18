'use strict';

const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const quotationService = require('../services/quotationService');
const systemConfigService = require('../services/systemConfigService');
const customerService = require('../services/customerService');
const surveyService = require('../services/surveyService');
const itemService = require('../services/itemService');
const User = require('../models/User');
const { getSettings } = require('../services/settingsService');
const { buildQuotationPdf } = require('../services/quotationPdfService');
const { safeReferrer } = require('../utils/urls');
const ApiError = require('../utils/ApiError');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');

const quotationsBreadcrumb = { label: 'Quotations', url: '/quotations' };

/**
 * List quotations with status, salesperson, and date filters, plus conversion rate.
 */
exports.index = asyncHandler(async (req, res) => {
  const [data, salesUsers] = await Promise.all([
    quotationService.listQuotations(req.query, req.user),
    User.find({ role: { $in: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES] }, isActive: true })
      .select('name role')
      .sort({ name: 1 })
      .lean(),
  ]);

  return res.render('quotations/index', {
    layout: 'layouts/admin',
    title: 'Quotations',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Quotations' }],
    quotationRows: data.quotations,
    total: data.total,
    pagination: data.pagination,
    metrics: data.metrics,
    salesUsers,
    filters: {
      search: req.query.search || '',
      status: req.query.status || '',
      assignedTo: req.query.assignedTo || '',
      from: req.query.from || '',
      to: req.query.to || '',
    },
    userRole: req.user.role,
    canViewProfit: can(req.user, 'profit.view'),
  });
});

/**
 * Quotation form (supports loading from SystemConfig, Survey, or Customer).
 */
exports.newForm = asyncHandler(async (req, res) => {
  const [settings, customers, inventoryItems, salesUsers] = await Promise.all([
    getSettings(),
    customerService.listCustomerOptions(500),
    itemService.listItemsForSelector(req.user),
    User.find({ role: { $in: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES] }, isActive: true })
      .select('name role')
      .sort({ name: 1 })
      .lean(),
  ]);

  let initialQuote = {
    customer: null,
    survey: null,
    systemConfig: null,
    assignedTo: req.user._id,
    systemType: 'on_grid',
    capacityKw: 0,
    panelCount: 0,
    inverterCapacityKw: 0,
    batteryCapacityKwh: 0,
    estimatedUnits: { daily: 0, monthly: 0, yearly: 0 },
    items: [],
    laborCost: settings.defaultLaborCostPaisa ? (settings.defaultLaborCostPaisa / 100) : 0,
    transportCost: settings.defaultTransportCostPaisa ? (settings.defaultTransportCostPaisa / 100) : 0,
    netMeteringCost: settings.defaultNetMeteringCostPaisa ? (settings.defaultNetMeteringCostPaisa / 100) : 0,
    additionalCost: 0,
    discountType: 'percent',
    discountValue: 0,
    paymentOption: 'cash',
    paymentPlan: [],
    validDays: 15,
    terms: settings.quotationTerms || '',
    warrantyTerms:
      '• Solar PV Modules: 12 Years Workmanship Warranty & 25 Years Performance Warranty.\n' +
      '• Grid-Tied / Hybrid Inverter: 5 Years Full Replacement Warranty.\n' +
      '• Complete Installation & System Workmanship: 1 Year Free Comprehensive Support.',
    includeUrdu: false,
    urduNotes:
      'وارنٹی کلیمز مینوفیکچرر کی شرائط کے مطابق لاگو ہوں گے۔ نیٹ میٹرنگ کے عمل کی منظوری متعلقہ ڈسکوز (DISCO) کے قوانین سے مشروط ہے۔',
  };

  // If loading from a saved SystemConfig:
  if (req.query.systemConfig && mongoose.isValidObjectId(req.query.systemConfig)) {
    try {
      const cfg = await systemConfigService.getSystemConfigOrThrow(req.query.systemConfig, req.user);
      initialQuote.systemConfig = cfg._id;
      initialQuote.customer = cfg.customer ? cfg.customer._id : null;
      initialQuote.survey = cfg.survey ? cfg.survey._id : null;
      initialQuote.systemType = cfg.systemType;
      initialQuote.capacityKw = cfg.capacityKw;
      initialQuote.panelCount = cfg.panelCount;
      initialQuote.inverterCapacityKw = cfg.inverterCapacityKw;
      initialQuote.batteryCapacityKwh = cfg.batteryCapacityKwh;
      initialQuote.estimatedUnits = cfg.estimatedUnits || initialQuote.estimatedUnits;

      initialQuote.items = (cfg.lines || []).map((l) => ({
        item: l.item ? (l.item._id || l.item) : null,
        itemSnapshot: l.itemSnapshot || {},
        qty: l.qty,
        unitSellingPrice: Number((l.unitSellingPricePaisa || 0) / 100),
        unitCost: Number((l.unitCostPaisa || 0) / 100),
        notes: l.notes || '',
        isOptionalExtra: false,
      }));

      initialQuote.laborCost = (cfg.laborCostPaisa || 0) / 100;
      initialQuote.transportCost = (cfg.transportCostPaisa || 0) / 100;
      initialQuote.netMeteringCost = (cfg.netMeteringCostPaisa || 0) / 100;
      initialQuote.additionalCost = (cfg.additionalCostPaisa || 0) / 100;
      initialQuote.discountType = cfg.discountType || 'percent';
      initialQuote.discountValue = cfg.discountType === 'amount' ? (cfg.discountPaisa || 0) / 100 : (cfg.discountPercent || 0);
    } catch (_e) {
      /* ignore invalid id */
    }
  }

  // Pre-load from Customer:
  if (req.query.customer && mongoose.isValidObjectId(req.query.customer)) {
    initialQuote.customer = req.query.customer;
  }

  // Pre-load from Survey:
  if (req.query.survey && mongoose.isValidObjectId(req.query.survey)) {
    try {
      const s = await surveyService.getSurveyOrThrow(req.query.survey, req.user);
      initialQuote.survey = s._id;
      if (s.customer) initialQuote.customer = s.customer._id;
      if (s.systemType) initialQuote.systemType = s.systemType;
      if (s.recommendedKw) initialQuote.capacityKw = s.recommendedKw;
    } catch (_e) {}
  }

  return res.render('quotations/form', {
    layout: 'layouts/admin',
    title: 'Create Quotation',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      quotationsBreadcrumb,
      { label: 'New quotation' },
    ],
    initialQuote,
    customers,
    inventoryItems,
    salesUsers,
    isEdit: false,
    canViewCosts: can(req.user, 'costs.view'),
    canViewProfit: can(req.user, 'profit.view'),
    isOwner: req.user.role === ROLES.OWNER,
  });
});

/**
 * Create quotation.
 */
exports.create = asyncHandler(async (req, res) => {
  try {
    let items = [];
    if (req.body.itemsJson) {
      try {
        items = JSON.parse(req.body.itemsJson);
      } catch (e) {
        throw ApiError.badRequest('Invalid quotation items format.');
      }
    } else if (Array.isArray(req.body.items)) {
      items = req.body.items;
    }

    let paymentPlan = [];
    if (req.body.paymentPlanJson) {
      try {
        paymentPlan = JSON.parse(req.body.paymentPlanJson);
      } catch (e) {}
    }

    const payload = {
      ...req.body,
      items,
      paymentPlan,
    };

    const quotation = await quotationService.createQuotation(payload, req.user, req);

    req.flash('success', `${quotation.quotationNumber} has been drafted successfully.`);
    return res.redirect(`/quotations/${quotation._id}`);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect('/quotations/new');
    }
    throw err;
  }
});

/**
 * Show quotation details, BOM snapshot, revisions, and action triggers.
 */
exports.show = asyncHandler(async (req, res) => {
  const quotation = await quotationService.getQuotationOrThrow(req.params.id, req.user);
  const settings = await getSettings();

  // Prepare WhatsApp share URL
  let whatsappUrl = '';
  const customer = quotation.customer || {};
  const rawPhone = customer.whatsapp || customer.phone || '';
  const cleanPhone = rawPhone.replace(/\D/g, '');

  if (cleanPhone) {
    // Format Pakistani phone to international standard (e.g. 0300... -> 92300...)
    const intlPhone = cleanPhone.startsWith('0') ? `92${cleanPhone.slice(1)}` : cleanPhone;
    const finalAmountRupees = Math.round(quotation.finalPricePaisa / 100).toLocaleString('en-PK');
    const capacity = quotation.systemSummary ? quotation.systemSummary.capacityKw : '—';
    const msg =
      `Assalam-o-Alaikum ${customer.name || 'Sir/Madam'},\n\n` +
      `Thank you for your interest in solar energy. Please find your official quotation ${quotation.fullNumber} for a ${capacity} kW solar system from ${settings.companyName || 'Solar Agency'}.\n\n` +
      `*System Capacity:* ${capacity} kW\n` +
      `*Total Investment:* PKR ${finalAmountRupees}\n` +
      `*Validity:* ${quotation.validUntil ? new Date(quotation.validUntil).toLocaleDateString('en-GB') : '15 days'}\n\n` +
      `For any questions or adjustments, please feel free to contact us.`;

    whatsappUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`;
  }

  return res.render('quotations/show', {
    layout: 'layouts/admin',
    title: quotation.fullNumber,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      quotationsBreadcrumb,
      { label: quotation.fullNumber },
    ],
    quotation,
    whatsappUrl,
    canViewCosts: can(req.user, 'costs.view'),
    canViewProfit: can(req.user, 'profit.view'),
    canManage: can(req.user, 'quotations.manage'),
    canApprove: can(req.user, 'quotations.approve'),
  });
});

/**
 * Stream quotation PDF.
 */
exports.downloadPdf = asyncHandler(async (req, res) => {
  const quotation = await quotationService.getQuotationOrThrow(req.params.id, req.user);
  const settings = await getSettings();

  const buffer = await buildQuotationPdf(quotation, settings);
  const safeFilename = `${quotation.quotationNumber}_Rev${quotation.revision}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.end(buffer);
});

/**
 * Duplicate quotation as a new revision.
 */
exports.duplicate = asyncHandler(async (req, res) => {
  try {
    const newRev = await quotationService.duplicateAsNewRevision(req.params.id, req.user, req);
    req.flash(
      'success',
      `Created new revision: ${newRev.quotationNumber} (Rev ${newRev.revision}). You can now edit and send it.`
    );
    return res.redirect(`/quotations/${newRev._id}`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
    return res.redirect(`/quotations/${req.params.id}`);
  }
});

/**
 * Mark status (Draft, Sent, Approved, Rejected).
 */
exports.updateStatus = asyncHandler(async (req, res) => {
  try {
    const { status, reason } = req.body;
    const { quotation, sale } = await quotationService.updateQuotationStatus(
      req.params.id,
      status,
      reason,
      req.user,
      req
    );

    if (status === 'approved' && sale) {
      req.flash(
        'success',
        `Quotation approved! Invoice ${sale.invoiceNumber} and project ${sale.saleNumber} have been created.`
      );
    } else {
      req.flash('success', `Quotation status updated to ${status}.`);
    }

    return res.redirect(`/quotations/${quotation._id}`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
    return res.redirect(`/quotations/${req.params.id}`);
  }
});

/**
 * Send PDF via Email.
 */
exports.sendEmail = asyncHandler(async (req, res) => {
  try {
    const { recipientEmail, subject, message } = req.body;
    await quotationService.emailQuotation(
      req.params.id,
      { recipientEmail, subject, message },
      req.user,
      req
    );

    req.flash('success', `Quotation PDF sent successfully to ${recipientEmail}.`);
  } catch (err) {
    req.flash('error', `Failed to send email: ${err.message}`);
  }
  return res.redirect(`/quotations/${req.params.id}`);
});

/**
 * Soft delete.
 */
exports.destroy = asyncHandler(async (req, res) => {
  try {
    const q = await quotationService.softDeleteQuotation(req.params.id, req.user, req);
    req.flash('success', `${q.quotationNumber} has been deleted.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(safeReferrer(req, '/quotations'));
});
