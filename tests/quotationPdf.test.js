'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQuotationPdf } = require('../services/quotationPdfService');

test('buildQuotationPdf returns a valid PDF buffer with header, items, and commercial sections', async () => {
  const sampleQuotation = {
    quotationNumber: 'QT-2026-0001',
    revision: 1,
    status: 'draft',
    quotationDate: new Date('2026-05-01'),
    validUntil: new Date('2026-05-16'),
    customer: {
      name: 'Mian Usman Tariq',
      phone: '0300-1234567',
      address: 'House 42, Block Y, Phase 3, DHA',
      city: 'Lahore',
      disco: 'LESCO',
      electricityReferenceNo: '08 11223 9988776 U',
    },
    systemSummary: {
      capacityKw: 10.53,
      systemType: 'on_grid',
      panelCount: 18,
      inverterCapacityKw: 10,
      estimatedUnits: {
        daily: 42.1,
        monthly: 1264,
        yearly: 15168,
      },
    },
    items: [
      {
        itemSnapshot: {
          name: 'Longi Hi-MO 7 585W Bifacial Solar Panels',
          brand: 'Longi Solar',
          category: 'panel',
          wattage: 585,
          unit: 'pcs',
          warrantyYears: 25,
        },
        qty: 18,
        unitSellingPricePaisa: 1800000,
        totalSellingPricePaisa: 32400000,
        isOptionalExtra: false,
      },
      {
        itemSnapshot: {
          name: 'Huawei SUN2000-10KTL-M1 High Efficiency On-Grid Inverter',
          brand: 'Huawei',
          category: 'inverter',
          capacityKw: 10,
          unit: 'unit',
          warrantyYears: 5,
        },
        qty: 1,
        unitSellingPricePaisa: 38000000,
        totalSellingPricePaisa: 38000000,
        isOptionalExtra: false,
      },
      {
        itemSnapshot: {
          name: 'Type 1+2 DC Surge Protection Device (SPD)',
          brand: 'Schneider',
          category: 'other',
          unit: 'set',
          warrantyYears: 2,
        },
        qty: 1,
        unitSellingPricePaisa: 2500000,
        totalSellingPricePaisa: 2500000,
        isOptionalExtra: true,
      },
    ],
    totalItemSellingPricePaisa: 72900000,
    laborCostPaisa: 4500000,
    transportCostPaisa: 1500000,
    netMeteringCostPaisa: 3500000,
    additionalCostPaisa: 0,
    grossPricePaisa: 82400000,
    discountType: 'percent',
    discountPercent: 5,
    discountPaisa: 4120000,
    finalPricePaisa: 78280000,
    paymentOption: 'installment',
    paymentPlan: [
      { label: '50% Advance on Booking', percent: 50, amountPaisa: 39140000 },
      { label: '40% Upon Delivery of Equipment at Site', percent: 40, amountPaisa: 31312000 },
      { label: '10% Upon Testing, Commissioning & Handover', percent: 10, amountPaisa: 7828000 },
    ],
    warrantyTerms: '• 25 Years Linear Performance Warranty on Longi Solar PV Modules.\n• 5 Years Full Replacement Warranty on Inverter.\n• 1 Year Comprehensive System Workmanship & Support.',
    terms: '1. Quotation validity is 15 calendar days.\n2. Civil and mounting structure customized according to site survey.\n3. Net metering subject to DISCO regulations.',
    includeUrdu: true,
    urduNotes: 'وارنٹی کلیمز مینوفیکچرر کی شرائط کے مطابق لاگو ہوں گے۔ نیٹ میٹرنگ کے عمل کی منظوری متعلقہ ڈسکوز (DISCO) کے قوانین سے مشروط ہے۔',
  };

  const sampleSettings = {
    companyName: 'Apex Solar Energy Solutions',
    legalName: 'Apex Green Energy Pvt Ltd',
    phone: '042-35789000',
    email: 'proposals@apexsolar.pk',
    address: 'Plot 12-C, Commercial Zone, Gulberg III',
    city: 'Lahore',
    ntn: '7654321-9',
    strn: '32-77-8765-432-11',
    bankName: 'Meezan Bank Ltd',
    bankAccountTitle: 'Apex Green Energy Pvt Ltd',
    bankAccountNumber: '02010108765432',
    bankIban: 'PK65MEZN0002010108765432',
  };

  const buffer = await buildQuotationPdf(sampleQuotation, sampleSettings);

  assert.ok(Buffer.isBuffer(buffer), 'Result should be a Buffer');
  assert.equal(buffer.subarray(0, 4).toString('ascii'), '%PDF', 'Buffer should begin with %PDF magic bytes');
  assert.ok(buffer.length > 3000, `PDF buffer length should be substantial (actual: ${buffer.length})`);
});
