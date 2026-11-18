'use strict';

/**
 * Step 10: Double-Entry Accounting, Financial Reporting, and Ledger Tests.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const Expense = require('../models/Expense');
const {
  ACCOUNT_TYPES,
  NORMAL_BALANCES,
  DEFAULT_CHART_OF_ACCOUNTS,
} = require('../config/accounting');
const {
  buildTrialBalancePdf,
  buildProfitLossPdf,
  buildCashBookPdf,
  buildDailyClosingPdf,
} = require('../services/accountingPdfService');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');

test('Account model validates required code, name, type, and normalBalance', () => {
  const acc = new Account({
    code: '1010',
    name: 'Cash in Hand',
    type: ACCOUNT_TYPES.ASSET,
    normalBalance: NORMAL_BALANCES.DEBIT,
  });

  assert.equal(acc.validateSync(), undefined);

  const invalid = new Account({});
  const err = invalid.validateSync();
  assert.ok(err.errors.code);
  assert.ok(err.errors.name);
  assert.ok(err.errors.type);
  assert.ok(err.errors.normalBalance);
});

test('Account model rejects invalid account types and normal balance strings', () => {
  const invalid = new Account({
    code: '9999',
    name: 'Invalid Account',
    type: 'unsupported_type',
    normalBalance: 'neutral',
  });

  const err = invalid.validateSync();
  assert.ok(err.errors.type);
  assert.ok(err.errors.normalBalance);
});

test('Standard Chart of Accounts defines all 15 core solar business accounts', () => {
  assert.ok(DEFAULT_CHART_OF_ACCOUNTS.length >= 15);
  const codes = DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.code);

  assert.ok(codes.includes('1010')); // Cash
  assert.ok(codes.includes('1020')); // Bank Alfalah
  assert.ok(codes.includes('1030')); // AR
  assert.ok(codes.includes('1040')); // Inventory Asset
  assert.ok(codes.includes('2010')); // AP
  assert.ok(codes.includes('3010')); // Equity
  assert.ok(codes.includes('4010')); // Sales Revenue
  assert.ok(codes.includes('5010')); // COGS
  assert.ok(codes.includes('6010')); // Salaries
  assert.ok(codes.includes('6020')); // Commissions
  assert.ok(codes.includes('6030')); // Rent
});

test('JournalEntry model accepts perfectly balanced double-entry lines', () => {
  const acc1 = new mongoose.Types.ObjectId();
  const acc2 = new mongoose.Types.ObjectId();

  const jv = new JournalEntry({
    entryNumber: 'JV-2026-0001',
    date: new Date(),
    referenceType: 'sale',
    memo: 'Sale Contract Approved',
    lines: [
      {
        account: acc1,
        accountCode: '1030',
        accountName: 'Accounts Receivable',
        debitPaisa: 50000000,
        creditPaisa: 0,
      },
      {
        account: acc2,
        accountCode: '4010',
        accountName: 'Solar System Revenue',
        debitPaisa: 0,
        creditPaisa: 50000000,
      },
    ],
    totalDebitPaisa: 50000000,
    totalCreditPaisa: 50000000,
  });

  assert.equal(jv.validateSync(), undefined);
});

test('JournalEntry rejects unbalanced lines (Total Debits !== Total Credits)', () => {
  const acc1 = new mongoose.Types.ObjectId();
  const acc2 = new mongoose.Types.ObjectId();

  const unbalancedJv = new JournalEntry({
    entryNumber: 'JV-2026-0002',
    date: new Date(),
    referenceType: 'expense',
    memo: 'Office Supplies',
    lines: [
      {
        account: acc1,
        accountCode: '6060',
        accountName: 'Office Supplies',
        debitPaisa: 500000, // 5,000 PKR
        creditPaisa: 0,
      },
      {
        account: acc2,
        accountCode: '1010',
        accountName: 'Cash in Hand',
        debitPaisa: 0,
        creditPaisa: 450000, // 4,500 PKR (500 PKR discrepancy)
      },
    ],
  });

  const err = unbalancedJv.validateSync();
  assert.ok(err, 'Unbalanced entry must fail validation');
  assert.match(err.message, /Unbalanced journal entry/);
});

test('JournalEntry requires at least 2 lines', () => {
  const acc1 = new mongoose.Types.ObjectId();
  const singleLineJv = new JournalEntry({
    entryNumber: 'JV-2026-0003',
    memo: 'Single Line Entry',
    referenceType: 'manual',
    lines: [
      {
        account: acc1,
        accountCode: '1010',
        accountName: 'Cash',
        debitPaisa: 10000,
        creditPaisa: 0,
      },
    ],
  });

  const err = singleLineJv.validateSync();
  assert.ok(err.errors.lines);
});

test('Expense model validates required voucherNumber, category, payment account, amount, payee', () => {
  const exp = new Expense({
    voucherNumber: 'EXP-2026-0001',
    categoryAccount: new mongoose.Types.ObjectId(),
    paymentAccount: new mongoose.Types.ObjectId(),
    amountPaisa: 1500000,
    payee: 'Lahore Electric Supply Company (LESCO)',
    recordedBy: new mongoose.Types.ObjectId(),
  });

  assert.equal(exp.validateSync(), undefined);

  const invalidExp = new Expense({});
  const err = invalidExp.validateSync();
  assert.ok(err.errors.voucherNumber);
  assert.ok(err.errors.categoryAccount);
  assert.ok(err.errors.paymentAccount);
  assert.ok(err.errors.amountPaisa);
  assert.ok(err.errors.payee);
  assert.ok(err.errors.recordedBy);
});

test('buildTrialBalancePdf generates a valid PDF buffer', async () => {
  const trialBalance = {
    asOfDate: new Date(),
    isBalanced: true,
    totalDebitPaisa: 100000000,
    totalCreditPaisa: 100000000,
    differencePaisa: 0,
    rows: [
      { code: '1010', name: 'Cash in Hand', type: 'asset', debitBalancePaisa: 25000000, creditBalancePaisa: 0 },
      { code: '1020', name: 'Bank Alfalah', type: 'asset', debitBalancePaisa: 75000000, creditBalancePaisa: 0 },
      { code: '3010', name: "Owner's Equity", type: 'equity', debitBalancePaisa: 0, creditBalancePaisa: 100000000 },
    ],
  };

  const buffer = await buildTrialBalancePdf({ trialBalance, asOfDate: new Date(), settings: { companyName: 'PakSolar Test' } });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

test('buildProfitLossPdf generates a valid PDF buffer', async () => {
  const profitLoss = {
    totalIncomePaisa: 120000000,
    totalCogsPaisa: 90000000,
    grossProfitPaisa: 30000000,
    grossMarginPercent: 25.0,
    totalOperatingExpensePaisa: 10000000,
    netProfitPaisa: 20000000,
    netMarginPercent: 16.7,
    incomeItems: [{ code: '4010', name: 'Solar Installation Revenue', amountPaisa: 120000000 }],
    cogsItems: [{ code: '5010', name: 'COGS - Solar Hardware', amountPaisa: 90000000 }],
    operatingExpenseItems: [{ code: '6010', name: 'Salaries', amountPaisa: 10000000 }],
  };

  const buffer = await buildProfitLossPdf({ profitLoss, fromDate: '2026-01-01', toDate: '2026-03-31', settings: { companyName: 'PakSolar Test' } });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

test('buildCashBookPdf generates a valid PDF buffer', async () => {
  const cashBook = {
    openingBalancePaisa: 5000000,
    periodDebitPaisa: 20000000,
    periodCreditPaisa: 15000000,
    closingBalancePaisa: 10000000,
    transactions: [
      {
        date: new Date(),
        entryNumber: 'JV-2026-0001',
        memo: 'Customer Cash Down Payment',
        debitPaisa: 20000000,
        creditPaisa: 0,
        runningBalancePaisa: 25000000,
      },
      {
        date: new Date(),
        entryNumber: 'JV-2026-0002',
        memo: 'Showroom Electricity Bill',
        debitPaisa: 0,
        creditPaisa: 15000000,
        runningBalancePaisa: 10000000,
      },
    ],
  };

  const buffer = await buildCashBookPdf({ cashBook, fromDate: '2026-02-01', toDate: '2026-02-28', settings: { companyName: 'PakSolar Test' } });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

test('buildDailyClosingPdf generates a valid PDF buffer with drawer sign-off', async () => {
  const closing = {
    date: new Date(),
    cash: {
      openingBalancePaisa: 2000000,
      collectionsPaisa: 8000000,
      disbursementsPaisa: 3000000,
      expensesPaisa: 1000000,
      wagesPaisa: 2000000,
      expectedClosingBalancePaisa: 7000000,
      transactions: [],
    },
    bank: {
      openingBalancePaisa: 50000000,
      depositsPaisa: 15000000,
      disbursementsPaisa: 5000000,
      closingBalancePaisa: 60000000,
      transactions: [],
    },
  };

  const buffer = await buildDailyClosingPdf({ closing, date: new Date(), settings: { companyName: 'PakSolar Test' } });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

test('Role permissions restrict accounting and financial report access', () => {
  // Owner and Accountant have full access
  assert.equal(can(ROLES.OWNER, 'accounting.view'), true);
  assert.equal(can(ROLES.OWNER, 'accounting.manage'), true);
  assert.equal(can(ROLES.OWNER, 'reports.financial'), true);

  assert.equal(can(ROLES.ACCOUNTANT, 'accounting.view'), true);
  assert.equal(can(ROLES.ACCOUNTANT, 'accounting.manage'), true);
  assert.equal(can(ROLES.ACCOUNTANT, 'reports.financial'), true);

  // Manager has view access
  assert.equal(can(ROLES.MANAGER, 'accounting.view'), true);
  assert.equal(can(ROLES.MANAGER, 'accounting.manage'), false);

  // Field roles (Sales, Technician, Surveyor, Storekeeper) are strictly blocked
  assert.equal(can(ROLES.SALES, 'accounting.view'), false);
  assert.equal(can(ROLES.SALES, 'accounting.manage'), false);
  assert.equal(can(ROLES.SALES, 'reports.financial'), false);

  assert.equal(can(ROLES.TECHNICIAN, 'accounting.view'), false);
  assert.equal(can(ROLES.TECHNICIAN, 'accounting.manage'), false);
  assert.equal(can(ROLES.TECHNICIAN, 'reports.financial'), false);

  assert.equal(can(ROLES.SURVEYOR, 'accounting.view'), false);
  assert.equal(can(ROLES.SURVEYOR, 'accounting.manage'), false);
  assert.equal(can(ROLES.SURVEYOR, 'reports.financial'), false);
});
