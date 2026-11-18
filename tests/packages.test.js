'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Package = require('../models/Package');
const { normalizePackageItems } = require('../services/packageService');

test('normalizePackageItems ignores invalid ObjectIds and non-positive quantities', async () => {
  const validId = new mongoose.Types.ObjectId();
  const raw = [
    { itemId: 'invalid-id', qty: 5 },
    { item: validId, qty: 10, notes: 'Grade A' },
    { item: validId, qty: -2 },
    { item: null, qty: 3 },
  ];

  const normalized = await normalizePackageItems(raw);
  assert.equal(normalized.length, 1);
  assert.equal(String(normalized[0].item), String(validId));
  assert.equal(normalized[0].qty, 10);
  assert.equal(normalized[0].notes, 'Grade A');
});

test('Package model validates required name, code, capacityKw', () => {
  const pkg = new Package({
    systemType: 'on_grid',
  });
  const err = pkg.validateSync();
  assert.ok(err.errors.name);
  assert.ok(err.errors.code);
  assert.ok(err.errors.capacityKw);
});
