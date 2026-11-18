'use strict';

/**
 * Daily closing & cash drawer reconciliation.
 *
 * The business day is a wall-clock window in the company timezone (for
 * example 09:00 -> 21:00, or an overnight 22:00 -> 06:00). Every branch gets
 * one drawer document per business date. While it is open the expected cash is
 * derived live from branch POS receipts and branch cash expenses; closing
 * freezes the figures and records the physical count.
 */

const mongoose = require('mongoose');
const config = require('../config/app');
const DailyClosing = require('../models/DailyClosing');
const PosSale = require('../models/PosSale');
const Expense = require('../models/Expense');
const Account = require('../models/Account');
const Branch = require('../models/Branch');
const Counter = require('../models/Counter');
const JournalEntry = require('../models/JournalEntry');
const ApiError = require('../utils/ApiError');
const branchInventory = require('./branchInventoryService');
const accountingService = require('./accountingService');
const { getSettings } = require('./settingsService');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { REFERENCE_TYPES } = require('../config/accounting');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Pakistani rupee notes and coins, largest first. */
const DENOMINATIONS = Object.freeze([
  { valuePaisa: 500000, label: 'Rs 5,000' },
  { valuePaisa: 100000, label: 'Rs 1,000' },
  { valuePaisa: 50000, label: 'Rs 500' },
  { valuePaisa: 10000, label: 'Rs 100' },
  { valuePaisa: 5000, label: 'Rs 50' },
  { valuePaisa: 2000, label: 'Rs 20' },
  { valuePaisa: 1000, label: 'Rs 10' },
  { valuePaisa: 500, label: 'Rs 5' },
  { valuePaisa: 200, label: 'Rs 2' },
  { valuePaisa: 100, label: 'Rs 1' },
]);

/* -------------------------------------------------------------------------- */
/* Timezone helpers                                                           */
/* -------------------------------------------------------------------------- */

function parseTime(value, fallback = '00:00') {
  const match = TIME_RE.exec(String(value || '').trim());
  const source = match ? match : TIME_RE.exec(fallback);
  const hour = Number(source[1]);
  const minute = Number(source[2]);
  return { hour, minute, minutes: hour * 60 + minute };
}

/** Wall-clock parts of an instant in a specific timezone. */
function zonedParts(date, timeZone = config.timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of the timezone at an instant, in milliseconds east of UTC. */
function zoneOffsetMs(date, timeZone = config.timezone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock date/time in a timezone to a UTC instant. */
function zonedDateTimeToUtc(year, month, day, hour, minute, timeZone = config.timezone) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const offset = zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

function addLocalDays(parts, delta) {
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + delta));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function businessDateKey(parts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`;
}

/** Logical business dates are stored at UTC midnight to keep them timezone-stable. */
function businessDateToDate(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

/**
 * Build the wall-clock window for a specific business date key (YYYY-MM-DD).
 * Overnight windows end on the following calendar day.
 */
function windowForBusinessDate(key, options = {}) {
  const match = DATE_RE.exec(String(key || '').trim());
  if (!match) return null;

  const start = parseTime(options.start, '09:00');
  const end = parseTime(options.end, '21:00');
  const timeZone = options.timeZone || config.timezone;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const overnight = end.minutes <= start.minutes;

  const periodStart = zonedDateTimeToUtc(year, month, day, start.hour, start.minute, timeZone);
  const endDay = overnight ? addLocalDays({ year, month, day }, 1) : { year, month, day };
  const periodEnd = zonedDateTimeToUtc(
    endDay.year,
    endDay.month,
    endDay.day,
    end.hour,
    end.minute,
    timeZone
  );

  return {
    businessDate: businessDateToDate(key),
    businessDateKey: key,
    periodStart,
    periodEnd,
    overnight,
    startMinutes: start.minutes,
    endMinutes: end.minutes,
    startTime: `${pad2(start.hour)}:${pad2(start.minute)}`,
    endTime: `${pad2(end.hour)}:${pad2(end.minute)}`,
    timeZone,
  };
}

/**
 * Resolve the business date whose window is currently active, or the most
 * recently ended window when the shop is between closing and the next start.
 */
function resolveBusinessWindow({ now = new Date(), start, end, timeZone } = {}) {
  const zone = timeZone || config.timezone;
  const startTime = parseTime(start, '09:00');
  const local = zonedParts(now, zone);
  const nowMinutes = local.hour * 60 + local.minute;
  const beforeStart = nowMinutes < startTime.minutes;
  const base = beforeStart ? addLocalDays(local, -1) : local;
  const key = businessDateKey(base);
  const window = windowForBusinessDate(key, { start, end, timeZone: zone });

  window.now = now;
  window.isOpen = now >= window.periodStart && now < window.periodEnd;
  window.isPastClose = now >= window.periodEnd;
  window.localNow = `${pad2(local.hour)}:${pad2(local.minute)}`;
  return window;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

function actorName(actor) {
  if (!actor) return 'System';
  if (actor.isBranchLogin) {
    return actor.branchName
      ? `${actor.branchName} (branch login)`
      : `${actor.branchCode || 'Branch'} (branch login)`;
  }
  return actor.name || actor.email || 'Unknown user';
}

function branchLabel(branch) {
  if (!branch) return '';
  return branch.code ? `${branch.code} — ${branch.name}` : branch.name || '';
}

function safeText(value, max) {
  return String(value || '').trim().slice(0, max);
}

function isMainBranchType(branch) {
  return branch && branch.type === 'main';
}

async function nextNumber() {
  const year = new Date().getFullYear();
  while (true) {
    const seq = await Counter.next(`daily_closing_${year}`);
    const number = `DC-${year}-${String(seq).padStart(4, '0')}`;
    if (!(await DailyClosing.exists({ number }))) return number;
  }
}

/* -------------------------------------------------------------------------- */
/* Denominations                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Parse denomination counts from a form body. Input names are
 * `denom_<valuePaisa>` (for example denom_500000 for a Rs 5,000 note).
 * Zero and blank rows are ignored.
 */
function parseDenominations(input = {}) {
  const rows = [];
  for (const denomination of DENOMINATIONS) {
    const raw = input[`denom_${denomination.valuePaisa}`];
    const count = Number.parseInt(raw, 10);
    if (!Number.isFinite(count) || count <= 0) continue;
    rows.push({
      valuePaisa: denomination.valuePaisa,
      label: denomination.label,
      count,
      totalPaisa: denomination.valuePaisa * count,
    });
  }
  return rows;
}

function denominationTotalPaisa(rows = []) {
  return rows.reduce((sum, row) => sum + Number(row.totalPaisa || 0), 0);
}

/* -------------------------------------------------------------------------- */
/* Drawer lifecycle                                                           */
/* -------------------------------------------------------------------------- */

/** Opening float comes from the last closed drawer, else the configured default. */
async function resolveOpeningFloat(branchId, businessDate) {
  const previous = await DailyClosing.findOne({
    branch: branchId,
    businessDate: { $lt: businessDate },
    status: 'closed',
    countedCashPaisa: { $ne: null },
  })
    .sort({ businessDate: -1 })
    .select('countedCashPaisa')
    .lean();

  if (previous && Number.isInteger(previous.countedCashPaisa)) {
    return { openingFloatPaisa: previous.countedCashPaisa, source: 'previous' };
  }

  const settings = await getSettings();
  return {
    openingFloatPaisa: Math.max(0, Math.round(Number(settings.defaultOpeningFloatPaisa || 0))),
    source: 'default',
  };
}

async function syncOpeningFloat(drawer) {
  if (!drawer || drawer.status !== 'open' || drawer.openingFloatSource === 'manual') return drawer;
  const float = await resolveOpeningFloat(drawer.branch, drawer.businessDate);
  if (drawer.openingFloatPaisa === float.openingFloatPaisa && drawer.openingFloatSource === float.source) {
    return drawer;
  }
  drawer.openingFloatPaisa = float.openingFloatPaisa;
  drawer.openingFloatSource = float.source;
  await DailyClosing.updateOne(
    { _id: drawer._id, status: 'open' },
    { $set: { openingFloatPaisa: float.openingFloatPaisa, openingFloatSource: float.source } }
  );
  return drawer;
}

/**
 * Find a drawer, or create it when allowed. Creating is idempotent thanks to
 * the unique {branch, businessDate} index.
 */
async function getDrawer({ branch, businessDate, window, actor = null, allowCreate = true } = {}) {
  if (!branch || !branch._id) throw ApiError.badRequest('Select a branch first.');
  if (!(businessDate instanceof Date) || Number.isNaN(businessDate.getTime())) {
    throw ApiError.badRequest('Select a valid business date.');
  }

  let drawer = await DailyClosing.findOne({ branch: branch._id, businessDate });
  if (drawer) return syncOpeningFloat(drawer);

  if (!allowCreate) return null;
  if (!window) {
    throw ApiError.badRequest('The business-day window is missing.');
  }

  const float = await resolveOpeningFloat(branch._id, businessDate);
  try {
    drawer = await DailyClosing.create({
      number: await nextNumber(),
      branch: branch._id,
      branchCode: branch.code || '',
      branchName: branch.name || '',
      businessDate,
      periodStart: window.periodStart,
      periodEnd: window.periodEnd,
      status: 'open',
      openingFloatPaisa: float.openingFloatPaisa,
      openingFloatSource: float.source,
      createdBy: actor && actor._id ? actor._id : null,
    });
    return drawer;
  } catch (err) {
    if (err && err.code === 11000) {
      drawer = await DailyClosing.findOne({ branch: branch._id, businessDate });
      if (drawer) return syncOpeningFloat(drawer);
    }
    throw err;
  }
}

/** Alias used by the controller and cron. */
async function getOrCreateDrawer(options) {
  return getDrawer({ ...options, allowCreate: true });
}

/**
 * Compute the live drawer summary. Closed drawers return their frozen snapshot;
 * open drawers are recomputed from POS sales and cash expenses.
 */
async function buildSummary(drawer, { persist = false } = {}) {
  if (!drawer) return null;

  if (drawer.status === 'closed') {
    const summary = drawer.summary || {};
    return {
      live: false,
      openingFloatPaisa: Number(drawer.openingFloatPaisa || 0),
      cashSalesPaisa: Number(drawer.cashSalesPaisa || 0),
      cashExpensesPaisa: Number(drawer.cashExpensesPaisa || 0),
      cashInPaisa: Number(drawer.cashInPaisa || 0),
      cashOutPaisa: Number(drawer.cashOutPaisa || 0),
      expectedCashPaisa: Number(drawer.expectedCashPaisa || 0),
      countedCashPaisa: drawer.countedCashPaisa,
      variancePaisa: Number(drawer.variancePaisa || 0),
      saleCount: Number(summary.saleCount || 0),
      cashSaleCount: Number(summary.cashSaleCount || 0),
      bankSaleCount: Number(summary.bankSaleCount || 0),
      creditSaleCount: Number(summary.creditSaleCount || 0),
      expenseCount: Number(summary.expenseCount || 0),
      salesTotalPaisa: Number(summary.salesTotalPaisa || 0),
      expenses: [],
      sales: [],
    };
  }

  const [branch, cashAccount] = await Promise.all([
    Branch.findById(drawer.branch).select('type code name').lean(),
    Account.findOne({ code: '1010', deletedAt: null }).select('_id').lean(),
  ]);

  const sales = await PosSale.find({
    branch: drawer.branch,
    status: 'completed',
    soldAt: { $gte: drawer.periodStart, $lt: drawer.periodEnd },
  })
    .select('number paymentMethod paidPaisa totalPaisa duePaisa soldAt customerName')
    .sort({ soldAt: 1 })
    .lean();

  let cashSalesPaisa = 0;
  let salesTotalPaisa = 0;
  const counts = { cash: 0, bank: 0, credit: 0, mixed: 0 };
  for (const sale of sales) {
    salesTotalPaisa += Number(sale.totalPaisa || 0);
    counts[sale.paymentMethod] = (counts[sale.paymentMethod] || 0) + 1;
    // posService posts the paid portion to 1010 for every method except bank.
    if (sale.paymentMethod !== 'bank') cashSalesPaisa += Number(sale.paidPaisa || 0);
  }

  const branchFilter = isMainBranchType(branch)
    ? { $or: [{ branch: drawer.branch }, { branch: null }] }
    : { branch: drawer.branch };

  let expenses = [];
  if (cashAccount) {
    expenses = await Expense.find({
      ...branchFilter,
      paymentAccount: cashAccount._id,
      date: { $gte: drawer.periodStart, $lt: drawer.periodEnd },
    })
      .select('voucherNumber payee amountPaisa date notes')
      .sort({ date: 1 })
      .lean();
  }
  const cashExpensesPaisa = expenses.reduce(
    (sum, expense) => sum + Number(expense.amountPaisa || 0),
    0
  );

  const adjustments = drawer.adjustments || [];
  const cashInPaisa = adjustments
    .filter((row) => row.kind === 'in')
    .reduce((sum, row) => sum + Number(row.amountPaisa || 0), 0);
  const cashOutPaisa = adjustments
    .filter((row) => row.kind === 'out')
    .reduce((sum, row) => sum + Number(row.amountPaisa || 0), 0);

  const openingFloatPaisa = Number(drawer.openingFloatPaisa || 0);
  const expectedCashPaisa =
    openingFloatPaisa + cashSalesPaisa - cashExpensesPaisa + cashInPaisa - cashOutPaisa;
  const countedCashPaisa =
    drawer.countedCashPaisa === null || drawer.countedCashPaisa === undefined
      ? null
      : Number(drawer.countedCashPaisa);
  const variancePaisa = countedCashPaisa === null ? null : countedCashPaisa - expectedCashPaisa;

  const snapshot = {
    cashSalesPaisa,
    cashExpensesPaisa,
    cashInPaisa,
    cashOutPaisa,
    expectedCashPaisa,
    summary: {
      saleCount: sales.length,
      cashSaleCount: counts.cash || 0,
      bankSaleCount: counts.bank || 0,
      creditSaleCount: counts.credit || 0,
      expenseCount: expenses.length,
      salesTotalPaisa,
    },
  };

  if (persist) {
    const changed =
      Number(drawer.cashSalesPaisa || 0) !== cashSalesPaisa ||
      Number(drawer.cashExpensesPaisa || 0) !== cashExpensesPaisa ||
      Number(drawer.cashInPaisa || 0) !== cashInPaisa ||
      Number(drawer.cashOutPaisa || 0) !== cashOutPaisa ||
      Number(drawer.expectedCashPaisa || 0) !== expectedCashPaisa ||
      Number(drawer.summary && drawer.summary.saleCount) !== sales.length ||
      Number(drawer.summary && drawer.summary.expenseCount) !== expenses.length;

    if (changed) {
      await DailyClosing.updateOne(
        { _id: drawer._id, status: 'open' },
        { $set: snapshot }
      );
      Object.assign(drawer, snapshot);
    }
  }

  return {
    live: true,
    ...snapshot,
    openingFloatPaisa,
    countedCashPaisa,
    variancePaisa,
    saleCount: sales.length,
    cashSaleCount: counts.cash || 0,
    bankSaleCount: counts.bank || 0,
    creditSaleCount: counts.credit || 0,
    mixedSaleCount: counts.mixed || 0,
    expenseCount: expenses.length,
    salesTotalPaisa,
    expenses,
    sales,
  };
}

/* -------------------------------------------------------------------------- */
/* Adjustments                                                                */
/* -------------------------------------------------------------------------- */

async function addAdjustment({ drawer, kind, amountPaisa, reason, actor = null, req = null }) {
  if (!drawer) throw ApiError.notFound('Daily closing drawer not found.');
  if (drawer.status !== 'open') {
    throw ApiError.conflict('This drawer is closed. Reopen it before adding adjustments.');
  }
  if (!['in', 'out'].includes(kind)) {
    throw ApiError.badRequest('Choose whether cash is coming in or going out.');
  }
  const amount = Math.round(Number(amountPaisa));
  if (!Number.isInteger(amount) || amount <= 0) {
    throw ApiError.badRequest('Enter a valid cash adjustment amount.');
  }
  const cleanReason = safeText(reason, 300);
  if (cleanReason.length < 3) {
    throw ApiError.badRequest('A short reason is required for every cash adjustment.');
  }

  const adjustment = {
    kind,
    amountPaisa: amount,
    reason: cleanReason,
    createdByName: actorName(actor),
    createdBy: actor && actor._id ? actor._id : null,
    createdAt: new Date(),
  };

  const updated = await DailyClosing.findOneAndUpdate(
    { _id: drawer._id, status: 'open' },
    { $push: { adjustments: adjustment }, $set: { updatedBy: actor && actor._id ? actor._id : null } },
    { new: true }
  );
  if (!updated) {
    throw ApiError.conflict('This drawer was closed before the adjustment could be saved.');
  }

  clearReminderCache(updated.branch);

  await logAction(
    actor,
    AUDIT_ACTIONS.DAILY_CLOSING_ADJUSTMENT,
    'daily_closings',
    updated._id,
    null,
    { kind, amountPaisa: amount, reason: cleanReason, number: updated.number },
    {
      req,
      description: `${kind === 'in' ? 'Cash in' : 'Cash out'} PKR ${(amount / 100).toLocaleString()} on ${updated.number}: ${cleanReason}`,
    }
  );

  return updated;
}

/* -------------------------------------------------------------------------- */
/* Close & reopen                                                             */
/* -------------------------------------------------------------------------- */

async function reverseJournalEntry(journalEntry, actor, req, memo) {
  if (!journalEntry) return null;
  return accountingService.createJournalEntry(
    {
      date: new Date(),
      memo,
      referenceType: REFERENCE_TYPES.CLOSING,
      referenceId: journalEntry.referenceId || null,
      lines: journalEntry.lines.map((line) => ({
        accountCode: line.accountCode,
        debitPaisa: line.creditPaisa,
        creditPaisa: line.debitPaisa,
        description: `Reversal: ${line.description || ''}`,
      })),
      actor,
    },
    { req }
  );
}

/**
 * Close a drawer. The physical count is compared with the live expected cash.
 * A non-zero variance posts a 6070 Cash Over & Short journal entry and requires
 * a written reason. The status change is an atomic claim so two closers can
 * never close the same drawer twice.
 */
async function closeDrawer({
  drawer,
  countedCashPaisa,
  denominations = [],
  closedByName,
  varianceReason = '',
  notes = '',
  actor = null,
  req = null,
} = {}) {
  if (!drawer) throw ApiError.notFound('Daily closing drawer not found.');
  if (drawer.status !== 'open') {
    throw ApiError.conflict('This drawer is already closed.');
  }

  const counted = Math.round(Number(countedCashPaisa));
  if (!Number.isInteger(counted) || counted < 0) {
    throw ApiError.badRequest('Enter a valid physical cash count.');
  }
  const closer = safeText(closedByName, 150);
  if (!closer) {
    throw ApiError.badRequest('Enter the name of the person closing the drawer.');
  }

  const rows = Array.isArray(denominations) ? denominations : [];
  if (rows.length) {
    const total = denominationTotalPaisa(rows);
    if (total !== counted) {
      throw ApiError.badRequest(
        `Denomination total (PKR ${(total / 100).toLocaleString()}) does not match the counted cash (PKR ${(counted / 100).toLocaleString()}).`
      );
    }
  }

  const summary = await buildSummary(drawer, { persist: false });
  const expected = summary.expectedCashPaisa;
  const variance = counted - expected;
  const reason = safeText(varianceReason, 500);

  if (variance !== 0 && reason.length < 3) {
    throw ApiError.badRequest(
      'A reason is required when the counted cash differs from the expected drawer balance.'
    );
  }

  let varianceJournal = null;
  if (variance !== 0) {
    await accountingService.seedChartOfAccounts({ force: true });
    const amount = Math.abs(variance);
    const lines =
      variance > 0
        ? [
            {
              accountCode: '1010',
              debitPaisa: amount,
              creditPaisa: 0,
              description: `${drawer.number} cash drawer overage`,
            },
            {
              accountCode: '6070',
              debitPaisa: 0,
              creditPaisa: amount,
              description: `${drawer.number} cash over & short`,
            },
          ]
        : [
            {
              accountCode: '6070',
              debitPaisa: amount,
              creditPaisa: 0,
              description: `${drawer.number} cash over & short`,
            },
            {
              accountCode: '1010',
              debitPaisa: 0,
              creditPaisa: amount,
              description: `${drawer.number} cash drawer shortage`,
            },
          ];

    varianceJournal = await accountingService.createJournalEntry(
      {
        date: new Date(),
        memo: `Daily closing ${drawer.number} (${drawer.branchCode}) — ${
          variance > 0 ? 'over' : 'short'
        } PKR ${(amount / 100).toLocaleString()}`,
        referenceType: REFERENCE_TYPES.CLOSING,
        referenceId: drawer._id,
        lines,
        actor,
      },
      { req }
    );
  }

  const closedAt = new Date();
  const update = {
    status: 'closed',
    countedCashPaisa: counted,
    variancePaisa: variance,
    varianceReason: variance !== 0 ? reason : '',
    denominations: rows,
    closedByName: closer,
    closedBy: actor && actor._id ? actor._id : null,
    closedByRole: actor ? actor.role || '' : '',
    closedAt,
    closingNotes: safeText(notes, 1000),
    varianceJournalEntry: varianceJournal ? varianceJournal._id : null,
    cashSalesPaisa: summary.cashSalesPaisa,
    cashExpensesPaisa: summary.cashExpensesPaisa,
    cashInPaisa: summary.cashInPaisa,
    cashOutPaisa: summary.cashOutPaisa,
    expectedCashPaisa: expected,
    summary: summary.summary,
    updatedBy: actor && actor._id ? actor._id : null,
  };

  const updated = await DailyClosing.findOneAndUpdate(
    { _id: drawer._id, status: 'open' },
    { $set: update },
    { new: true }
  );

  if (!updated) {
    // Another closer won the race. Undo the variance journal we just posted.
    if (varianceJournal) {
      await reverseJournalEntry(
        varianceJournal,
        actor,
        req,
        `Rollback ${varianceJournal.entryNumber}: ${drawer.number} was already closed`
      ).catch(() => {});
    }
    throw ApiError.conflict('This drawer was already closed by another user.');
  }

  clearReminderCache(updated.branch);

  await logAction(
    actor,
    AUDIT_ACTIONS.DAILY_CLOSING_PERFORMED,
    'daily_closings',
    updated._id,
    {
      status: drawer.status,
      expectedCashPaisa: expected,
      openingFloatPaisa: drawer.openingFloatPaisa,
    },
    {
      status: 'closed',
      countedCashPaisa: counted,
      variancePaisa: variance,
      varianceReason: reason,
      closedByName: closer,
      number: updated.number,
    },
    {
      req,
      description: `Closed ${updated.number} for ${updated.branchCode} on ${updated.businessDate.toISOString().slice(0, 10)} — counted PKR ${(counted / 100).toLocaleString()}, variance PKR ${(variance / 100).toLocaleString()}`,
    }
  );

  return updated;
}

/**
 * Reopen a closed drawer. The variance journal is reversed, the count is
 * cleared, and the previous close is kept in reopenHistory. Only the latest
 * closed drawer for a branch may be reopened so the cash chain stays intact.
 */
async function reopenDrawer({ drawer, reason, actor = null, req = null } = {}) {
  if (!drawer) throw ApiError.notFound('Daily closing drawer not found.');
  if (drawer.status !== 'closed') {
    throw ApiError.badRequest('Only a closed drawer can be reopened.');
  }
  const cleanReason = safeText(reason, 500);
  if (cleanReason.length < 5) {
    throw ApiError.badRequest('A detailed reopen reason is required.');
  }

  const later = await DailyClosing.findOne({
    branch: drawer.branch,
    businessDate: { $gt: drawer.businessDate },
    status: 'closed',
  })
    .sort({ businessDate: 1 })
    .select('number businessDate')
    .lean();

  if (later) {
    throw ApiError.conflict(
      `Cannot reopen ${drawer.number}: later drawer ${later.number} is already closed. Reopen the latest closing first.`
    );
  }

  let reversal = null;
  if (drawer.varianceJournalEntry) {
    const original = await JournalEntry.findById(drawer.varianceJournalEntry);
    if (original && !original.deletedAt) {
      reversal = await reverseJournalEntry(
        original,
        actor,
        req,
        `Reopen ${drawer.number}: reversal of ${original.entryNumber}`
      );
    }
  }

  const history = {
    reopenedAt: new Date(),
    reopenedByName: actorName(actor),
    reopenedBy: actor && actor._id ? actor._id : null,
    reason: cleanReason,
    previousCountedCashPaisa: drawer.countedCashPaisa,
    previousVariancePaisa: drawer.variancePaisa,
    previousClosedAt: drawer.closedAt,
    previousClosedByName: drawer.closedByName,
    previousVarianceJournalEntry: drawer.varianceJournalEntry,
    reversalJournalEntry: reversal ? reversal._id : null,
  };

  const updated = await DailyClosing.findOneAndUpdate(
    { _id: drawer._id, status: 'closed' },
    {
      $set: {
        status: 'open',
        countedCashPaisa: null,
        variancePaisa: 0,
        varianceReason: '',
        denominations: [],
        closedAt: null,
        closedByName: '',
        closedBy: null,
        closedByRole: '',
        varianceJournalEntry: null,
        reopenedAt: history.reopenedAt,
        reopenedByName: history.reopenedByName,
        reopenedBy: history.reopenedBy,
        updatedBy: actor && actor._id ? actor._id : null,
      },
      $push: { reopenHistory: history },
      $inc: { reopenCount: 1 },
    },
    { new: true }
  );

  if (!updated) {
    if (reversal) {
      await reverseJournalEntry(
        reversal,
        actor,
        req,
        `Rollback ${reversal.entryNumber}: ${drawer.number} was reopened by another user`
      ).catch(() => {});
    }
    throw ApiError.conflict('This drawer was already reopened by another user.');
  }

  clearReminderCache(updated.branch);

  await logAction(
    actor,
    AUDIT_ACTIONS.DAILY_CLOSING_REOPENED,
    'daily_closings',
    updated._id,
    {
      status: 'closed',
      countedCashPaisa: history.previousCountedCashPaisa,
      variancePaisa: history.previousVariancePaisa,
    },
    { status: 'open', reason: cleanReason, reversalJournalEntry: history.reversalJournalEntry },
    {
      req,
      description: `Reopened ${updated.number} for ${updated.branchCode}: ${cleanReason}`,
    }
  );

  return updated;
}

/* -------------------------------------------------------------------------- */
/* History, reminders & automation                                            */
/* -------------------------------------------------------------------------- */

async function listDrawers({ branchId, limit = 14 } = {}) {
  if (!branchId) return [];
  return DailyClosing.find({ branch: branchId })
    .sort({ businessDate: -1 })
    .limit(Math.min(Math.max(Number(limit) || 14, 1), 60))
    .lean();
}

const reminderCache = new Map();
const REMINDER_TTL_MS = 45 * 1000;

function clearReminderCache(branchId = null) {
  if (!branchId) {
    reminderCache.clear();
    return;
  }
  const prefix = `${String(branchId)}:`;
  for (const key of reminderCache.keys()) {
    if (key.startsWith(prefix)) reminderCache.delete(key);
  }
}

/**
 * Returns the popup payload when the current business day is past its closing
 * time and the drawer is still open. Results are cached briefly because this
 * runs on every authenticated page view.
 */
async function getReminder({ actor, now = new Date() } = {}) {
  const settings = await getSettings();
  if (!settings.dailyClosingReminderEnabled) return null;

  const window = resolveBusinessWindow({
    now,
    start: settings.businessDayStart,
    end: settings.businessDayEnd,
  });
  if (!window.isPastClose) return null;

  const branch = await branchInventory.getAccessibleBranch(actor, null);
  const key = `${String(branch._id)}:${window.businessDateKey}`;
  const cached = reminderCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  let drawer = await DailyClosing.findOne({
    branch: branch._id,
    businessDate: window.businessDate,
  });
  if (!drawer) {
    drawer = await getDrawer({
      branch,
      businessDate: window.businessDate,
      window,
      actor,
      allowCreate: true,
    });
  }

  if (!drawer || drawer.status !== 'open') {
    reminderCache.set(key, { expires: Date.now() + REMINDER_TTL_MS, value: null });
    return null;
  }

  const summary = await buildSummary(drawer, { persist: true });
  const value = {
    drawerId: String(drawer._id),
    number: drawer.number,
    branchId: String(branch._id),
    branchCode: branch.code,
    branchName: branch.name,
    businessDate: window.businessDate,
    businessDateKey: window.businessDateKey,
    periodStart: window.periodStart,
    periodEnd: window.periodEnd,
    closingTime: window.endTime,
    openingFloatPaisa: summary.openingFloatPaisa,
    cashSalesPaisa: summary.cashSalesPaisa,
    cashExpensesPaisa: summary.cashExpensesPaisa,
    cashInPaisa: summary.cashInPaisa,
    cashOutPaisa: summary.cashOutPaisa,
    expectedCashPaisa: summary.expectedCashPaisa,
  };
  reminderCache.set(key, { expires: Date.now() + REMINDER_TTL_MS, value });
  return value;
}

/**
 * Create today's open drawer for every active branch once the business day has
 * started. Safe to call repeatedly; the unique index makes it idempotent.
 */
async function ensureOpenDrawers({ now = new Date(), actor = null } = {}) {
  const settings = await getSettings();
  const window = resolveBusinessWindow({
    now,
    start: settings.businessDayStart,
    end: settings.businessDayEnd,
  });
  if (!window.isOpen) {
    return { checked: 0, opened: 0, businessDateKey: window.businessDateKey, skipped: 'outside-window' };
  }

  const branches = await Branch.find({ isActive: true }).select('_id code name type').lean();
  let opened = 0;
  for (const branch of branches) {
    const existing = await DailyClosing.exists({
      branch: branch._id,
      businessDate: window.businessDate,
    });
    if (existing) continue;
    await getDrawer({
      branch,
      businessDate: window.businessDate,
      window,
      actor,
      allowCreate: true,
    });
    opened += 1;
  }

  return { checked: branches.length, opened, businessDateKey: window.businessDateKey };
}

module.exports = {
  DENOMINATIONS,
  parseTime,
  zonedParts,
  zonedDateTimeToUtc,
  windowForBusinessDate,
  resolveBusinessWindow,
  businessDateKey,
  businessDateToDate,
  parseDenominations,
  denominationTotalPaisa,
  resolveOpeningFloat,
  getDrawer,
  getOrCreateDrawer,
  buildSummary,
  addAdjustment,
  closeDrawer,
  reopenDrawer,
  listDrawers,
  getReminder,
  clearReminderCache,
  ensureOpenDrawers,
  actorName,
  branchLabel,
};
