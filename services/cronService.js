'use strict';

const cron = require('node-cron');
const Installment = require('../models/Installment');
const InstallmentPlan = require('../models/InstallmentPlan');
const InstallmentPayment = require('../models/InstallmentPayment');
const PromiseToPay = require('../models/PromiseToPay');
const Cheque = require('../models/Cheque');
const Item = require('../models/Item');
const SerialNo = require('../models/SerialNo');
const AppNotification = require('../models/AppNotification');
const MaintenanceSchedule = require('../models/MaintenanceSchedule');
const { dispatchNotification, seedDefaultTemplates } = require('./notificationService');
const { flagPlanForRecovery } = require('./recoveryService');
const dailyClosingService = require('./dailyClosingService');
const { performBackup } = require('../scripts/backup');
const { formatPKR, formatDate } = require('../utils/format');

/**
 * Normalise a date to start of day (midnight).
 */
function toMidnight(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Difference in whole days (targetDate - baseDate).
 */
function diffDays(targetDate, baseDate) {
  const t = toMidnight(targetDate).getTime();
  const b = toMidnight(baseDate).getTime();
  return Math.round((t - b) / (1000 * 60 * 60 * 24));
}

/**
 * 1. Process Installment Reminders (-3d, 0d, +1d, +3d, +7d, +15d).
 */
async function runInstallmentReminders(now = new Date()) {
  const today = toMidnight(now);

  // Fetch pending / partial / overdue installments
  const installments = await Installment.find({
    status: { $in: ['pending', 'partial', 'overdue'] },
    deletedAt: null,
  })
    .populate('customer')
    .populate('installmentPlan');

  const results = {
    evaluated: installments.length,
    sent: 0,
    skipped: 0,
    stagesTriggered: {},
  };

  for (const inst of installments) {
    if (!inst.customer || !inst.installmentPlan) continue;

    // Remaining balance for this installment
    const totalDue = (inst.amountPaisa || 0) + (inst.lateFeeAssessedPaisa || 0);
    const settled = (inst.paidAmountPaisa || 0) + (inst.lateFeePaidPaisa || 0) + (inst.lateFeeWaivedPaisa || 0);
    const balancePaisa = Math.max(0, totalDue - settled);
    if (balancePaisa <= 0) continue;

    const daysUntilDue = diffDays(inst.dueDate, today); // positive = future, 0 = today, negative = past due
    const daysOverdue = -daysUntilDue;

    let stage = null;
    let templateSlug = null;

    if (daysUntilDue === 3) {
      stage = 'upcoming_3d';
      templateSlug = 'reminder_upcoming_3d';
    } else if (daysUntilDue === 0) {
      stage = 'due_today';
      templateSlug = 'reminder_due_today';
    } else if (daysOverdue === 1) {
      stage = 'overdue_1d';
      templateSlug = 'reminder_overdue_1d';
    } else if (daysOverdue === 3) {
      stage = 'overdue_3d';
      templateSlug = 'reminder_overdue_3d';
    } else if (daysOverdue === 7) {
      stage = 'overdue_7d';
      templateSlug = 'reminder_overdue_7d';
    } else if (daysOverdue >= 15) {
      stage = 'overdue_15d';
      templateSlug = 'reminder_overdue_15d';

      // Auto-flag plan for recovery if not flagged yet
      if (!inst.installmentPlan.isFlaggedForRecovery) {
        await flagPlanForRecovery({
          planId: inst.installmentPlan._id,
          reason: `Tranche #${inst.installmentNumber} is ${daysOverdue} days overdue.`,
        });
      }
    }

    if (stage && templateSlug) {
      results.stagesTriggered[stage] = (results.stagesTriggered[stage] || 0) + 1;

      const vars = {
        name: inst.customer.name,
        amount: formatPKR(balancePaisa),
        dueDate: formatDate(inst.dueDate),
        balance: formatPKR(inst.installmentPlan.remainingBalancePaisa),
        planNumber: inst.installmentPlan.planNumber,
        installmentNumber: inst.installmentNumber,
      };

      // Dispatch via preferred channel (default WhatsApp)
      const dispatchRes = await dispatchNotification({
        channel: 'whatsapp',
        toPhone: inst.customer.whatsapp || inst.customer.phone,
        toEmail: inst.customer.email,
        stage,
        installment: inst,
        installmentPlan: inst.installmentPlan,
        customer: inst.customer,
        templateSlug,
        variables: vars,
        language: 'roman_urdu',
      });

      if (dispatchRes.skipped) {
        results.skipped += 1;
      } else {
        results.sent += 1;
      }
    }
  }

  return results;
}

/**
 * 2. Validate Promises to Pay (PTP).
 * If promised date has passed and payment wasn't received, mark broken and alert.
 */
async function validatePromisesToPay(now = new Date()) {
  const startOfToday = toMidnight(now);

  const pendingPtps = await PromiseToPay.find({
    status: 'pending',
    promisedDate: { $lt: startOfToday },
  })
    .populate('customer')
    .populate('installmentPlan');

  const results = {
    checked: pendingPtps.length,
    kept: 0,
    broken: 0,
  };

  for (const ptp of pendingPtps) {
    // Check payments received on or after the promise was made
    const payments = await InstallmentPayment.find({
      installmentPlan: ptp.installmentPlan ? ptp.installmentPlan._id : null,
      paidAt: { $gte: ptp.createdAt },
    });

    const totalPaidPaisa = payments.reduce((acc, p) => acc + (p.amountPaisa || 0), 0);

    if (totalPaidPaisa >= ptp.promisedAmountPaisa) {
      ptp.status = 'kept';
      ptp.keptAt = new Date();
      await ptp.save();
      results.kept += 1;
    } else {
      ptp.status = 'broken';
      ptp.brokenAt = new Date();
      await ptp.save();
      results.broken += 1;

      // Send alert notification to customer
      if (ptp.customer) {
        await dispatchNotification({
          channel: 'whatsapp',
          toPhone: ptp.customer.whatsapp || ptp.customer.phone,
          toEmail: ptp.customer.email,
          stage: 'ptp_broken',
          customer: ptp.customer,
          installmentPlan: ptp.installmentPlan,
          templateSlug: 'ptp_broken',
          variables: {
            name: ptp.customer.name,
            amount: formatPKR(ptp.promisedAmountPaisa),
            dueDate: formatDate(ptp.promisedDate),
            planNumber: ptp.installmentPlan ? ptp.installmentPlan.planNumber : '',
          },
        });
      }

      // Create high-priority AppNotification for officers
      await AppNotification.create({
        title: `Broken Promise to Pay: ${ptp.customer ? ptp.customer.name : 'Customer'}`,
        message: `Promised PKR ${formatPKR(ptp.promisedAmountPaisa)} on ${formatDate(ptp.promisedDate)} was not fulfilled.`,
        type: 'broken_promise',
        link: ptp.installmentPlan ? `/installments/${ptp.installmentPlan._id}` : '/recovery/escalations',
        entityId: ptp._id,
      });
    }
  }

  return results;
}

/**
 * 3. Check Matured Post-Dated Cheques (due in next 3 days).
 */
async function checkMaturedCheques(now = new Date()) {
  const today = toMidnight(now);
  const in3Days = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

  const upcomingCheques = await Cheque.find({
    status: 'held',
    chequeDate: { $gte: today, $lte: in3Days },
    deletedAt: null,
  })
    .populate('customer')
    .populate('installmentPlan');

  let alerted = 0;

  for (const chq of upcomingCheques) {
    if (!chq.customer) continue;

    // Send customer reminder
    await dispatchNotification({
      channel: 'whatsapp',
      toPhone: chq.customer.whatsapp || chq.customer.phone,
      toEmail: chq.customer.email,
      stage: 'cheque_due_3d',
      cheque: chq,
      customer: chq.customer,
      installmentPlan: chq.installmentPlan,
      templateSlug: 'cheque_due',
      variables: {
        name: chq.customer.name,
        amount: formatPKR(chq.amountPaisa),
        reference: chq.chequeNumber,
        dueDate: formatDate(chq.chequeDate),
      },
    });

    // Create AppNotification if not already created
    const existing = await AppNotification.findOne({
      type: 'cheque_due',
      entityId: chq._id,
      isRead: false,
    });

    if (!existing) {
      await AppNotification.create({
        title: `Cheque Deposit Due: ${chq.chequeNumber}`,
        message: `Cheque #${chq.chequeNumber} for PKR ${formatPKR(chq.amountPaisa)} (${chq.bankName}) matures on ${formatDate(chq.chequeDate)}.`,
        type: 'cheque_due',
        link: '/installments/cheques',
        entityId: chq._id,
      });
      alerted += 1;
    }
  }

  return { checked: upcomingCheques.length, alerted };
}

/**
 * 4. Check Low Stock Items.
 */
async function checkLowStock() {
  const lowStockItems = await Item.find({
    $expr: { $lte: ['$currentStock', '$minStock'] },
    minStock: { $gt: 0 },
    deletedAt: null,
  });

  let alerted = 0;

  for (const item of lowStockItems) {
    const existing = await AppNotification.findOne({
      type: 'low_stock',
      entityId: item._id,
      isRead: false,
    });

    if (!existing) {
      await AppNotification.create({
        title: `Low Stock Alert: ${item.name}`,
        message: `${item.sku} is at ${item.currentStock} ${item.unit} (Minimum threshold: ${item.minStock} ${item.unit}).`,
        type: 'low_stock',
        link: `/items/${item._id}`,
        entityId: item._id,
      });
      alerted += 1;
    }
  }

  return { checked: lowStockItems.length, alerted };
}

/**
 * 5. Check Expiring Warranties (within 30 days).
 */
async function checkExpiringWarranties(now = new Date()) {
  const today = toMidnight(now);
  const in30Days = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const expiringSerials = await SerialNo.find({
    productWarrantyEnd: { $gte: today, $lte: in30Days },
    deletedAt: null,
  }).populate('customer item');

  let alerted = 0;

  for (const sn of expiringSerials) {
    const existing = await AppNotification.findOne({
      type: 'warranty_expiry',
      entityId: sn._id,
      isRead: false,
    });

    if (!existing) {
      const itemName = sn.item ? sn.item.name : 'Component';
      const custName = sn.customer ? sn.customer.name : 'Unknown';
      await AppNotification.create({
        title: `Warranty Expiring Soon: ${sn.serial}`,
        message: `${itemName} (S/N: ${sn.serial}) for ${custName} warranty ends on ${formatDate(sn.productWarrantyEnd)}.`,
        type: 'warranty_expiry',
        link: `/serials?search=${encodeURIComponent(sn.serial)}`,
        entityId: sn._id,
      });
      alerted += 1;
    }
  }

  return { checked: expiringSerials.length, alerted };
}

/**
 * 6. Check Upcoming Maintenance Schedules (due in next 3 days).
 */
async function checkUpcomingMaintenance(now = new Date()) {
  const today = toMidnight(now);
  const in3Days = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

  const upcomingMaintenance = await MaintenanceSchedule.find({
    status: 'scheduled',
    scheduledDate: { $gte: today, $lte: in3Days },
    remindersSent: false,
    deletedAt: null,
  }).populate('customer');

  let alerted = 0;

  for (const mnt of upcomingMaintenance) {
    if (!mnt.customer) continue;

    await dispatchNotification({
      channel: 'whatsapp',
      toPhone: mnt.customer.whatsapp || mnt.customer.phone,
      stage: 'maintenance_due_3d',
      customer: mnt.customer,
      customBody: `Assalam-o-Alaikum ${mnt.customer.name} sb, aapki solar installation ki periodic cleaning & maintenance service tareekh ${formatDate(mnt.scheduledDate)} ko scheduled hai. Shukriya.`,
    });

    mnt.remindersSent = true;
    await mnt.save();
    alerted += 1;
  }

  return { checked: upcomingMaintenance.length, alerted };
}

/**
 * Run all scheduled recovery and maintenance jobs on demand.
 */
async function runAllJobsManual(now = new Date()) {
  await seedDefaultTemplates();

  const reminderResults = await runInstallmentReminders(now);
  const ptpResults = await validatePromisesToPay(now);
  const chequeResults = await checkMaturedCheques(now);
  const lowStockResults = await checkLowStock();
  const warrantyResults = await checkExpiringWarranties(now);
  const maintenanceResults = await checkUpcomingMaintenance(now);

  return {
    reminders: reminderResults,
    ptps: ptpResults,
    cheques: chequeResults,
    lowStock: lowStockResults,
    warranties: warrantyResults,
    maintenance: maintenanceResults,
    executedAt: new Date(),
  };
}

/**
 * Open today's cash drawer for every active branch once the configured
 * business-day start time has passed. The service is idempotent, so this can
 * run every 15 minutes without creating duplicates.
 */
async function openDailyDrawers(now = new Date()) {
  return dailyClosingService.ensureOpenDrawers({ now });
}

/**
 * Initialize background node-cron scheduler.
 * Runs daily at 09:00 AM Pakistan Standard Time (PKT / UTC+5).
 */
function initCronJobs() {
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_CRON === 'true') {
    return null;
  }

  // Seed default templates on boot
  seedDefaultTemplates().catch((err) => {
    console.error('[cron] failed to seed default templates:', err.message);
  });

  // Open daily drawers at the configured start time (checked every 15 min).
  openDailyDrawers().catch((err) => {
    console.error('[cron] failed to open daily drawers:', err.message);
  });
  cron.schedule('*/15 * * * *', async () => {
    try {
      const result = await openDailyDrawers();
      if (result.opened) console.log('[cron] Daily drawers opened:', JSON.stringify(result));
    } catch (err) {
      console.error('[cron] daily drawer opening failed:', err.message);
    }
  });

  // Daily at 09:00 AM (0 9 * * *)
  const scheduledTask = cron.schedule('0 9 * * *', async () => {
    console.log('[cron] Running daily recovery, reminders and health checks...');
    try {
      const summary = await runAllJobsManual();
      console.log('[cron] Daily jobs completed successfully:', JSON.stringify(summary));
    } catch (err) {
      console.error('[cron] Error during daily cron execution:', err);
    }
  });

  // Daily database backup at 02:00 AM (0 2 * * *)
  cron.schedule('0 2 * * *', async () => {
    console.log('[cron] Running automated nightly database backup...');
    try {
      const res = await performBackup();
      console.log('[cron] Nightly backup finished:', JSON.stringify(res));
    } catch (err) {
      console.error('[cron] Error during automated backup execution:', err);
    }
  });

  return scheduledTask;
}

module.exports = {
  initCronJobs,
  runInstallmentReminders,
  validatePromisesToPay,
  checkMaturedCheques,
  checkLowStock,
  checkExpiringWarranties,
  checkUpcomingMaintenance,
  runAllJobsManual,
  openDailyDrawers,
};
