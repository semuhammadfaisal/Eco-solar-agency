'use strict';

const mongoose = require('mongoose');
const InstallmentPlan = require('../models/InstallmentPlan');
const Installment = require('../models/Installment');
const Customer = require('../models/Customer');
const Cheque = require('../models/Cheque');
const PromiseToPay = require('../models/PromiseToPay');
const RecoveryNote = require('../models/RecoveryNote');
const AppNotification = require('../models/AppNotification');
const { logAudit } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../config/roles');
const { normalizePakistaniPhone } = require('./notificationService');

/**
 * Determine aging bucket from days overdue.
 */
function getAgingBucket(daysOverdue) {
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

/**
 * Calculate the Aging Report across active / delinquent installment plans.
 */
async function getAgingReport({ asOfDate = new Date() } = {}) {
  const asOf = new Date(asOfDate);
  const startOfDay = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());

  // Fetch all active or defaulted plans with their installments
  const plans = await InstallmentPlan.find({
    status: { $in: ['active', 'defaulted', 'rescheduled'] },
    deletedAt: null,
  })
    .populate('customer')
    .populate('assignedOfficer', 'name email phone role')
    .lean();

  const planIds = plans.map((p) => p._id);
  const installments = await Installment.find({
    installmentPlan: { $in: planIds },
    status: { $in: ['pending', 'partial', 'overdue'] },
    deletedAt: null,
  })
    .sort({ dueDate: 1 })
    .lean();

  // Group installments by planId
  const installmentsByPlan = new Map();
  for (const inst of installments) {
    const key = String(inst.installmentPlan);
    if (!installmentsByPlan.has(key)) {
      installmentsByPlan.set(key, []);
    }
    installmentsByPlan.get(key).push(inst);
  }

  // Summary counters in integer paisa
  const summary = {
    totalAccounts: plans.length,
    delinquentAccounts: 0,
    totalOverduePaisa: 0,
    totalOutstandingPaisa: 0,
    buckets: {
      current: { count: 0, amountPaisa: 0, label: 'Current / Not Due' },
      '1-30': { count: 0, amountPaisa: 0, label: '1 - 30 Days' },
      '31-60': { count: 0, amountPaisa: 0, label: '31 - 60 Days' },
      '61-90': { count: 0, amountPaisa: 0, label: '61 - 90 Days' },
      '90+': { count: 0, amountPaisa: 0, label: '90+ Days' },
    },
  };

  const rows = [];

  for (const plan of plans) {
    const pInsts = installmentsByPlan.get(String(plan._id)) || [];
    summary.totalOutstandingPaisa += plan.remainingBalancePaisa || 0;

    let planOverduePaisa = 0;
    let maxDaysOverdue = 0;
    const planBuckets = {
      current: 0,
      '1-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };

    for (const inst of pInsts) {
      const totalDue = (inst.amountPaisa || 0) + (inst.lateFeeAssessedPaisa || 0);
      const settled = (inst.paidAmountPaisa || 0) + (inst.lateFeePaidPaisa || 0) + (inst.lateFeeWaivedPaisa || 0);
      const balancePaisa = Math.max(0, totalDue - settled);

      if (balancePaisa <= 0) continue;

      const instDueDate = new Date(inst.dueDate);
      const diffMs = startOfDay.getTime() - instDueDate.getTime();
      const daysOverdue = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

      const bucket = getAgingBucket(daysOverdue);
      planBuckets[bucket] += balancePaisa;

      if (daysOverdue > 0) {
        planOverduePaisa += balancePaisa;
        if (daysOverdue > maxDaysOverdue) {
          maxDaysOverdue = daysOverdue;
        }
      }
    }

    // Add into global summary
    for (const bKey of Object.keys(planBuckets)) {
      if (planBuckets[bKey] > 0) {
        summary.buckets[bKey].amountPaisa += planBuckets[bKey];
        summary.buckets[bKey].count += 1;
      }
    }

    if (planOverduePaisa > 0) {
      summary.delinquentAccounts += 1;
      summary.totalOverduePaisa += planOverduePaisa;
    }

    // Determine primary aging category for row
    const rowBucket = maxDaysOverdue > 0 ? getAgingBucket(maxDaysOverdue) : 'current';

    rows.push({
      planId: plan._id,
      planNumber: plan.planNumber,
      customer: plan.customer || {},
      assignedOfficer: plan.assignedOfficer || null,
      remainingBalancePaisa: plan.remainingBalancePaisa || 0,
      planOverduePaisa,
      maxDaysOverdue,
      agingBucket: rowBucket,
      bucketBreakdown: planBuckets,
      isFlaggedForRecovery: plan.isFlaggedForRecovery || false,
    });
  }

  // Sort rows: highest overdue first
  rows.sort((a, b) => b.planOverduePaisa - a.planOverduePaisa);

  return { summary, rows };
}

/**
 * Mobile-friendly Today's Recovery List.
 * Scoped by officer if user is sales role.
 */
async function getTodaysRecoveryList(user) {
  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

  // Build filter for installment plan
  const planQuery = {
    status: { $in: ['active', 'defaulted', 'rescheduled'] },
    deletedAt: null,
  };

  // If salesperson, only show assigned customers or assigned plans
  if (user && user.role === ROLES.SALES) {
    planQuery.assignedOfficer = user._id;
  }

  const plans = await InstallmentPlan.find(planQuery)
    .populate('customer')
    .populate('assignedOfficer', 'name phone')
    .lean();

  const planIds = plans.map((p) => p._id);
  const planMap = new Map(plans.map((p) => [String(p._id), p]));

  // Find installments due today or overdue
  const delinquentInsts = await Installment.find({
    installmentPlan: { $in: planIds },
    dueDate: { $lte: endOfDay },
    status: { $in: ['pending', 'partial', 'overdue'] },
    deletedAt: null,
  })
    .sort({ dueDate: 1 })
    .lean();

  // Find active PTPs due today or in the past
  const ptps = await PromiseToPay.find({
    installmentPlan: { $in: planIds },
    status: 'pending',
    promisedDate: { $lte: endOfDay },
  })
    .populate('customer')
    .lean();

  const ptpMap = new Map();
  for (const ptp of ptps) {
    const k = String(ptp.installmentPlan);
    if (!ptpMap.has(k)) ptpMap.set(k, []);
    ptpMap.get(k).push(ptp);
  }

  // Group installments by plan
  const instByPlan = new Map();
  for (const inst of delinquentInsts) {
    const k = String(inst.installmentPlan);
    if (!instByPlan.has(k)) instByPlan.set(k, []);
    instByPlan.get(k).push(inst);
  }

  const recoveryItems = [];

  for (const [pId, pInsts] of instByPlan.entries()) {
    const plan = planMap.get(pId);
    if (!plan || !plan.customer) continue;

    let totalDuePaisa = 0;
    let maxDaysOverdue = 0;
    let hasDueToday = false;

    for (const inst of pInsts) {
      const due = (inst.amountPaisa || 0) + (inst.lateFeeAssessedPaisa || 0);
      const paid = (inst.paidAmountPaisa || 0) + (inst.lateFeePaidPaisa || 0) + (inst.lateFeeWaivedPaisa || 0);
      const bal = Math.max(0, due - paid);
      totalDuePaisa += bal;

      const instDueDate = new Date(inst.dueDate);
      const diffMs = startOfDay.getTime() - instDueDate.getTime();
      const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (days >= 0 && days > maxDaysOverdue) {
        maxDaysOverdue = days;
      }
      if (instDueDate >= startOfDay && instDueDate <= endOfDay) {
        hasDueToday = true;
      }
    }

    if (totalDuePaisa <= 0) continue;

    const cust = plan.customer;
    const cleanPhone = normalizePakistaniPhone(cust.whatsapp || cust.phone);
    const custPhone = cust.phone || '';
    const activePromises = ptpMap.get(pId) || [];

    // Pre-craft WhatsApp reminder message
    const waText = encodeURIComponent(
      `Assalam-o-Alaikum ${cust.name} sb, aapki solar installment plan ${plan.planNumber} ki baqaya raqam PKR ${(totalDuePaisa / 100).toLocaleString()} hai. Baraye meherbani barwaqt adaigi yakeeni banayein. Shukriya.`
    );
    const waLink = cleanPhone ? `https://wa.me/${cleanPhone}?text=${waText}` : null;
    const telLink = custPhone ? `tel:${custPhone}` : null;

    recoveryItems.push({
      planId: plan._id,
      planNumber: plan.planNumber,
      customer: cust,
      assignedOfficer: plan.assignedOfficer,
      totalDuePaisa,
      maxDaysOverdue,
      hasDueToday,
      activePromises,
      waLink,
      telLink,
      isFlaggedForRecovery: plan.isFlaggedForRecovery,
    });
  }

  // Sort: highest priority (overdue days descending, then amount descending)
  recoveryItems.sort((a, b) => b.maxDaysOverdue - a.maxDaysOverdue || b.totalDuePaisa - a.totalDuePaisa);

  return recoveryItems;
}

/**
 * Get Escalations List (15+ days overdue, broken promises, bounced cheques, recovery-flagged).
 */
async function getEscalationList() {
  const { rows } = await getAgingReport();

  // Severe overdue: 15+ days or flagged
  const severeDelinquents = rows.filter((r) => r.maxDaysOverdue >= 15 || r.isFlaggedForRecovery);

  // Broken promises
  const brokenPtps = await PromiseToPay.find({ status: 'broken' })
    .populate('customer')
    .populate('installmentPlan')
    .populate('recordedBy', 'name role')
    .sort({ brokenAt: -1 })
    .limit(50)
    .lean();

  // Bounced cheques
  const bouncedCheques = await Cheque.find({ status: 'bounced' })
    .populate('customer')
    .populate('installmentPlan')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();

  return {
    severeDelinquents,
    brokenPtps,
    bouncedCheques,
  };
}

/**
 * Record a Promise to Pay (PTP).
 */
async function recordPromiseToPay({
  installmentPlanId,
  installmentId = null,
  customerId,
  promisedDate,
  promisedAmountPaisa,
  notes = '',
  user,
  req = null,
}) {
  if (!installmentPlanId) throw ApiError.badRequest('Installment plan ID is required.');
  if (!customerId) throw ApiError.badRequest('Customer ID is required.');
  if (!promisedDate) throw ApiError.badRequest('Promised date is required.');
  if (!promisedAmountPaisa || promisedAmountPaisa <= 0) {
    throw ApiError.badRequest('Valid promised amount is required.');
  }

  const ptp = await PromiseToPay.create({
    installmentPlan: installmentPlanId,
    installment: installmentId || null,
    customer: customerId,
    promisedDate: new Date(promisedDate),
    promisedAmountPaisa: Math.round(promisedAmountPaisa),
    status: 'pending',
    notes,
    recordedBy: user ? user._id : null,
  });

  if (req && user) {
    await logAudit(req, {
      action: AUDIT_ACTIONS.PROMISE_TO_PAY_RECORDED,
      targetType: 'PromiseToPay',
      targetId: ptp._id,
      notes: `PTP recorded for PKR ${(promisedAmountPaisa / 100).toFixed(2)} on ${new Date(promisedDate).toLocaleDateString()}`,
    });
  }

  return ptp;
}

/**
 * Record a Recovery Call/Site Note.
 */
async function recordRecoveryNote({
  customerId,
  installmentPlanId = null,
  callOutcome = 'spoke_to_customer',
  notes,
  nextActionDate = null,
  user,
  req = null,
}) {
  if (!customerId) throw ApiError.badRequest('Customer ID is required.');
  if (!notes) throw ApiError.badRequest('Interaction notes are required.');

  const recNote = await RecoveryNote.create({
    customer: customerId,
    installmentPlan: installmentPlanId || null,
    officer: user ? user._id : null,
    callOutcome,
    notes,
    nextActionDate: nextActionDate ? new Date(nextActionDate) : null,
  });

  // If customer refused to pay or raised serious dispute, automatically flag plan if linked
  if (['refused_to_pay', 'dispute'].includes(callOutcome) && installmentPlanId) {
    await flagPlanForRecovery({
      planId: installmentPlanId,
      reason: `Customer interaction outcome: ${callOutcome} - ${notes}`,
      user,
      req,
    });
  }

  if (req && user) {
    await logAudit(req, {
      action: AUDIT_ACTIONS.RECOVERY_NOTE_CREATED,
      targetType: 'RecoveryNote',
      targetId: recNote._id,
      notes: `Call note logged (${callOutcome})`,
    });
  }

  return recNote;
}

/**
 * Flag an installment plan for legal / recovery enforcement.
 */
async function flagPlanForRecovery({ planId, reason = '', user = null, req = null }) {
  const plan = await InstallmentPlan.findById(planId).populate('customer');
  if (!plan) throw ApiError.notFound('Installment plan not found.');

  plan.isFlaggedForRecovery = true;
  plan.recoveryFlagNotes = reason || 'Escalated to recovery team due to persistent delinquency.';
  plan.recoveryFlaggedAt = new Date();
  await plan.save();

  // Create App Notification for Management
  await AppNotification.create({
    title: `Account Escalated to Recovery: ${plan.planNumber}`,
    message: `${plan.customer ? plan.customer.name : 'Customer'} flagged for recovery. Reason: ${reason || 'Delinquency'}.`,
    type: 'overdue_installment',
    link: `/installments/${plan._id}`,
    entityId: plan._id,
  });

  if (req && user) {
    await logAudit(req, {
      action: AUDIT_ACTIONS.PLAN_FLAGGED_RECOVERY,
      targetType: 'InstallmentPlan',
      targetId: plan._id,
      notes: `Plan flagged for recovery: ${reason}`,
    });
  }

  return plan;
}

/**
 * Fetch customer recovery history (Notes & PTPs).
 */
async function getCustomerRecoveryHistory(customerId) {
  const notes = await RecoveryNote.find({ customer: customerId })
    .populate('officer', 'name role')
    .sort({ createdAt: -1 })
    .limit(20)
    .lean();

  const ptps = await PromiseToPay.find({ customer: customerId })
    .populate('recordedBy', 'name role')
    .sort({ promisedDate: -1 })
    .limit(20)
    .lean();

  return { notes, ptps };
}

module.exports = {
  getAgingBucket,
  getAgingReport,
  getTodaysRecoveryList,
  getEscalationList,
  recordPromiseToPay,
  recordRecoveryNote,
  flagPlanForRecovery,
  getCustomerRecoveryHistory,
};
