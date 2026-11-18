'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const Sale = require('../models/Sale');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');
const {
  normalizeProjectMilestones,
  statusFilterForScope,
} = require('../services/saleService');

test('direct projects validate without a quotation', () => {
  const sale = new Sale({
    saleNumber: 'SAL-2026-0100',
    invoiceNumber: 'INV-2026-0100',
    customer: new mongoose.Types.ObjectId(),
    assignedTo: new mongoose.Types.ObjectId(),
    amountPaisa: 150000000,
    origin: 'direct',
    projectTitle: '10 kW Hybrid — DHA Phase 5',
    startDate: new Date('2026-03-01'),
    paymentType: 'cash',
  });

  assert.equal(sale.validateSync(), undefined);
  assert.equal(sale.quotation, null);
  assert.equal(sale.origin, 'direct');
  assert.equal(sale.projectTitle, '10 kW Hybrid — DHA Phase 5');
  assert.equal(sale.status, 'confirmed');
});

test('cash projects get a single 100% advance milestone', () => {
  const plan = normalizeProjectMilestones('cash', [], 150000000);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].percent, 100);
  assert.equal(plan[0].amountPaisa, 150000000);
  assert.equal(plan[0].isPaid, false);
});

test('installment projects default to the 50 / 40 / 10 schedule', () => {
  const plan = normalizeProjectMilestones('installment', [], 100000000);

  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((row) => row.percent), [50, 40, 10]);
  assert.deepEqual(plan.map((row) => row.amountPaisa), [50000000, 40000000, 10000000]);
});

test('installment projects accept custom milestone percentages', () => {
  const plan = normalizeProjectMilestones(
    'installment',
    [
      { label: 'Booking', percent: 30 },
      { label: 'Delivery', percent: 70 },
    ],
    200000000
  );

  assert.equal(plan.length, 2);
  assert.equal(plan[0].amountPaisa, 60000000);
  assert.equal(plan[1].amountPaisa, 140000000);
});

test('installment milestones cannot exceed 100 percent', () => {
  assert.throws(
    () =>
      normalizeProjectMilestones(
        'installment',
        [
          { label: 'Booking', percent: 60 },
          { label: 'Delivery', percent: 50 },
        ],
        100000000
      ),
    /cannot exceed 100%/
  );
});

test('project scopes map to the right status filters', () => {
  assert.equal(statusFilterForScope('all'), null);
  assert.deepEqual(statusFilterForScope('ongoing'), { $in: ['confirmed', 'in_progress'] });
  assert.equal(statusFilterForScope('completed'), 'completed');
  assert.equal(statusFilterForScope('cancelled'), 'cancelled');
});

test('sales staff can start projects without gaining material-issue rights', () => {
  assert.equal(can(ROLES.SALES, 'projects.manage'), true);
  assert.equal(can(ROLES.SALES, 'sales.manage'), false);
  assert.equal(can(ROLES.MANAGER, 'projects.manage'), true);
  assert.equal(can(ROLES.OWNER, 'projects.manage'), true);
  assert.equal(can(ROLES.ACCOUNTANT, 'projects.manage'), false);
});
