'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { validationResult } = require('express-validator');

const Quotation = require('../models/Quotation');
const Sale = require('../models/Sale');
const { can } = require('../config/permissions');
const { ROLES } = require('../config/roles');
const {
  QUOTATION_STATUSES,
  PAYMENT_OPTIONS,
  DEFAULT_MILESTONES,
} = require('../config/quotations');
const {
  formatQuotationNumber,
  sanitizeQuotationForRole,
  normalizePaymentPlan,
  normalizeQuotationItems,
  resolveQuotationCustomer,
} = require('../services/quotationService');
const { quotationRules } = require('../validators/quotationValidators');

async function runQuotationRules(body) {
  const req = { body };
  for (const rule of quotationRules) {
    await rule(req, {}, () => {});
  }
  return validationResult(req).array().map((error) => error.msg);
}

test('Quotation model validates required quotationNumber, customer, items', () => {
  const quote = new Quotation({});
  const err = quote.validateSync();
  assert.ok(err.errors.quotationNumber);
  assert.ok(err.errors.customer);
});

test('Quotation defaults status to draft, revision to 1, and supports valid statuses', () => {
  const quote = new Quotation({
    quotationNumber: 'QT-2026-0001',
    customer: new mongoose.Types.ObjectId(),
    assignedTo: new mongoose.Types.ObjectId(),
    validUntil: new Date(),
    finalPricePaisa: 150000000,
  });

  assert.equal(quote.status, 'draft');
  assert.equal(quote.revision, 1);
  assert.equal(quote.isLatestRevision, true);
  assert.equal(quote.paymentOption, 'cash');

  quote.status = 'approved';
  assert.equal(quote.validateSync(), undefined);

  quote.status = 'unsupported_status';
  const err = quote.validateSync();
  assert.ok(err.errors.status);
});

test('Quotation accepts optional extra items and snapshot details', () => {
  const quote = new Quotation({
    quotationNumber: 'QT-2026-0002',
    customer: new mongoose.Types.ObjectId(),
    assignedTo: new mongoose.Types.ObjectId(),
    validUntil: new Date(),
    items: [
      {
        itemSnapshot: {
          name: 'Tier-1 Bifacial 585W Panels',
          category: 'panel',
          brand: 'Longi',
          wattage: 585,
        },
        qty: 18,
        unitSellingPricePaisa: 1800000,
        unitCostPaisa: 1400000,
        totalSellingPricePaisa: 32400000,
        totalCostPaisa: 25200000,
        isOptionalExtra: false,
      },
      {
        itemSnapshot: {
          name: 'Surge Protective Device (Type II)',
          category: 'other',
          brand: 'Schneider',
        },
        qty: 1,
        unitSellingPricePaisa: 1500000,
        unitCostPaisa: 900000,
        totalSellingPricePaisa: 1500000,
        totalCostPaisa: 900000,
        isOptionalExtra: true,
      },
    ],
    finalPricePaisa: 33900000,
  });

  assert.equal(quote.validateSync(), undefined);
  assert.equal(quote.items.length, 2);
  assert.equal(quote.items[0].isOptionalExtra, false);
  assert.equal(quote.items[1].isOptionalExtra, true);
});

test('Sale model requires saleNumber, invoiceNumber, customer, assignedTo and amountPaisa but allows direct projects', () => {
  const sale = new Sale({});
  const err = sale.validateSync();
  assert.ok(err.errors.saleNumber);
  assert.ok(err.errors.invoiceNumber);
  assert.ok(err.errors.customer);
  assert.ok(err.errors.assignedTo);
  assert.ok(err.errors.amountPaisa);
  // Direct projects have no quotation and default to the direct origin.
  assert.equal(err.errors.quotation, undefined);
  assert.equal(sale.quotation, null);
  assert.equal(sale.origin, 'quotation');
  assert.equal(sale.projectTitle, '');
});

test('Sale model supports milestone payment plans and status progression', () => {
  const sale = new Sale({
    saleNumber: 'SAL-2026-0001',
    invoiceNumber: 'INV-2026-0001',
    quotation: new mongoose.Types.ObjectId(),
    customer: new mongoose.Types.ObjectId(),
    assignedTo: new mongoose.Types.ObjectId(),
    amountPaisa: 150000000,
    paymentType: 'installment',
    paymentPlan: [
      { label: 'Booking Advance', percent: 50, amountPaisa: 75000000, isPaid: true },
      { label: 'On Delivery', percent: 40, amountPaisa: 60000000, isPaid: false },
      { label: 'Commissioning', percent: 10, amountPaisa: 15000000, isPaid: false },
    ],
    status: 'confirmed',
  });

  assert.equal(sale.validateSync(), undefined);
  assert.equal(sale.paymentPlan.length, 3);
  assert.equal(sale.paymentPlan[0].isPaid, true);
  assert.equal(sale.paymentPlan[1].isPaid, false);

  sale.status = 'in_progress';
  assert.equal(sale.validateSync(), undefined);
  sale.status = 'completed';
  assert.equal(sale.validateSync(), undefined);
});

test('sanitizeQuotationForRole hides costs and profits from sales role', () => {
  const fullQuotation = {
    quotationNumber: 'QT-2026-0001',
    finalPricePaisa: 100000000,
    totalBaseCostPaisa: 75000000,
    netProfitPaisa: 25000000,
    netProfitMarginPercent: 25.0,
    salesCommissionPaisa: 2000000,
    items: [
      {
        itemSnapshot: { name: '585W Panel' },
        qty: 10,
        unitSellingPricePaisa: 1800000,
        unitCostPaisa: 1400000,
        totalCostPaisa: 14000000,
        totalSellingPricePaisa: 18000000,
      },
    ],
  };

  // For sales user:
  const salesScoped = sanitizeQuotationForRole(fullQuotation, { role: ROLES.SALES });
  assert.equal(salesScoped.finalPricePaisa, 100000000);
  assert.equal('totalBaseCostPaisa' in salesScoped, false);
  assert.equal('netProfitPaisa' in salesScoped, false);
  assert.equal('salesCommissionPaisa' in salesScoped, false);
  assert.equal('unitCostPaisa' in salesScoped.items[0], false);
  assert.equal('totalCostPaisa' in salesScoped.items[0], false);
  assert.equal(salesScoped.items[0].unitSellingPricePaisa, 1800000);

  // For owner / accountant:
  const ownerScoped = sanitizeQuotationForRole(fullQuotation, { role: ROLES.OWNER });
  assert.equal(ownerScoped.totalBaseCostPaisa, 75000000);
  assert.equal(ownerScoped.netProfitPaisa, 25000000);
  assert.equal(ownerScoped.items[0].unitCostPaisa, 1400000);
});

test('normalizePaymentPlan creates 100% advance for cash and supports installment milestones', () => {
  const cashPlan = normalizePaymentPlan('cash', [], 100000000);
  assert.equal(cashPlan.length, 1);
  assert.equal(cashPlan[0].percent, 100);
  assert.equal(cashPlan[0].amountPaisa, 100000000);

  const installmentPlan = normalizePaymentPlan('installment', [], 100000000);
  assert.equal(installmentPlan.length, 3);
  assert.equal(installmentPlan[0].percent, 50);
  assert.equal(installmentPlan[0].amountPaisa, 50000000);
  assert.equal(installmentPlan[1].percent, 40);
  assert.equal(installmentPlan[1].amountPaisa, 40000000);
  assert.equal(installmentPlan[2].percent, 10);
  assert.equal(installmentPlan[2].amountPaisa, 10000000);
});

test('normalizeQuotationItems keeps description separate from the item name', () => {
  const lines = normalizeQuotationItems([
    {
      item: null,
      itemSnapshot: {
        name: 'Longi Hi-MO 7 585W Panel',
        category: 'panel',
        unit: 'pcs',
      },
      qty: 2,
      unitSellingPrice: 18000,
      description: 'Tier-1 bifacial module with 25-year performance warranty',
    },
  ]);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].itemSnapshot.name, 'Longi Hi-MO 7 585W Panel');
  assert.equal(lines[0].notes, 'Tier-1 bifacial module with 25-year performance warranty');
  assert.equal(lines[0].qty, 2);
  assert.equal(lines[0].unitSellingPricePaisa, 1800000);
  assert.equal(lines[0].totalSellingPricePaisa, 3600000);
});

test('Quotation permissions separate sales viewing/managing from approval', () => {
  assert.equal(can(ROLES.SALES, 'quotations.view'), true);
  assert.equal(can(ROLES.SALES, 'quotations.manage'), true);
  assert.equal(can(ROLES.SALES, 'customers.manage'), true);
  assert.equal(can(ROLES.SALES, 'quotations.approve'), false);
  assert.equal(can(ROLES.SALES, 'sales.view'), true);
  assert.equal(can(ROLES.SALES, 'sales.manage'), false);

  assert.equal(can(ROLES.OWNER, 'quotations.approve'), true);
  assert.equal(can(ROLES.OWNER, 'sales.manage'), true);
  assert.equal(can(ROLES.ACCOUNTANT, 'costs.view'), true);
  assert.equal(can(ROLES.ACCOUNTANT, 'profit.view'), true);
});

test('quotation numbers use the year and a zero-padded sequence', () => {
  assert.equal(formatQuotationNumber(2026, 1), 'QT-2026-0001');
  assert.equal(formatQuotationNumber(2026, 12567), 'QT-2026-12567');
});

test('quotation rules require a customer only in existing-customer mode', async () => {
  const existingErrors = await runQuotationRules({
    customerMode: 'existing',
    validUntil: '2026-12-01',
  });
  assert.ok(existingErrors.includes('Select a valid customer.'));

  const existingWithHiddenNewFields = await runQuotationRules({
    customerMode: 'existing',
    customer: '507f1f77bcf86cd799439011',
    cnic: 'not-a-cnic',
    validUntil: '2026-12-01',
  });
  assert.deepEqual(existingWithHiddenNewFields, []);

  const newErrors = await runQuotationRules({
    customerMode: 'new',
    validUntil: '2026-12-01',
  });
  assert.ok(newErrors.includes('Customer name is required.'));
  assert.ok(newErrors.includes('Customer phone number is required.'));
  assert.equal(newErrors.includes('Select a valid customer.'), false);
});

test('quotation rules accept a complete new-customer submission', async () => {
  const errors = await runQuotationRules({
    customerMode: 'new',
    name: 'New Solar Client',
    phone: '03001234567',
    customerType: 'residential',
    customerSource: 'walk_in',
    validUntil: '2026-12-01',
  });
  assert.deepEqual(errors, []);
});

test('new-customer quotations refuse actors without customer create permission', async () => {
  await assert.rejects(
    resolveQuotationCustomer(
      { customerMode: 'new', name: 'New Solar Client', phone: '03001234567' },
      { role: ROLES.ACCOUNTANT, _id: new mongoose.Types.ObjectId() },
      null
    ),
    /permission to create customers/
  );
});
