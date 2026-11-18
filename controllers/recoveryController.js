'use strict';

const NotificationLog = require('../models/NotificationLog');
const AppNotification = require('../models/AppNotification');
const recoveryService = require('../services/recoveryService');
const { retryNotification } = require('../services/notificationService');
const { runAllJobsManual } = require('../services/cronService');
const { logAudit } = require('../services/auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { paginate } = require('../utils/pagination');

/**
 * Mobile-friendly Today's Recovery workspace.
 */
async function todayView(req, res, next) {
  try {
    const recoveryItems = await recoveryService.getTodaysRecoveryList(req.user);

    return res.render('recovery/today', {
      title: "Today's Recovery Queue",
      recoveryItems,
      breadcrumbs: [
        { label: 'Finance & Installments', url: '/installments' },
        { label: "Today's Recovery", url: '/recovery/today' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Escalation Desk (15+ days overdue, broken promises, bounced cheques).
 */
async function escalationsView(req, res, next) {
  try {
    const { severeDelinquents, brokenPtps, bouncedCheques } = await recoveryService.getEscalationList();

    return res.render('recovery/escalations', {
      title: 'Recovery Escalations & Defaults',
      severeDelinquents,
      brokenPtps,
      bouncedCheques,
      breadcrumbs: [
        { label: 'Finance & Installments', url: '/installments' },
        { label: 'Escalations & PTP', url: '/recovery/escalations' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Record Promise-to-Pay (PTP).
 */
async function createPtp(req, res, next) {
  try {
    const { installmentPlanId, installmentId, customerId, promisedDate, promisedAmount, notes } = req.body;

    const amountPaisa = Math.round(parseFloat(promisedAmount) * 100);

    await recoveryService.recordPromiseToPay({
      installmentPlanId,
      installmentId: installmentId || null,
      customerId,
      promisedDate,
      promisedAmountPaisa: amountPaisa,
      notes,
      user: req.user,
      req,
    });

    req.flash('success', 'Promise-to-Pay (PTP) recorded successfully.');
    return res.redirect(req.get('Referrer') || '/recovery/today');
  } catch (err) {
    next(err);
  }
}

/**
 * Record Field / Phone Interaction Note.
 */
async function createNote(req, res, next) {
  try {
    const { customerId, installmentPlanId, callOutcome, notes, nextActionDate } = req.body;

    await recoveryService.recordRecoveryNote({
      customerId,
      installmentPlanId: installmentPlanId || null,
      callOutcome,
      notes,
      nextActionDate: nextActionDate || null,
      user: req.user,
      req,
    });

    req.flash('success', 'Recovery note recorded.');
    return res.redirect(req.get('Referrer') || '/recovery/today');
  } catch (err) {
    next(err);
  }
}

/**
 * Flag an installment plan for recovery / legal enforcement.
 */
async function flagPlan(req, res, next) {
  try {
    const { reason } = req.body;
    await recoveryService.flagPlanForRecovery({
      planId: req.params.id,
      reason,
      user: req.user,
      req,
    });

    req.flash('warning', 'Installment plan has been flagged for recovery.');
    return res.redirect(req.get('Referrer') || '/recovery/escalations');
  } catch (err) {
    next(err);
  }
}

/**
 * Notification & Reminder Audit Logs.
 */
async function logsIndex(req, res, next) {
  try {
    const { channel, status, page = 1 } = req.query;
    const filter = {};

    if (channel) filter.channel = channel;
    if (status) filter.status = status;

    const count = await NotificationLog.countDocuments(filter);
    const pagination = paginate(count, parseInt(page, 10) || 1, 20);

    const logs = await NotificationLog.find(filter)
      .populate('recipientCustomer', 'name phone email code')
      .populate('installmentPlan', 'planNumber')
      .sort({ createdAt: -1 })
      .skip(pagination.offset)
      .limit(pagination.limit);

    return res.render('recovery/logs', {
      title: 'Notification & Reminder Logs',
      logs,
      pagination,
      filters: { channel, status },
      breadcrumbs: [
        { label: 'Finance & Installments', url: '/installments' },
        { label: 'Notification Logs', url: '/recovery/logs' },
      ],
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Retry failed notification.
 */
async function retryLog(req, res, next) {
  try {
    const updated = await retryNotification(req.params.id);

    await logAudit(req, {
      action: AUDIT_ACTIONS.NOTIFICATION_RETRIED,
      targetType: 'NotificationLog',
      targetId: updated._id,
      notes: `Retried notification log ${updated._id} (Status: ${updated.status})`,
    });

    req.flash('info', `Notification retried. Current status: ${updated.status}`);
    return res.redirect('/recovery/logs');
  } catch (err) {
    next(err);
  }
}

/**
 * Manually trigger daily background recovery jobs.
 */
async function runCronManual(req, res, next) {
  try {
    const summary = await runAllJobsManual();

    req.flash(
      'success',
      `Manual recovery run completed: ${summary.reminders.sent} reminders sent (${summary.reminders.skipped} skipped), ${summary.ptps.broken} broken PTPs flagged, ${summary.cheques.alerted} cheque alerts, ${summary.lowStock.alerted} low stock alerts.`
    );
    return res.redirect(req.get('Referrer') || '/recovery/today');
  } catch (err) {
    next(err);
  }
}

/**
 * Mark all notifications read.
 */
async function markAllNotificationsRead(req, res, next) {
  try {
    await AppNotification.updateMany(
      {
        isRead: false,
        $or: [{ forUser: req.user._id }, { forUser: null }],
      },
      { isRead: true }
    );

    return res.redirect(req.get('Referrer') || '/dashboard');
  } catch (err) {
    next(err);
  }
}

/**
 * JSON API for Customer Recovery History (Notes and PTPs).
 */
async function customerRecoveryHistoryJson(req, res, next) {
  try {
    const data = await recoveryService.getCustomerRecoveryHistory(req.params.customerId);
    return res.json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  todayView,
  escalationsView,
  createPtp,
  createNote,
  flagPlan,
  logsIndex,
  retryLog,
  runCronManual,
  markAllNotificationsRead,
  customerRecoveryHistoryJson,
};
