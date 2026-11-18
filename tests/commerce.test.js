'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const { ALL_ROLES } = require('../config/roles');
const { can } = require('../config/permissions');
const Item = require('../models/Item');
const PosSale = require('../models/PosSale');
const BranchStock = require('../models/BranchStock');

test('shopkeeper role is available and limited to operational commerce permissions', () => {
  assert.ok(ALL_ROLES.includes('shopkeeper'));
  assert.equal(can('shopkeeper', 'pos.sell'), true);
  assert.equal(can('shopkeeper', 'inventory.view'), true);
  assert.equal(can('shopkeeper', 'profit.view'), false);
  assert.equal(can('shopkeeper', 'branches.manage'), false);
  assert.equal(can('shopkeeper', 'pos.cancel'), false);
});

test('item supports wholesale, retail and shopkeeper discount pricing', () => {
  const item = new Item({ sku: 'TEST-01', name: 'Test product' });
  assert.equal(item.wholesalePricePaisa, 0);
  assert.equal(item.retailPricePaisa, 0);
  assert.equal(item.maxDiscountPercent, 0);
});

test('POS sale snapshots price, discount, cost and actual profit', () => {
  const paths = Object.keys(PosSale.schema.paths);
  for (const field of ['subtotalPaisa', 'discountPaisa', 'totalPaisa', 'totalCostPaisa', 'profitPaisa', 'branch']) {
    assert.ok(paths.includes(field), `missing POS field ${field}`);
  }
  const linePaths = Object.keys(PosSale.schema.path('items').schema.paths);
  for (const field of ['listedUnitPricePaisa', 'unitPricePaisa', 'discountPaisa', 'costTotalPaisa', 'profitPaisa']) {
    assert.ok(linePaths.includes(field), `missing POS line field ${field}`);
  }
});

test('branch inventory enforces one balance per product and branch', () => {
  const uniqueIndex = BranchStock.schema.indexes().find(([keys, options]) => keys.branch === 1 && keys.item === 1 && options.unique);
  assert.ok(uniqueIndex);
});

test('new commerce EJS templates compile', () => {
  const dir = path.join(__dirname, '..', 'views', 'commerce');
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.ejs'))) {
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.doesNotThrow(() => ejs.compile(source, { filename: path.join(dir, name) }), name);
  }
  const dashboard = path.join(__dirname, '..', 'views', 'dashboard', 'index.ejs');
  assert.doesNotThrow(() => ejs.compile(fs.readFileSync(dashboard, 'utf8'), { filename: dashboard }), 'dashboard/index.ejs');
});
