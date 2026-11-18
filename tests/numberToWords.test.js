'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { numberToWordsPKR } = require('../utils/format');

test('numberToWordsPKR correctly converts amounts into Pakistani words', () => {
  assert.equal(numberToWordsPKR(0), 'Zero Rupees Only');
  assert.equal(numberToWordsPKR(500), 'Five Hundred Rupees Only');
  assert.equal(numberToWordsPKR(1250), 'One Thousand Two Hundred Fifty Rupees Only');
  assert.equal(numberToWordsPKR(45000), 'Forty-Five Thousand Rupees Only');
  assert.equal(numberToWordsPKR(125000), 'One Lac Twenty-Five Thousand Rupees Only');
  assert.equal(numberToWordsPKR(1450000), 'Fourteen Lac Fifty Thousand Rupees Only');
  assert.equal(numberToWordsPKR(25000000), 'Two Crore Fifty Lac Rupees Only');
});

test('numberToWordsPKR supports paisa conversion flag', () => {
  assert.equal(numberToWordsPKR(145000000, true), 'Fourteen Lac Fifty Thousand Rupees Only');
});
