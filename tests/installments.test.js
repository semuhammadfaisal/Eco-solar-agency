'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const InstallmentPlan = require('../models/InstallmentPlan');
const Installment = require('../models/Installment');
const InstallmentPayment = require('../models/InstallmentPayment');
const Cheque = require('../models/Cheque');
const {
  generateInstallmentSchedule,
  checkMaterialIssueGate,
} = require('../services/installmentService');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');

test('generateInstallmentSchedule accurately splits total payable and assigns remainder', () => {
  // Financed: PKR 700,000 (70,000,000 paisa), Markup: PKR 105,000 (10,500,000 paisa)
  // Total payable: PKR 805,000 (80,500,000 paisa) across 12 monthly installments
  const schedule = generateInstallmentSchedule({
    financedAmountPaisa: 70000000,
    markupPaisa: 10500000,
    installmentCount: 12,
    frequency: 'monthly',
    startDate: new Date('2026-06-01'),
  });

  assert.equal(schedule.length, 12);

  // Sum of installments must exactly equal total payable down to the paisa
  const totalSum = schedule.reduce((acc, it) => acc + it.amountPaisa, 0);
  assert.equal(totalSum, 80500000);

  // Monthly base check
  const baseAmount = Math.floor(80500000 / 12);
  assert.equal(schedule[0].amountPaisa, baseAmount);
  assert.equal(schedule[0].installmentNumber, 1);
  assert.equal(schedule[11].installmentNumber, 12);

  // Remainder added to last installment
  const remainder = 80500000 - baseAmount * 12;
  assert.equal(schedule[11].amountPaisa, baseAmount + remainder);

  // Dates progression
  assert.equal(schedule[0].dueDate.toISOString().slice(0, 10), '2026-06-01');
  assert.equal(schedule[1].dueDate.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(schedule[11].dueDate.toISOString().slice(0, 10), '2027-05-01');
});

test('generateInstallmentSchedule supports bi-monthly and quarterly frequencies', () => {
  const biMonthly = generateInstallmentSchedule({
    financedAmountPaisa: 60000000,
    markupPaisa: 0,
    installmentCount: 3,
    frequency: 'bi_monthly',
    startDate: new Date('2026-01-15'),
  });
  assert.equal(biMonthly.length, 3);
  assert.equal(biMonthly[0].dueDate.toISOString().slice(0, 10), '2026-01-15');
  assert.equal(biMonthly[1].dueDate.toISOString().slice(0, 10), '2026-03-15');
  assert.equal(biMonthly[2].dueDate.toISOString().slice(0, 10), '2026-05-15');

  const quarterly = generateInstallmentSchedule({
    financedAmountPaisa: 40000000,
    markupPaisa: 0,
    installmentCount: 4,
    frequency: 'quarterly',
    startDate: new Date('2026-01-01'),
  });
  assert.equal(quarterly.length, 4);
  assert.equal(quarterly[1].dueDate.toISOString().slice(0, 10), '2026-04-01');
  assert.equal(quarterly[2].dueDate.toISOString().slice(0, 10), '2026-07-01');
  assert.equal(quarterly[3].dueDate.toISOString().slice(0, 10), '2026-10-01');
});

test('InstallmentPlan model validates required planNumber, sale, customer, and amounts', () => {
  const plan = new InstallmentPlan({});
  const err = plan.validateSync();
  assert.ok(err.errors.planNumber);
  assert.ok(err.errors.sale);
  assert.ok(err.errors.customer);
  assert.ok(err.errors.totalSaleAmountPaisa);
  assert.ok(err.errors.downPaymentPaisa);
  assert.ok(err.errors.financedAmountPaisa);
  assert.ok(err.errors.totalPayablePaisa);
  assert.ok(err.errors.installmentCount);
  assert.ok(err.errors.startDate);
});

test('Installment model computes balanceDuePaisa virtual correctly', () => {
  const inst = new Installment({
    installmentPlan: new mongoose.Types.ObjectId(),
    customer: new mongoose.Types.ObjectId(),
    installmentNumber: 1,
    dueDate: new Date(),
    amountPaisa: 6500000,
    paidAmountPaisa: 4000000,
    lateFeeAssessedPaisa: 50000,
    lateFeePaidPaisa: 20000,
    lateFeeWaivedPaisa: 10000,
    status: 'partial',
  });

  assert.equal(inst.validateSync(), undefined);

  // Total due: 65,000 + 500 = 65,500 PKR (6,550,000 paisa)
  // Total settled: 40,000 + 200 + 100 = 40,300 PKR (4,030,000 paisa)
  // Remaining balance: 25,200 PKR (2,520,000 paisa)
  assert.equal(inst.balanceDuePaisa, 2520000);
});

test('InstallmentPayment model validates required receiptNumber, plan, customer, amount', () => {
  const payment = new InstallmentPayment({});
  const err = payment.validateSync();
  assert.ok(err.errors.receiptNumber);
  assert.ok(err.errors.installmentPlan);
  assert.ok(err.errors.customer);
  assert.ok(err.errors.amountPaisa);
  assert.ok(err.errors.receivedBy);
});

test('Cheque model validates required number, bank, amount, and date', () => {
  const ch = new Cheque({});
  const err = ch.validateSync();
  assert.ok(err.errors.chequeNumber);
  assert.ok(err.errors.bankName);
  assert.ok(err.errors.amountPaisa);
  assert.ok(err.errors.chequeDate);
  assert.ok(err.errors.customer);
});

test('Cheque model links a payment to a sale, POS order and installment plan', () => {
  const ch = new Cheque({
    chequeNumber: '889901',
    bankName: 'Meezan Bank',
    amountPaisa: 105000000,
    chequeDate: new Date('2026-12-01'),
    customer: new mongoose.Types.ObjectId(),
    sale: new mongoose.Types.ObjectId(),
    posSale: new mongoose.Types.ObjectId(),
    installmentPlan: new mongoose.Types.ObjectId(),
    installmentNumber: 2,
  });

  assert.equal(ch.validateSync(), undefined);
  assert.ok(ch.sale);
  assert.ok(ch.posSale);
  assert.ok(ch.installmentPlan);
  assert.equal(ch.installmentNumber, 2);
  assert.equal(ch.status, 'held');
});

test('Cheque links stay optional for general customer payments', () => {
  const ch = new Cheque({
    chequeNumber: '889902',
    bankName: 'HBL',
    amountPaisa: 5000000,
    chequeDate: new Date('2026-12-15'),
    customer: new mongoose.Types.ObjectId(),
  });

  assert.equal(ch.validateSync(), undefined);
  assert.equal(ch.sale, null);
  assert.equal(ch.posSale, null);
  assert.equal(ch.installmentPlan, null);
  assert.equal(ch.installmentNumber, null);
});

test('Installment security permissions restrict reschedule, waiver and override', () => {
  assert.equal(can(ROLES.SALES, 'installments.view'), true);
  assert.equal(can(ROLES.SALES, 'installments.collect'), true);
  assert.equal(can(ROLES.SALES, 'installments.reschedule'), false);
  assert.equal(can(ROLES.SALES, 'installments.waive'), false);
  assert.equal(can(ROLES.SALES, 'installments.security_override'), false);

  assert.equal(can(ROLES.MANAGER, 'installments.reschedule'), true);
  assert.equal(can(ROLES.MANAGER, 'installments.waive'), true);
  assert.equal(can(ROLES.MANAGER, 'installments.security_override'), false);

  assert.equal(can(ROLES.OWNER, 'installments.security_override'), true);
  assert.equal(can(ROLES.OWNER, 'installments.reschedule'), true);
  assert.equal(can(ROLES.OWNER, 'installments.waive'), true);
});
