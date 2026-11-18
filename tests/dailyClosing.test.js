'use strict';

/**
 * Daily Closing & Cash Drawer Reconciliation tests.
 *
 * These are unit tests: they cover the timezone window maths, denomination
 * parsing, model validation, permissions, navigation, the branch allow-list and
 * the printable sign-off PDF. Database-backed close/reopen flows are exercised
 * over HTTP in the smoke test.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ejs = require('ejs');
const mongoose = require('mongoose');

const DailyClosing = require('../models/DailyClosing');
const Settings = require('../models/Settings');
const navigation = require('../config/navigation');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');
const { isBranchAllowedPath } = require('../middleware/branchSessionGuard');
const { DEFAULT_CHART_OF_ACCOUNTS, REFERENCE_TYPES } = require('../config/accounting');
const {
  DENOMINATIONS,
  parseTime,
  windowForBusinessDate,
  resolveBusinessWindow,
  businessDateToDate,
  parseDenominations,
  denominationTotalPaisa,
  actorName,
  branchLabel,
  closeDrawer,
  reopenDrawer,
} = require('../services/dailyClosingService');
const { buildDrawerClosingPdf } = require('../services/accountingPdfService');
const {
  adjustmentRules,
  closeRules,
  quickCloseRules,
  reopenRules,
} = require('../validators/dailyClosingValidators');

/* -------------------------------------------------------------------------- */
/* Timezone windows                                                           */
/* -------------------------------------------------------------------------- */

test('parseTime accepts HH:MM and falls back safely', () => {
  assert.deepEqual(parseTime('09:30'), { hour: 9, minute: 30, minutes: 570 });
  assert.deepEqual(parseTime('22:05'), { hour: 22, minute: 5, minutes: 1325 });
  assert.deepEqual(parseTime('not-a-time', '21:00'), { hour: 21, minute: 0, minutes: 1260 });
  assert.deepEqual(parseTime('25:99', '09:00'), { hour: 9, minute: 0, minutes: 540 });
});

test('same-day business window converts Asia/Karachi wall clock to UTC', () => {
  const window = windowForBusinessDate('2026-11-18', {
    start: '09:00',
    end: '21:00',
    timeZone: 'Asia/Karachi',
  });

  assert.equal(window.overnight, false);
  assert.equal(window.businessDate.toISOString(), '2026-11-18T00:00:00.000Z');
  assert.equal(window.periodStart.toISOString(), '2026-11-18T04:00:00.000Z');
  assert.equal(window.periodEnd.toISOString(), '2026-11-18T16:00:00.000Z');
  assert.equal(window.startTime, '09:00');
  assert.equal(window.endTime, '21:00');
});

test('overnight business window ends on the following calendar day', () => {
  const window = windowForBusinessDate('2026-11-18', {
    start: '22:00',
    end: '06:00',
    timeZone: 'Asia/Karachi',
  });

  assert.equal(window.overnight, true);
  assert.equal(window.periodStart.toISOString(), '2026-11-18T17:00:00.000Z');
  assert.equal(window.periodEnd.toISOString(), '2026-11-19T01:00:00.000Z');
});

test('windowForBusinessDate rejects malformed business dates', () => {
  assert.equal(windowForBusinessDate('18-11-2026'), null);
  assert.equal(windowForBusinessDate(''), null);
});

test('resolveBusinessWindow picks the active business date during the day', () => {
  // 12:00Z = 17:00 Asia/Karachi on 18 Nov.
  const now = new Date('2026-11-18T12:00:00.000Z');
  const window = resolveBusinessWindow({
    now,
    start: '09:00',
    end: '21:00',
    timeZone: 'Asia/Karachi',
  });

  assert.equal(window.businessDateKey, '2026-11-18');
  assert.equal(window.isOpen, true);
  assert.equal(window.isPastClose, false);
  assert.equal(window.localNow, '17:00');
});

test('resolveBusinessWindow keeps the day open until the configured end time', () => {
  // 16:30Z = 21:30 Asia/Karachi — thirty minutes past a 21:00 close.
  const now = new Date('2026-11-18T16:30:00.000Z');
  const window = resolveBusinessWindow({
    now,
    start: '09:00',
    end: '21:00',
    timeZone: 'Asia/Karachi',
  });

  assert.equal(window.businessDateKey, '2026-11-18');
  assert.equal(window.isOpen, false);
  assert.equal(window.isPastClose, true);
});

test('resolveBusinessWindow rolls back before the start time', () => {
  // 02:00Z = 07:00 Asia/Karachi, before a 09:00 start.
  const now = new Date('2026-11-18T02:00:00.000Z');
  const window = resolveBusinessWindow({
    now,
    start: '09:00',
    end: '21:00',
    timeZone: 'Asia/Karachi',
  });

  assert.equal(window.businessDateKey, '2026-11-17');
  assert.equal(window.isOpen, false);
  assert.equal(window.isPastClose, true);
});

test('overnight window stays open after midnight and closes at the end time', () => {
  // 20:00Z = 01:00 Asia/Karachi on 19 Nov. The 18 Nov overnight day is open.
  const open = resolveBusinessWindow({
    now: new Date('2026-11-18T20:00:00.000Z'),
    start: '22:00',
    end: '06:00',
    timeZone: 'Asia/Karachi',
  });
  assert.equal(open.businessDateKey, '2026-11-18');
  assert.equal(open.isOpen, true);
  assert.equal(open.isPastClose, false);

  // 01:30Z = 06:30 Asia/Karachi on 19 Nov. The 18 Nov day has closed.
  const closed = resolveBusinessWindow({
    now: new Date('2026-11-19T01:30:00.000Z'),
    start: '22:00',
    end: '06:00',
    timeZone: 'Asia/Karachi',
  });
  assert.equal(closed.businessDateKey, '2026-11-18');
  assert.equal(closed.isOpen, false);
  assert.equal(closed.isPastClose, true);
});

test('business dates are stored at UTC midnight for stable uniqueness', () => {
  assert.equal(businessDateToDate('2026-11-18').toISOString(), '2026-11-18T00:00:00.000Z');
});

/* -------------------------------------------------------------------------- */
/* Denominations & labels                                                     */
/* -------------------------------------------------------------------------- */

test('denomination grid is ordered from the largest note down', () => {
  assert.ok(DENOMINATIONS.length >= 8);
  assert.equal(DENOMINATIONS[0].valuePaisa, 500000);
  const values = DENOMINATIONS.map((row) => row.valuePaisa);
  assert.deepEqual(values, [...values].sort((a, b) => b - a));
});

test('parseDenominations sums only positive whole counts', () => {
  const rows = parseDenominations({
    denom_500000: '2',
    denom_100000: '3',
    denom_1000: '0',
    denom_100: '5',
    denom_500: '',
    denom_50: 'abc',
    denom_20: '-4',
  });

  assert.equal(rows.length, 3);
  assert.equal(denominationTotalPaisa(rows), 2 * 500000 + 3 * 100000 + 5 * 100);
  assert.equal(rows[0].label, 'Rs 5,000');
  assert.equal(rows[0].totalPaisa, 1000000);
});

test('denominationTotalPaisa is zero for an empty grid', () => {
  assert.equal(denominationTotalPaisa([]), 0);
  assert.equal(denominationTotalPaisa(parseDenominations({})), 0);
});

test('actorName and branchLabel describe branch logins without a user id', () => {
  assert.equal(actorName(null), 'System');
  assert.equal(actorName({ name: 'Ali' }), 'Ali');
  assert.equal(
    actorName({ isBranchLogin: true, branchName: 'Main Agency', branchCode: 'MAIN' }),
    'Main Agency (branch login)'
  );
  assert.equal(branchLabel({ code: 'BR-1', name: 'Township' }), 'BR-1 — Township');
  assert.equal(branchLabel(null), '');
});

/* -------------------------------------------------------------------------- */
/* Model validation                                                           */
/* -------------------------------------------------------------------------- */

function validDrawer(overrides = {}) {
  return new DailyClosing({
    number: 'DC-2026-0001',
    branch: new mongoose.Types.ObjectId(),
    branchCode: 'MAIN',
    branchName: 'Main Agency',
    businessDate: businessDateToDate('2026-11-18'),
    periodStart: new Date('2026-11-18T04:00:00.000Z'),
    periodEnd: new Date('2026-11-18T16:00:00.000Z'),
    ...overrides,
  });
}

test('DailyClosing validates a complete drawer document', () => {
  assert.equal(validDrawer().validateSync(), undefined);
});

test('DailyClosing requires a branch, number and period window', () => {
  const drawer = new DailyClosing({});
  const errors = drawer.validateSync().errors;
  assert.ok(errors.number);
  assert.ok(errors.branch);
  assert.ok(errors.businessDate);
  assert.ok(errors.periodStart);
  assert.ok(errors.periodEnd);
});

test('DailyClosing rejects fractional paisa and unknown status', () => {
  const errors = validDrawer({
    openingFloatPaisa: 150.5,
    status: 'archived',
  }).validateSync().errors;

  assert.ok(errors.openingFloatPaisa);
  assert.ok(errors.status);
});

test('DailyClosing rejects adjustments without a positive amount or reason', () => {
  const errors = validDrawer({
    adjustments: [{ kind: 'in', amountPaisa: 0, reason: '' }],
  }).validateSync().errors;

  assert.ok(errors['adjustments.0.amountPaisa']);
  assert.ok(errors['adjustments.0.reason']);
});

test('DailyClosing variance label reflects over, short and balanced states', () => {
  assert.equal(validDrawer({ status: 'closed', variancePaisa: 0 }).varianceLabel, 'Balanced');
  assert.equal(validDrawer({ status: 'closed', variancePaisa: 500 }).varianceLabel, 'Over');
  assert.equal(validDrawer({ status: 'closed', variancePaisa: -500 }).varianceLabel, 'Short');
});

/* -------------------------------------------------------------------------- */
/* Close / reopen guard rails (no database needed)                            */
/* -------------------------------------------------------------------------- */

test('closeDrawer refuses to close an already closed drawer', async () => {
  await assert.rejects(
    () => closeDrawer({ drawer: { status: 'closed', number: 'DC-1' }, countedCashPaisa: 100 }),
    /already closed/i
  );
});

test('closeDrawer rejects a negative physical count before touching the database', async () => {
  await assert.rejects(
    () => closeDrawer({ drawer: { status: 'open', number: 'DC-1' }, countedCashPaisa: -1 }),
    /valid physical cash count/i
  );
});

test('closeDrawer requires the closer name', async () => {
  await assert.rejects(
    () => closeDrawer({ drawer: { status: 'open', number: 'DC-1' }, countedCashPaisa: 1000 }),
    /name of the person closing/i
  );
});

test('closeDrawer rejects a denomination grid that disagrees with the count', async () => {
  await assert.rejects(
    () =>
      closeDrawer({
        drawer: { status: 'open', number: 'DC-1' },
        countedCashPaisa: 100000,
        closedByName: 'Ali',
        denominations: [{ valuePaisa: 500000, label: 'Rs 5,000', count: 1, totalPaisa: 500000 }],
      }),
    /does not match the counted cash/i
  );
});

test('reopenDrawer only accepts a closed drawer and requires a reason', async () => {
  await assert.rejects(
    () => reopenDrawer({ drawer: { status: 'open', number: 'DC-1' }, reason: 'Mistake in count' }),
    /only a closed drawer/i
  );
  await assert.rejects(
    () => reopenDrawer({ drawer: { status: 'closed', number: 'DC-1' }, reason: 'bad' }),
    /detailed reopen reason/i
  );
});

/* -------------------------------------------------------------------------- */
/* Permissions, navigation & branch workspace                                 */
/* -------------------------------------------------------------------------- */

test('closing permissions let shopkeepers close but not reopen', () => {
  assert.equal(can(ROLES.OWNER, 'closing.view'), true);
  assert.equal(can(ROLES.OWNER, 'closing.manage'), true);
  assert.equal(can(ROLES.OWNER, 'closing.reopen'), true);

  assert.equal(can(ROLES.ACCOUNTANT, 'closing.reopen'), true);
  assert.equal(can(ROLES.MANAGER, 'closing.manage'), true);
  assert.equal(can(ROLES.MANAGER, 'closing.reopen'), false);

  assert.equal(can(ROLES.SHOPKEEPER, 'closing.view'), true);
  assert.equal(can(ROLES.SHOPKEEPER, 'closing.manage'), true);
  assert.equal(can(ROLES.SHOPKEEPER, 'closing.reopen'), false);

  assert.equal(can(ROLES.SALES, 'closing.view'), false);
  assert.equal(can(ROLES.TECHNICIAN, 'closing.view'), false);
});

test('Daily Closing lives in Accounts & Ledger and is available to branch logins', () => {
  const group = navigation.find((entry) => entry.label === 'Accounts & Ledger');
  const item = group.items.find((entry) => entry.url === '/accounting/daily-closing');

  assert.ok(item, 'Daily Closing nav item must exist in Accounts & Ledger');
  assert.equal(item.icon, 'bi-safe');
  assert.equal(item.branchLogin, true);
  assert.ok(item.roles.includes(ROLES.SHOPKEEPER));
  assert.ok(item.roles.includes(ROLES.OWNER));
});

test('branch allow-list permits the drawer page and close actions only', () => {
  assert.equal(isBranchAllowedPath('/accounting/daily-closing', 'GET'), true);
  assert.equal(isBranchAllowedPath('/accounting/daily-closing/adjustment', 'POST'), true);
  assert.equal(isBranchAllowedPath('/accounting/daily-closing/close', 'POST'), true);
  assert.equal(isBranchAllowedPath('/accounting/daily-closing/quick-close', 'POST'), true);
  assert.equal(isBranchAllowedPath('/accounting/daily-closing/snooze', 'POST'), true);

  assert.equal(isBranchAllowedPath('/accounting/daily-closing/reopen', 'POST'), false);
  assert.equal(isBranchAllowedPath('/accounting/daily-closing/close', 'GET'), false);
  assert.equal(isBranchAllowedPath('/accounting/dashboard', 'GET'), false);
});

/* -------------------------------------------------------------------------- */
/* Settings, chart of accounts & validators                                   */
/* -------------------------------------------------------------------------- */

test('Settings defaults a 09:00–21:00 business day with a reminder enabled', () => {
  const settings = new Settings({});
  assert.equal(settings.businessDayStart, '09:00');
  assert.equal(settings.businessDayEnd, '21:00');
  assert.equal(settings.defaultOpeningFloatPaisa, 0);
  assert.equal(settings.dailyClosingReminderEnabled, true);
  assert.equal(settings.validateSync(), undefined);
});

test('Settings rejects malformed business-day times', () => {
  assert.ok(new Settings({ businessDayStart: '25:00' }).validateSync().errors.businessDayStart);
  assert.ok(new Settings({ businessDayEnd: '9:5' }).validateSync().errors.businessDayEnd);
});

test('chart of accounts includes 6070 Cash Over & Short and the closing reference', () => {
  const account = DEFAULT_CHART_OF_ACCOUNTS.find((row) => row.code === '6070');
  assert.ok(account);
  assert.equal(account.name, 'Cash Over & Short');
  assert.equal(REFERENCE_TYPES.CLOSING, 'closing');
});

test('daily closing validators are exported and non-empty', () => {
  [adjustmentRules, closeRules, quickCloseRules, reopenRules].forEach((rules) => {
    assert.ok(Array.isArray(rules));
    assert.ok(rules.length >= 2);
  });
});

/* -------------------------------------------------------------------------- */
/* Printable sign-off & templates                                             */
/* -------------------------------------------------------------------------- */

test('buildDrawerClosingPdf generates a valid closed-drawer PDF', async () => {
  const buffer = await buildDrawerClosingPdf({
    drawer: {
      number: 'DC-2026-0001',
      branchCode: 'MAIN',
      branchName: 'Main Agency',
      businessDate: businessDateToDate('2026-11-18'),
      periodStart: new Date('2026-11-18T04:00:00.000Z'),
      periodEnd: new Date('2026-11-18T16:00:00.000Z'),
      status: 'closed',
      openingFloatPaisa: 500000,
      cashSalesPaisa: 1250000,
      cashExpensesPaisa: 150000,
      cashInPaisa: 0,
      cashOutPaisa: 0,
      expectedCashPaisa: 1600000,
      countedCashPaisa: 1595000,
      variancePaisa: -5000,
      varianceReason: 'Five hundred rupee note missing at handover',
      closedByName: 'Ali Raza',
      closedByRole: 'shopkeeper',
      closedAt: new Date('2026-11-18T16:10:00.000Z'),
      closingNotes: 'Drawer handed to night shift.',
      denominations: [
        { valuePaisa: 500000, label: 'Rs 5,000', count: 2, totalPaisa: 1000000 },
        { valuePaisa: 100000, label: 'Rs 1,000', count: 5, totalPaisa: 500000 },
        { valuePaisa: 10000, label: 'Rs 100', count: 9, totalPaisa: 90000 },
      ],
      adjustments: [
        { kind: 'out', amountPaisa: 20000, reason: 'Cleaning supplies', createdByName: 'Ali Raza' },
      ],
    },
    summary: null,
    settings: { companyName: 'Solar Agency' },
  });

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1000);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
});

test('daily closing, reminder, settings and expense templates compile', () => {
  const views = [
    'views/accounting/daily-closing.ejs',
    'views/partials/closing-reminder.ejs',
    'views/settings/index.ejs',
    'views/accounting/expenses.ejs',
    'views/layouts/admin.ejs',
  ];

  views.forEach((view) => {
    const source = fs.readFileSync(view, 'utf8');
    assert.doesNotThrow(() => ejs.compile(source, { filename: view }), `${view} must compile`);
  });
});
