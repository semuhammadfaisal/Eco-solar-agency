'use strict';

const mongoose = require('mongoose');
const InstallmentPlan = require('../models/InstallmentPlan');
const Installment = require('../models/Installment');
const InstallmentPayment = require('../models/InstallmentPayment');
const Cheque = require('../models/Cheque');
const Sale = require('../models/Sale');
const PosSale = require('../models/PosSale');
const Customer = require('../models/Customer');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { text } = require('../utils/inputs');
const { paginate, escapeRegex } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');
const accountingService = require('./accountingService');
const {
  PLAN_STATUSES,
  INSTALLMENT_STATUSES,
  CHEQUE_STATUSES,
} = require('../config/installments');

async function nextPlanNumber() {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`installment_plan_${year}`);
  return `IP-${year}-${String(seq).padStart(4, '0')}`;
}

async function nextReceiptNumber() {
  const seq = await Counter.next('receipt');
  return `RC-${String(seq).padStart(4, '0')}`;
}

/**
 * Calculates date stepping based on frequency.
 */
function addPeriod(baseDate, periodCount, frequency = 'monthly') {
  const d = new Date(baseDate);
  if (frequency === 'quarterly') {
    d.setMonth(d.getMonth() + periodCount * 3);
  } else if (frequency === 'bi_monthly') {
    d.setMonth(d.getMonth() + periodCount * 2);
  } else {
    // monthly default
    d.setMonth(d.getMonth() + periodCount);
  }
  return d;
}

/**
 * Generates an exact installment schedule distributing total payable across N installments.
 * Remainder paisas are placed on the final installment.
 */
function generateInstallmentSchedule({
  financedAmountPaisa = 0,
  markupPaisa = 0,
  installmentCount = 1,
  frequency = 'monthly',
  startDate = new Date(),
}) {
  const count = Math.max(1, parseInt(installmentCount, 10) || 1);
  const totalPayable = Math.max(0, Math.round(financedAmountPaisa + markupPaisa));
  const baseAmount = Math.floor(totalPayable / count);
  const remainder = totalPayable - baseAmount * count;

  const schedule = [];
  const start = new Date(startDate);

  for (let i = 1; i <= count; i += 1) {
    const isLast = i === count;
    const amountPaisa = isLast ? baseAmount + remainder : baseAmount;
    const dueDate = addPeriod(start, i - 1, frequency);

    schedule.push({
      installmentNumber: i,
      dueDate,
      amountPaisa,
      paidAmountPaisa: 0,
      lateFeeAssessedPaisa: 0,
      lateFeePaidPaisa: 0,
      lateFeeWaivedPaisa: 0,
      status: 'pending',
    });
  }

  return schedule;
}

/**
 * Creates an InstallmentPlan and its child Installment schedule.
 */
async function createInstallmentPlan(payload, actor, req) {
  if (!payload.sale || !mongoose.isValidObjectId(payload.sale)) {
    throw ApiError.badRequest('Select a valid sale contract.');
  }

  const sale = await Sale.findById(payload.sale).populate('customer');
  if (!sale) throw ApiError.badRequest('Sale contract not found.');
  if (sale.installmentPlan) {
    throw ApiError.badRequest(`Sale ${sale.saleNumber} already has an active installment plan.`);
  }

  const customerId = sale.customer ? (sale.customer._id || sale.customer) : payload.customer;
  const totalSaleAmountPaisa = sale.amountPaisa;

  // Down payment in paisa
  const downPaymentPaisa = payload.downPaymentPaisa !== undefined && payload.downPaymentPaisa !== ''
    ? Math.max(0, Math.round(Number(payload.downPaymentPaisa)))
    : toPaisa(payload.downPayment);

  if (downPaymentPaisa >= totalSaleAmountPaisa) {
    throw ApiError.badRequest('Down payment cannot be equal to or greater than the total sale amount.');
  }

  const financedAmountPaisa = totalSaleAmountPaisa - downPaymentPaisa;

  // Markup calculation
  const markupType = payload.markupType === 'fixed_amount' ? 'fixed_amount' : 'percent';
  let markupPaisa = 0;
  let markupRatePercent = 0;

  if (markupType === 'percent') {
    markupRatePercent = Math.max(0, Number(payload.markupRatePercent) || 0);
    markupPaisa = Math.round(financedAmountPaisa * (markupRatePercent / 100));
  } else {
    markupPaisa = payload.markupPaisa !== undefined && payload.markupPaisa !== ''
      ? Math.max(0, Math.round(Number(payload.markupPaisa)))
      : toPaisa(payload.markupFixedAmount);
  }

  const totalPayablePaisa = financedAmountPaisa + markupPaisa;
  const installmentCount = Math.max(1, Math.min(120, parseInt(payload.installmentCount, 10) || 12));
  const frequency = ['monthly', 'bi_monthly', 'quarterly'].includes(payload.frequency)
    ? payload.frequency
    : 'monthly';

  const startDate = payload.startDate ? new Date(payload.startDate) : addPeriod(new Date(), 1, 'monthly');
  const baseInstallmentAmountPaisa = Math.floor(totalPayablePaisa / installmentCount);

  const planNumber = await nextPlanNumber();

  // Assigned collection officer
  let assignedOfficer = null;
  if (payload.assignedOfficer && mongoose.isValidObjectId(payload.assignedOfficer)) {
    assignedOfficer = payload.assignedOfficer;
  } else if (sale.assignedTo) {
    assignedOfficer = sale.assignedTo;
  }

  // Guarantor info
  const guarantor = {
    name: text(payload.guarantorName, 100),
    cnic: text(payload.guarantorCnic, 20),
    phone: text(payload.guarantorPhone, 30),
    relation: text(payload.guarantorRelation, 50),
    address: text(payload.guarantorAddress, 300),
    workplace: text(payload.guarantorWorkplace, 150),
  };

  // Security checklist
  const securityChecklist = {
    stampAgreement: { submitted: Boolean(payload.check_stampAgreement) },
    customerCnicCopy: { submitted: Boolean(payload.check_customerCnicCopy) },
    guarantorCnicCopy: { submitted: Boolean(payload.check_guarantorCnicCopy) },
    utilityBillCopy: { submitted: Boolean(payload.check_utilityBillCopy) },
    promissoryNote: { submitted: Boolean(payload.check_promissoryNote) },
    postDatedCheques: {
      submitted: Boolean(payload.check_postDatedCheques),
      count: Math.max(0, parseInt(payload.postDatedChequesCount, 10) || 0),
    },
    isComplete: false,
  };

  // Check initial completeness
  securityChecklist.isComplete =
    securityChecklist.stampAgreement.submitted &&
    securityChecklist.customerCnicCopy.submitted &&
    securityChecklist.guarantorCnicCopy.submitted &&
    securityChecklist.utilityBillCopy.submitted &&
    securityChecklist.promissoryNote.submitted &&
    securityChecklist.postDatedCheques.submitted;

  if (securityChecklist.isComplete) {
    securityChecklist.completedAt = new Date();
    securityChecklist.completedBy = actor._id;
  }

  const plan = await InstallmentPlan.create({
    planNumber,
    sale: sale._id,
    customer: customerId,
    totalSaleAmountPaisa,
    downPaymentPaisa,
    downPaymentPaid: true,
    downPaymentPaidAt: new Date(),
    financedAmountPaisa,
    markupType,
    markupRatePercent,
    markupPaisa,
    totalPayablePaisa,
    installmentCount,
    installmentAmountPaisa: baseInstallmentAmountPaisa,
    frequency,
    startDate,
    lateFeeRule: {
      graceDays: Math.max(0, parseInt(payload.graceDays, 10) || 5),
      type: 'fixed',
      amountPaisa: payload.lateFeeAmount !== undefined && payload.lateFeeAmount !== ''
        ? toPaisa(payload.lateFeeAmount)
        : 50000,
    },
    totalPaidPaisa: 0,
    remainingBalancePaisa: totalPayablePaisa,
    status: 'active',
    assignedOfficer,
    securityChecklist,
    guarantor,
    notes: text(payload.notes, 3000),
    createdBy: actor._id,
  });

  // Bulk create the installments
  const schedule = generateInstallmentSchedule({
    financedAmountPaisa,
    markupPaisa,
    installmentCount,
    frequency,
    startDate,
  });

  const installmentDocs = schedule.map((item) => ({
    ...item,
    installmentPlan: plan._id,
    customer: customerId,
    sale: sale._id,
  }));

  await Installment.insertMany(installmentDocs);

  // Link installment plan to sale
  sale.installmentPlan = plan._id;
  sale.paymentType = 'installment';
  await sale.save();

  // If initial cheques were provided
  if (Array.isArray(payload.cheques) && payload.cheques.length) {
    const chequeDocs = payload.cheques
      .filter((c) => c && c.chequeNumber && c.bankName)
      .map((c, idx) => ({
        chequeNumber: text(c.chequeNumber, 50),
        bankName: text(c.bankName, 100),
        branch: text(c.branch, 100),
        amountPaisa: toPaisa(c.amount) || baseInstallmentAmountPaisa,
        chequeDate: c.chequeDate ? new Date(c.chequeDate) : addPeriod(startDate, idx, frequency),
        customer: customerId,
        installmentPlan: plan._id,
        installmentNumber: idx + 1,
        status: 'held',
        receivedBy: actor._id,
      }));

    if (chequeDocs.length) {
      await Cheque.insertMany(chequeDocs);
    }
  }

  await logAction(
    actor,
    AUDIT_ACTIONS.INSTALLMENT_PLAN_CREATED,
    'installment_plans',
    plan._id,
    null,
    plan.toObject(),
    { req, description: `Installment plan ${plan.planNumber} created for Sale ${sale.saleNumber}` }
  );

  return plan;
}

/**
 * Get plan details, child installments, payments, cheques, and guarantor.
 */
async function getInstallmentPlanOrThrow(id, user) {
  if (!mongoose.isValidObjectId(id)) {
    throw ApiError.notFound('Installment plan not found.');
  }

  const query = { _id: id };
  if (user && user.role === 'sales') {
    // Sales users see only plans where they are assigned or customer is theirs
    query.$or = [{ assignedOfficer: user._id }, { createdBy: user._id }];
  }

  const plan = await InstallmentPlan.findOne(query)
    .populate('customer')
    .populate('sale')
    .populate('assignedOfficer', 'name email phone')
    .populate('createdBy', 'name')
    .populate('securityChecklist.completedBy', 'name')
    .populate('securityChecklist.ownerOverride.overriddenBy', 'name')
    .lean();

  if (!plan) throw ApiError.notFound('Installment plan not found.');

  // Fetch installments sorted chronologically
  const installments = await Installment.find({ installmentPlan: plan._id })
    .sort({ installmentNumber: 1 })
    .lean();

  // Fetch payment receipts
  const payments = await InstallmentPayment.find({ installmentPlan: plan._id })
    .populate('receivedBy', 'name')
    .sort({ paymentDate: -1 })
    .lean();

  // Fetch cheques
  const cheques = await Cheque.find({ installmentPlan: plan._id })
    .sort({ chequeDate: 1 })
    .lean();

  // Check and update overdue status dynamically
  const now = new Date();
  const graceDays = (plan.lateFeeRule && plan.lateFeeRule.graceDays) || 5;

  let hasUpdates = false;
  for (const inst of installments) {
    if (inst.status !== 'paid') {
      const graceThreshold = new Date(inst.dueDate);
      graceThreshold.setDate(graceThreshold.getDate() + graceDays);

      if (now > graceThreshold && inst.status !== 'overdue') {
        inst.status = 'overdue';
        await Installment.updateOne({ _id: inst._id }, { $set: { status: 'overdue' } });
        hasUpdates = true;
      }
    }
  }

  plan.installments = installments;
  plan.payments = payments;
  plan.cheques = cheques;

  return plan;
}

/**
 * List installment plans with filters, metrics, and pagination.
 */
async function listInstallmentPlans(query = {}, user) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 20));

  const filter = {};
  if (user && user.role === 'sales') {
    filter.$or = [{ assignedOfficer: user._id }, { createdBy: user._id }];
  }

  if (query.status && PLAN_STATUSES.includes(query.status)) {
    filter.status = query.status;
  }

  if (query.customer && mongoose.isValidObjectId(query.customer)) {
    filter.customer = query.customer;
  }

  if (query.isFlaggedForRecovery === 'true' || query.recovery === 'true') {
    filter.isFlaggedForRecovery = true;
  }

  if (query.assignedOfficer && mongoose.isValidObjectId(query.assignedOfficer)) {
    filter.assignedOfficer = query.assignedOfficer;
  }

  const search = text(query.search, 80);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ planNumber: regex }, { notes: regex }];
  }

  const [total, plans, metricsAgg] = await Promise.all([
    InstallmentPlan.countDocuments(filter),
    InstallmentPlan.find(filter)
      .populate('customer', 'name code phone city area')
      .populate('sale', 'saleNumber amountPaisa')
      .populate('assignedOfficer', 'name')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    InstallmentPlan.aggregate([
      { $match: { deletedAt: null } },
      {
        $group: {
          _id: null,
          totalPlans: { $sum: 1 },
          activePlans: { $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] } },
          recoveryPlans: { $sum: { $cond: ['$isFlaggedForRecovery', 1, 0] } },
          totalFinancedPaisa: { $sum: '$financedAmountPaisa' },
          totalPaidPaisa: { $sum: '$totalPaidPaisa' },
          totalRemainingPaisa: { $sum: '$remainingBalancePaisa' },
        },
      },
    ]),
  ]);

  const metricsRow = metricsAgg[0] || {
    totalPlans: 0,
    activePlans: 0,
    recoveryPlans: 0,
    totalFinancedPaisa: 0,
    totalPaidPaisa: 0,
    totalRemainingPaisa: 0,
  };

  return {
    plans,
    total,
    pagination: paginate(total, page, limit),
    metrics: metricsRow,
  };
}

/**
 * Record a payment, allocate across installments, and issue receipt RC-XXXX.
 */
async function recordPayment(payload, actor, req) {
  if (!payload.planId || !mongoose.isValidObjectId(payload.planId)) {
    throw ApiError.badRequest('Select a valid installment plan.');
  }

  const plan = await InstallmentPlan.findById(payload.planId).populate('customer').populate('sale');
  if (!plan) throw ApiError.badRequest('Installment plan not found.');

  const amountPaisa = payload.amountPaisa !== undefined && payload.amountPaisa !== ''
    ? Math.max(1, Math.round(Number(payload.amountPaisa)))
    : toPaisa(payload.amount);

  if (amountPaisa <= 0) {
    throw ApiError.badRequest('Payment amount must be greater than zero.');
  }

  // Fetch unpaid/partial installments in chronological order
  const installments = await Installment.find({
    installmentPlan: plan._id,
    status: { $in: ['pending', 'partial', 'overdue'] },
  }).sort({ installmentNumber: 1 });

  let unallocatedPaisa = amountPaisa;
  const allocations = [];

  for (const inst of installments) {
    if (unallocatedPaisa <= 0) break;

    const principalDue = inst.amountPaisa - inst.paidAmountPaisa;
    const lateFeeDue = Math.max(0, inst.lateFeeAssessedPaisa - (inst.lateFeePaidPaisa + inst.lateFeeWaivedPaisa));
    const totalInstDue = principalDue + lateFeeDue;

    if (totalInstDue <= 0) continue;

    let allocateToLateFee = 0;
    let allocateToPrincipal = 0;

    // First allocate to unpaid late fee
    if (lateFeeDue > 0) {
      allocateToLateFee = Math.min(unallocatedPaisa, lateFeeDue);
      unallocatedPaisa -= allocateToLateFee;
    }

    // Then allocate remaining to principal installment amount
    if (unallocatedPaisa > 0 && principalDue > 0) {
      allocateToPrincipal = Math.min(unallocatedPaisa, principalDue);
      unallocatedPaisa -= allocateToPrincipal;
    }

    const totalAllocated = allocateToLateFee + allocateToPrincipal;
    inst.lateFeePaidPaisa += allocateToLateFee;
    inst.paidAmountPaisa += allocateToPrincipal;

    const remainingOnInst =
      (inst.amountPaisa + inst.lateFeeAssessedPaisa) -
      (inst.paidAmountPaisa + inst.lateFeePaidPaisa + inst.lateFeeWaivedPaisa);

    const wasFullySettled = remainingOnInst <= 0;
    if (wasFullySettled) {
      inst.status = 'paid';
      inst.paidAt = new Date();
    } else {
      inst.status = 'partial';
    }

    await inst.save();

    allocations.push({
      installment: inst._id,
      installmentNumber: inst.installmentNumber,
      principalPaidPaisa: allocateToPrincipal,
      lateFeePaidPaisa: allocateToLateFee,
      totalAllocatedPaisa: totalAllocated,
      wasFullySettled,
    });
  }

  // If there is excess remaining payment after all installments are settled
  const excessAdvancePaisa = Math.max(0, unallocatedPaisa);

  // Update plan running totals
  const principalPaidTotal = amountPaisa - excessAdvancePaisa;
  plan.totalPaidPaisa += principalPaidTotal;
  plan.remainingBalancePaisa = Math.max(0, plan.totalPayablePaisa - plan.totalPaidPaisa);

  // Check if all installments for the plan are settled
  const remainingUnpaidCount = await Installment.countDocuments({
    installmentPlan: plan._id,
    status: { $in: ['pending', 'partial', 'overdue'] },
  });

  if (remainingUnpaidCount === 0 && plan.remainingBalancePaisa === 0) {
    plan.status = 'completed';
  }

  await plan.save();

  // Generate Receipt
  const receiptNumber = await nextReceiptNumber();
  const payment = await InstallmentPayment.create({
    receiptNumber,
    installmentPlan: plan._id,
    customer: plan.customer ? (plan.customer._id || plan.customer) : plan.customer,
    sale: plan.sale ? (plan.sale._id || plan.sale) : null,
    amountPaisa,
    paymentDate: payload.paymentDate ? new Date(payload.paymentDate) : new Date(),
    paymentMethod: ['cash', 'bank', 'cheque', 'online'].includes(payload.paymentMethod)
      ? payload.paymentMethod
      : 'cash',
    reference: text(payload.reference, 100),
    bankName: text(payload.bankName, 100),
    allocations,
    excessAdvancePaisa,
    remainingPlanBalancePaisa: plan.remainingBalancePaisa,
    receivedBy: actor._id,
    notes: text(payload.notes, 1000),
  });

  // Step 10: Auto-post double-entry journal entry for payment receipt
  try {
    await accountingService.postCustomerPayment(payment, actor, req);
  } catch (accErr) {
    console.error('[accounting] postCustomerPayment error:', accErr.message);
  }

  await logAction(
    actor,
    AUDIT_ACTIONS.INSTALLMENT_PAYMENT_RECORDED,
    'installment_payments',
    payment._id,
    null,
    payment.toObject(),
    { req, description: `Receipt ${receiptNumber} recorded for ${amountPaisa / 100} PKR on Plan ${plan.planNumber}` }
  );

  return { payment, plan, receiptNumber };
}

/**
 * Reschedules remaining installments of an active plan (Owner/Manager only).
 */
async function reschedulePlan(planId, payload, actor, req) {
  if (!can(actor, 'installments.reschedule')) {
    throw ApiError.forbidden('Only owners and managers can reschedule installment plans.');
  }

  const reason = text(payload.reason, 500);
  if (!reason) {
    throw ApiError.badRequest('A mandatory reschedule reason is required.');
  }

  const plan = await InstallmentPlan.findById(planId);
  if (!plan) throw ApiError.notFound('Installment plan not found.');

  // Fetch unpaid installments
  const unpaidInstallments = await Installment.find({
    installmentPlan: plan._id,
    status: { $in: ['pending', 'partial', 'overdue'] },
  }).sort({ installmentNumber: 1 });

  if (!unpaidInstallments.length) {
    throw ApiError.badRequest('No pending installments left to reschedule.');
  }

  const oldScheduleSummary = unpaidInstallments
    .map((i) => `#${i.installmentNumber}: due ${i.dueDate.toISOString().slice(0, 10)} (PKR ${i.amountPaisa / 100})`)
    .join('; ');

  const newStartDate = payload.newStartDate ? new Date(payload.newStartDate) : new Date();
  const frequency = payload.frequency || plan.frequency;

  for (let idx = 0; idx < unpaidInstallments.length; idx += 1) {
    const inst = unpaidInstallments[idx];
    inst.dueDate = addPeriod(newStartDate, idx, frequency);
    inst.status = 'pending'; // reset overdue flag after management rescheduling
    await inst.save();
  }

  const newScheduleSummary = unpaidInstallments
    .map((i) => `#${i.installmentNumber}: due ${i.dueDate.toISOString().slice(0, 10)} (PKR ${i.amountPaisa / 100})`)
    .join('; ');

  plan.status = 'rescheduled';
  plan.rescheduleHistory.push({
    rescheduledAt: new Date(),
    rescheduledBy: actor._id,
    reason,
    oldScheduleSummary,
    newScheduleSummary,
  });

  await plan.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.INSTALLMENT_RESCHEDULED,
    'installment_plans',
    plan._id,
    { oldScheduleSummary },
    { newScheduleSummary, reason },
    { req, description: `Plan ${plan.planNumber} rescheduled. Reason: ${reason}` }
  );

  return plan;
}

/**
 * Waive late fee on an installment (Owner/Manager only).
 */
async function waiveLateFee(installmentId, payload, actor, req) {
  if (!can(actor, 'installments.waive')) {
    throw ApiError.forbidden('Only owners and managers can waive late fees.');
  }

  const reason = text(payload.reason, 500);
  if (!reason) {
    throw ApiError.badRequest('A mandatory reason is required to waive late fees.');
  }

  const installment = await Installment.findById(installmentId);
  if (!installment) throw ApiError.notFound('Installment not found.');

  const waiverAmountPaisa = payload.amountPaisa !== undefined && payload.amountPaisa !== ''
    ? Math.max(1, Math.round(Number(payload.amountPaisa)))
    : toPaisa(payload.amount);

  const maxWaivable = Math.max(
    0,
    installment.lateFeeAssessedPaisa - (installment.lateFeePaidPaisa + installment.lateFeeWaivedPaisa)
  );

  if (waiverAmountPaisa > maxWaivable) {
    throw ApiError.badRequest(`Waiver exceeds outstanding late fee of PKR ${(maxWaivable / 100).toLocaleString()}.`);
  }

  installment.lateFeeWaivedPaisa += waiverAmountPaisa;

  // Check if remaining due is settled
  const remainingDue =
    (installment.amountPaisa + installment.lateFeeAssessedPaisa) -
    (installment.paidAmountPaisa + installment.lateFeePaidPaisa + installment.lateFeeWaivedPaisa);

  if (remainingDue <= 0) {
    installment.status = 'paid';
  }

  await installment.save();

  // Update plan summary
  await InstallmentPlan.updateOne(
    { _id: installment.installmentPlan },
    { $inc: { totalLateFeesWaivedPaisa: waiverAmountPaisa } }
  );

  await logAction(
    actor,
    AUDIT_ACTIONS.INSTALLMENT_LATE_FEE_WAIVED,
    'installments',
    installment._id,
    null,
    { waiverAmountPaisa, reason },
    { req, description: `Late fee waived PKR ${waiverAmountPaisa / 100} on Installment #${installment.installmentNumber}` }
  );

  return installment;
}

/**
 * Updates security checklist items and re-evaluates completeness.
 */
async function updateSecurityChecklist(planId, checklistData, actor, req) {
  const plan = await InstallmentPlan.findById(planId);
  if (!plan) throw ApiError.notFound('Installment plan not found.');

  const sc = plan.securityChecklist || {};

  if (checklistData.stampAgreement !== undefined) {
    sc.stampAgreement.submitted = Boolean(checklistData.stampAgreement);
    if (sc.stampAgreement.submitted) sc.stampAgreement.verifiedAt = new Date();
  }
  if (checklistData.customerCnicCopy !== undefined) {
    sc.customerCnicCopy.submitted = Boolean(checklistData.customerCnicCopy);
    if (sc.customerCnicCopy.submitted) sc.customerCnicCopy.verifiedAt = new Date();
  }
  if (checklistData.guarantorCnicCopy !== undefined) {
    sc.guarantorCnicCopy.submitted = Boolean(checklistData.guarantorCnicCopy);
    if (sc.guarantorCnicCopy.submitted) sc.guarantorCnicCopy.verifiedAt = new Date();
  }
  if (checklistData.utilityBillCopy !== undefined) {
    sc.utilityBillCopy.submitted = Boolean(checklistData.utilityBillCopy);
    if (sc.utilityBillCopy.submitted) sc.utilityBillCopy.verifiedAt = new Date();
  }
  if (checklistData.promissoryNote !== undefined) {
    sc.promissoryNote.submitted = Boolean(checklistData.promissoryNote);
    if (sc.promissoryNote.submitted) sc.promissoryNote.verifiedAt = new Date();
  }
  if (checklistData.postDatedCheques !== undefined) {
    sc.postDatedCheques.submitted = Boolean(checklistData.postDatedCheques);
    if (checklistData.postDatedChequesCount !== undefined) {
      sc.postDatedCheques.count = Math.max(0, parseInt(checklistData.postDatedChequesCount, 10) || 0);
    }
    if (sc.postDatedCheques.submitted) sc.postDatedCheques.verifiedAt = new Date();
  }

  // Check completeness
  const wasComplete = sc.isComplete;
  sc.isComplete =
    sc.stampAgreement.submitted &&
    sc.customerCnicCopy.submitted &&
    sc.guarantorCnicCopy.submitted &&
    sc.utilityBillCopy.submitted &&
    sc.promissoryNote.submitted &&
    sc.postDatedCheques.submitted;

  if (sc.isComplete && !wasComplete) {
    sc.completedAt = new Date();
    sc.completedBy = actor._id;
  }

  plan.securityChecklist = sc;
  await plan.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.SECURITY_CHECKLIST_UPDATED,
    'installment_plans',
    plan._id,
    { wasComplete },
    { isComplete: sc.isComplete },
    { req, description: `Security checklist updated for Plan ${plan.planNumber} (Complete: ${sc.isComplete})` }
  );

  return plan;
}

/**
 * Grants Owner Override for incomplete security checklist.
 */
async function ownerOverrideSecurityChecklist(planId, reason, actor, req) {
  if (actor.role !== ROLES.OWNER) {
    throw ApiError.forbidden('Only the business owner can override the security checklist.');
  }

  const cleanReason = text(reason, 500);
  if (!cleanReason) {
    throw ApiError.badRequest('A mandatory reason is required for owner security override.');
  }

  const plan = await InstallmentPlan.findById(planId);
  if (!plan) throw ApiError.notFound('Installment plan not found.');

  plan.securityChecklist.ownerOverride = {
    isOverridden: true,
    reason: cleanReason,
    overriddenBy: actor._id,
    overriddenAt: new Date(),
  };

  await plan.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.SECURITY_OVERRIDE_GRANTED,
    'installment_plans',
    plan._id,
    null,
    plan.securityChecklist.ownerOverride,
    { req, description: `Owner override granted on Plan ${plan.planNumber}: ${cleanReason}` }
  );

  return plan;
}

/**
 * Checks whether an installment sale can proceed to material issue.
 * RULE: An installment sale cannot proceed to material issue until the checklist
 * is complete, UNLESS an owner override is present.
 */
async function checkMaterialIssueGate(saleId, actor) {
  const sale = await Sale.findById(saleId).populate('installmentPlan');
  if (!sale) throw ApiError.notFound('Sale not found.');

  if (sale.paymentType !== 'installment' || !sale.installmentPlan) {
    // Non-installment sales (full cash) are not gated by installment security checklist
    return { allowed: true, reason: 'Cash sale' };
  }

  const plan = sale.installmentPlan;
  const isChecklistComplete = plan.securityChecklist && plan.securityChecklist.isComplete;
  const isOwnerOverridden =
    plan.securityChecklist &&
    plan.securityChecklist.ownerOverride &&
    plan.securityChecklist.ownerOverride.isOverridden;

  if (isChecklistComplete) {
    return { allowed: true, reason: 'Security checklist complete' };
  }

  if (isOwnerOverridden) {
    return {
      allowed: true,
      reason: `Owner override: ${plan.securityChecklist.ownerOverride.reason}`,
    };
  }

  throw ApiError.badRequest(
    `Material issue blocked: Installment security checklist for Sale ${sale.saleNumber} is incomplete. Owner override with reason is required to proceed.`
  );
}

/**
 * Marks material issued for a sale (enforcing the checklist gate).
 */
async function issueMaterialForSale(saleId, notes, actor, req) {
  await checkMaterialIssueGate(saleId, actor);

  const sale = await Sale.findById(saleId);
  sale.isMaterialIssued = true;
  sale.materialIssuedAt = new Date();
  sale.materialIssuedBy = actor._id;
  sale.materialIssueNotes = text(notes, 1000);
  await sale.save();

  return sale;
}

/**
 * Parses a FullCalendar start/end query value.
 */
function parseCalendarDate(value) {
  if (!value) return null;
  // FullCalendar sends timezone offsets as "+05:00". Express decodes a raw "+"
  // in a query string as a space, which makes the string unparseable, so put
  // the plus sign back before handing it to Date.
  const normalized = String(value).trim().replace(/ (\d{2}:\d{2})$/, '+$1');
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Calendar JSON events feed for FullCalendar.
 */
async function listCalendarEvents(query = {}, user) {
  const filter = {};

  const start = parseCalendarDate(query.start);
  const end = parseCalendarDate(query.end);

  if (start && end) {
    // FullCalendar sends an exclusive end, so use $lt to avoid repeating the
    // first installment of the following month on the current month's grid.
    filter.dueDate = {
      $gte: start,
      $lt: end,
    };
  }

  if (query.status && INSTALLMENT_STATUSES.includes(query.status)) {
    filter.status = query.status;
  }

  if (query.customer && mongoose.isValidObjectId(query.customer)) {
    filter.customer = query.customer;
  }

  const installments = await Installment.find(filter)
    .populate('customer', 'name phone city area')
    .populate('installmentPlan', 'planNumber assignedOfficer')
    .sort({ dueDate: 1 })
    .lean();

  const todayStr = new Date().toISOString().slice(0, 10);

  return installments.map((inst) => {
    const dueStr = inst.dueDate ? inst.dueDate.toISOString().slice(0, 10) : '';
    const isToday = dueStr === todayStr;
    const isPaid = inst.status === 'paid';
    const isOverdue = inst.status === 'overdue';

    let color = '#0d6efd'; // Upcoming: Blue
    let statusLabel = 'Upcoming';

    if (isPaid) {
      color = '#198754'; // Paid: Green
      statusLabel = 'Paid';
    } else if (isOverdue) {
      color = '#dc3545'; // Overdue: Red
      statusLabel = 'Overdue';
    } else if (inst.status === 'partial') {
      color = '#6f42c1'; // Partially paid: Purple
      statusLabel = 'Partially Paid';
    } else if (isToday) {
      color = '#fd7e14'; // Due Today: Orange
      statusLabel = 'Due Today';
    }

    const customerName = inst.customer ? inst.customer.name : 'Client';
    const amountRupees = Math.round(inst.amountPaisa / 100).toLocaleString('en-PK');

    return {
      id: String(inst._id),
      title: `PKR ${amountRupees} - ${customerName} (#${inst.installmentNumber})`,
      start: dueStr,
      allDay: true,
      backgroundColor: color,
      borderColor: color,
      extendedProps: {
        installmentId: String(inst._id),
        planId: inst.installmentPlan ? String(inst.installmentPlan._id) : '',
        planNumber: inst.installmentPlan ? inst.installmentPlan.planNumber : '',
        customerName,
        customerPhone: inst.customer ? inst.customer.phone : '',
        customerCity: inst.customer ? [inst.customer.city, inst.customer.area].filter(Boolean).join(', ') : '',
        installmentNumber: inst.installmentNumber,
        amountPaisa: inst.amountPaisa,
        paidAmountPaisa: inst.paidAmountPaisa,
        dueAmountPaisa: Math.max(0, inst.amountPaisa - inst.paidAmountPaisa),
        status: inst.status,
        statusLabel,
      },
    };
  });
}

/**
 * Builds customer ledger transactions statement.
 */
async function getCustomerInstallmentLedger(customerId) {
  if (!mongoose.isValidObjectId(customerId)) {
    throw ApiError.badRequest('Invalid customer identifier.');
  }

  const [customer, plans, payments] = await Promise.all([
    Customer.findById(customerId).lean(),
    InstallmentPlan.find({ customer: customerId }).populate('sale').sort({ createdAt: 1 }).lean(),
    InstallmentPayment.find({ customer: customerId }).sort({ paymentDate: 1 }).lean(),
  ]);

  if (!customer) throw ApiError.notFound('Customer not found.');

  let totalContractValuePaisa = 0;
  let totalDownPaymentsPaisa = 0;
  let totalFinancedPaisa = 0;
  let totalMarkupPaisa = 0;
  let totalPaidPaisa = 0;
  let totalRemainingBalancePaisa = 0;

  const transactions = [];

  for (const plan of plans) {
    totalContractValuePaisa += plan.totalSaleAmountPaisa;
    totalDownPaymentsPaisa += plan.downPaymentPaisa;
    totalFinancedPaisa += plan.financedAmountPaisa;
    totalMarkupPaisa += plan.markupPaisa;
    totalPaidPaisa += plan.totalPaidPaisa;
    totalRemainingBalancePaisa += plan.remainingBalancePaisa;

    // 1. Financed Plan Entry (Debit)
    transactions.push({
      date: plan.createdAt,
      type: 'Plan Financed',
      reference: plan.planNumber,
      description: `Contract financed for ${plan.installmentCount} installments (${plan.frequency})`,
      debitPaisa: plan.totalPayablePaisa,
      creditPaisa: 0,
    });

    // 2. Down Payment Entry (Credit)
    if (plan.downPaymentPaid) {
      transactions.push({
        date: plan.downPaymentPaidAt || plan.createdAt,
        type: 'Down Payment',
        reference: `DP-${plan.planNumber}`,
        description: 'Advance booking payment received',
        debitPaisa: 0,
        creditPaisa: plan.downPaymentPaisa,
      });
    }
  }

  // 3. Payment Receipts (Credits)
  for (const p of payments) {
    transactions.push({
      date: p.paymentDate,
      type: 'Receipt',
      reference: p.receiptNumber,
      description: `Payment via ${p.paymentMethod.toUpperCase()}${p.reference ? ' (' + p.reference + ')' : ''}`,
      debitPaisa: 0,
      creditPaisa: p.amountPaisa,
    });
  }

  // Sort chronological
  transactions.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Compute running balance
  let runningBalance = 0;
  transactions.forEach((tx) => {
    runningBalance += (tx.debitPaisa || 0) - (tx.creditPaisa || 0);
    tx.runningBalancePaisa = runningBalance;
  });

  return {
    customer,
    plans,
    transactions,
    summary: {
      totalContractValuePaisa,
      totalDownPaymentsPaisa,
      totalFinancedPaisa,
      totalMarkupPaisa,
      totalPaidPaisa,
      totalRemainingBalancePaisa,
    },
  };
}

/**
 * Adds a cheque to the register / vault and links it to the customer plus any
 * combination of project/sale, POS order and installment plan.
 */
async function createCheque(payload = {}, actor, req) {
  if (!mongoose.isValidObjectId(payload.customer)) {
    throw ApiError.badRequest('Select the customer who issued the cheque.');
  }

  const customer = await Customer.findOne({ _id: payload.customer }).lean();
  if (!customer) throw ApiError.badRequest('The selected customer was not found.');

  let sale = null;
  if (payload.sale) {
    if (!mongoose.isValidObjectId(payload.sale)) {
      throw ApiError.badRequest('Select a valid project / sale.');
    }
    sale = await Sale.findOne({ _id: payload.sale }).lean();
    if (!sale) throw ApiError.badRequest('The selected project / sale was not found.');
    if (String(sale.customer) !== String(customer._id)) {
      throw ApiError.badRequest('The selected project does not belong to this customer.');
    }
  }

  let posSale = null;
  if (payload.posSale) {
    if (!mongoose.isValidObjectId(payload.posSale)) {
      throw ApiError.badRequest('Select a valid POS order.');
    }
    posSale = await PosSale.findOne({ _id: payload.posSale }).lean();
    if (!posSale) throw ApiError.badRequest('The selected POS order was not found.');
    if (posSale.customer && String(posSale.customer) !== String(customer._id)) {
      throw ApiError.badRequest('The selected POS order does not belong to this customer.');
    }
  }

  let plan = null;
  if (payload.installmentPlan) {
    if (!mongoose.isValidObjectId(payload.installmentPlan)) {
      throw ApiError.badRequest('Select a valid installment plan.');
    }
    plan = await InstallmentPlan.findOne({ _id: payload.installmentPlan }).lean();
    if (!plan) throw ApiError.badRequest('The selected installment plan was not found.');
    if (String(plan.customer) !== String(customer._id)) {
      throw ApiError.badRequest('The selected installment plan does not belong to this customer.');
    }
    if (sale && String(plan.sale) !== String(sale._id)) {
      throw ApiError.badRequest('The selected installment plan does not belong to this project.');
    }
    // A plan usually belongs to a sale, so link the project too. Older data can
    // have a plan pointing at another customer's sale; in that case leave the
    // direct project link empty rather than record a cross-customer cheque.
    if (!sale && plan.sale) {
      const planSale = await Sale.findOne({ _id: plan.sale }).lean();
      if (planSale && String(planSale.customer) === String(customer._id)) {
        sale = planSale;
      }
    }
  }

  let amountPaisa;
  try {
    amountPaisa = toPaisa(payload.amount);
  } catch (_err) {
    throw ApiError.badRequest('Enter a valid cheque amount.');
  }
  if (!amountPaisa || amountPaisa <= 0) {
    throw ApiError.badRequest('Cheque amount must be greater than zero.');
  }

  const chequeDate = payload.chequeDate ? new Date(payload.chequeDate) : new Date();
  if (Number.isNaN(chequeDate.getTime())) {
    throw ApiError.badRequest('Enter a valid cheque date.');
  }

  const status = CHEQUE_STATUSES.includes(payload.status) ? payload.status : 'held';
  const now = new Date();
  const bounceReason =
    status === 'bounced'
      ? text(payload.bounceReason, 500) || 'Dishonored by clearing house / Insufficient funds'
      : '';

  const cheque = await Cheque.create({
    chequeNumber: text(payload.chequeNumber, 50),
    bankName: text(payload.bankName, 100),
    branch: text(payload.branch, 100),
    amountPaisa,
    chequeDate,
    customer: customer._id,
    sale: sale ? sale._id : null,
    posSale: posSale ? posSale._id : null,
    installmentPlan: plan ? plan._id : null,
    installmentNumber: payload.installmentNumber
      ? Math.max(1, parseInt(payload.installmentNumber, 10) || 1)
      : null,
    status,
    depositedAt: status === 'deposited' || status === 'cleared' ? now : null,
    clearedAt: status === 'cleared' ? now : null,
    bouncedAt: status === 'bounced' ? now : null,
    bounceReason,
    notes: text(payload.notes, 1000),
    receivedBy: actor ? actor._id : null,
  });

  // A bounced cheque added directly must still flag its plan for recovery.
  if (status === 'bounced' && plan) {
    await InstallmentPlan.updateOne(
      { _id: plan._id },
      {
        $set: {
          isFlaggedForRecovery: true,
          recoveryFlagNotes: `Cheque #${cheque.chequeNumber} (${cheque.bankName}) bounced on ${now.toISOString().slice(0, 10)}. Reason: ${bounceReason}`,
          recoveryFlaggedAt: now,
        },
      }
    );
  }

  await logAction(
    actor,
    AUDIT_ACTIONS.CHEQUE_CREATED,
    'cheques',
    cheque._id,
    null,
    cheque.toObject(),
    {
      req,
      description: `Cheque #${cheque.chequeNumber} added to the vault for ${customer.name}`,
    }
  );

  return cheque;
}

/**
 * Cheque Register query.
 */
async function listCheques(query = {}, user) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(query.limit, 10) || 20));

  const filter = {};
  const andConditions = [];

  // Sales staff only see cheques tied to their own projects, plans or customers.
  if (user && user.role === 'sales') {
    const [saleIds, planIds, customerIds] = await Promise.all([
      Sale.find({ assignedTo: user._id }).distinct('_id'),
      InstallmentPlan.find({
        $or: [{ assignedOfficer: user._id }, { createdBy: user._id }],
      }).distinct('_id'),
      Customer.find({ assignedTo: user._id }).distinct('_id'),
    ]);
    andConditions.push({
      $or: [
        { sale: { $in: saleIds } },
        { installmentPlan: { $in: planIds } },
        { customer: { $in: customerIds } },
      ],
    });
  }

  if (query.status && CHEQUE_STATUSES.includes(query.status)) {
    filter.status = query.status;
  }
  if (query.customer && mongoose.isValidObjectId(query.customer)) {
    filter.customer = query.customer;
  }
  if (query.sale && mongoose.isValidObjectId(query.sale)) {
    filter.sale = query.sale;
  }
  if (query.posSale && mongoose.isValidObjectId(query.posSale)) {
    filter.posSale = query.posSale;
  }
  if (query.bankName) {
    filter.bankName = new RegExp(escapeRegex(query.bankName), 'i');
  }

  const search = text(query.search, 80);
  if (search) {
    const regex = new RegExp(escapeRegex(search), 'i');
    andConditions.push({
      $or: [
        { chequeNumber: regex },
        { bankName: regex },
        { branch: regex },
        { notes: regex },
      ],
    });
  }

  if (andConditions.length) filter.$and = andConditions;

  const [total, cheques, statusCounts] = await Promise.all([
    Cheque.countDocuments(filter),
    Cheque.find(filter)
      .populate('customer', 'name code phone city')
      .populate('sale', 'saleNumber invoiceNumber projectTitle systemSummary amountPaisa status')
      .populate('posSale', 'number customerName totalPaisa soldAt status items')
      .populate({
        path: 'installmentPlan',
        select: 'planNumber sale customer status',
        populate: { path: 'sale', select: 'saleNumber projectTitle systemSummary' },
      })
      .sort({ chequeDate: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Cheque.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: '$status', count: { $sum: 1 }, totalPaisa: { $sum: '$amountPaisa' } } },
    ]),
  ]);

  return {
    cheques,
    total,
    pagination: paginate(total, page, limit),
    statusCounts,
  };
}

/**
 * Updates cheque status (held -> deposited -> cleared / bounced).
 * If bounced, AUTOMATICALLY flags the linked plan for recovery!
 */
async function updateChequeStatus(chequeId, newStatus, bounceReason, actor, req) {
  if (!CHEQUE_STATUSES.includes(newStatus)) {
    throw ApiError.badRequest('Invalid cheque status.');
  }

  const cheque = await Cheque.findById(chequeId).populate('customer').populate('installmentPlan');
  if (!cheque) throw ApiError.notFound('Cheque record not found.');

  const prevStatus = cheque.status;
  cheque.status = newStatus;

  if (newStatus === 'deposited') {
    cheque.depositedAt = new Date();
  } else if (newStatus === 'cleared') {
    cheque.clearedAt = new Date();
  } else if (newStatus === 'bounced') {
    const cleanReason = text(bounceReason, 500) || 'Dishonored by clearing house / Insufficient funds';
    cheque.bouncedAt = new Date();
    cheque.bounceReason = cleanReason;

    // AUTOMATIC ACTION: Flag the account / plan for recovery!
    if (cheque.installmentPlan) {
      await InstallmentPlan.updateOne(
        { _id: cheque.installmentPlan._id || cheque.installmentPlan },
        {
          $set: {
            isFlaggedForRecovery: true,
            recoveryFlagNotes: `Cheque #${cheque.chequeNumber} (${cheque.bankName}) bounced on ${new Date().toISOString().slice(0, 10)}. Reason: ${cleanReason}`,
            recoveryFlaggedAt: new Date(),
          },
        }
      );
    }

    await logAction(
      actor,
      AUDIT_ACTIONS.CHEQUE_BOUNCED,
      'cheques',
      cheque._id,
      { prevStatus },
      { newStatus, bounceReason: cleanReason },
      { req, description: `Cheque #${cheque.chequeNumber} BOUNCED. Account flagged for recovery.` }
    );
  }

  await cheque.save();

  if (newStatus !== 'bounced') {
    await logAction(
      actor,
      AUDIT_ACTIONS.CHEQUE_STATUS_CHANGED,
      'cheques',
      cheque._id,
      { prevStatus },
      { newStatus },
      { req, description: `Cheque #${cheque.chequeNumber} status changed from ${prevStatus} to ${newStatus}` }
    );
  }

  return cheque;
}

/**
 * Fetch upcoming cheques due in N days for dashboard widget.
 */
async function getUpcomingCheques(days = 7) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + days);

  return Cheque.find({
    status: { $in: ['held', 'deposited'] },
    chequeDate: { $lte: targetDate },
    deletedAt: null,
  })
    .populate('customer', 'name phone city')
    .populate('installmentPlan', 'planNumber')
    .sort({ chequeDate: 1 })
    .limit(8)
    .lean();
}

module.exports = {
  nextPlanNumber,
  nextReceiptNumber,
  generateInstallmentSchedule,
  createInstallmentPlan,
  getInstallmentPlanOrThrow,
  listInstallmentPlans,
  recordPayment,
  reschedulePlan,
  waiveLateFee,
  updateSecurityChecklist,
  ownerOverrideSecurityChecklist,
  checkMaterialIssueGate,
  issueMaterialForSale,
  listCalendarEvents,
  getCustomerInstallmentLedger,
  createCheque,
  listCheques,
  updateChequeStatus,
  getUpcomingCheques,
};
