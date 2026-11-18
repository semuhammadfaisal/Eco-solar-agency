'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReceiptPdf, buildCustomerStatementPdf } = require('../services/installmentPdfService');

test('buildReceiptPdf produces a valid PDF buffer with allocation and words in PKR', async () => {
  const samplePayment = {
    receiptNumber: 'RC-0001',
    paymentDate: new Date('2026-06-15'),
    amountPaisa: 6500000,
    paymentMethod: 'bank',
    reference: 'FT-20260615-99881',
    customer: {
      name: 'Chaudhry Pervaiz Iqbal',
      code: 'CUS-0012',
      phone: '0321-4455667',
      address: 'House 14-A, Canal View Housing Society',
      city: 'Lahore',
    },
    installmentPlan: {
      planNumber: 'IP-2026-0001',
    },
    allocations: [
      {
        installmentNumber: 1,
        principalPaidPaisa: 6450000,
        lateFeePaidPaisa: 50000,
        totalAllocatedPaisa: 6500000,
        wasFullySettled: true,
      },
    ],
    excessAdvancePaisa: 0,
    remainingPlanBalancePaisa: 71500000,
    receivedBy: {
      name: 'Ali Raza (Cashier)',
    },
  };

  const sampleSettings = {
    companyName: 'Apex Solar Energy Solutions',
    phone: '042-35789000',
    address: 'Plot 12-C, Commercial Zone, Gulberg III, Lahore',
    ntn: '7654321-9',
  };

  const buffer = await buildReceiptPdf(samplePayment, sampleSettings);

  assert.ok(Buffer.isBuffer(buffer), 'Result should be a Buffer');
  assert.equal(buffer.subarray(0, 4).toString('ascii'), '%PDF', 'Buffer should begin with %PDF magic bytes');
  assert.ok(buffer.length > 2500, `Receipt PDF should be substantial (actual: ${buffer.length})`);
});

test('buildCustomerStatementPdf produces a valid PDF buffer with transactions ledger', async () => {
  const sampleCustomer = {
    name: 'Chaudhry Pervaiz Iqbal',
    code: 'CUS-0012',
    phone: '0321-4455667',
    cnic: '35202-9988776-1',
    city: 'Lahore',
    disco: 'LESCO',
    electricityReferenceNo: '08 11223 9988776 U',
  };

  const sampleLedgerData = {
    summary: {
      totalContractValuePaisa: 100000000,
      totalDownPaymentsPaisa: 30000000,
      totalFinancedPaisa: 70000000,
      totalMarkupPaisa: 8000000,
      totalPaidPaisa: 36500000,
      totalRemainingBalancePaisa: 41500000,
    },
    transactions: [
      {
        date: new Date('2026-05-10'),
        type: 'Plan Financed',
        reference: 'IP-2026-0001',
        description: 'Contract financed for 12 monthly installments',
        debitPaisa: 78000000,
        creditPaisa: 0,
        runningBalancePaisa: 78000000,
      },
      {
        date: new Date('2026-05-10'),
        type: 'Down Payment',
        reference: 'DP-IP-2026-0001',
        description: 'Advance booking payment received',
        debitPaisa: 0,
        creditPaisa: 30000000,
        runningBalancePaisa: 48000000,
      },
      {
        date: new Date('2026-06-15'),
        type: 'Receipt',
        reference: 'RC-0001',
        description: 'Payment via BANK (FT-99881)',
        debitPaisa: 0,
        creditPaisa: 6500000,
        runningBalancePaisa: 41500000,
      },
    ],
  };

  const sampleSettings = {
    companyName: 'Apex Solar Energy Solutions',
    phone: '042-35789000',
    address: 'Plot 12-C, Commercial Zone, Gulberg III, Lahore',
  };

  const buffer = await buildCustomerStatementPdf(sampleCustomer, sampleLedgerData, sampleSettings);

  assert.ok(Buffer.isBuffer(buffer), 'Result should be a Buffer');
  assert.equal(buffer.subarray(0, 4).toString('ascii'), '%PDF', 'Buffer should begin with %PDF magic bytes');
  assert.ok(buffer.length > 2500, `Statement PDF should be substantial (actual: ${buffer.length})`);
});
