'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FULL_EQUITY_BPS,
  clampEquityBps,
  equityPercent,
  allocateProfit,
} = require('../utils/partners');

test('equity helpers clamp and render basis points', () => {
  assert.equal(FULL_EQUITY_BPS, 10000);
  assert.equal(clampEquityBps(5000), 5000);
  assert.equal(clampEquityBps(-10), 0);
  assert.equal(clampEquityBps(12000), 10000);
  assert.equal(equityPercent(3333), 33.33);
  assert.equal(equityPercent(5000), 50);
});

test('two partners at 50% each split PKR 100 exactly in half', () => {
  const shares = allocateProfit(10000, [
    { _id: 'a', name: 'A', equityBps: 5000, isActive: true },
    { _id: 'b', name: 'B', equityBps: 5000, isActive: true },
  ]);

  assert.deepEqual(
    shares.map((row) => row.sharePaisa),
    [5000, 5000]
  );
  assert.equal(
    shares.reduce((sum, row) => sum + row.sharePaisa, 0),
    10000
  );
});

test('largest-remainder allocation keeps every paisa when profit does not divide evenly', () => {
  const shares = allocateProfit(10001, [
    { _id: 'a', equityBps: 5000, isActive: true },
    { _id: 'b', equityBps: 5000, isActive: true },
  ]);

  assert.equal(
    shares.reduce((sum, row) => sum + row.sharePaisa, 0),
    10001
  );
  assert.deepEqual(
    shares.map((row) => row.sharePaisa).sort((x, y) => y - x),
    [5001, 5000]
  );
});

test('thirds allocation never loses or invents paisa', () => {
  const shares = allocateProfit(10000, [
    { _id: 'a', equityBps: 3333, isActive: true },
    { _id: 'b', equityBps: 3333, isActive: true },
    { _id: 'c', equityBps: 3333, isActive: true },
  ]);

  const total = shares.reduce((sum, row) => sum + row.sharePaisa, 0);
  assert.equal(total, 9999);
  assert.deepEqual(
    shares.map((row) => row.sharePaisa),
    [3333, 3333, 3333]
  );
});

test('a loss is split with the same equity ratios and stays negative', () => {
  const shares = allocateProfit(-10000, [
    { _id: 'a', equityBps: 5000, isActive: true },
    { _id: 'b', equityBps: 5000, isActive: true },
  ]);

  assert.deepEqual(
    shares.map((row) => row.sharePaisa),
    [-5000, -5000]
  );
});

test('profit is only distributed up to the equity that is actually assigned', () => {
  const shares = allocateProfit(10000, [
    { _id: 'a', equityBps: 5000, isActive: true },
    { _id: 'b', equityBps: 2500, isActive: true },
  ]);

  assert.deepEqual(
    shares.map((row) => row.sharePaisa),
    [5000, 2500]
  );
  assert.equal(
    shares.reduce((sum, row) => sum + row.sharePaisa, 0),
    7500
  );
});

test('inactive partners do not receive a profit share', () => {
  const shares = allocateProfit(10000, [
    { _id: 'a', equityBps: 5000, isActive: true },
    { _id: 'b', equityBps: 5000, isActive: false },
  ]);

  assert.equal(shares.length, 1);
  assert.equal(shares[0].sharePaisa, 5000);
});

test('zero profit and no partners are handled safely', () => {
  assert.deepEqual(allocateProfit(0, [{ _id: 'a', equityBps: 5000, isActive: true }]), [
    {
      partner: { _id: 'a', equityBps: 5000, isActive: true },
      equityBps: 5000,
      equityPercent: 50,
      sharePaisa: 0,
    },
  ]);
  assert.deepEqual(allocateProfit(10000, []), []);
});
