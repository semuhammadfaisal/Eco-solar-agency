'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const MessageTemplate = require('../models/MessageTemplate');
const NotificationLog = require('../models/NotificationLog');
const PromiseToPay = require('../models/PromiseToPay');
const RecoveryNote = require('../models/RecoveryNote');
const AppNotification = require('../models/AppNotification');
const {
  interpolate,
  normalizePakistaniPhone,
} = require('../services/notificationService');
const { getAgingBucket } = require('../services/recoveryService');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');

test('notificationService.interpolate correctly substitutes template variables', () => {
  const tpl = 'Hello {{name}}, your due amount is PKR {{amount}} for plan {{planNumber}}.';
  const vars = {
    name: 'Muhammad Asif',
    amount: '45,000',
    planNumber: 'IP-2026-0099',
  };

  const output = interpolate(tpl, vars);
  assert.equal(output, 'Hello Muhammad Asif, your due amount is PKR 45,000 for plan IP-2026-0099.');
});

test('notificationService.interpolate handles missing variables gracefully', () => {
  const tpl = 'Hi {{name}}, missing var is {{missing}}.';
  const output = interpolate(tpl, { name: 'Ali' });
  assert.equal(output, 'Hi Ali, missing var is .');
});

test('notificationService.normalizePakistaniPhone normalizes various Pakistani phone formats', () => {
  assert.equal(normalizePakistaniPhone('03001234567'), '923001234567');
  assert.equal(normalizePakistaniPhone('+923001234567'), '923001234567');
  assert.equal(normalizePakistaniPhone('923001234567'), '923001234567');
  assert.equal(normalizePakistaniPhone('0300-1234567'), '923001234567');
  assert.equal(normalizePakistaniPhone(''), '');
});

test('recoveryService.getAgingBucket maps days overdue into correct delinquency tranches', () => {
  assert.equal(getAgingBucket(0), 'current');
  assert.equal(getAgingBucket(-5), 'current'); // Not yet due
  assert.equal(getAgingBucket(1), '1-30');
  assert.equal(getAgingBucket(15), '1-30');
  assert.equal(getAgingBucket(30), '1-30');
  assert.equal(getAgingBucket(31), '31-60');
  assert.equal(getAgingBucket(60), '31-60');
  assert.equal(getAgingBucket(61), '61-90');
  assert.equal(getAgingBucket(90), '61-90');
  assert.equal(getAgingBucket(91), '90+');
  assert.equal(getAgingBucket(150), '90+');
});

test('MessageTemplate model validates required fields and language fields', () => {
  const tpl = new MessageTemplate({
    slug: 'reminder_test',
    title: 'Test Reminder',
    category: 'installment_reminder',
    preferredLanguage: 'roman_urdu',
    romanUrduBody: 'Aapki qist PKR {{amount}} due hai.',
  });

  assert.equal(tpl.validateSync(), undefined);

  const invalidTpl = new MessageTemplate({});
  const err = invalidTpl.validateSync();
  assert.ok(err.errors.slug);
  assert.ok(err.errors.title);
});

test('NotificationLog model validates channel, stage, and body', () => {
  const log = new NotificationLog({
    channel: 'whatsapp',
    stage: 'due_today',
    body: 'Test notification body',
    status: 'sent',
    idempotencyKey: 'inst123_due_today_whatsapp',
  });

  assert.equal(log.validateSync(), undefined);

  const invalidLog = new NotificationLog({});
  const err = invalidLog.validateSync();
  assert.ok(err.errors.channel);
  assert.ok(err.errors.stage);
  assert.ok(err.errors.body);
});

test('PromiseToPay model validates plan, customer, promisedDate, and positive amount', () => {
  const ptp = new PromiseToPay({
    installmentPlan: new mongoose.Types.ObjectId(),
    customer: new mongoose.Types.ObjectId(),
    promisedDate: new Date(),
    promisedAmountPaisa: 3000000,
    recordedBy: new mongoose.Types.ObjectId(),
    status: 'pending',
  });

  assert.equal(ptp.validateSync(), undefined);

  const invalidPtp = new PromiseToPay({
    promisedAmountPaisa: 0,
  });
  const err = invalidPtp.validateSync();
  assert.ok(err.errors.installmentPlan);
  assert.ok(err.errors.customer);
  assert.ok(err.errors.promisedDate);
  assert.ok(err.errors.promisedAmountPaisa);
  assert.ok(err.errors.recordedBy);
});

test('RecoveryNote model validates customer, officer, notes and outcome enum', () => {
  const note = new RecoveryNote({
    customer: new mongoose.Types.ObjectId(),
    officer: new mongoose.Types.ObjectId(),
    callOutcome: 'promise_to_pay',
    notes: 'Customer promised payment by Friday via Raast.',
  });

  assert.equal(note.validateSync(), undefined);

  const invalidNote = new RecoveryNote({});
  const err = invalidNote.validateSync();
  assert.ok(err.errors.customer);
  assert.ok(err.errors.officer);
  assert.ok(err.errors.notes);
});

test('AppNotification model validates title, message, and type enum', () => {
  const notif = new AppNotification({
    title: 'Post-Dated Cheque Due',
    message: 'Cheque #1234 matures tomorrow.',
    type: 'cheque_due',
    link: '/installments/cheques',
  });

  assert.equal(notif.validateSync(), undefined);

  const invalidNotif = new AppNotification({});
  const err = invalidNotif.validateSync();
  assert.ok(err.errors.title);
  assert.ok(err.errors.message);
});

test('Recovery permissions restrict plan recovery actions', () => {
  // Sales can view recovery list but cannot manage recovery actions
  assert.equal(can(ROLES.SALES, 'recovery.view'), true);
  assert.equal(can(ROLES.SALES, 'recovery.manage'), false);

  // Accountant can view recovery and manage collections
  assert.equal(can(ROLES.ACCOUNTANT, 'recovery.view'), true);
  assert.equal(can(ROLES.ACCOUNTANT, 'recovery.manage'), true);

  // Manager and Owner have full recovery management
  assert.equal(can(ROLES.MANAGER, 'recovery.view'), true);
  assert.equal(can(ROLES.MANAGER, 'recovery.manage'), true);

  assert.equal(can(ROLES.OWNER, 'recovery.view'), true);
  assert.equal(can(ROLES.OWNER, 'recovery.manage'), true);
});
