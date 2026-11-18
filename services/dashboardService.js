'use strict';

/**
 * Dashboard Analytics and Multi-Role KPI Service.
 *
 * Provides:
 * 1. Owner & Manager Executive Dashboard:
 *    - KPI Cards: Today & Month Sales, Today & Month Collections, Pending Recovery,
 *      Overdue Balance, Net Profit, Stock Valuation, Low Stock Items, Pending Installations,
 *      Open Complaints and sales performance.
 *    - Chart.js Datasets: Sales vs. Collections trend (last 6 months), Monthly Net Profit,
 *      Top Sales Performers leaderboard and aging delinquency breakdown.
 *    - Live Operational Alerts Panel: Maturing cheques (7 days), overdue installments,
 *      low stock items, and SLA-breached complaints.
 * 2. Role-Tailored Perspectives:
 *    - Sales Dashboard (strictly sanitized, zero cost/profit exposure).
 *    - Technician Dashboard (active installations & assigned repair tickets).
 *    - Storekeeper Dashboard (stock alerts, pending GRNs, movement activity).
 *    - Surveyor Dashboard (scheduled and completed field surveys).
 *    - Accountant Dashboard (liquid cash, bank balance, AR, AP, daily collections).
 */

const mongoose = require('mongoose');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Cheque = require('../models/Cheque');
const Survey = require('../models/Survey');
const Quotation = require('../models/Quotation');
const Sale = require('../models/Sale');
const InstallmentPlan = require('../models/InstallmentPlan');
const Installment = require('../models/Installment');
const InstallmentPayment = require('../models/InstallmentPayment');
const Installation = require('../models/Installation');
const Complaint = require('../models/Complaint');
const Item = require('../models/Item');
const Purchase = require('../models/Purchase');
const StockMovement = require('../models/StockMovement');
const SerialNo = require('../models/SerialNo');
const JournalEntry = require('../models/JournalEntry');
const { can } = require('../config/permissions');
const { ROLES, ROLE_LABELS } = require('../config/roles');
const { getAccountingDashboardStats } = require('./accountingService');
const { getAgingReport } = require('./recoveryService');
const { getValuationReport } = require('./stockService');

/**
 * Aggregates all dashboard KPIs and visual datasets based on the requesting user's role.
 */
async function getDashboardData(user) {
  const role = user ? user.role : 'sales';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  // Common baseline: team accounts & upcoming cheques
  const in7Days = new Date(Date.now() + 7 * 86400000);
  // Start common dashboard data immediately, but do not block role-specific
  // queries on it. Remote database latency makes sequential query groups feel
  // like a failed login even when authentication has already succeeded.
  const commonDataPromise = Promise.all([
    User.countDocuments({ deletedAt: null }),
    User.countDocuments({ isActive: true, deletedAt: null }),
    User.aggregate([
      { $match: { deletedAt: null } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    can(user, 'audit.view')
      ? AuditLog.find().sort({ createdAt: -1 }).limit(6).lean()
      : Promise.resolve([]),
    can(user, 'installments.view')
      ? Cheque.find({
          status: mongoose.trusted({ $in: ['held', 'deposited'] }),
          chequeDate: mongoose.trusted({ $lte: in7Days }),
          deletedAt: null,
        })
          .populate('customer', 'name code phone')
          .sort({ chequeDate: 1 })
          .limit(6)
          .lean()
      : Promise.resolve([]),
  ]);

  const getBaseStats = async () => {
    const [totalUsers, activeUsers, roleAgg, recentActivity, upcomingCheques] =
      await commonDataPromise;
    const roleCounts = roleAgg.map((row) => ({
      role: row._id,
      label: ROLE_LABELS[row._id] || row._id,
      count: row.count,
    }));

    return {
      totalUsers,
      activeUsers,
      roleCounts,
      recentActivity,
      upcomingCheques,
      role,
      roleLabel: ROLE_LABELS[role] || role,
    };
  };

  /* ------------------------------------------------------------------------ */
  /* 1. OWNER & MANAGER COMPREHENSIVE EXECUTIVE DASHBOARD                     */
  /* ------------------------------------------------------------------------ */
  if (role === ROLES.OWNER || role === ROLES.MANAGER) {
    const [
      todaySalesAgg,
      monthSalesAgg,
      todayPaymentsAgg,
      monthPaymentsAgg,
      overdueInstallmentsAgg,
      pendingInstallationsCount,
      openComplaintsCount,
      valuationReport,
      accountingStats,
      agingReport,
      urgentComplaints,
      lowStockItems,
    ] = await Promise.all([
      // Today sales
      Sale.aggregate([
        { $match: { createdAt: { $gte: startOfToday, $lte: endOfToday }, status: { $ne: 'cancelled' }, deletedAt: null } },
        { $group: { _id: null, totalPaisa: { $sum: '$amountPaisa' }, count: { $sum: 1 } } },
      ]),
      // Month sales
      Sale.aggregate([
        { $match: { createdAt: { $gte: startOfMonth }, status: { $ne: 'cancelled' }, deletedAt: null } },
        { $group: { _id: null, totalPaisa: { $sum: '$amountPaisa' }, count: { $sum: 1 } } },
      ]),
      // Today payments
      InstallmentPayment.aggregate([
        { $match: { paymentDate: { $gte: startOfToday, $lte: endOfToday }, deletedAt: null } },
        { $group: { _id: null, totalPaisa: { $sum: '$amountPaisa' }, count: { $sum: 1 } } },
      ]),
      // Month payments
      InstallmentPayment.aggregate([
        { $match: { paymentDate: { $gte: startOfMonth }, deletedAt: null } },
        { $group: { _id: null, totalPaisa: { $sum: '$amountPaisa' }, count: { $sum: 1 } } },
      ]),
      // Overdue installments
      Installment.aggregate([
        { $match: { status: 'overdue', dueDate: { $lt: startOfToday }, deletedAt: null } },
        {
          $group: {
            _id: null,
            totalDuePaisa: { $sum: '$amountPaisa' },
            totalPaidPaisa: { $sum: '$paidAmountPaisa' },
            count: { $sum: 1 },
          },
        },
      ]),
      // Pending installations
      Installation.countDocuments({
        status: mongoose.trusted({
          $in: ['approved', 'material_issued', 'scheduled', 'in_progress', 'net_metering_pending'],
        }),
        deletedAt: null,
      }),
      // Open complaints
      Complaint.countDocuments({
        status: mongoose.trusted({ $in: ['open', 'assigned', 'in_progress'] }),
        deletedAt: null,
      }),
      // Stock valuation & low stock
      getValuationReport().catch(() => ({ totals: { totalValuePaisa: 0, lowStock: 0 }, items: [] })),
      // Accounting financial KPIs
      getAccountingDashboardStats().catch(() => ({
        monthNetProfitPaisa: 0,
        netMarginPercent: 0,
        cashInHandPaisa: 0,
        bankBalancePaisa: 0,
      })),
      // Delinquency aging buckets
      getAgingReport().catch(() => ({ summary: { totalOverduePaisa: 0 }, rows: [] })),
      // Urgent complaints
      Complaint.find({
        status: mongoose.trusted({ $in: ['open', 'assigned', 'in_progress'] }),
        priority: mongoose.trusted({ $in: ['urgent', 'high'] }),
        deletedAt: null,
      })
        .populate('customer', 'name phone city')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      // Top low stock items
      Item.find({
        currentStock: mongoose.trusted({ $gt: 0 }),
        deletedAt: null,
        $expr: mongoose.trusted({ $lte: ['$currentStock', '$minStock'] }),
      })
        .select('sku name category currentStock minStock unit')
        .sort({ currentStock: 1 })
        .limit(5)
        .lean(),
    ]);

    const todaySalesPaisa = todaySalesAgg[0] ? todaySalesAgg[0].totalPaisa : 0;
    const monthSalesPaisa = monthSalesAgg[0] ? monthSalesAgg[0].totalPaisa : 0;
    const todayCollectionsPaisa = todayPaymentsAgg[0] ? todayPaymentsAgg[0].totalPaisa : 0;
    const monthCollectionsPaisa = monthPaymentsAgg[0] ? monthPaymentsAgg[0].totalPaisa : 0;

    const overdueStats = overdueInstallmentsAgg[0] || { totalDuePaisa: 0, totalPaidPaisa: 0, count: 0 };
    const overdueBalancePaisa = Math.max(0, overdueStats.totalDuePaisa - overdueStats.totalPaidPaisa);

    // Build Chart.js Datasets: 6-Month Sales vs Collections Trend
    const last6Months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      last6Months.push({
        year: d.getFullYear(),
        monthIndex: d.getMonth(),
        label: new Intl.DateTimeFormat('en-PK', { month: 'short' }).format(d),
        start: new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0),
        end: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999),
      });
    }

    const sixMonthsSalesVsCollections = await Promise.all(
      last6Months.map(async (m) => {
        const [sales, payments] = await Promise.all([
          Sale.aggregate([
            { $match: { createdAt: { $gte: m.start, $lte: m.end }, status: { $ne: 'cancelled' }, deletedAt: null } },
            { $group: { _id: null, sum: { $sum: '$amountPaisa' } } },
          ]),
          InstallmentPayment.aggregate([
            { $match: { paymentDate: { $gte: m.start, $lte: m.end }, deletedAt: null } },
            { $group: { _id: null, sum: { $sum: '$amountPaisa' } } },
          ]),
        ]);
        return {
          month: m.label,
          salesPaisa: sales[0] ? sales[0].sum : 0,
          collectionsPaisa: payments[0] ? payments[0].sum : 0,
        };
      })
    );

    // 6-Month Net Profit Trend from accounting. Revenue accounts (4xxx)
    // contribute credits minus debits; expense/COGS accounts (5xxx/6xxx)
    // contribute the same signed amount, which subtracts their debit balance.
    // One grouped query replaces six full P&L reports (and their repeated
    // chart-of-accounts seeding), keeping the post-login dashboard responsive.
    const monthlyProfitAgg = await JournalEntry.aggregate([
      {
        $match: {
          date: { $gte: last6Months[0].start, $lte: last6Months.at(-1).end },
          deletedAt: null,
        },
      },
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': { $regex: /^[456]/ } } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m',
              date: '$date',
              timezone: 'Asia/Karachi',
            },
          },
          profitPaisa: {
            $sum: { $subtract: ['$lines.creditPaisa', '$lines.debitPaisa'] },
          },
        },
      },
    ]).catch(() => []);

    const monthlyProfitByKey = new Map(
      monthlyProfitAgg.map((row) => [row._id, row.profitPaisa || 0])
    );
    const sixMonthsProfit = last6Months.map((m) => ({
      month: m.label,
      profitPaisa:
        monthlyProfitByKey.get(
          `${m.year}-${String(m.monthIndex + 1).padStart(2, '0')}`
        ) || 0,
    }));

    // Top Sales Performers Leaderboard
    const topSalesAgg = await Sale.aggregate([
      { $match: { createdAt: { $gte: startOfMonth }, status: { $ne: 'cancelled' }, deletedAt: null } },
      {
        $group: {
          _id: '$assignedTo',
          salesCount: { $sum: 1 },
          volumePaisa: { $sum: '$amountPaisa' },
        },
      },
      { $sort: { volumePaisa: -1 } },
      { $limit: 5 },
    ]);

    const topSalespeople = await Promise.all(
      topSalesAgg.map(async (s) => {
        const u = await User.findById(s._id).select('name email').lean();
        return {
          name: u ? u.name : 'Unassigned',
          salesCount: s.salesCount,
          volumePaisa: s.volumePaisa,
        };
      })
    );

    // Aging breakdown for Doughnut Chart
    const agingSummary = agingReport.summary || {};
    const agingChartData = {
      currentPaisa: agingSummary.currentPaisa || 0,
      d1_30Paisa: agingSummary.d1_30Paisa || 0,
      d31_60Paisa: agingSummary.d31_60Paisa || 0,
      d61_90Paisa: agingSummary.d61_90Paisa || 0,
      d90PlusPaisa: agingSummary.d90PlusPaisa || 0,
      totalOverduePaisa: agingSummary.totalOverduePaisa || overdueBalancePaisa,
    };

    const baseStats = await getBaseStats();

    return {
      ...baseStats,
      isOwnerOrManager: true,
      kpis: {
        todaySalesPaisa,
        monthSalesPaisa,
        todayCollectionsPaisa,
        monthCollectionsPaisa,
        pendingRecoveryPaisa: agingSummary.totalOverduePaisa || overdueBalancePaisa,
        overdueBalancePaisa,
        monthNetProfitPaisa: accountingStats.monthNetProfitPaisa || 0,
        netMarginPercent: accountingStats.netMarginPercent || 0,
        stockValuationPaisa: valuationReport.totals ? valuationReport.totals.totalValuePaisa : 0,
        lowStockCount: valuationReport.totals ? valuationReport.totals.lowStock : 0,
        pendingInstallationsCount,
        openComplaintsCount,
      },
      charts: {
        salesVsCollections: sixMonthsSalesVsCollections,
        monthlyProfit: sixMonthsProfit,
        topSalespeople,
        aging: agingChartData,
      },
      alerts: {
        urgentComplaints,
        lowStockItems,
        overdueInstallmentsCount: overdueStats.count || 0,
        upcomingCheques: baseStats.upcomingCheques,
      },
    };
  }

  /* ------------------------------------------------------------------------ */
  /* 2. SALES ROLE DASHBOARD (STRICTLY CONFIDENTIAL COSTS/PROFIT STRIPPED)    */
  /* ------------------------------------------------------------------------ */
  if (role === ROLES.SALES) {
    const userId = user._id;

    const [myWonSalesCount, mySalesAgg, myQuotes] = await Promise.all([
      Sale.countDocuments({
        assignedTo: userId,
        status: mongoose.trusted({ $ne: 'cancelled' }),
        deletedAt: null,
      }),
      Sale.aggregate([
        { $match: { assignedTo: userId, status: { $ne: 'cancelled' }, deletedAt: null } },
        { $group: { _id: null, volumePaisa: { $sum: '$amountPaisa' } } },
      ]),
      Quotation.find({ assignedTo: userId, deletedAt: null })
        .populate('customer', 'name phone')
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
    ]);

    const mySalesVolumePaisa = mySalesAgg[0] ? mySalesAgg[0].volumePaisa : 0;
    const baseStats = await getBaseStats();

    return {
      ...baseStats,
      isSales: true,
      salesKpis: {
        myWonSalesCount,
        mySalesVolumePaisa,
        myQuotesCount: myQuotes.length,
      },
      myRecentQuotes: myQuotes.map((q) => ({
        quotationNumber: q.quotationNumber,
        customerName: q.customer ? q.customer.name : 'Client',
        capacityKw: q.systemSummary ? q.systemSummary.capacityKw : 0,
        finalPricePaisa: q.finalPricePaisa,
        status: q.status,
      })),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* 3. TECHNICIAN ROLE DASHBOARD                                             */
  /* ------------------------------------------------------------------------ */
  if (role === ROLES.TECHNICIAN) {
    const userId = user._id;

    const [myInstallations, myComplaints] = await Promise.all([
      Installation.find({
        $or: [{ leadTechnician: userId }, { technicians: userId }],
        status: mongoose.trusted({
          $in: ['scheduled', 'in_progress', 'material_issued', 'approved'],
        }),
        deletedAt: null,
      })
        .populate('customer', 'name phone address city')
        .populate('sale', 'saleNumber systemSummary')
        .sort({ scheduledDate: 1 })
        .limit(8)
        .lean(),
      Complaint.find({
        assignedTechnician: userId,
        status: mongoose.trusted({ $in: ['assigned', 'in_progress'] }),
        deletedAt: null,
      })
        .populate('customer', 'name phone address city')
        .sort({ targetResolutionDate: 1 })
        .limit(8)
        .lean(),
    ]);

    const baseStats = await getBaseStats();

    return {
      ...baseStats,
      isTechnician: true,
      technicianKpis: {
        activeInstallationsCount: myInstallations.length,
        openTicketsCount: myComplaints.length,
      },
      myInstallations,
      myComplaints,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* 4. STOREKEEPER ROLE DASHBOARD                                            */
  /* ------------------------------------------------------------------------ */
  if (role === ROLES.STOREKEEPER) {
    const [lowStockItems, pendingPurchases, todayMovementsAgg, serialAgg, valuation] = await Promise.all([
      Item.find({
        deletedAt: null,
        $expr: mongoose.trusted({ $lte: ['$currentStock', '$minStock'] }),
      })
        .select('sku name category currentStock minStock unit location')
        .sort({ currentStock: 1 })
        .lean(),
      Purchase.find({
        status: mongoose.trusted({ $in: ['ordered', 'partial'] }),
        deletedAt: null,
      })
        .populate('supplier', 'name phone')
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
      StockMovement.countDocuments({
        occurredAt: mongoose.trusted({ $gte: startOfToday, $lte: endOfToday }),
      }),
      SerialNo.aggregate([
        { $match: { deletedAt: null } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      getValuationReport().catch(() => ({ totals: { totalValuePaisa: 0 } })),
    ]);

    const serialStatusCounts = {};
    serialAgg.forEach((r) => {
      serialStatusCounts[r._id] = r.count;
    });

    const baseStats = await getBaseStats();

    return {
      ...baseStats,
      isStorekeeper: true,
      storekeeperKpis: {
        lowStockCount: lowStockItems.length,
        pendingPurchasesCount: pendingPurchases.length,
        todayMovementsCount: todayMovementsAgg,
        stockValuationPaisa: valuation.totals ? valuation.totals.totalValuePaisa : 0,
      },
      lowStockItems,
      pendingPurchases,
      serialStatusCounts,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* 5. SURVEYOR ROLE DASHBOARD                                               */
  /* ------------------------------------------------------------------------ */
  if (role === ROLES.SURVEYOR) {
    const userId = user._id;

    const [todaySurveys, pendingSurveys, completedMonthCount] = await Promise.all([
      Survey.find({
        surveyor: userId,
        scheduledDate: mongoose.trusted({ $gte: startOfToday, $lte: endOfToday }),
        deletedAt: null,
      })
        .populate('customer', 'name phone address city')
        .sort({ scheduledDate: 1 })
        .lean(),
      Survey.find({
        surveyor: userId,
        status: mongoose.trusted({ $in: ['scheduled', 'in_progress'] }),
        deletedAt: null,
      })
        .populate('customer', 'name phone address city')
        .sort({ scheduledDate: 1 })
        .limit(8)
        .lean(),
      Survey.countDocuments({
        surveyor: userId,
        status: 'completed',
        completedAt: mongoose.trusted({ $gte: startOfMonth }),
        deletedAt: null,
      }),
    ]);

    const baseStats = await getBaseStats();

    return {
      ...baseStats,
      isSurveyor: true,
      surveyorKpis: {
        todaySurveysCount: todaySurveys.length,
        pendingSurveysCount: pendingSurveys.length,
        completedMonthCount,
      },
      todaySurveys,
      pendingSurveys,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* 6. ACCOUNTANT DASHBOARD                                                  */
  /* ------------------------------------------------------------------------ */
  if (role === ROLES.ACCOUNTANT) {
    const [accountingStats, agingReport, pendingBills] = await Promise.all([
      getAccountingDashboardStats().catch(() => ({
        cashInHandPaisa: 0,
        bankBalancePaisa: 0,
        totalReceivablesPaisa: 0,
        totalPayablesPaisa: 0,
      })),
      getAgingReport().catch(() => ({ summary: { totalOverduePaisa: 0 } })),
      Purchase.find({
        paymentStatus: mongoose.trusted({ $in: ['unpaid', 'partial'] }),
        status: mongoose.trusted({ $ne: 'cancelled' }),
        deletedAt: null,
      })
        .populate('supplier', 'name phone')
        .sort({ createdAt: 1 })
        .limit(6)
        .lean(),
    ]);

    const baseStats = await getBaseStats();

    return {
      ...baseStats,
      isAccountant: true,
      accountantKpis: {
        cashInHandPaisa: accountingStats.cashInHandPaisa || 0,
        bankBalancePaisa: accountingStats.bankBalancePaisa || 0,
        totalReceivablesPaisa: accountingStats.totalReceivablesPaisa || 0,
        totalPayablesPaisa: accountingStats.totalPayablesPaisa || 0,
        overdueRecoveryPaisa: agingReport.summary ? agingReport.summary.totalOverduePaisa : 0,
      },
      pendingBills,
      upcomingCheques: baseStats.upcomingCheques,
    };
  }

  return getBaseStats();
}

module.exports = { getDashboardData };
