/**
 * Partner service: equity, profit share and partner cash records.
 *
 * Profit share is calculated from the accounting Profit & Loss statement for
 * the selected period and split by equity using the largest-remainder method,
 * so the partner shares always add up to the profit exactly.
 *
 * Every cash movement (capital in, cash taken, expense paid) also posts a
 * balanced double-entry journal entry, so the cash book, P&L and partner
 * account stay in agreement.
 */
'use strict';

const mongoose = require('mongoose');
const Partner = require('../models/Partner');
const PartnerTransaction = require('../models/PartnerTransaction');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const accountingService = require('./accountingService');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { REFERENCE_TYPES, EXPENSE_CATEGORIES } = require('../config/accounting');
const { escapeRegex, createPagination } = require('../utils/pagination');
const { toPaisa } = require('../utils/money');
const { text, cnic, optionalNumber, percentToBps } = require('../utils/inputs');
const { parseDateKey, todayKey, monthKey } = require('../utils/dates');
const { allocateProfit, equityPercent } = require('../utils/partners');
const {
  PARTNER_TRANSACTION_TYPES,
  PARTNER_TRANSACTION_LABELS,
  PARTNER_PAYMENT_CODES,
} = require('../config/partners');

const MAX_SEARCH_LENGTH = 80;
const TRANSACTION_LIMIT = 200;
const EQUITY_ACCOUNT_CODE = '3010';
const DRAWINGS_ACCOUNT_CODE = '3030';
const DEFAULT_PAYMENT_CODE = '1010';
const DEFAULT_EXPENSE_CODE = '6060';

function isTruthy(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value || '').toLowerCase());
}

function cleanSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LENGTH);
}

/**
 * Turn the query string into a P&L period.
 * Defaults to the current month; `all=1` means all time.
 */
function resolvePeriod({ from, to, all } = {}) {
  if (all === '1' || all === true) {
    return { from: null, to: null, all: true };
  }

  let fromKey = parseDateKey(from) ? from : `${monthKey()}-01`;
  let toKey = parseDateKey(to) ? to : todayKey();
  if (fromKey > toKey) [fromKey, toKey] = [toKey, fromKey];

  return { from: fromKey, to: toKey, all: false };
}

async function nextPartnerCode() {
  const seq = await Counter.next('partner');
  return `PTR-${String(seq).padStart(4, '0')}`;
}

async function nextTransactionReference() {
  const seq = await Counter.next('partner_transaction');
  return `PTX-${String(seq).padStart(4, '0')}`;
}

function parseEquity(value) {
  const percentage = optionalNumber(value);
  if (percentage === null) throw ApiError.badRequest('Enter the partner equity share.');
  if (percentage < 0 || percentage > 100) {
    throw ApiError.badRequest('Equity share must be between 0% and 100%.');
  }
  return percentToBps(percentage);
}

function parseAmount(value) {
  if (value === '' || value === null || value === undefined) {
    throw ApiError.badRequest('Enter an amount.');
  }
  try {
    const paisa = toPaisa(value);
    if (paisa <= 0) throw new Error('invalid');
    return paisa;
  } catch (_err) {
    throw ApiError.badRequest('Enter an amount greater than zero.');
  }
}

function normalizePartnerInput(input = {}) {
  const joinedAt = input.joinedAt
    ? parseDateKey(String(input.joinedAt).slice(0, 10))
    : null;

  return {
    name: text(input.name, 150),
    phone: text(input.phone, 30),
    email: text(input.email, 150).toLowerCase(),
    cnic: cnic(input.cnic),
    address: text(input.address, 300),
    equityBps: parseEquity(input.equity),
    joinedAt: joinedAt || new Date(),
    isActive: isTruthy(input.isActive),
    notes: text(input.notes, 1000),
  };
}

/**
 * Active partners may never hold more than 100% between them.
 * The partner being edited is excluded from the "already assigned" total.
 */
async function assertEquityAvailable(equityBps, excludeId = null) {
  const filter = { isActive: true };
  if (excludeId) filter._id = mongoose.trusted({ $ne: excludeId });

  const others = await Partner.find(filter).select('equityBps name').lean();
  const assigned = others.reduce((sum, partner) => sum + Number(partner.equityBps || 0), 0);
  const remaining = Math.max(0, 10000 - assigned);

  if (equityBps > remaining) {
    throw ApiError.badRequest(
      `Equity cannot exceed 100%. Only ${equityPercent(remaining)}% is unallocated.`
    );
  }
}

async function buildPartnerFilter({ search, status } = {}) {
  const filter = {};

  if (status === 'active') filter.isActive = true;
  else if (status === 'inactive') filter.isActive = false;

  const term = cleanSearch(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    filter.$or = [
      { name: regex },
      { code: regex },
      { phone: regex },
      { email: regex },
      { cnic: regex },
    ];
  }

  return filter;
}

async function paginatePartners({ search, status, page, limit } = {}) {
  const filter = await buildPartnerFilter({ search, status });
  const total = await Partner.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const items = await Partner.find(filter)
    .sort({ isActive: -1, equityBps: -1, name: 1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .lean();

  return { items, total, pagination };
}

async function getPartnerOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Partner not found.');
  const partner = await Partner.findById(id);
  if (!partner) throw ApiError.notFound('Partner not found.');
  return partner;
}

/**
 * Sum of contributions, drawings and partner-paid expenses per partner.
 * @param {Array} partnerIds Optional partner filter.
 * @returns {Promise<Map<string, {contribution:number, drawing:number, expense:number, count:number}>>}
 */
async function getTransactionTotals(partnerIds = null) {
  const match = { deletedAt: null };
  if (partnerIds) match.partner = { $in: partnerIds };

  const rows = await PartnerTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { partner: '$partner', type: '$type' },
        total: { $sum: '$amountPaisa' },
        count: { $sum: 1 },
      },
    },
  ]);

  const map = new Map();
  for (const row of rows) {
    const key = String(row._id.partner);
    if (!map.has(key)) {
      map.set(key, { contribution: 0, drawing: 0, expense: 0, count: 0 });
    }
    const bucket = map.get(key);
    bucket[row._id.type] = Number(row.total || 0);
    bucket.count += Number(row.count || 0);
  }
  return map;
}

function withTotals(bucket = {}) {
  const contributionPaisa = Number(bucket.contribution || 0);
  const drawingPaisa = Number(bucket.drawing || 0);
  const expensePaisa = Number(bucket.expense || 0);

  return {
    contributionPaisa,
    drawingPaisa,
    expensePaisa,
    netPositionPaisa: contributionPaisa + expensePaisa - drawingPaisa,
    transactionCount: Number(bucket.count || 0),
  };
}

async function createPartner(input, actor, req) {
  const data = normalizePartnerInput(input);
  if (!data.name) throw ApiError.badRequest('Partner name is required.');
  if (data.isActive) await assertEquityAvailable(data.equityBps);

  const partner = await Partner.create({
    ...data,
    code: await nextPartnerCode(),
    createdBy: actor ? actor._id : null,
  });

  await logAction(
    actor,
    AUDIT_ACTIONS.PARTNER_CREATED,
    'partners',
    partner._id,
    null,
    {
      code: partner.code,
      name: partner.name,
      equityPercent: partner.equityPercent,
      isActive: partner.isActive,
    },
    { req, description: `Added partner ${partner.name} with ${partner.equityPercent}% equity` }
  );

  return partner;
}

async function updatePartner(id, input, actor, req) {
  const partner = await getPartnerOrThrow(id);
  const before = partner.toObject();
  const data = normalizePartnerInput(input);

  if (!data.name) throw ApiError.badRequest('Partner name is required.');
  if (data.isActive) await assertEquityAvailable(data.equityBps, partner._id);

  Object.assign(partner, data);
  await partner.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.PARTNER_UPDATED,
    'partners',
    partner._id,
    before,
    {
      name: partner.name,
      equityPercent: partner.equityPercent,
      isActive: partner.isActive,
      phone: partner.phone,
      email: partner.email,
    },
    { req, description: `Updated partner ${partner.name}` }
  );

  return partner;
}

async function softDeletePartner(id, actor, req) {
  const partner = await getPartnerOrThrow(id);
  const transactions = await PartnerTransaction.countDocuments({ partner: partner._id });
  if (transactions) {
    throw ApiError.badRequest(
      'This partner has cash records. Mark the partner inactive instead of deleting them.'
    );
  }

  const before = partner.toObject();
  await partner.softDelete(actor ? actor._id : null);

  await logAction(
    actor,
    AUDIT_ACTIONS.PARTNER_DELETED,
    'partners',
    partner._id,
    before,
    { deletedAt: partner.deletedAt },
    { req, description: `Deleted partner ${partner.name}` }
  );

  return partner;
}

/** Partner list plus equity total, period P&L and each partner's profit share. */
async function getPartnersOverview(period = {}) {
  const resolved = resolvePeriod(period);

  const [partners, totals, pnl] = await Promise.all([
    Partner.find().sort({ isActive: -1, equityBps: -1, name: 1 }).lean(),
    getTransactionTotals(),
    accountingService.getProfitAndLoss({
      fromDate: resolved.all ? null : parseDateKey(resolved.from),
      toDate: resolved.all ? null : parseDateKey(resolved.to),
    }),
  ]);

  const shares = allocateProfit(pnl.netProfitPaisa, partners);
  const shareById = new Map(shares.map((row) => [String(row.partner._id), row.sharePaisa]));

  const rows = partners.map((partner) => ({
    ...partner,
    equityPercent: equityPercent(partner.equityBps),
    ...withTotals(totals.get(String(partner._id))),
    profitSharePaisa: shareById.get(String(partner._id)) || 0,
  }));

  const activePartners = partners.filter((partner) => partner.isActive);
  const totalEquityBps = activePartners.reduce(
    (sum, partner) => sum + Number(partner.equityBps || 0),
    0
  );
  const distributedPaisa = shares.reduce((sum, row) => sum + row.sharePaisa, 0);

  return {
    partners: rows,
    pnl,
    totalEquityBps,
    totalEquityPercent: equityPercent(totalEquityBps),
    distributedPaisa,
    unallocatedPaisa: Number(pnl.netProfitPaisa || 0) - distributedPaisa,
    period: resolved,
  };
}

/** One partner with their cash history and period profit share. */
async function getPartnerDetail(id, period = {}) {
  const partner = await getPartnerOrThrow(id);
  const resolved = resolvePeriod(period);

  const [transactions, totals, pnl] = await Promise.all([
    PartnerTransaction.find({ partner: partner._id })
      .sort({ date: -1, createdAt: -1 })
      .limit(TRANSACTION_LIMIT)
      .populate('recordedBy', 'name')
      .lean(),
    getTransactionTotals([partner._id]),
    accountingService.getProfitAndLoss({
      fromDate: resolved.all ? null : parseDateKey(resolved.from),
      toDate: resolved.all ? null : parseDateKey(resolved.to),
    }),
  ]);

  const share = allocateProfit(pnl.netProfitPaisa, [partner])[0];

  return {
    partner,
    transactions,
    totals: withTotals(totals.get(String(partner._id))),
    pnl,
    profitSharePaisa: share ? share.sharePaisa : 0,
    period: resolved,
  };
}

/**
 * Record a partner cash movement and post the matching journal entry.
 *
 *   contribution: Debit cash/bank        Credit 3010 Owner's Equity
 *   drawing:      Debit 3030 Drawings    Credit cash/bank
 *   expense:      Debit expense account  Credit 3010 Owner's Equity
 */
async function recordTransaction(partnerId, input = {}, actor, req) {
  const partner = await getPartnerOrThrow(partnerId);
  if (!partner.isActive) {
    throw ApiError.badRequest('Activate this partner before recording transactions.');
  }

  const type = PARTNER_TRANSACTION_TYPES.includes(input.type) ? input.type : null;
  if (!type) throw ApiError.badRequest('Select a transaction type.');

  const amountPaisa = parseAmount(input.amount);

  const date = input.date ? parseDateKey(String(input.date).slice(0, 10)) : null;
  if (input.date && !date) throw ApiError.badRequest('Enter a valid transaction date.');

  const isExpense = type === 'expense';
  const requestedCode =
    text(isExpense ? input.expenseAccountCode : input.paymentAccountCode, 20) ||
    (isExpense ? DEFAULT_EXPENSE_CODE : DEFAULT_PAYMENT_CODE);

  const allowedCodes = isExpense
    ? EXPENSE_CATEGORIES.map((category) => category.code)
    : PARTNER_PAYMENT_CODES;

  if (!allowedCodes.includes(requestedCode)) {
    throw ApiError.badRequest(
      isExpense ? 'Select a valid expense category.' : 'Select a valid cash or bank account.'
    );
  }

  const account = await accountingService.getAccountOrThrow(requestedCode);
  const occurredAt = date || new Date();
  const reference = await nextTransactionReference();
  const label = PARTNER_TRANSACTION_LABELS[type];
  const memo = `Partner ${label.toLowerCase()} [${reference}]: ${partner.name} (PKR ${(
    amountPaisa / 100
  ).toFixed(2)})`;

  let lines;
  if (type === 'contribution') {
    lines = [
      {
        accountCode: account.code,
        debitPaisa: amountPaisa,
        creditPaisa: 0,
        description: `${partner.name} capital in via ${account.name}`,
      },
      {
        accountCode: EQUITY_ACCOUNT_CODE,
        debitPaisa: 0,
        creditPaisa: amountPaisa,
        description: `${partner.name} capital account`,
      },
    ];
  } else if (type === 'drawing') {
    lines = [
      {
        accountCode: DRAWINGS_ACCOUNT_CODE,
        debitPaisa: amountPaisa,
        creditPaisa: 0,
        description: `${partner.name} drawings`,
      },
      {
        accountCode: account.code,
        debitPaisa: 0,
        creditPaisa: amountPaisa,
        description: `Paid to ${partner.name} from ${account.name}`,
      },
    ];
  } else {
    lines = [
      {
        accountCode: account.code,
        debitPaisa: amountPaisa,
        creditPaisa: 0,
        description: `${partner.name} paid ${account.name}`,
      },
      {
        accountCode: EQUITY_ACCOUNT_CODE,
        debitPaisa: 0,
        creditPaisa: amountPaisa,
        description: `${partner.name} capital account`,
      },
    ];
  }

  const journalEntry = await accountingService.createJournalEntry(
    {
      date: occurredAt,
      memo,
      referenceType: REFERENCE_TYPES.PARTNER_TRANSACTION,
      lines,
      actor,
    },
    { req }
  );

  const transaction = await PartnerTransaction.create({
    reference,
    partner: partner._id,
    type,
    amountPaisa,
    date: occurredAt,
    accountCode: account.code,
    accountName: account.name,
    notes: text(input.notes, 500),
    journalEntry: journalEntry._id,
    recordedBy: actor ? actor._id : null,
  });

  journalEntry.referenceId = transaction._id;
  await journalEntry.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.PARTNER_TRANSACTION_RECORDED,
    'partners',
    transaction._id,
    null,
    {
      reference,
      partner: partner.name,
      type,
      amountPaisa,
      accountCode: account.code,
      journalEntry: journalEntry.entryNumber,
    },
    {
      req,
      description: `${label} PKR ${(amountPaisa / 100).toFixed(2)} recorded for ${partner.name} (${reference})`,
    }
  );

  return { partner, transaction, journalEntry };
}

module.exports = {
  resolvePeriod,
  parseEquity,
  parseAmount,
  buildPartnerFilter,
  paginatePartners,
  getPartnerOrThrow,
  getTransactionTotals,
  createPartner,
  updatePartner,
  softDeletePartner,
  getPartnersOverview,
  getPartnerDetail,
  recordTransaction,
};
