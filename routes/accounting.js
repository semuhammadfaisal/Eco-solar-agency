'use strict';

/**
 * Accounting & Double-Entry Ledger Routes.
 */

const express = require('express');
const accountingController = require('../controllers/accountingController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const { expenseReceiptUpload } = require('../middleware/upload');
const {
  createExpenseRules,
  createSupplierPaymentRules,
  disburseSalaryRules,
} = require('../validators/accountingValidators');
const {
  adjustmentRules,
  closeRules,
  quickCloseRules,
  reopenRules,
} = require('../validators/dailyClosingValidators');

const router = express.Router();

router.use(isAuthenticated);

// 1. Dashboard & Reports
router.get(
  '/dashboard',
  requirePermission('accounting.view'),
  accountingController.dashboard
);

// 2. Expenses
router.get(
  '/expenses',
  requirePermission('accounting.view'),
  accountingController.expenses
);
router.post(
  '/expenses',
  requirePermission('accounting.manage'),
  expenseReceiptUpload,
  createExpenseRules,
  accountingController.createExpense
);

// 3. Supplier Payments
router.get(
  '/supplier-payments',
  requirePermission('accounting.view'),
  accountingController.supplierPayments
);
router.post(
  '/supplier-payments',
  requirePermission('accounting.manage'),
  createSupplierPaymentRules,
  accountingController.createSupplierPayment
);

// 4. Ledgers: Cash Book & Bank Book
router.get(
  '/cash-book',
  requirePermission('accounting.view'),
  accountingController.cashBook
);
router.get(
  '/bank-book',
  requirePermission('accounting.view'),
  accountingController.bankBook
);

// 5. Daily Closing & Cash Drawer Reconciliation
router.get(
  '/daily-closing',
  requirePermission('closing.view'),
  accountingController.dailyClosing
);
router.post(
  '/daily-closing/adjustment',
  requirePermission('closing.manage'),
  adjustmentRules,
  accountingController.addClosingAdjustment
);
router.post(
  '/daily-closing/close',
  requirePermission('closing.manage'),
  closeRules,
  accountingController.closeDailyClosing
);
router.post(
  '/daily-closing/quick-close',
  requirePermission('closing.manage'),
  quickCloseRules,
  accountingController.quickCloseDailyClosing
);
router.post(
  '/daily-closing/reopen',
  requirePermission('closing.reopen'),
  reopenRules,
  accountingController.reopenDailyClosing
);
router.post(
  '/daily-closing/snooze',
  requirePermission('closing.view'),
  accountingController.snoozeClosingReminder
);

// 6. Salary & Commission Sheet
router.get(
  '/salary-sheet',
  requirePermission('accounting.view'),
  accountingController.salarySheet
);
router.post(
  '/salary-sheet/disburse',
  requirePermission('accounting.manage'),
  disburseSalaryRules,
  accountingController.disburseSalary
);

// 7. Trial Balance
router.get(
  '/trial-balance',
  requirePermission('reports.financial'),
  accountingController.trialBalance
);

// 8. Profit & Loss Statement
router.get(
  '/profit-loss',
  requirePermission('reports.financial'),
  accountingController.profitLoss
);

// 9. Accounts Receivable & Payable Ledgers
router.get(
  '/receivables',
  requirePermission('accounting.view'),
  accountingController.receivables
);
router.get(
  '/payables',
  requirePermission('accounting.view'),
  accountingController.payables
);

module.exports = router;
