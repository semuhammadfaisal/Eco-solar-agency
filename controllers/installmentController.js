'use strict';

const mongoose = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const installmentService = require('../services/installmentService');
const { buildReceiptPdf, buildCustomerStatementPdf } = require('../services/installmentPdfService');
const { getSettings } = require('../services/settingsService');
const Sale = require('../models/Sale');
const PosSale = require('../models/PosSale');
const Customer = require('../models/Customer');
const InstallmentPlan = require('../models/InstallmentPlan');
const User = require('../models/User');
const InstallmentPayment = require('../models/InstallmentPayment');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');
const { formatPKR } = require('../utils/format');
const { safeReferrer } = require('../utils/urls');

const installmentsBreadcrumb = { label: 'Installment Plans', url: '/installments' };

/**
 * List installment plans.
 */
exports.index = asyncHandler(async (req, res) => {
  const [data, officers] = await Promise.all([
    installmentService.listInstallmentPlans(req.query, req.user),
    User.find({ role: { $in: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT] }, isActive: true })
      .select('name role')
      .sort({ name: 1 })
      .lean(),
  ]);

  return res.render('installments/index', {
    layout: 'layouts/admin',
    title: 'Installment Plans & Contracts',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, installmentsBreadcrumb],
    plans: data.plans,
    total: data.total,
    pagination: data.pagination,
    metrics: data.metrics,
    officers,
    filters: {
      search: req.query.search || '',
      status: req.query.status || '',
      assignedOfficer: req.query.assignedOfficer || '',
      isFlaggedForRecovery: req.query.isFlaggedForRecovery || '',
    },
    canManage: can(req.user, 'installments.manage'),
  });
});

/**
 * New installment plan form.
 */
exports.newForm = asyncHandler(async (req, res) => {
  const [eligibleSales, officers] = await Promise.all([
    Sale.find({ installmentPlan: null, deletedAt: null })
      .populate('customer', 'name code phone')
      .sort({ createdAt: -1 })
      .lean(),
    User.find({ role: { $in: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES] }, isActive: true })
      .select('name role')
      .sort({ name: 1 })
      .lean(),
  ]);

  let preselectedSale = null;
  if (req.query.sale && mongoose.isValidObjectId(req.query.sale)) {
    preselectedSale = await Sale.findById(req.query.sale).populate('customer').lean();
  }

  return res.render('installments/form', {
    layout: 'layouts/admin',
    title: 'Create Installment Plan',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      installmentsBreadcrumb,
      { label: 'New plan' },
    ],
    sales: eligibleSales,
    officers,
    preselectedSale,
  });
});

/**
 * Create plan.
 */
exports.create = asyncHandler(async (req, res) => {
  try {
    let cheques = [];
    if (req.body.chequesJson) {
      try {
        cheques = JSON.parse(req.body.chequesJson);
      } catch (_e) {}
    }

    const payload = {
      ...req.body,
      cheques,
    };

    const plan = await installmentService.createInstallmentPlan(payload, req.user, req);

    req.flash('success', `Installment Plan ${plan.planNumber} created successfully.`);
    return res.redirect(`/installments/${plan._id}`);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect('/installments/new');
    }
    throw err;
  }
});

/**
 * Show installment plan details, schedule, security checklist, cheques, and guarantor.
 */
exports.show = asyncHandler(async (req, res) => {
  const plan = await installmentService.getInstallmentPlanOrThrow(req.params.id, req.user);

  return res.render('installments/show', {
    layout: 'layouts/admin',
    title: `${plan.planNumber} — ${plan.customer ? plan.customer.name : 'Installment Plan'}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      installmentsBreadcrumb,
      { label: plan.planNumber },
    ],
    plan,
    canManage: can(req.user, 'installments.manage'),
    canCollect: can(req.user, 'installments.collect'),
    canReschedule: can(req.user, 'installments.reschedule'),
    canWaive: can(req.user, 'installments.waive'),
    canSecurityOverride: can(req.user, 'installments.security_override'),
    isOwner: req.user.role === ROLES.OWNER,
  });
});

/**
 * Collect payment & issue receipt.
 */
exports.collectPayment = asyncHandler(async (req, res) => {
  try {
    const { payment, plan, receiptNumber } = await installmentService.recordPayment(
      req.body,
      req.user,
      req
    );

    req.flash(
      'success',
      `Payment of PKR ${(payment.amountPaisa / 100).toLocaleString()} recorded. Receipt #${receiptNumber} generated.`
    );
    return res.redirect(`/installments/receipts/${payment._id}`);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect(safeReferrer(req, `/installments/${req.body.planId}`));
    }
    throw err;
  }
});

/**
 * Show payment receipt & WhatsApp share link.
 */
exports.showReceipt = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw ApiError.notFound('Receipt not found.');
  }

  const payment = await InstallmentPayment.findById(req.params.id)
    .populate('customer')
    .populate('installmentPlan')
    .populate('receivedBy', 'name')
    .lean();

  if (!payment) throw ApiError.notFound('Receipt not found.');

  const settings = await getSettings();

  // WhatsApp share link
  let whatsappUrl = '';
  const customer = payment.customer || {};
  const rawPhone = customer.whatsapp || customer.phone || '';
  const cleanPhone = rawPhone.replace(/\D/g, '');

  if (cleanPhone) {
    const intlPhone = cleanPhone.startsWith('0') ? `92${cleanPhone.slice(1)}` : cleanPhone;
    const amountRupees = Math.round(payment.amountPaisa / 100).toLocaleString('en-PK');
    const remainingRupees = Math.round(payment.remainingPlanBalancePaisa / 100).toLocaleString('en-PK');
    const planNumber = payment.installmentPlan ? payment.installmentPlan.planNumber : 'Installment Plan';

    const msg =
      `Assalam-o-Alaikum ${customer.name || 'Valued Client'},\n\n` +
      `Thank you for your payment. Official receipt *${payment.receiptNumber}* has been issued by ${settings.companyName || 'Solar Agency'}.\n\n` +
      `*Installment Plan:* ${planNumber}\n` +
      `*Amount Received:* PKR ${amountRupees}\n` +
      `*Payment Method:* ${payment.paymentMethod.toUpperCase()}${payment.reference ? ' (' + payment.reference + ')' : ''}\n` +
      `*Remaining Balance:* PKR ${remainingRupees}\n` +
      `*Receipt Date:* ${new Date(payment.paymentDate).toLocaleDateString('en-GB')}\n\n` +
      `Thank you for your business.`;

    whatsappUrl = `https://wa.me/${intlPhone}?text=${encodeURIComponent(msg)}`;
  }

  return res.render('installments/receipt', {
    layout: 'layouts/admin',
    title: `Receipt ${payment.receiptNumber}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      installmentsBreadcrumb,
      { label: payment.receiptNumber },
    ],
    payment,
    whatsappUrl,
    settings,
  });
});

/**
 * Download Receipt PDF.
 */
exports.downloadReceiptPdf = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    throw ApiError.notFound('Receipt not found.');
  }

  const payment = await InstallmentPayment.findById(req.params.id)
    .populate('customer')
    .populate('installmentPlan')
    .populate('receivedBy', 'name')
    .lean();

  if (!payment) throw ApiError.notFound('Receipt not found.');

  const settings = await getSettings();
  const buffer = await buildReceiptPdf(payment, settings);
  const safeFilename = `${payment.receiptNumber}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.end(buffer);
});

/**
 * Reschedule plan.
 */
exports.reschedule = asyncHandler(async (req, res) => {
  try {
    const plan = await installmentService.reschedulePlan(
      req.params.id,
      req.body,
      req.user,
      req
    );
    req.flash('success', `Installment Plan ${plan.planNumber} rescheduled successfully.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(`/installments/${req.params.id}`);
});

/**
 * Waive late fee.
 */
exports.waiveLateFee = asyncHandler(async (req, res) => {
  try {
    const inst = await installmentService.waiveLateFee(
      req.params.installmentId,
      req.body,
      req.user,
      req
    );
    req.flash(
      'success',
      `Late fee waived on Installment #${inst.installmentNumber}.`
    );
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(safeReferrer(req, '/installments'));
});

/**
 * Update Security Checklist.
 */
exports.updateChecklist = asyncHandler(async (req, res) => {
  try {
    const plan = await installmentService.updateSecurityChecklist(
      req.params.id,
      req.body,
      req.user,
      req
    );
    req.flash(
      'success',
      `Security checklist updated. Status: ${plan.securityChecklist.isComplete ? 'Complete' : 'Pending'}.`
    );
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(`/installments/${req.params.id}`);
});

/**
 * Owner Override for Security Checklist.
 */
exports.overrideSecurity = asyncHandler(async (req, res) => {
  try {
    const plan = await installmentService.ownerOverrideSecurityChecklist(
      req.params.id,
      req.body.reason,
      req.user,
      req
    );
    req.flash(
      'success',
      `Owner security override granted for Plan ${plan.planNumber}. Material dispatch is now unblocked.`
    );
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(`/installments/${req.params.id}`);
});

/**
 * Issue Material for Sale (enforces checklist gate).
 */
exports.issueMaterial = asyncHandler(async (req, res) => {
  try {
    const sale = await installmentService.issueMaterialForSale(
      req.params.saleId,
      req.body.notes,
      req.user,
      req
    );
    req.flash('success', `Material successfully issued for Sale ${sale.saleNumber}.`);
    return res.redirect(`/projects/${sale._id}`);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect(safeReferrer(req, `/projects/${req.params.saleId}`));
    }
    throw err;
  }
});

/**
 * FullCalendar page.
 */
exports.calendarView = asyncHandler(async (req, res) => {
  const [customers, officers] = await Promise.all([
    Customer.find({ deletedAt: null }).select('name code phone city').sort({ name: 1 }).lean(),
    User.find({ role: { $in: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES] }, isActive: true })
      .select('name role')
      .sort({ name: 1 })
      .lean(),
  ]);

  return res.render('installments/calendar', {
    layout: 'layouts/admin',
    title: 'Installment Collection Calendar',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      installmentsBreadcrumb,
      { label: 'Calendar' },
    ],
    customers,
    officers,
    pageScripts: ['/vendor/fullcalendar/index.global.min.js'],
  });
});

/**
 * FullCalendar JSON events endpoint.
 */
exports.calendarEvents = asyncHandler(async (req, res) => {
  const events = await installmentService.listCalendarEvents(req.query, req.user);
  return res.json(events);
});

/**
 * Cheque Register page.
 */
exports.chequesIndex = asyncHandler(async (req, res) => {
  const [data, customers] = await Promise.all([
    installmentService.listCheques(req.query, req.user),
    Customer.find({})
      .select('name code phone')
      .sort({ name: 1 })
      .limit(1000)
      .lean(),
  ]);

  return res.render('installments/cheques', {
    layout: 'layouts/admin',
    title: 'Cheque Register & Vault',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      installmentsBreadcrumb,
      { label: 'Cheque Register' },
    ],
    cheques: data.cheques,
    total: data.total,
    pagination: data.pagination,
    statusCounts: data.statusCounts,
    customers,
    filters: {
      status: req.query.status || '',
      bankName: req.query.bankName || '',
      search: req.query.search || '',
      customer: req.query.customer || '',
      sale: req.query.sale || '',
      posSale: req.query.posSale || '',
    },
    canManage: can(req.user, 'installments.manage'),
  });
});

/**
 * Add-cheque form. A cheque can be linked to a customer plus a project/sale,
 * POS order, installment plan, or any combination of them.
 */
exports.newChequeForm = asyncHandler(async (req, res) => {
  const [customers, sales, posSales, plans] = await Promise.all([
    Customer.find({})
      .select('name code phone city')
      .sort({ name: 1 })
      .limit(1000)
      .lean(),
    Sale.find({})
      .select('saleNumber invoiceNumber projectTitle amountPaisa customer systemSummary status')
      .populate('customer', 'name code phone')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
    PosSale.find({ status: 'completed' })
      .select('number customer customerName totalPaisa soldAt status items')
      .populate('customer', 'name code phone')
      .sort({ soldAt: -1 })
      .limit(300)
      .lean(),
    InstallmentPlan.find({})
      .select('planNumber sale customer status')
      .populate('sale', 'saleNumber projectTitle')
      .sort({ createdAt: -1 })
      .limit(500)
      .lean(),
  ]);

  return res.render('installments/cheque-form', {
    layout: 'layouts/admin',
    title: 'Add Cheque to Vault',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      installmentsBreadcrumb,
      { label: 'Cheque Register', url: '/installments/cheques' },
      { label: 'Add cheque' },
    ],
    customers,
    sales,
    posSales,
    plans,
    preselected: {
      customer: req.query.customer || '',
      sale: req.query.sale || '',
      posSale: req.query.posSale || '',
      plan: req.query.plan || '',
    },
  });
});

/**
 * Persist a new cheque from the register form.
 */
exports.createCheque = asyncHandler(async (req, res) => {
  try {
    const cheque = await installmentService.createCheque(req.body, req.user, req);

    req.flash(
      'success',
      `Cheque #${cheque.chequeNumber} for ${formatPKR(cheque.amountPaisa)} added to the vault.`
    );
    return res.redirect(`/installments/cheques?customer=${cheque.customer}`);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect('/installments/cheques/new');
    }
    throw err;
  }
});

/**
 * Update Cheque Status (held/deposited/cleared/bounced).
 */
exports.updateCheque = asyncHandler(async (req, res) => {
  try {
    const { status, bounceReason } = req.body;
    const cheque = await installmentService.updateChequeStatus(
      req.params.id,
      status,
      bounceReason,
      req.user,
      req
    );

    if (status === 'bounced') {
      req.flash(
        'error',
        `Cheque #${cheque.chequeNumber} marked BOUNCED! The associated customer account has been flagged for recovery.`
      );
    } else {
      req.flash('success', `Cheque #${cheque.chequeNumber} status updated to ${status}.`);
    }
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }
  return res.redirect(safeReferrer(req, '/installments/cheques'));
});

/**
 * Customer Installment Ledger.
 */
exports.customerLedger = asyncHandler(async (req, res) => {
  const data = await installmentService.getCustomerInstallmentLedger(req.params.customerId);

  return res.render('installments/customer_ledger', {
    layout: 'layouts/admin',
    title: `Installment Ledger — ${data.customer.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Customers', url: '/customers' },
      { label: data.customer.name, url: `/customers/${data.customer._id}` },
      { label: 'Installment Ledger' },
    ],
    customer: data.customer,
    plans: data.plans,
    transactions: data.transactions,
    summary: data.summary,
  });
});

/**
 * Customer Statement of Account PDF.
 */
exports.customerStatementPdf = asyncHandler(async (req, res) => {
  const data = await installmentService.getCustomerInstallmentLedger(req.params.customerId);
  const settings = await getSettings();

  const buffer = await buildCustomerStatementPdf(data.customer, data, settings);
  const safeFilename = `Statement_${data.customer.code || 'Customer'}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.end(buffer);
});

/**
 * List all receipts.
 */
exports.receiptsIndex = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 20));

  const filter = {};
  if (req.query.search) {
    const rx = new RegExp(req.query.search.trim(), 'i');
    filter.$or = [{ receiptNumber: rx }, { reference: rx }];
  }

  const [total, receipts] = await Promise.all([
    InstallmentPayment.countDocuments(filter),
    InstallmentPayment.find(filter)
      .populate('customer', 'name code phone')
      .populate('installmentPlan', 'planNumber')
      .populate('receivedBy', 'name')
      .sort({ paymentDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
  ]);

  return res.render('installments/receipts', {
    layout: 'layouts/admin',
    title: 'Payment Receipts',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      installmentsBreadcrumb,
      { label: 'Receipts' },
    ],
    receipts,
    total,
    pagination: {
      page,
      pages: Math.ceil(total / limit),
      limit,
    },
    filters: {
      search: req.query.search || '',
    },
  });
});
