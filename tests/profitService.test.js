'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateLine,
  calculateSystemSpecs,
  calculateSystem,
  applyRoleVisibility,
} = require('../services/profitService');

test('calculateLine computes line costs, selling prices, margins and handles below-cost', () => {
  const line = calculateLine({
    qty: 10,
    unitSellingPricePaisa: 2500000, // PKR 25,000
    unitCostPaisa: 2000000,        // PKR 20,000
  });

  assert.equal(line.qty, 10);
  assert.equal(line.totalCostPaisa, 20000000); // 200,000 PKR
  assert.equal(line.totalSellingPricePaisa, 25000000); // 250,000 PKR
  assert.equal(line.marginPaisa, 5000000); // 50,000 PKR
  assert.equal(line.marginPercent, 20.0);
  assert.equal(line.isBelowCost, false);

  const belowCostLine = calculateLine({
    qty: 2,
    unitSellingPricePaisa: 10000,
    unitCostPaisa: 15000,
  });
  assert.equal(belowCostLine.isBelowCost, true);
  assert.ok(belowCostLine.marginPaisa < 0);
});

test('calculateSystemSpecs aggregates kW, panel counts, and energy units', () => {
  const lines = [
    { qty: 10, itemSnapshot: { category: 'panel', wattage: 550 } }, // 5.5 kW
    { qty: 1, itemSnapshot: { category: 'inverter', capacityKw: 6 } },
    { qty: 2, itemSnapshot: { category: 'battery', capacityKw: 5 } }, // 10 kWh
  ];

  const specs = calculateSystemSpecs(lines, { surveyMonthlyUnitsPerKw: 120 });
  assert.equal(specs.panelCount, 10);
  assert.equal(specs.capacityKw, 5.5);
  assert.equal(specs.inverterCapacityKw, 6);
  assert.equal(specs.batteryCapacityKwh, 10);
  assert.equal(specs.estimatedUnits.monthly, 660); // 5.5 * 120
  assert.equal(specs.estimatedUnits.daily, 22);    // 660 / 30
  assert.equal(specs.estimatedUnits.yearly, 7920); // 660 * 12
});

test('calculateSystem calculates total profit, deducts transport, labor, commission and discount', () => {
  const system = calculateSystem(
    {
      lines: [
        {
          itemSnapshot: { name: '550W Tier 1 Panel', category: 'panel', wattage: 550 },
          qty: 10,
          unitCostPaisa: 1500000,        // 15,000 PKR
          unitSellingPricePaisa: 2000000 // 20,000 PKR -> 200,000 PKR total
        },
      ],
      laborCostPaisa: 3000000,       // 30,000 PKR
      transportCostPaisa: 1000000,   // 10,000 PKR
      netMeteringCostPaisa: 5000000, // 50,000 PKR
      additionalCostPaisa: 0,
      discountType: 'percent',
      discountValue: 10,             // 10% discount
      salesCommissionRateBps: 200,   // 2% commission (200 bps)
    },
    {
      minMarginPercent: 10,
      maxDiscountPercentWithoutApproval: 5,
      surveyMonthlyUnitsPerKw: 120,
    }
  );

  // Total items cost = 150,000 PKR (15,000,000 paisa)
  // Total overheads = 30k + 10k + 50k = 90k PKR (9,000,000 paisa)
  // Total base cost = 240,000 PKR (24,000,000 paisa)
  // Total items selling = 200,000 PKR
  // Gross selling price = 200k + 90k = 290,000 PKR (29,000,000 paisa)
  assert.equal(system.totalItemCostPaisa, 15000000);
  assert.equal(system.totalBaseCostPaisa, 24000000);
  assert.equal(system.grossPricePaisa, 29000000);

  // 10% discount on 290k = 29,000 PKR (2,900,000 paisa)
  // Final selling price = 261,000 PKR (26,100,000 paisa)
  assert.equal(system.discountPaisa, 2900000);
  assert.equal(system.finalPricePaisa, 26100000);

  // 2% commission on 261k = 5,220 PKR (522,000 paisa)
  assert.equal(system.salesCommissionPaisa, 522000);

  // Net profit = finalPrice (26,100,000) - totalBaseCost (24,000,000) - commission (522,000)
  // = 1,578,000 paisa (15,780 PKR)
  assert.equal(system.netProfitPaisa, 1578000);

  // Net profit margin % = (15,780 / 261,000) * 100 = 6.05%
  assert.equal(system.netProfitMarginPercent, 6.05);

  // Warnings check:
  // 10% discount exceeds max discount (5%), so requiresApproval = true!
  // Net margin 6.05% is less than minMarginPercent (10%), so low margin warning!
  assert.equal(system.requiresApproval, true);
  assert.ok(system.warnings.some((w) => w.includes('Discount approval required')));
  assert.ok(system.warnings.some((w) => w.includes('Low margin warning')));
});

test('Role-aware responses: owner and accountant see cost and profit, sales gets only selling prices', () => {
  const calculation = calculateSystem(
    {
      lines: [
        {
          itemSnapshot: { name: 'Inverter 6kW', category: 'inverter', capacityKw: 6 },
          qty: 1,
          unitCostPaisa: 18000000,
          unitSellingPricePaisa: 22000000,
        },
      ],
      laborCostPaisa: 2000000,
      transportCostPaisa: 1000000,
      netMeteringCostPaisa: 0,
      discountType: 'percent',
      discountValue: 0,
    },
    { minMarginPercent: 10, maxDiscountPercentWithoutApproval: 5 }
  );

  const ownerView = applyRoleVisibility(calculation, { role: 'owner' });
  assert.equal(ownerView.totalItemCostPaisa, 18000000);
  assert.equal(ownerView.netProfitPaisa, 4000000);
  assert.equal(ownerView.lines[0].unitCostPaisa, 18000000);

  const accountantView = applyRoleVisibility(calculation, { role: 'accountant' });
  assert.equal(accountantView.totalItemCostPaisa, 18000000);
  assert.equal(accountantView.netProfitPaisa, 4000000);
  assert.equal(accountantView.lines[0].unitCostPaisa, 18000000);

  const salesView = applyRoleVisibility(calculation, { role: 'sales' });
  // Sales MUST NOT see costs or profits
  assert.equal('totalItemCostPaisa' in salesView, false);
  assert.equal('totalBaseCostPaisa' in salesView, false);
  assert.equal('netProfitPaisa' in salesView, false);
  assert.equal('netProfitMarginPercent' in salesView, false);
  assert.equal('unitCostPaisa' in salesView.lines[0], false);
  assert.equal('marginPaisa' in salesView.lines[0], false);

  // Sales MUST see selling prices and specs
  assert.equal(salesView.finalPricePaisa, 25000000);
  assert.equal(salesView.lines[0].unitSellingPricePaisa, 22000000);
  assert.equal(salesView.inverterCapacityKw, 6);
});
