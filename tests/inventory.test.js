'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSerialInput, parseSerialBarcodeInput, normalizeBarcode, isValidBarcode } = require('../utils/serials');
const {
  ITEM_CATEGORIES,
  ITEM_CATEGORY_LABELS,
  ITEM_CATEGORY_BADGES,
  ITEM_CATEGORY_ICONS,
} = require('../config/inventory');
const { movingAverageCost } = require('../services/stockService');
const {
  parseBranchPrice,
  defaultBranchPrice,
} = require('../services/transferService');
const {
  applyItemVisibility,
  applyMovementVisibility,
} = require('../services/itemService');

test('serial CSV parsing ignores a header after leading blank rows', () => {
  const parsed = parseSerialInput('\n\uFEFFSerial No,Notes\nabc-001,Panel A\nABC-002,Panel B');

  assert.deepEqual(parsed.serials, ['ABC-001', 'ABC-002']);
  assert.deepEqual(parsed.invalid, []);
  assert.deepEqual(parsed.duplicates, []);
  assert.equal(parsed.tooMany, false);
});

test('serial parsing reports case-insensitive duplicates', () => {
  const parsed = parseSerialInput('panel-001\nPANEL-001');

  assert.deepEqual(parsed.serials, ['PANEL-001']);
  assert.deepEqual(parsed.duplicates, ['PANEL-001']);
});

test('serial registry parser accepts an optional barcode column', () => {
  const parsed = parseSerialBarcodeInput(
    'Serial,Barcode\nsn-001, 8901234567890\nSN-002\nSN-003,abc-9'
  );

  assert.deepEqual(parsed.rows, [
    { serial: 'SN-001', barcode: '8901234567890' },
    { serial: 'SN-002', barcode: '' },
    { serial: 'SN-003', barcode: 'ABC-9' },
  ]);
  assert.deepEqual(parsed.serials, ['SN-001', 'SN-002', 'SN-003']);
  assert.deepEqual(parsed.duplicates, []);
  assert.deepEqual(parsed.duplicateBarcodes, []);
  assert.deepEqual(parsed.invalid, []);
  assert.equal(parsed.tooMany, false);
});

test('serial registry parser reports duplicate barcodes and invalid rows', () => {
  const parsed = parseSerialBarcodeInput('SN-001,890\nSN-002,890\nbad serial!,123\nSN-003,bad barcode!');

  assert.deepEqual(parsed.serials, ['SN-001']);
  assert.deepEqual(parsed.duplicateBarcodes, ['890']);
  assert.equal(parsed.invalid.length, 2);
});

test('barcode values are normalised and validated', () => {
  assert.equal(normalizeBarcode('  ab-123 '), 'AB-123');
  assert.equal(isValidBarcode('8901234567890'), true);
  assert.equal(isValidBarcode('abc/123+4'), true);
  assert.equal(isValidBarcode('bad barcode'), false);
  assert.equal(isValidBarcode(''), false);
});

test('item cost fields are removed for roles without purchase-price permission', () => {
  const item = {
    currentStock: 3,
    minStock: 5,
    purchasePricePaisa: 10000,
    avgCostPaisa: 9000,
    lastPurchasePricePaisa: 9500,
  };

  applyItemVisibility(item, { role: 'manager' });

  assert.equal(item.isLowStock, true);
  assert.equal('purchasePricePaisa' in item, false);
  assert.equal('avgCostPaisa' in item, false);
  assert.equal('lastPurchasePricePaisa' in item, false);
  assert.equal('stockValuePaisa' in item, false);
});

test('stock movement costs are removed for unauthorised roles and retained for storekeepers', () => {
  const managerRows = [{ type: 'IN', qty: 1, unitCostPaisa: 125000 }];
  const storekeeperRows = [{ type: 'IN', qty: 1, unitCostPaisa: 125000 }];

  applyMovementVisibility(managerRows, { role: 'manager' });
  applyMovementVisibility(storekeeperRows, { role: 'storekeeper' });

  assert.equal('unitCostPaisa' in managerRows[0], false);
  assert.equal(storekeeperRows[0].unitCostPaisa, 125000);
});

test('every inventory category has a label, badge and icon', () => {
  for (const key of ITEM_CATEGORIES) {
    assert.equal(typeof ITEM_CATEGORY_LABELS[key], 'string', `${key} label`);
    assert.ok(ITEM_CATEGORY_LABELS[key].length > 0, `${key} label is not empty`);
    assert.equal(typeof ITEM_CATEGORY_BADGES[key], 'string', `${key} badge`);
    assert.equal(typeof ITEM_CATEGORY_ICONS[key], 'string', `${key} icon`);
  }

  assert.ok(ITEM_CATEGORIES.includes('power_bank'));
  assert.ok(ITEM_CATEGORIES.includes('accessory'));
});

test('moving average cost weights old stock against the received quantity', () => {
  // 10 units at 1000 plus 10 units at 2000 averages to 1500.
  assert.equal(movingAverageCost(10, 100000, 10, 200000), 150000);
  // Receiving the first units adopts the received cost outright.
  assert.equal(movingAverageCost(0, 0, 5, 125000), 125000);
  // Rounding is to the nearest paisa.
  assert.equal(movingAverageCost(1, 100000, 2, 100001), 100001);
  // No stock and no received cost is zero rather than NaN.
  assert.equal(movingAverageCost(0, 0, 0, 0), 0);
});

test('transfer branch price defaults to retail, then selling, then cost', () => {
  assert.equal(defaultBranchPrice({ retailPricePaisa: 250000, sellingPricePaisa: 200000, avgCostPaisa: 150000 }), 250000);
  assert.equal(defaultBranchPrice({ retailPricePaisa: 0, sellingPricePaisa: 200000, avgCostPaisa: 150000 }), 200000);
  assert.equal(defaultBranchPrice({ retailPricePaisa: 0, sellingPricePaisa: 0, avgCostPaisa: 150000 }), 150000);
  assert.equal(defaultBranchPrice({}), 0);
});

test('transfer branch price parses rupees and falls back only when blank', () => {
  assert.equal(parseBranchPrice('1,250.50', 0), 125050);
  assert.equal(parseBranchPrice('', 90000), 90000);
  assert.equal(parseBranchPrice(undefined, 90000), 90000);
  assert.equal(parseBranchPrice('0', 90000), 0);
  assert.throws(() => parseBranchPrice('-5', 0), /cannot be negative|valid branch price/i);
  assert.throws(() => parseBranchPrice('abc', 0), /valid branch price/i);
});
