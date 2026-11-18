'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const SystemConfig = require('../models/SystemConfig');

test('SystemConfig model validates required name, number', () => {
  const config = new SystemConfig({});
  const err = config.validateSync();
  assert.ok(err.errors.name);
  assert.ok(err.errors.number);
});

test('SystemConfig defaults approvalStatus to none and supports pending/approved/rejected', () => {
  const config = new SystemConfig({
    name: '5kW System',
    number: 'SYS-0001',
  });
  assert.equal(config.approvalStatus, 'none');
  assert.equal(config.requiresApproval, false);

  config.approvalStatus = 'pending';
  config.requiresApproval = true;
  assert.equal(config.validateSync(), undefined);

  config.approvalStatus = 'invalid-status';
  const err = config.validateSync();
  assert.ok(err.errors.approvalStatus);
});

test('SystemConfig lines validate required item and positive qty', () => {
  const config = new SystemConfig({
    name: '10kW System',
    number: 'SYS-0002',
    lines: [
      { qty: 0 },
    ],
  });
  const err = config.validateSync();
  assert.ok(err.errors['lines.0.item']);
  assert.ok(err.errors['lines.0.qty']);
});

test('SystemConfig lines accept valid item reference and numbers', () => {
  const config = new SystemConfig({
    name: '10kW System',
    number: 'SYS-0002',
    lines: [
      {
        item: new mongoose.Types.ObjectId(),
        qty: 18,
        unitCostPaisa: 1500000,
        unitSellingPricePaisa: 2000000,
        totalCostPaisa: 27000000,
        totalSellingPricePaisa: 36000000,
        marginPaisa: 9000000,
        marginPercent: 25.0,
      },
    ],
  });
  assert.equal(config.validateSync(), undefined);
  assert.equal(config.lines.length, 1);
  assert.equal(config.lines[0].qty, 18);
  assert.equal(config.lines[0].totalSellingPricePaisa, 36000000);
});
