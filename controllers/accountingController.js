'use strict';

/**
 * Double-Entry Accounting & Financial Controller.
 *
 * Handles:
 * - Financial Dashboard overview
 * - Expense registration & listing
 * - Supplier payment posting
 * - Cash Book & Bank Book ledgers (with CSV/PDF exports)
 * - Daily closing reconciliation
 * - Salary & commission disbursement sheet
 * - Trial Balance (with CSV/PDF export)
 * - Profit & Loss statement (with CSV/PDF export)
 * - Accounts Receivable & Accounts Payable reports (with CSV exports)
 */

const { validationResult } = require('express-validator');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const accountingService = require('../services/accountingService');
const accountingPdfService = require('../services/accountingPdfService');
const dailyClosingService = require('../services/dailyClosingService');
const branchInventory = require('../services/branchInventoryService');
const Expense = require('../models/Expense');
const JournalEntry = require('../models/JournalEntry');
const Supplier = require('../models/Supplier');
const Employee = require('../models/Employee');
const { getSettings } = require('../services/settingsService');
const { toPaisa } = require('../utils/money');
const { formatDate, formatPKR } = require('../utils/format');
const { paginate } = require('../utils/pagination');
const { EXPENSE_CATEGORIES, PAYMENT_ACCOUNTS } = require('../config/accounting');

/**
 * 1. Financial Dashboard
 */
exports.dashboard = asyncHandler(async (req, res) => {
  const stats = await accountingService.getAccountingDashboardStats();
  const trialBalance = await accountingService.getTrialBalance();

  return res.render('accounting/dashboard', {
    layout: 'layouts/admin',
    title: 'Financial & Accounting Dashboard',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Accounting' }],
    stats,
    trialBalance,
  });
});

/**
 * 2. Expense Register & Listing
 */
exports.expenses = asyncHandler(async (req, res) => {
  const { category, paymentAccount, from, to, page, limit } = req.query;

  const filter = { deletedAt: null };
  if (category) filter.categoryAccount = category;
  if (paymentAccount) filter.paymentAccount = paymentAccount;

  const dateQuery = {};
  if (from) dateQuery.$gte = new Date(new Date(from).setHours(0, 0, 0, 0));
  if (to) dateQuery.$lte = new Date(new Date(to).setHours(23, 59, 59, 999));
  if (Object.keys(dateQuery).length) filter.date = dateQuery;

  const [items, total, pagination] = await paginate(
    Expense.find(filter)
      .populate('categoryAccount', 'code name')
      .populate('paymentAccount', 'code name')
      .populate('recordedBy', 'name email')
      .sort({ date: -1, createdAt: -1 }),
    { page, limit }
  );

  const branches = await branchInventory.listBranches();

  return res.render('accounting/expenses', {
    layout: 'layouts/admin',
    title: 'Operating Expense Register',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Expenses' },
    ],
    expenses: items,
    total,
    pagination,
    expenseCategories: EXPENSE_CATEGORIES,
    paymentAccounts: PAYMENT_ACCOUNTS,
    branches,
    defaultBranchId: branches.length ? String(branches[0]._id) : '',
    filters: { category, paymentAccount, from, to },
  });
});

/**
 * 3. Create Operating Expense
 */
exports.createExpense = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect('/accounting/expenses');
  }

  const { categoryAccountCode, paymentAccountCode, amount, payee, notes, date, branch } = req.body;
  const amountPaisa = toPaisa(amount);

  let receiptAttachment = null;
  if (req.file) {
    receiptAttachment = `/uploads/expenses/${req.file.filename}`;
  }

  await accountingService.postExpense(
    {
      categoryAccountCode,
      paymentAccountCode,
      amountPaisa,
      payee,
      notes,
      receiptAttachment,
      date: date ? new Date(date) : new Date(),
      branch: branch || null,
    },
    req.user,
    req
  );

  req.flash('success', `Expense voucher recorded successfully for PKR ${(amountPaisa / 100).toLocaleString()}`);
  return res.redirect('/accounting/expenses');
});

/**
 * 4. Supplier Payments
 */
exports.supplierPayments = asyncHandler(async (req, res) => {
  const [suppliers, payablesList, recentEntries] = await Promise.all([
    Supplier.find({ isActive: true, deletedAt: null }).sort({ name: 1 }).lean(),
    accountingService.getPayablesList(),
    JournalEntry.find({ referenceType: 'supplier_payment', deletedAt: null })
      .populate('createdBy', 'name')
      .sort({ date: -1, createdAt: -1 })
      .limit(15)
      .lean(),
  ]);

  return res.render('accounting/supplier-payments', {
    layout: 'layouts/admin',
    title: 'Supplier Payments & AP Settlement',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Supplier Payments' },
    ],
    suppliers,
    payablesList,
    recentEntries,
    paymentAccounts: PAYMENT_ACCOUNTS,
  });
});

/**
 * 5. Create Supplier Payment
 */
exports.createSupplierPayment = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect('/accounting/supplier-payments');
  }

  const { supplierId, amount, paymentAccountCode, reference, notes } = req.body;
  const amountPaisa = toPaisa(amount);

  await accountingService.postSupplierPayment(
    {
      supplierId,
      amountPaisa,
      paymentAccountCode,
      reference,
      notes,
    },
    req.user,
    req
  );

  req.flash('success', `Payment of PKR ${(amountPaisa / 100).toLocaleString()} recorded successfully.`);
  return res.redirect('/accounting/supplier-payments');
});

/**
 * 6. Cash Book (1010)
 */
exports.cashBook = asyncHandler(async (req, res) => {
  const { from, to, format } = req.query;
  const cashBook = await accountingService.getCashBook({ fromDate: from, toDate: to });
  const settings = await getSettings();

  if (format === 'csv') {
    const rows = [
      ['Date', 'Voucher Number', 'Particulars / Memo', 'Cash IN (Debit PKR)', 'Cash OUT (Credit PKR)', 'Running Balance (PKR)'],
      ['Opening Balance', '', '', '', '', (cashBook.openingBalancePaisa / 100).toFixed(2)],
    ];

    cashBook.transactions.forEach((t) => {
      rows.push([
        formatDate(t.date),
        t.entryNumber,
        `"${(t.memo || t.description || '').replace(/"/g, '""')}"`,
        (t.debitPaisa / 100).toFixed(2),
        (t.creditPaisa / 100).toFixed(2),
        (t.runningBalancePaisa / 100).toFixed(2),
      ]);
    });

    rows.push(['Closing Balance', '', '', '', '', (cashBook.closingBalancePaisa / 100).toFixed(2)]);
    const csvContent = rows.map((r) => r.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="cash-book-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csvContent);
  }

  if (format === 'pdf') {
    const pdfBuffer = await accountingPdfService.buildCashBookPdf({
      cashBook,
      fromDate: from,
      toDate: to,
      settings,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="cash-book.pdf"`);
    return res.send(pdfBuffer);
  }

  return res.render('accounting/cash-book', {
    layout: 'layouts/admin',
    title: 'Cash in Hand Book (1010)',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Cash Book' },
    ],
    cashBook,
    filters: { from, to },
  });
});

/**
 * 7. Bank Book (1020)
 */
exports.bankBook = asyncHandler(async (req, res) => {
  const { from, to, format } = req.query;
  const bankBook = await accountingService.getBankBook({ fromDate: from, toDate: to });
  const settings = await getSettings();

  if (format === 'csv') {
    const rows = [
      ['Date', 'Reference Number', 'Particulars / Memo', 'Deposits (Debit PKR)', 'Withdrawals (Credit PKR)', 'Balance (PKR)'],
      ['Opening Balance', '', '', '', '', (bankBook.openingBalancePaisa / 100).toFixed(2)],
    ];

    bankBook.transactions.forEach((t) => {
      rows.push([
        formatDate(t.date),
        t.entryNumber,
        `"${(t.memo || t.description || '').replace(/"/g, '""')}"`,
        (t.debitPaisa / 100).toFixed(2),
        (t.creditPaisa / 100).toFixed(2),
        (t.runningBalancePaisa / 100).toFixed(2),
      ]);
    });

    rows.push(['Closing Balance', '', '', '', '', (bankBook.closingBalancePaisa / 100).toFixed(2)]);
    const csvContent = rows.map((r) => r.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="bank-book-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csvContent);
  }

  if (format === 'pdf') {
    const pdfBuffer = await accountingPdfService.buildCashBookPdf({
      cashBook: bankBook,
      fromDate: from,
      toDate: to,
      settings,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="bank-book.pdf"`);
    return res.send(pdfBuffer);
  }

  return res.render('accounting/bank-book', {
    layout: 'layouts/admin',
    title: 'Bank Alfalah Register (1020)',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Bank Book' },
    ],
    bankBook,
    filters: { from, to },
  });
});

/**
 * 8. Daily Closing & Cash Drawer Reconciliation
 */

function closingRedirectUrl(branch, businessDateKey) {
  const params = new URLSearchParams();
  if (branch && branch._id) params.set('branch', String(branch._id));
  if (businessDateKey) params.set('date', businessDateKey);
  const query = params.toString();
  return `/accounting/daily-closing${query ? `?${query}` : ''}`;
}

function safeReturnTo(value, fallback = '/dashboard') {
  const target = String(value || '');
  if (target.startsWith('/') && !target.startsWith('//')) return target;
  return fallback;
}

function redirectClosingError(req, res, err, fallback) {
  if (!(err instanceof ApiError)) throw err;
  req.flash('error', err.message);
  return res.redirect(fallback || '/accounting/daily-closing');
}

function parseOptionalAmount(value) {
  if (value === undefined || value === null || String(value).trim() === '') return 0;
  return toPaisa(value);
}

/**
 * Resolve the selected branch and business-date window for a closing action.
 * Branch sessions are always pinned to their own branch by
 * branchInventory.getAccessibleBranch().
 */
async function resolveClosingContext(req) {
  const settings = await getSettings();
  const body = req.body || {};
  const currentWindow = dailyClosingService.resolveBusinessWindow({
    now: new Date(),
    start: settings.businessDayStart,
    end: settings.businessDayEnd,
  });
  const branch = await branchInventory.getAccessibleBranch(
    req.user,
    body.branch || req.query.branch
  );

  let window = currentWindow;
  const requestedKey = body.businessDate || req.query.date;
  if (requestedKey && /^\d{4}-\d{2}-\d{2}$/.test(String(requestedKey))) {
    window =
      dailyClosingService.windowForBusinessDate(requestedKey, {
        start: settings.businessDayStart,
        end: settings.businessDayEnd,
      }) || currentWindow;
  }

  return { settings, currentWindow, branch, window };
}

exports.dailyClosing = asyncHandler(async (req, res) => {
  const { settings, currentWindow, branch, window } = await resolveClosingContext(req);

  // Only the active business day is auto-created. Historical dates are shown
  // read-only when a drawer already exists, so simply browsing an old date can
  // never fabricate a new drawer in the cash chain.
  const allowCreate = window.businessDateKey === currentWindow.businessDateKey;
  const drawer = await dailyClosingService.getDrawer({
    branch,
    businessDate: window.businessDate,
    window,
    actor: req.user,
    allowCreate,
  });

  if (req.query.format === 'pdf') {
    if (!drawer) {
      req.flash('error', 'No closing record exists for the selected date.');
      return res.redirect(closingRedirectUrl(branch, window.businessDateKey));
    }
    const summary = await dailyClosingService.buildSummary(drawer);
    const pdfBuffer = await accountingPdfService.buildDrawerClosingPdf({
      drawer,
      summary,
      settings,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="cash-drawer-${window.businessDateKey}.pdf"`
    );
    return res.send(pdfBuffer);
  }

  const summary = drawer
    ? await dailyClosingService.buildSummary(drawer, { persist: drawer.status === 'open' })
    : null;
  const history = await dailyClosingService.listDrawers({
    branchId: branch._id,
    limit: 14,
  });

  const restricted = Boolean(
    req.user &&
      (req.user.isBranchLogin ||
        (['shopkeeper', 'sales'].includes(req.user.role) && req.user.branch))
  );
  const branches = restricted ? [] : await branchInventory.listBranches();

  return res.render('accounting/daily-closing', {
    layout: 'layouts/admin',
    title: 'Daily Closing & Drawer Reconciliation',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Daily Closing' },
    ],
    drawer,
    summary,
    history,
    branch,
    branches,
    canChooseBranch: branches.length > 0,
    canManage: res.locals.can('closing.manage'),
    canReopen: res.locals.can('closing.reopen'),
    denominations: dailyClosingService.DENOMINATIONS,
    settings,
    dateString: window.businessDateKey,
    currentDateString: currentWindow.businessDateKey,
    window,
    currentWindow,
    isCurrentBusinessDay: window.businessDateKey === currentWindow.businessDateKey,
  });
});

exports.addClosingAdjustment = asyncHandler(async (req, res) => {
  const fallback = safeReturnTo(req.body.returnTo, '/accounting/daily-closing');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect(fallback);
  }

  let context;
  try {
    context = await resolveClosingContext(req);
    const { branch, window, currentWindow } = context;
    const drawer = await dailyClosingService.getDrawer({
      branch,
      businessDate: window.businessDate,
      window,
      actor: req.user,
      // Existing historical drawers may be adjusted, but a past date cannot be
      // opened retroactively by posting directly to this endpoint.
      allowCreate: window.businessDateKey === currentWindow.businessDateKey,
    });
    if (!drawer) throw ApiError.notFound('No cash drawer exists for that business date.');
    const amountPaisa = toPaisa(req.body.amount);
    await dailyClosingService.addAdjustment({
      drawer,
      kind: req.body.kind,
      amountPaisa,
      reason: req.body.reason,
      actor: req.user,
      req,
    });
    req.flash(
      'success',
      `${req.body.kind === 'in' ? 'Cash in' : 'Cash out'} recorded for PKR ${(
        amountPaisa / 100
      ).toLocaleString()}.`
    );
    return res.redirect(closingRedirectUrl(branch, window.businessDateKey));
  } catch (err) {
    return redirectClosingError(req, res, err, fallback);
  }
});

exports.closeDailyClosing = asyncHandler(async (req, res) => {
  const fallback = safeReturnTo(req.body.returnTo, '/accounting/daily-closing');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect(fallback);
  }

  let context;
  try {
    context = await resolveClosingContext(req);
    const { branch, window, currentWindow } = context;
    const drawer = await dailyClosingService.getDrawer({
      branch,
      businessDate: window.businessDate,
      window,
      actor: req.user,
      // Only the active business day can be opened by closing it.
      allowCreate: window.businessDateKey === currentWindow.businessDateKey,
    });
    if (!drawer) throw ApiError.notFound('No cash drawer exists for that business date.');
    const countedCashPaisa = toPaisa(req.body.countedCash);
    const denominations = dailyClosingService.parseDenominations(req.body);
    await dailyClosingService.closeDrawer({
      drawer,
      countedCashPaisa,
      denominations,
      closedByName: req.body.closedByName,
      varianceReason: req.body.varianceReason,
      notes: req.body.notes,
      actor: req.user,
      req,
    });
    req.flash('success', `Drawer ${drawer.number} closed successfully.`);
    return res.redirect(closingRedirectUrl(branch, window.businessDateKey));
  } catch (err) {
    return redirectClosingError(req, res, err, fallback);
  }
});

/**
 * One-step close from the closing-time popup. Optional cash-in/cash-out
 * adjustments are recorded first, then the drawer is closed with the physical
 * count. This keeps the popup useful when the shopkeeper needs to explain a
 * small cash movement at the last minute.
 */
exports.quickCloseDailyClosing = asyncHandler(async (req, res) => {
  const fallback = safeReturnTo(req.body.returnTo, '/accounting/daily-closing');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect(fallback);
  }

  try {
    const { branch, window, currentWindow } = await resolveClosingContext(req);
    let drawer = await dailyClosingService.getDrawer({
      branch,
      businessDate: window.businessDate,
      window,
      actor: req.user,
      // The popup only ever targets the active business day.
      allowCreate: window.businessDateKey === currentWindow.businessDateKey,
    });
    if (!drawer) throw ApiError.notFound('No cash drawer exists for that business date.');

    const cashIn = parseOptionalAmount(req.body.cashIn);
    const cashOut = parseOptionalAmount(req.body.cashOut);

    if (cashIn > 0) {
      drawer = await dailyClosingService.addAdjustment({
        drawer,
        kind: 'in',
        amountPaisa: cashIn,
        reason: req.body.cashInReason || 'Extra cash at closing',
        actor: req.user,
        req,
      });
    }
    if (cashOut > 0) {
      drawer = await dailyClosingService.addAdjustment({
        drawer,
        kind: 'out',
        amountPaisa: cashOut,
        reason: req.body.cashOutReason || 'Cash removed at closing',
        actor: req.user,
        req,
      });
    }

    await dailyClosingService.closeDrawer({
      drawer,
      countedCashPaisa: toPaisa(req.body.countedCash),
      closedByName: req.body.closedByName,
      varianceReason: req.body.varianceReason,
      notes: req.body.notes,
      actor: req.user,
      req,
    });

    req.flash('success', `Drawer ${drawer.number} closed successfully.`);
    return res.redirect(closingRedirectUrl(branch, window.businessDateKey));
  } catch (err) {
    return redirectClosingError(req, res, err, fallback);
  }
});

exports.reopenDailyClosing = asyncHandler(async (req, res) => {
  const fallback = safeReturnTo(req.body.returnTo, '/accounting/daily-closing');
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect(fallback);
  }

  try {
    const { branch, window } = await resolveClosingContext(req);
    const drawer = await dailyClosingService.getDrawer({
      branch,
      businessDate: window.businessDate,
      window,
      actor: req.user,
      allowCreate: false,
    });
    if (!drawer) throw ApiError.notFound('No closing record exists for this date.');
    await dailyClosingService.reopenDrawer({
      drawer,
      reason: req.body.reason,
      actor: req.user,
      req,
    });
    req.flash('success', `Drawer ${drawer.number} reopened. Review the count and close it again.`);
    return res.redirect(closingRedirectUrl(branch, window.businessDateKey));
  } catch (err) {
    return redirectClosingError(req, res, err, fallback);
  }
});

exports.snoozeClosingReminder = asyncHandler(async (req, res) => {
  req.session.closingSnooze = {
    until: Date.now() + 30 * 60 * 1000,
    businessDate: req.body.businessDate || null,
  };
  return res.redirect(safeReturnTo(req.body.returnTo, '/dashboard'));
});

/**
 * 9. Monthly Salary & Commission Sheet
 */
exports.salarySheet = asyncHandler(async (req, res) => {
  const now = new Date();
  const month = req.query.month !== undefined ? Number(req.query.month) : now.getMonth();
  const year = req.query.year !== undefined ? Number(req.query.year) : now.getFullYear();

  const [sheet, employees] = await Promise.all([
    accountingService.getSalaryCommissionSheet({ month, year }),
    Employee.find({ isActive: true, deletedAt: null }).sort({ name: 1 }).lean(),
  ]);

  return res.render('accounting/salary-sheet', {
    layout: 'layouts/admin',
    title: 'Staff Salary & Sales Commission Sheet',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Salary Sheet' },
    ],
    sheet,
    employees,
    paymentAccounts: PAYMENT_ACCOUNTS,
    selectedMonth: month,
    selectedYear: year,
  });
});

/**
 * 10. Disburse Salary / Commission
 */
exports.disburseSalary = asyncHandler(async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.flash('error', errors.array()[0].msg);
    return res.redirect('/accounting/salary-sheet');
  }

  const { employeeId, amount, paymentAccountCode, disbursementType, notes } = req.body;
  const amountPaisa = toPaisa(amount);

  if (disbursementType === 'commission') {
    await accountingService.postCommissionPayout(
      { employeeId, amountPaisa, paymentAccountCode, notes },
      req.user,
      req
    );
    req.flash('success', `Commission of PKR ${(amountPaisa / 100).toLocaleString()} disbursed successfully.`);
  } else {
    await accountingService.postSalaryDisbursement(
      { employeeId, amountPaisa, paymentAccountCode, notes },
      req.user,
      req
    );
    req.flash('success', `Salary of PKR ${(amountPaisa / 100).toLocaleString()} disbursed successfully.`);
  }

  return res.redirect('/accounting/salary-sheet');
});

/**
 * 11. Trial Balance
 */
exports.trialBalance = asyncHandler(async (req, res) => {
  const { asOfDate, format } = req.query;
  const targetDate = asOfDate ? new Date(asOfDate) : new Date();
  const trialBalance = await accountingService.getTrialBalance({ asOfDate: targetDate });
  const settings = await getSettings();

  if (format === 'csv') {
    const rows = [
      ['Account Code', 'Account Name', 'Type', 'Debit Balance (PKR)', 'Credit Balance (PKR)'],
    ];

    trialBalance.rows.forEach((r) => {
      rows.push([
        r.code,
        `"${r.name.replace(/"/g, '""')}"`,
        r.type.toUpperCase(),
        (r.debitBalancePaisa / 100).toFixed(2),
        (r.creditBalancePaisa / 100).toFixed(2),
      ]);
    });

    rows.push([
      'TOTAL',
      'DOUBLE-ENTRY TOTAL',
      trialBalance.isBalanced ? 'BALANCED' : 'UNBALANCED',
      (trialBalance.totalDebitPaisa / 100).toFixed(2),
      (trialBalance.totalCreditPaisa / 100).toFixed(2),
    ]);

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trial-balance-${targetDate.toISOString().split('T')[0]}.csv"`);
    return res.send(csvContent);
  }

  if (format === 'pdf') {
    const pdfBuffer = await accountingPdfService.buildTrialBalancePdf({
      trialBalance,
      asOfDate: targetDate,
      settings,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="trial-balance.pdf"`);
    return res.send(pdfBuffer);
  }

  return res.render('accounting/trial-balance', {
    layout: 'layouts/admin',
    title: 'Trial Balance Verification',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Trial Balance' },
    ],
    trialBalance,
    asOfDateString: targetDate.toISOString().split('T')[0],
  });
});

/**
 * 12. Profit & Loss Statement
 */
exports.profitLoss = asyncHandler(async (req, res) => {
  const { from, to, format } = req.query;
  const pnl = await accountingService.getProfitAndLoss({ fromDate: from, toDate: to });
  const settings = await getSettings();

  if (format === 'csv') {
    const rows = [
      ['Section', 'Account Code', 'Account Name', 'Amount (PKR)'],
      ['Revenue', '', 'TOTAL OPERATING REVENUE', (pnl.totalIncomePaisa / 100).toFixed(2)],
    ];

    pnl.incomeItems.forEach((i) => {
      rows.push(['Revenue Item', i.code, `"${i.name.replace(/"/g, '""')}"`, (i.amountPaisa / 100).toFixed(2)]);
    });

    rows.push(['COGS', '', 'TOTAL COST OF GOODS SOLD', (pnl.totalCogsPaisa / 100).toFixed(2)]);
    pnl.cogsItems.forEach((c) => {
      rows.push(['COGS Item', c.code, `"${c.name.replace(/"/g, '""')}"`, (c.amountPaisa / 100).toFixed(2)]);
    });

    rows.push(['Gross Profit', '', `GROSS PROFIT (${pnl.grossMarginPercent}%)`, (pnl.grossProfitPaisa / 100).toFixed(2)]);
    rows.push(['OPEX', '', 'TOTAL OPERATING EXPENSES', (pnl.totalOperatingExpensePaisa / 100).toFixed(2)]);
    pnl.operatingExpenseItems.forEach((o) => {
      rows.push(['Expense Item', o.code, `"${o.name.replace(/"/g, '""')}"`, (o.amountPaisa / 100).toFixed(2)]);
    });

    rows.push(['Net Profit', '', `NET OPERATING PROFIT (${pnl.netMarginPercent}%)`, (pnl.netProfitPaisa / 100).toFixed(2)]);

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="profit-and-loss-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csvContent);
  }

  if (format === 'pdf') {
    const pdfBuffer = await accountingPdfService.buildProfitLossPdf({
      profitLoss: pnl,
      fromDate: from,
      toDate: to,
      settings,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="profit-and-loss.pdf"`);
    return res.send(pdfBuffer);
  }

  return res.render('accounting/profit-loss', {
    layout: 'layouts/admin',
    title: 'Profit & Loss Statement',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Profit & Loss' },
    ],
    pnl,
    filters: { from, to },
  });
});

/**
 * 13. Accounts Receivable Aging & Customer Balances
 */
exports.receivables = asyncHandler(async (req, res) => {
  const { format } = req.query;
  const receivables = await accountingService.getReceivablesList();

  if (format === 'csv') {
    const rows = [
      ['Customer Code', 'Customer Name', 'Phone', 'City', 'Total Billed (PKR)', 'Total Paid (PKR)', 'Balance Due (PKR)', 'Days Overdue'],
    ];

    receivables.rows.forEach((r) => {
      rows.push([
        r.customer ? r.customer.code : '',
        `"${(r.customer ? r.customer.name : '').replace(/"/g, '""')}"`,
        r.customer ? r.customer.phone : '',
        r.customer ? r.customer.city : '',
        (r.totalBilledPaisa / 100).toFixed(2),
        (r.totalPaidPaisa / 100).toFixed(2),
        (r.balanceDuePaisa / 100).toFixed(2),
        r.daysOverdue,
      ]);
    });

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="accounts-receivable-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csvContent);
  }

  return res.render('accounting/receivables', {
    layout: 'layouts/admin',
    title: 'Accounts Receivable Ledger',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Receivables' },
    ],
    receivables,
  });
});

/**
 * 14. Accounts Payable Aging & Supplier Balances
 */
exports.payables = asyncHandler(async (req, res) => {
  const { format } = req.query;
  const payables = await accountingService.getPayablesList();

  if (format === 'csv') {
    const rows = [
      ['Supplier Code', 'Supplier Name', 'Phone', 'Orders Count', 'Total Purchases (PKR)', 'Total Paid (PKR)', 'Balance Due (PKR)', 'Days Overdue'],
    ];

    payables.rows.forEach((r) => {
      rows.push([
        r.supplier ? r.supplier.code : '',
        `"${(r.supplier ? r.supplier.name : '').replace(/"/g, '""')}"`,
        r.supplier ? r.supplier.phone : '',
        r.ordersCount,
        (r.totalPurchasesPaisa / 100).toFixed(2),
        (r.totalPaidPaisa / 100).toFixed(2),
        (r.balanceDuePaisa / 100).toFixed(2),
        r.daysOverdue,
      ]);
    });

    const csvContent = rows.map((r) => r.join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="accounts-payable-${new Date().toISOString().split('T')[0]}.csv"`);
    return res.send(csvContent);
  }

  return res.render('accounting/payables', {
    layout: 'layouts/admin',
    title: 'Accounts Payable Ledger',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Accounting', url: '/accounting/dashboard' },
      { label: 'Payables' },
    ],
    payables,
  });
});
