'use strict';

/**
 * Double-Entry Accounting Service.
 *
 * Implements:
 * 1. Chart of Accounts management and automatic seeding.
 * 2. Balanced journal entry creation with strict sum(debit) == sum(credit) invariance.
 * 3. Automatic event-driven double-entry postings for:
 *    - Sale approvals (AR debit, Revenue credit, COGS debit, Inventory credit)
 *    - Customer installment & down payments (Cash/Bank debit, AR credit, Late fee credit)
 *    - Purchase receipts / GRN (Inventory debit, AP credit)
 *    - Supplier payments (AP debit, Cash/Bank credit)
 *    - Operating expenses (Expense debit, Cash/Bank credit)
 *    - Salary disbursements (Salaries expense debit, Cash/Bank credit)
 *    - Sales commission payouts (Commission expense debit, Cash/Bank credit)
 *    - Service & repair charges (Cash/AR debit, Service Income credit)
 * 4. Financial statement and report engines:
 *    - Trial Balance (as of date)
 *    - Profit & Loss statement (date range)
 *    - Cash Book (ledger of Cash in Hand 1010)
 *    - Bank Book (ledger of Bank Alfalah 1020)
 *    - Daily Closing sheet with cash reconciliation
 *    - Salary & Commission disbursement sheet
 *    - Accounts Receivable & Accounts Payable aging
 */

const mongoose = require('mongoose');
const Account = require('../models/Account');
const JournalEntry = require('../models/JournalEntry');
const Expense = require('../models/Expense');
const Counter = require('../models/Counter');
const Customer = require('../models/Customer');
const Supplier = require('../models/Supplier');
const Employee = require('../models/Employee');
const Sale = require('../models/Sale');
const Installment = require('../models/Installment');
const Purchase = require('../models/Purchase');
const Attendance = require('../models/Attendance');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const {
  DEFAULT_CHART_OF_ACCOUNTS,
  ACCOUNT_TYPES,
  NORMAL_BALANCES,
  REFERENCE_TYPES,
} = require('../config/accounting');

/**
 * Seeds the default Solar Business Chart of Accounts if empty or missing system accounts.
 */
let chartSeedPromise = null;
let chartSeededUntil = 0;

async function seedChartOfAccounts({ force = false } = {}) {
  if (!force && Date.now() < chartSeededUntil) return [];
  if (chartSeedPromise) return chartSeedPromise;

  chartSeedPromise = (async () => {
    const result = await Account.bulkWrite(
      DEFAULT_CHART_OF_ACCOUNTS.map((def) => ({
        updateOne: {
          filter: { code: def.code },
          update: { $setOnInsert: def },
          upsert: true,
        },
      })),
      { ordered: false }
    );

    // Dashboard/report requests often call several accounting helpers at once.
    // Avoid rechecking the same immutable system accounts on every helper call.
    chartSeededUntil = Date.now() + 5 * 60 * 1000;

    const insertedIds = Object.values(result.upsertedIds || {});
    if (insertedIds.length === 0) return [];
    return Account.find({ _id: mongoose.trusted({ $in: insertedIds }) });
  })();

  try {
    return await chartSeedPromise;
  } finally {
    chartSeedPromise = null;
  }
}

/**
 * Generates the next sequential Journal Entry voucher number (e.g. JV-2026-0001).
 * Seeded/imported entries can exist without advancing the counter, so skip any
 * number that is already in use.
 */
async function nextJournalEntryNumber() {
  const year = new Date().getFullYear();
  while (true) {
    const seq = await Counter.next(`journal_entry_${year}`);
    const entryNumber = `JV-${year}-${String(seq).padStart(4, '0')}`;
    if (!(await JournalEntry.exists({ entryNumber }))) return entryNumber;
  }
}

/**
 * Generates the next sequential Expense Voucher number (e.g. EXP-2026-0001).
 */
async function nextExpenseVoucherNumber() {
  const year = new Date().getFullYear();
  while (true) {
    const seq = await Counter.next(`expense_${year}`);
    const voucherNumber = `EXP-${year}-${String(seq).padStart(4, '0')}`;
    if (!(await Expense.exists({ voucherNumber }))) return voucherNumber;
  }
}

/**
 * Look up an account by its code, throwing an ApiError if missing.
 */
async function getAccountOrThrow(code) {
  let account = await Account.findOne({ code, isActive: true, deletedAt: null });
  if (!account) {
    // If system account is missing, ensure COA is seeded
    await seedChartOfAccounts({ force: true });
    account = await Account.findOne({ code, isActive: true, deletedAt: null });
    if (!account) {
      throw ApiError.badRequest(`System account with code "${code}" does not exist.`);
    }
  }
  return account;
}

/**
 * Core method: Creates and validates an atomic double-entry JournalEntry.
 *
 * Invariant: Sum of line debits MUST equal sum of line credits down to the exact paisa.
 */
async function createJournalEntry(
  { date = new Date(), memo, referenceType, referenceId = null, lines, actor = null },
  { session = null, req = null } = {}
) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw ApiError.badRequest('A journal entry must contain at least 2 lines.');
  }

  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;
  const hydratedLines = [];

  for (const line of lines) {
    let account = null;
    if (line.account && mongoose.isValidObjectId(line.account)) {
      account = await Account.findById(line.account).session(session);
    } else if (line.accountCode) {
      account = await Account.findOne({ code: line.accountCode }).session(session);
    }

    if (!account) {
      throw ApiError.badRequest(`Account not found for line: ${line.accountCode || line.account}`);
    }

    const debit = Math.round(Number(line.debitPaisa) || 0);
    const credit = Math.round(Number(line.creditPaisa) || 0);

    if (debit < 0 || credit < 0) {
      throw ApiError.badRequest('Debit and credit amounts cannot be negative.');
    }
    if (debit === 0 && credit === 0) {
      throw ApiError.badRequest(`Line for account ${account.code} must have a non-zero debit or credit.`);
    }

    totalDebitPaisa += debit;
    totalCreditPaisa += credit;

    hydratedLines.push({
      account: account._id,
      accountCode: account.code,
      accountName: account.name,
      debitPaisa: debit,
      creditPaisa: credit,
      description: line.description || '',
    });
  }

  if (totalDebitPaisa !== totalCreditPaisa) {
    throw ApiError.badRequest(
      `Double-entry balance violation: Total Debits (PKR ${totalDebitPaisa / 100}) must equal Total Credits (PKR ${totalCreditPaisa / 100}). Difference: PKR ${(totalDebitPaisa - totalCreditPaisa) / 100}.`
    );
  }

  if (totalDebitPaisa <= 0) {
    throw ApiError.badRequest('Journal entry amount must be greater than zero.');
  }

  const entryNumber = await nextJournalEntryNumber();

  const entryDoc = new JournalEntry({
    entryNumber,
    date,
    referenceType,
    referenceId,
    memo,
    lines: hydratedLines,
    totalDebitPaisa,
    totalCreditPaisa,
    createdBy: actor ? actor._id : null,
  });

  await entryDoc.save({ session });

  if (actor) {
    await logAction(
      actor,
      AUDIT_ACTIONS.JOURNAL_ENTRY_POSTED,
      'journal_entries',
      entryDoc._id,
      null,
      { entryNumber, totalDebitPaisa, referenceType, memo },
      {
        description: `Posted ${entryNumber} for ${referenceType}: ${memo} (PKR ${totalDebitPaisa / 100})`,
        ip: req ? req.ip : null,
        userAgent: req ? req.get('user-agent') : null,
      }
    );
  }

  return entryDoc;
}

/* -------------------------------------------------------------------------- */
/* Auto-Posting Triggers                                                       */
/* -------------------------------------------------------------------------- */

/**
 * 1. Sale Approval Auto-Post:
 *    Debit 1030 (Accounts Receivable - Customers)   [sale.amountPaisa]
 *    Credit 4010 (Solar System Revenue)             [sale.amountPaisa]
 *
 *    If hardware cost snapshot exists (> 0):
 *    Debit 5010 (COGS - Solar Hardware)             [sale.totalCostPaisa]
 *    Credit 1040 (Inventory Asset)                  [sale.totalCostPaisa]
 */
async function postSaleApproval(sale, actor, req) {
  if (!sale || !sale.amountPaisa) return null;

  const lines = [
    {
      accountCode: '1030',
      debitPaisa: sale.amountPaisa,
      creditPaisa: 0,
      description: `Contract receivable for Sale ${sale.saleNumber}`,
    },
    {
      accountCode: '4010',
      debitPaisa: 0,
      creditPaisa: sale.amountPaisa,
      description: `Revenue recognized for Solar Sale ${sale.saleNumber}`,
    },
  ];

  if (sale.totalCostPaisa && sale.totalCostPaisa > 0) {
    lines.push(
      {
        accountCode: '5010',
        debitPaisa: sale.totalCostPaisa,
        creditPaisa: 0,
        description: `COGS recognized for Sale ${sale.saleNumber}`,
      },
      {
        accountCode: '1040',
        debitPaisa: 0,
        creditPaisa: sale.totalCostPaisa,
        description: `Inventory reduction for Sale ${sale.saleNumber}`,
      }
    );
  }

  return createJournalEntry(
    {
      date: new Date(),
      memo: `Sale Approved & Contract Issued: ${sale.saleNumber}`,
      referenceType: REFERENCE_TYPES.SALE,
      referenceId: sale._id,
      lines,
      actor,
    },
    { req }
  );
}

/**
 * 2. Customer Installment & Down Payment Auto-Post:
 *    Debit 1010 (Cash in Hand) or 1020 (Bank)       [payment.amountPaisa]
 *    Credit 1030 (Accounts Receivable - Customers)  [principalPaidPaisa]
 *    Credit 4030 (Late Fee Income)                  [lateFeePaidPaisa, if any]
 */
async function postCustomerPayment(payment, actor, req) {
  if (!payment || !payment.amountPaisa) return null;

  const isCash = String(payment.method || '').toLowerCase() === 'cash';
  const paymentAccountCode = isCash ? '1010' : '1020';

  const lateFeePaisa = Math.round(Number(payment.lateFeePaidPaisa) || 0);
  const principalPaisa = payment.amountPaisa - lateFeePaisa;

  const lines = [
    {
      accountCode: paymentAccountCode,
      debitPaisa: payment.amountPaisa,
      creditPaisa: 0,
      description: `Payment collected via ${payment.method || 'cash'} (${payment.receiptNumber || 'Receipt'})`,
    },
    {
      accountCode: '1030',
      debitPaisa: 0,
      creditPaisa: principalPaisa,
      description: `AR reduction for receipt ${payment.receiptNumber || ''}`,
    },
  ];

  if (lateFeePaisa > 0) {
    lines.push({
      accountCode: '4030',
      debitPaisa: 0,
      creditPaisa: lateFeePaisa,
      description: `Late payment fee collected (${payment.receiptNumber})`,
    });
  }

  return createJournalEntry(
    {
      date: payment.paymentDate || new Date(),
      memo: `Customer Payment Received: ${payment.receiptNumber} (${payment.method || 'cash'})`,
      referenceType: REFERENCE_TYPES.PAYMENT,
      referenceId: payment._id,
      lines,
      actor,
    },
    { req }
  );
}

/**
 * 3. Purchase GRN Receipt Auto-Post:
 *    Debit 1040 (Inventory Asset)                  [purchase.totalPaisa]
 *    Credit 2010 (Accounts Payable - Suppliers)    [purchase.totalPaisa]
 */
async function postPurchaseReceipt(purchase, actor, req) {
  if (!purchase || !purchase.totalPaisa) return null;

  const lines = [
    {
      accountCode: '1040',
      debitPaisa: purchase.totalPaisa,
      creditPaisa: 0,
      description: `Inventory received on PO ${purchase.purchaseNumber}`,
    },
    {
      accountCode: '2010',
      debitPaisa: 0,
      creditPaisa: purchase.totalPaisa,
      description: `Supplier bill payable for PO ${purchase.purchaseNumber}`,
    },
  ];

  return createJournalEntry(
    {
      date: new Date(),
      memo: `Goods Received Note (GRN): PO ${purchase.purchaseNumber}`,
      referenceType: REFERENCE_TYPES.PURCHASE,
      referenceId: purchase._id,
      lines,
      actor,
    },
    { req }
  );
}

/**
 * 4. Supplier Payment Auto-Post:
 *    Debit 2010 (Accounts Payable - Suppliers)     [amountPaisa]
 *    Credit 1010 (Cash) or 1020 (Bank)             [amountPaisa]
 */
async function postSupplierPayment(
  { supplierId, amountPaisa, paymentAccountCode = '1020', reference = '', notes = '' },
  actor,
  req
) {
  const supplier = await Supplier.findById(supplierId);
  if (!supplier) throw ApiError.notFound('Supplier not found.');

  const parsedAmount = Math.round(Number(amountPaisa));
  if (!parsedAmount || parsedAmount <= 0) {
    throw ApiError.badRequest('Payment amount must be greater than zero.');
  }

  const lines = [
    {
      accountCode: '2010',
      debitPaisa: parsedAmount,
      creditPaisa: 0,
      description: `Payment to supplier ${supplier.name} ${reference ? '(' + reference + ')' : ''}`,
    },
    {
      accountCode: paymentAccountCode,
      debitPaisa: 0,
      creditPaisa: parsedAmount,
      description: `Disbursement from ${paymentAccountCode === '1010' ? 'Cash in Hand' : 'Bank Alfalah'}`,
    },
  ];

  const memo = `Supplier Payment: ${supplier.name} (PKR ${(parsedAmount / 100).toLocaleString()}) ${notes || ''}`.trim();

  const jv = await createJournalEntry(
    {
      date: new Date(),
      memo,
      referenceType: REFERENCE_TYPES.SUPPLIER_PAYMENT,
      referenceId: supplier._id,
      lines,
      actor,
    },
    { req }
  );

  await logAction(
    actor,
    AUDIT_ACTIONS.SUPPLIER_PAYMENT_POSTED,
    'suppliers',
    supplier._id,
    null,
    { amountPaisa: parsedAmount, paymentAccountCode, reference },
    {
      description: `Paid PKR ${parsedAmount / 100} to ${supplier.name} via ${paymentAccountCode}`,
      ip: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
    }
  );

  return jv;
}

/**
 * 5. Operating Expense Auto-Post:
 *    Creates an Expense voucher and posts:
 *    Debit Category Account (6010 - 6060)           [amountPaisa]
 *    Credit Payment Account (1010 Cash or 1020 Bank) [amountPaisa]
 */
async function postExpense(
  {
    categoryAccountCode,
    paymentAccountCode = '1010',
    amountPaisa,
    payee,
    notes = '',
    receiptAttachment = null,
    date = new Date(),
    branch = null,
  },
  actor,
  req
) {
  const [categoryAcc, paymentAcc] = await Promise.all([
    getAccountOrThrow(categoryAccountCode),
    getAccountOrThrow(paymentAccountCode),
  ]);

  const parsedAmount = Math.round(Number(amountPaisa));
  if (!parsedAmount || parsedAmount <= 0) {
    throw ApiError.badRequest('Expense amount must be greater than zero.');
  }
  if (!payee || !payee.trim()) {
    throw ApiError.badRequest('Payee name is required.');
  }

  const voucherNumber = await nextExpenseVoucherNumber();

  // Branch attribution is optional. A blank value keeps legacy behaviour and
  // is treated as a main-branch expense by daily closing.
  let branchId = null;
  if (branch) {
    if (!mongoose.isValidObjectId(branch)) {
      throw ApiError.badRequest('Select a valid branch for this expense.');
    }
    branchId = branch;
  }

  const lines = [
    {
      account: categoryAcc._id,
      accountCode: categoryAcc.code,
      accountName: categoryAcc.name,
      debitPaisa: parsedAmount,
      creditPaisa: 0,
      description: `Expense voucher ${voucherNumber} paid to ${payee}`,
    },
    {
      account: paymentAcc._id,
      accountCode: paymentAcc.code,
      accountName: paymentAcc.name,
      debitPaisa: 0,
      creditPaisa: parsedAmount,
      description: `Paid via ${paymentAcc.name} to ${payee}`,
    },
  ];

  const memo = `Expense [${voucherNumber}]: ${categoryAcc.name} - ${payee} (${notes || 'Voucher'})`;

  const jv = await createJournalEntry(
    {
      date,
      memo,
      referenceType: REFERENCE_TYPES.EXPENSE,
      lines,
      actor,
    },
    { req }
  );

  const expense = await Expense.create({
    voucherNumber,
    date,
    branch: branchId,
    categoryAccount: categoryAcc._id,
    paymentAccount: paymentAcc._id,
    amountPaisa: parsedAmount,
    payee: payee.trim(),
    notes: (notes || '').trim(),
    receiptAttachment,
    journalEntry: jv._id,
    recordedBy: actor ? actor._id : null,
  });

  // Link referenceId in journal entry
  jv.referenceId = expense._id;
  await jv.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.EXPENSE_CREATED,
    'expenses',
    expense._id,
    null,
    { voucherNumber, amountPaisa: parsedAmount, payee, categoryAccountCode },
    {
      description: `Expense voucher ${voucherNumber} recorded for PKR ${parsedAmount / 100} to ${payee}`,
      ip: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
    }
  );

  return expense;
}

/**
 * 6. Salary Disbursement Auto-Post:
 *    Debit 6010 (Salaries & Staff Wages Expense)    [amountPaisa]
 *    Credit 1010 (Cash) or 1020 (Bank)             [amountPaisa]
 */
async function postSalaryDisbursement(
  { employeeId, amountPaisa, paymentAccountCode = '1020', notes = '', date = new Date() },
  actor,
  req
) {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found.');

  const parsedAmount = Math.round(Number(amountPaisa));
  if (!parsedAmount || parsedAmount <= 0) {
    throw ApiError.badRequest('Salary disbursement amount must be greater than zero.');
  }

  const lines = [
    {
      accountCode: '6010',
      debitPaisa: parsedAmount,
      creditPaisa: 0,
      description: `Salary disbursed to ${employee.name} (${employee.employeeCode || ''})`,
    },
    {
      accountCode: paymentAccountCode,
      debitPaisa: 0,
      creditPaisa: parsedAmount,
      description: `Salary payment from ${paymentAccountCode === '1010' ? 'Cash in Hand' : 'Bank Alfalah'}`,
    },
  ];

  const memo = `Salary Payout: ${employee.name} (PKR ${(parsedAmount / 100).toLocaleString()}) ${notes || ''}`.trim();

  const jv = await createJournalEntry(
    {
      date,
      memo,
      referenceType: REFERENCE_TYPES.SALARY,
      referenceId: employee._id,
      lines,
      actor,
    },
    { req }
  );

  await logAction(
    actor,
    AUDIT_ACTIONS.SALARY_DISBURSED,
    'employees',
    employee._id,
    null,
    { amountPaisa: parsedAmount, paymentAccountCode },
    {
      description: `Salary disbursed to ${employee.name}: PKR ${parsedAmount / 100}`,
      ip: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
    }
  );

  return jv;
}

/**
 * 7. Sales Commission Payout Auto-Post:
 *    Debit 6020 (Sales Commission Expense)          [amountPaisa]
 *    Credit 1010 (Cash) or 1020 (Bank)             [amountPaisa]
 */
async function postCommissionPayout(
  { employeeId, amountPaisa, paymentAccountCode = '1020', notes = '', date = new Date() },
  actor,
  req
) {
  const employee = await Employee.findById(employeeId);
  if (!employee) throw ApiError.notFound('Employee not found.');

  const parsedAmount = Math.round(Number(amountPaisa));
  if (!parsedAmount || parsedAmount <= 0) {
    throw ApiError.badRequest('Commission payout amount must be greater than zero.');
  }

  const lines = [
    {
      accountCode: '6020',
      debitPaisa: parsedAmount,
      creditPaisa: 0,
      description: `Sales commission paid to ${employee.name}`,
    },
    {
      accountCode: paymentAccountCode,
      debitPaisa: 0,
      creditPaisa: parsedAmount,
      description: `Commission paid via ${paymentAccountCode === '1010' ? 'Cash' : 'Bank'}`,
    },
  ];

  const memo = `Sales Commission Paid: ${employee.name} (PKR ${(parsedAmount / 100).toLocaleString()}) ${notes || ''}`.trim();

  const jv = await createJournalEntry(
    {
      date,
      memo,
      referenceType: REFERENCE_TYPES.COMMISSION,
      referenceId: employee._id,
      lines,
      actor,
    },
    { req }
  );

  await logAction(
    actor,
    AUDIT_ACTIONS.COMMISSION_DISBURSED,
    'employees',
    employee._id,
    null,
    { amountPaisa: parsedAmount, paymentAccountCode },
    {
      description: `Commission paid to ${employee.name}: PKR ${parsedAmount / 100}`,
      ip: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
    }
  );

  return jv;
}

/**
 * 8. Service & Repair Charge Auto-Post:
 *    Debit 1010 (Cash) or 1020 (Bank) or 1030 (AR)  [amountPaisa]
 *    Credit 4020 (Service & Maintenance Income)     [amountPaisa]
 */
async function postServiceCharge(
  { customerId, amountPaisa, paymentAccountCode = '1010', notes = '', complaintId = null },
  actor,
  req
) {
  const customer = await Customer.findById(customerId);
  if (!customer) throw ApiError.notFound('Customer not found.');

  const parsedAmount = Math.round(Number(amountPaisa));
  if (!parsedAmount || parsedAmount <= 0) return null;

  const lines = [
    {
      accountCode: paymentAccountCode,
      debitPaisa: parsedAmount,
      creditPaisa: 0,
      description: `Service charges collected from ${customer.name}`,
    },
    {
      accountCode: '4020',
      debitPaisa: 0,
      creditPaisa: parsedAmount,
      description: `Maintenance & repair income from ticket ${notes || ''}`,
    },
  ];

  return createJournalEntry(
    {
      date: new Date(),
      memo: `After-Sales Service Fee: ${customer.name} (PKR ${(parsedAmount / 100).toLocaleString()})`,
      referenceType: REFERENCE_TYPES.SERVICE_CHARGE,
      referenceId: complaintId || customer._id,
      lines,
      actor,
    },
    { req }
  );
}

/* -------------------------------------------------------------------------- */
/* Financial Reporting Engines                                                */
/* -------------------------------------------------------------------------- */

/**
 * Generates the Trial Balance as of a given cut-off date.
 * Verifies that Total Debits == Total Credits.
 */
async function getTrialBalance({ asOfDate = new Date() } = {}) {
  await seedChartOfAccounts();
  const targetDate = new Date(asOfDate);
  targetDate.setHours(23, 59, 59, 999);

  const accounts = await Account.find({ isActive: true, deletedAt: null }).sort({ code: 1 });

  // Aggregate line balances from journal entries up to targetDate
  const lineAgg = await JournalEntry.aggregate([
    {
      $match: {
        date: { $lte: targetDate },
        deletedAt: null,
      },
    },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.accountCode',
        totalDebitPaisa: { $sum: '$lines.debitPaisa' },
        totalCreditPaisa: { $sum: '$lines.creditPaisa' },
      },
    },
  ]);

  const aggMap = new Map();
  for (const row of lineAgg) {
    aggMap.set(row._id, row);
  }

  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;

  const rows = accounts.map((acc) => {
    const agg = aggMap.get(acc.code) || { totalDebitPaisa: 0, totalCreditPaisa: 0 };
    const rawDebit = agg.totalDebitPaisa;
    const rawCredit = agg.totalCreditPaisa;

    let netDebitPaisa = 0;
    let netCreditPaisa = 0;

    if (acc.normalBalance === NORMAL_BALANCES.DEBIT) {
      const balance = rawDebit - rawCredit;
      if (balance >= 0) {
        netDebitPaisa = balance;
      } else {
        netCreditPaisa = Math.abs(balance);
      }
    } else {
      const balance = rawCredit - rawDebit;
      if (balance >= 0) {
        netCreditPaisa = balance;
      } else {
        netDebitPaisa = Math.abs(balance);
      }
    }

    totalDebitPaisa += netDebitPaisa;
    totalCreditPaisa += netCreditPaisa;

    return {
      _id: acc._id,
      code: acc.code,
      name: acc.name,
      type: acc.type,
      normalBalance: acc.normalBalance,
      rawDebitPaisa: rawDebit,
      rawCreditPaisa: rawCredit,
      debitBalancePaisa: netDebitPaisa,
      creditBalancePaisa: netCreditPaisa,
    };
  });

  const isBalanced = totalDebitPaisa === totalCreditPaisa;
  const differencePaisa = totalDebitPaisa - totalCreditPaisa;

  return {
    asOfDate: targetDate,
    rows,
    totalDebitPaisa,
    totalCreditPaisa,
    isBalanced,
    differencePaisa,
  };
}

/**
 * Generates the Profit & Loss Statement (Income Statement) for a date range.
 *
 * Revenue (4000s)
 * - COGS (5000s)
 * = Gross Profit
 * - Operating Expenses (6000s)
 * = Net Profit
 */
async function getProfitAndLoss({ fromDate = null, toDate = null } = {}) {
  await seedChartOfAccounts();

  const filter = { deletedAt: null };
  const dateQuery = {};
  if (fromDate) dateQuery.$gte = new Date(new Date(fromDate).setHours(0, 0, 0, 0));
  if (toDate) dateQuery.$lte = new Date(new Date(toDate).setHours(23, 59, 59, 999));
  if (Object.keys(dateQuery).length) filter.date = dateQuery;

  const accounts = await Account.find({
    type: { $in: [ACCOUNT_TYPES.INCOME, ACCOUNT_TYPES.EXPENSE] },
    isActive: true,
    deletedAt: null,
  }).sort({ code: 1 });

  const lineAgg = await JournalEntry.aggregate([
    { $match: filter },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.accountCode',
        totalDebitPaisa: { $sum: '$lines.debitPaisa' },
        totalCreditPaisa: { $sum: '$lines.creditPaisa' },
      },
    },
  ]);

  const aggMap = new Map();
  for (const row of lineAgg) {
    aggMap.set(row._id, row);
  }

  const incomeItems = [];
  const cogsItems = [];
  const operatingExpenseItems = [];

  let totalIncomePaisa = 0;
  let totalCogsPaisa = 0;
  let totalOperatingExpensePaisa = 0;

  for (const acc of accounts) {
    const agg = aggMap.get(acc.code) || { totalDebitPaisa: 0, totalCreditPaisa: 0 };

    if (acc.type === ACCOUNT_TYPES.INCOME) {
      // Income increases with Credit
      const netIncomePaisa = agg.totalCreditPaisa - agg.totalDebitPaisa;
      incomeItems.push({
        code: acc.code,
        name: acc.name,
        amountPaisa: netIncomePaisa,
      });
      totalIncomePaisa += netIncomePaisa;
    } else if (acc.type === ACCOUNT_TYPES.EXPENSE) {
      // Expense increases with Debit
      const netExpensePaisa = agg.totalDebitPaisa - agg.totalCreditPaisa;
      if (acc.subtype === 'cogs' || acc.code.startsWith('5')) {
        cogsItems.push({
          code: acc.code,
          name: acc.name,
          amountPaisa: netExpensePaisa,
        });
        totalCogsPaisa += netExpensePaisa;
      } else {
        operatingExpenseItems.push({
          code: acc.code,
          name: acc.name,
          amountPaisa: netExpensePaisa,
        });
        totalOperatingExpensePaisa += netExpensePaisa;
      }
    }
  }

  const grossProfitPaisa = totalIncomePaisa - totalCogsPaisa;
  const grossMarginPercent =
    totalIncomePaisa > 0 ? ((grossProfitPaisa / totalIncomePaisa) * 100).toFixed(1) : 0;

  const netProfitPaisa = grossProfitPaisa - totalOperatingExpensePaisa;
  const netMarginPercent =
    totalIncomePaisa > 0 ? ((netProfitPaisa / totalIncomePaisa) * 100).toFixed(1) : 0;

  return {
    fromDate: fromDate ? new Date(fromDate) : null,
    toDate: toDate ? new Date(toDate) : null,
    incomeItems,
    totalIncomePaisa,
    cogsItems,
    totalCogsPaisa,
    grossProfitPaisa,
    grossMarginPercent: Number(grossMarginPercent),
    operatingExpenseItems,
    totalOperatingExpensePaisa,
    netProfitPaisa,
    netMarginPercent: Number(netMarginPercent),
  };
}

/**
 * Generates the Cash Book ledger (Account 1010 - Cash in Hand).
 * Computes opening balance, chronological ins/outs, and closing balance.
 */
async function getCashBook({ fromDate = null, toDate = null } = {}) {
  return getAccountBook('1010', { fromDate, toDate });
}

/**
 * Generates the Bank Book ledger (Account 1020 - Bank Alfalah).
 * Computes opening balance, chronological ins/outs, and closing balance.
 */
async function getBankBook({ fromDate = null, toDate = null } = {}) {
  return getAccountBook('1020', { fromDate, toDate });
}

/**
 * Internal helper: Generates ledger book for a specific account code.
 */
async function getAccountBook(accountCode, { fromDate = null, toDate = null } = {}) {
  await seedChartOfAccounts();
  const account = await Account.findOne({ code: accountCode });
  if (!account) throw ApiError.notFound(`Account ${accountCode} not found.`);

  const start = fromDate ? new Date(new Date(fromDate).setHours(0, 0, 0, 0)) : null;
  const end = toDate ? new Date(new Date(toDate).setHours(23, 59, 59, 999)) : null;

  // 1. Calculate opening balance before start date
  let openingBalancePaisa = 0;
  if (start) {
    const priorAgg = await JournalEntry.aggregate([
      {
        $match: {
          date: { $lt: start },
          deletedAt: null,
          'lines.accountCode': accountCode,
        },
      },
      { $unwind: '$lines' },
      { $match: { 'lines.accountCode': accountCode } },
      {
        $group: {
          _id: null,
          totalDebit: { $sum: '$lines.debitPaisa' },
          totalCredit: { $sum: '$lines.creditPaisa' },
        },
      },
    ]);

    if (priorAgg.length > 0) {
      const isDebitNormal = account.normalBalance === NORMAL_BALANCES.DEBIT;
      openingBalancePaisa = isDebitNormal
        ? priorAgg[0].totalDebit - priorAgg[0].totalCredit
        : priorAgg[0].totalCredit - priorAgg[0].totalDebit;
    }
  }

  // 2. Fetch journal entries in period
  const matchFilter = {
    deletedAt: null,
    'lines.accountCode': accountCode,
  };
  const dateQuery = {};
  if (start) dateQuery.$gte = start;
  if (end) dateQuery.$lte = end;
  if (Object.keys(dateQuery).length) matchFilter.date = dateQuery;

  const entries = await JournalEntry.find(matchFilter).sort({ date: 1, createdAt: 1 }).lean();

  let runningBalancePaisa = openingBalancePaisa;
  let periodDebitPaisa = 0;
  let periodCreditPaisa = 0;

  const transactions = [];

  for (const entry of entries) {
    const line = entry.lines.find((l) => l.accountCode === accountCode);
    if (!line) continue;

    const debit = line.debitPaisa || 0;
    const credit = line.creditPaisa || 0;

    periodDebitPaisa += debit;
    periodCreditPaisa += credit;

    if (account.normalBalance === NORMAL_BALANCES.DEBIT) {
      runningBalancePaisa += debit - credit;
    } else {
      runningBalancePaisa += credit - debit;
    }

    transactions.push({
      _id: entry._id,
      entryNumber: entry.entryNumber,
      date: entry.date,
      referenceType: entry.referenceType,
      memo: entry.memo,
      description: line.description || entry.memo,
      debitPaisa: debit,
      creditPaisa: credit,
      runningBalancePaisa,
    });
  }

  return {
    account,
    fromDate: start,
    toDate: end,
    openingBalancePaisa,
    transactions,
    periodDebitPaisa,
    periodCreditPaisa,
    closingBalancePaisa: runningBalancePaisa,
  };
}

/**
 * Generates the Daily Closing Reconciliation Sheet for a particular day.
 * Reconciles cash drawer receipts, disbursements, and physical count.
 */
async function getDailyClosing({ date = new Date() } = {}) {
  const targetDate = new Date(date);
  const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
  const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

  const [cashBook, bankBook] = await Promise.all([
    getCashBook({ fromDate: startOfDay, toDate: endOfDay }),
    getBankBook({ fromDate: startOfDay, toDate: endOfDay }),
  ]);

  // Aggregate breakdown of today's cash collections
  const todayCashSalesPaisa = cashBook.transactions
    .filter((t) => t.referenceType === REFERENCE_TYPES.SALE || t.referenceType === REFERENCE_TYPES.PAYMENT)
    .reduce((sum, t) => sum + t.debitPaisa, 0);

  const todayCashExpensesPaisa = cashBook.transactions
    .filter((t) => t.referenceType === REFERENCE_TYPES.EXPENSE)
    .reduce((sum, t) => sum + t.creditPaisa, 0);

  const todayCashWagesPaisa = cashBook.transactions
    .filter((t) => t.referenceType === REFERENCE_TYPES.SALARY || t.referenceType === REFERENCE_TYPES.COMMISSION)
    .reduce((sum, t) => sum + t.creditPaisa, 0);

  const otherDisbursementsPaisa =
    cashBook.periodCreditPaisa - todayCashExpensesPaisa - todayCashWagesPaisa;

  return {
    date: startOfDay,
    cash: {
      openingBalancePaisa: cashBook.openingBalancePaisa,
      collectionsPaisa: cashBook.periodDebitPaisa,
      todaySalesPaisa: todayCashSalesPaisa,
      disbursementsPaisa: cashBook.periodCreditPaisa,
      expensesPaisa: todayCashExpensesPaisa,
      wagesPaisa: todayCashWagesPaisa,
      otherDisbursementsPaisa: Math.max(0, otherDisbursementsPaisa),
      expectedClosingBalancePaisa: cashBook.closingBalancePaisa,
      transactions: cashBook.transactions,
    },
    bank: {
      openingBalancePaisa: bankBook.openingBalancePaisa,
      depositsPaisa: bankBook.periodDebitPaisa,
      disbursementsPaisa: bankBook.periodCreditPaisa,
      closingBalancePaisa: bankBook.closingBalancePaisa,
      transactions: bankBook.transactions,
    },
  };
}

/**
 * Generates the Monthly Salary & Commission Disbursement Sheet.
 */
async function getSalaryCommissionSheet({ month = null, year = null } = {}) {
  const now = new Date();
  const m = month !== null ? Number(month) : now.getMonth();
  const y = year !== null ? Number(year) : now.getFullYear();

  const startOfMonth = new Date(y, m, 1, 0, 0, 0, 0);
  const endOfMonth = new Date(y, m + 1, 0, 23, 59, 59, 999);

  const employees = await Employee.find({ isActive: true, deletedAt: null })
    .populate('user', 'role name email')
    .sort({ name: 1 })
    .lean();

  // Find disbursements already made this month
  const jvDisbursements = await JournalEntry.find({
    date: { $gte: startOfMonth, $lte: endOfMonth },
    referenceType: { $in: [REFERENCE_TYPES.SALARY, REFERENCE_TYPES.COMMISSION] },
    deletedAt: null,
  }).lean();

  // Find attendance counts this month
  const attendanceAgg = await Attendance.aggregate([
    {
      $match: {
        date: { $gte: startOfMonth, $lte: endOfMonth },
        status: { $in: ['present', 'late', 'half_day'] },
      },
    },
    {
      $group: {
        _id: '$employee',
        presentDays: {
          $sum: {
            $cond: [{ $eq: ['$status', 'half_day'] }, 0.5, 1],
          },
        },
      },
    },
  ]);

  const attMap = new Map();
  for (const att of attendanceAgg) {
    attMap.set(String(att._id), att.presentDays);
  }

  // Find won sales this month for commission calculation
  const wonSales = await Sale.find({
    status: { $in: ['confirmed', 'approved', 'in_progress', 'completed'] },
    createdAt: { $gte: startOfMonth, $lte: endOfMonth },
    deletedAt: null,
  }).lean();

  const rows = employees.map((emp) => {
    const empIdStr = String(emp._id);
    const userIdStr = emp.user ? String(emp.user._id) : null;

    const baseSalaryPaisa = emp.salaryPaisa || emp.baseSalaryPaisa || 0;
    const presentDays = attMap.get(empIdStr) || 26; // default 26 if no attendance system used

    // Commission earned this month
    let commissionEarnedPaisa = 0;
    let wonSalesCount = 0;
    let wonSalesVolumePaisa = 0;

    if (emp.commissionRateBps && emp.commissionRateBps > 0 && userIdStr) {
      for (const s of wonSales) {
        if (String(s.assignedTo) === userIdStr) {
          wonSalesCount++;
          wonSalesVolumePaisa += s.amountPaisa;
          commissionEarnedPaisa += Math.round((s.amountPaisa * emp.commissionRateBps) / 10000);
        }
      }
    }

    const totalEarnedPaisa = baseSalaryPaisa + commissionEarnedPaisa;

    // Disbursed so far
    let disbursedPaisa = 0;
    for (const jv of jvDisbursements) {
      if (String(jv.referenceId) === empIdStr) {
        disbursedPaisa += jv.totalDebitPaisa;
      }
    }

    const netPayablePaisa = totalEarnedPaisa - disbursedPaisa;

    return {
      _id: emp._id,
      name: emp.user ? emp.user.name : (emp.name || 'Staff Member'),
      employeeCode: emp.user ? emp.user.email : 'EMP',
      designation: emp.designation,
      baseSalaryPaisa,
      presentDays,
      wonSalesCount,
      wonSalesVolumePaisa,
      commissionRateBps: emp.commissionRateBps || 0,
      commissionEarnedPaisa,
      totalEarnedPaisa,
      disbursedPaisa,
      netPayablePaisa,
    };
  });

  return {
    month: m,
    year: y,
    periodLabel: new Intl.DateTimeFormat('en-PK', { month: 'long', year: 'numeric' }).format(startOfMonth),
    rows,
    totalBaseSalaryPaisa: rows.reduce((s, r) => s + r.baseSalaryPaisa, 0),
    totalCommissionPaisa: rows.reduce((s, r) => s + r.commissionEarnedPaisa, 0),
    totalEarnedPaisa: rows.reduce((s, r) => s + r.totalEarnedPaisa, 0),
    totalDisbursedPaisa: rows.reduce((s, r) => s + r.disbursedPaisa, 0),
    totalNetPayablePaisa: rows.reduce((s, r) => s + r.netPayablePaisa, 0),
  };
}

/**
 * Generates Accounts Receivable Customer Balances and Aging.
 */
async function getReceivablesList() {
  const sales = await Sale.find({
    status: { $ne: 'cancelled' },
    deletedAt: null,
  })
    .populate('customer', 'name code phone city area address')
    .lean();

  const customerMap = new Map();

  for (const s of sales) {
    if (!s.customer) continue;
    const cid = String(s.customer._id);
    if (!customerMap.has(cid)) {
      customerMap.set(cid, {
        customer: s.customer,
        totalBilledPaisa: 0,
        totalPaidPaisa: 0,
        balanceDuePaisa: 0,
        salesCount: 0,
        oldestUnpaidDate: null,
      });
    }

    const entry = customerMap.get(cid);
    entry.totalBilledPaisa += s.amountPaisa;
    entry.totalPaidPaisa += s.amountPaidPaisa || 0;
    const due = s.amountPaisa - (s.amountPaidPaisa || 0);
    entry.balanceDuePaisa += due;
    entry.salesCount++;

    if (due > 0 && (!entry.oldestUnpaidDate || s.createdAt < entry.oldestUnpaidDate)) {
      entry.oldestUnpaidDate = s.createdAt;
    }
  }

  const now = Date.now();
  const rows = [];
  let totalReceivablePaisa = 0;

  for (const entry of customerMap.values()) {
    if (entry.balanceDuePaisa > 0) {
      totalReceivablePaisa += entry.balanceDuePaisa;
      const daysOverdue = entry.oldestUnpaidDate
        ? Math.max(0, Math.floor((now - new Date(entry.oldestUnpaidDate).getTime()) / 86400000))
        : 0;

      rows.push({
        customer: entry.customer,
        totalBilledPaisa: entry.totalBilledPaisa,
        totalPaidPaisa: entry.totalPaidPaisa,
        balanceDuePaisa: entry.balanceDuePaisa,
        daysOverdue,
      });
    }
  }

  rows.sort((a, b) => b.balanceDuePaisa - a.balanceDuePaisa);

  return {
    rows,
    totalReceivablePaisa,
  };
}

/**
 * Generates Accounts Payable Supplier Balances and Aging.
 */
async function getPayablesList() {
  const purchases = await Purchase.find({
    status: { $in: ['received', 'ordered', 'partial'] },
    paymentStatus: { $ne: 'paid' },
    deletedAt: null,
  })
    .populate('supplier', 'name code phone contactPerson')
    .lean();

  const supplierMap = new Map();

  for (const p of purchases) {
    if (!p.supplier) continue;
    const sid = String(p.supplier._id);
    if (!supplierMap.has(sid)) {
      supplierMap.set(sid, {
        supplier: p.supplier,
        totalPurchasesPaisa: 0,
        totalPaidPaisa: 0,
        balanceDuePaisa: 0,
        ordersCount: 0,
        oldestBillDate: null,
      });
    }

    const entry = supplierMap.get(sid);
    entry.totalPurchasesPaisa += p.totalPaisa;
    entry.totalPaidPaisa += p.paidPaisa || 0;
    const due = p.totalPaisa - (p.paidPaisa || 0);
    entry.balanceDuePaisa += due;
    entry.ordersCount++;

    if (due > 0 && (!entry.oldestBillDate || p.createdAt < entry.oldestBillDate)) {
      entry.oldestBillDate = p.createdAt;
    }
  }

  const now = Date.now();
  const rows = [];
  let totalPayablePaisa = 0;

  for (const entry of supplierMap.values()) {
    if (entry.balanceDuePaisa > 0) {
      totalPayablePaisa += entry.balanceDuePaisa;
      const daysOverdue = entry.oldestBillDate
        ? Math.max(0, Math.floor((now - new Date(entry.oldestBillDate).getTime()) / 86400000))
        : 0;

      rows.push({
        supplier: entry.supplier,
        totalPurchasesPaisa: entry.totalPurchasesPaisa,
        totalPaidPaisa: entry.totalPaidPaisa,
        balanceDuePaisa: entry.balanceDuePaisa,
        ordersCount: entry.ordersCount,
        daysOverdue,
      });
    }
  }

  rows.sort((a, b) => b.balanceDuePaisa - a.balanceDuePaisa);

  return {
    rows,
    totalPayablePaisa,
  };
}

/**
 * Financial KPIs for the Accounting Dashboard.
 */
async function getAccountingDashboardStats() {
  await seedChartOfAccounts();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

  const [cashBook, bankBook, pnlMonth, receivables, payables] = await Promise.all([
    getCashBook(),
    getBankBook(),
    getProfitAndLoss({ fromDate: startOfMonth }),
    getReceivablesList(),
    getPayablesList(),
  ]);

  return {
    cashInHandPaisa: cashBook.closingBalancePaisa,
    bankBalancePaisa: bankBook.closingBalancePaisa,
    totalLiquidFundsPaisa: cashBook.closingBalancePaisa + bankBook.closingBalancePaisa,
    totalReceivablesPaisa: receivables.totalReceivablePaisa,
    totalPayablesPaisa: payables.totalPayablePaisa,
    monthRevenuePaisa: pnlMonth.totalIncomePaisa,
    monthCogsPaisa: pnlMonth.totalCogsPaisa,
    monthOperatingExpensePaisa: pnlMonth.totalOperatingExpensePaisa,
    monthNetProfitPaisa: pnlMonth.netProfitPaisa,
    netMarginPercent: pnlMonth.netMarginPercent,
  };
}

module.exports = {
  seedChartOfAccounts,
  nextJournalEntryNumber,
  nextExpenseVoucherNumber,
  getAccountOrThrow,
  createJournalEntry,
  postSaleApproval,
  postCustomerPayment,
  postPurchaseReceipt,
  postSupplierPayment,
  postExpense,
  postSalaryDisbursement,
  postCommissionPayout,
  postServiceCharge,
  getTrialBalance,
  getProfitAndLoss,
  getCashBook,
  getBankBook,
  getDailyClosing,
  getSalaryCommissionSheet,
  getReceivablesList,
  getPayablesList,
  getAccountingDashboardStats,
};
