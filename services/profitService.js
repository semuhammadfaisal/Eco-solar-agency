'use strict';

const { can } = require('../config/permissions');

/**
 * Calculates financial metrics for a single line item.
 *
 * @param {object} params
 * @param {number} params.qty
 * @param {number} params.unitSellingPricePaisa
 * @param {number} params.unitCostPaisa
 * @returns {object}
 */
function calculateLine({ qty, unitSellingPricePaisa, unitCostPaisa }) {
  const quantity = Math.max(0, Number(qty) || 0);
  const unitCost = Math.max(0, Math.round(Number(unitCostPaisa) || 0));
  const unitPrice = Math.max(0, Math.round(Number(unitSellingPricePaisa) || 0));

  const totalCostPaisa = Math.round(quantity * unitCost);
  const totalSellingPricePaisa = Math.round(quantity * unitPrice);
  const marginPaisa = totalSellingPricePaisa - totalCostPaisa;
  const marginPercent =
    totalSellingPricePaisa > 0
      ? Number(((marginPaisa / totalSellingPricePaisa) * 100).toFixed(2))
      : 0;

  return {
    qty: quantity,
    unitCostPaisa: unitCost,
    unitSellingPricePaisa: unitPrice,
    totalCostPaisa,
    totalSellingPricePaisa,
    marginPaisa,
    marginPercent,
    isBelowCost: totalSellingPricePaisa < totalCostPaisa,
  };
}

/**
 * Calculates system specs (kW capacity, panel count, generation units).
 *
 * @param {Array} lines
 * @param {object} settings
 * @returns {object}
 */
function calculateSystemSpecs(lines = [], settings = {}) {
  let panelCount = 0;
  let panelCapacityWatts = 0;
  let inverterCapacityKw = 0;
  let batteryCapacityKwh = 0;

  for (const line of lines) {
    const qty = Number(line.qty) || 0;
    const item = line.itemSnapshot || line.item || {};
    const category = (item.category || '').toLowerCase();
    const wattage = Number(item.wattage) || 0;
    const capacityKw = Number(item.capacityKw) || 0;

    if (category === 'panel') {
      panelCount += qty;
      panelCapacityWatts += qty * wattage;
    } else if (category === 'inverter') {
      inverterCapacityKw += qty * (capacityKw || wattage / 1000);
    } else if (category === 'battery') {
      batteryCapacityKwh += qty * capacityKw;
    }
  }

  // System capacity is based on panel capacity (kW) if panels exist; otherwise inverter capacity
  const calculatedPanelKw = panelCapacityWatts / 1000;
  const capacityKw = calculatedPanelKw > 0 ? calculatedPanelKw : inverterCapacityKw;
  const roundedCapacityKw = Number(capacityKw.toFixed(2));

  const monthlyUnitsPerKw = Number(settings.surveyMonthlyUnitsPerKw) || 120;
  const monthly = Math.round(roundedCapacityKw * monthlyUnitsPerKw);
  const daily = Number((monthly / 30).toFixed(1));
  const yearly = Math.round(monthly * 12);

  return {
    capacityKw: roundedCapacityKw,
    panelCount: Math.round(panelCount),
    inverterCapacityKw: Number(inverterCapacityKw.toFixed(2)),
    batteryCapacityKwh: Number(batteryCapacityKwh.toFixed(2)),
    estimatedUnits: { daily, monthly, yearly },
  };
}

/**
 * Authoritative server-side calculation for a solar system configuration.
 *
 * @param {object} input System data
 * @param {object} settings Company settings
 * @returns {object}
 */
function calculateSystem(input = {}, settings = {}) {
  const minMarginPercent =
    settings.minMarginPercent !== undefined ? Number(settings.minMarginPercent) : 10;
  const maxDiscountPercentWithoutApproval =
    settings.maxDiscountPercentWithoutApproval !== undefined
      ? Number(settings.maxDiscountPercentWithoutApproval)
      : 5;

  // 1. Process line items
  let totalItemCostPaisa = 0;
  let totalItemSellingPricePaisa = 0;
  const processedLines = [];
  const warnings = [];

  for (const line of input.lines || []) {
    const item = line.itemSnapshot || line.item || {};
    const lineCalc = calculateLine({
      qty: line.qty,
      unitSellingPricePaisa: line.unitSellingPricePaisa,
      unitCostPaisa: line.unitCostPaisa,
    });

    totalItemCostPaisa += lineCalc.totalCostPaisa;
    totalItemSellingPricePaisa += lineCalc.totalSellingPricePaisa;

    if (lineCalc.isBelowCost && lineCalc.qty > 0) {
      warnings.push(`Item "${item.name || item.sku || 'Item'}" is priced below cost.`);
    }

    processedLines.push({
      item: line.item ? (line.item._id || line.item) : null,
      itemSnapshot: {
        sku: item.sku || '',
        name: item.name || '',
        category: item.category || 'other',
        brand: item.brand || '',
        model: item.model || '',
        unit: item.unit || 'pcs',
        wattage: item.wattage !== undefined ? item.wattage : null,
        capacityKw: item.capacityKw !== undefined ? item.capacityKw : null,
      },
      qty: lineCalc.qty,
      unitCostPaisa: lineCalc.unitCostPaisa,
      unitSellingPricePaisa: lineCalc.unitSellingPricePaisa,
      totalCostPaisa: lineCalc.totalCostPaisa,
      totalSellingPricePaisa: lineCalc.totalSellingPricePaisa,
      marginPaisa: lineCalc.marginPaisa,
      marginPercent: lineCalc.marginPercent,
      notes: line.notes || '',
    });
  }

  // 2. Overheads & installation costs (in integer paisa)
  const laborCostPaisa = Math.max(0, Math.round(Number(input.laborCostPaisa) || 0));
  const transportCostPaisa = Math.max(0, Math.round(Number(input.transportCostPaisa) || 0));
  const netMeteringCostPaisa = Math.max(0, Math.round(Number(input.netMeteringCostPaisa) || 0));
  const additionalCostPaisa = Math.max(0, Math.round(Number(input.additionalCostPaisa) || 0));

  const totalOverheadsPaisa =
    laborCostPaisa + transportCostPaisa + netMeteringCostPaisa + additionalCostPaisa;

  // Base cost = item costs + labor + transport + net-metering + additional
  const totalBaseCostPaisa = totalItemCostPaisa + totalOverheadsPaisa;

  // Gross selling price = item selling prices + overhead charges
  const grossPricePaisa = totalItemSellingPricePaisa + totalOverheadsPaisa;

  // 3. Discount calculation
  const discountType = input.discountType === 'amount' ? 'amount' : 'percent';
  const discountValue = Math.max(0, Number(input.discountValue) || 0);
  let discountPaisa = 0;
  let discountPercent = 0;

  if (discountType === 'percent') {
    discountPercent = Math.min(100, discountValue);
    discountPaisa = Math.round(grossPricePaisa * (discountPercent / 100));
  } else {
    // discountValue is provided in paisa or rupees depending on caller
    discountPaisa = Math.min(grossPricePaisa, Math.round(discountValue));
    discountPercent =
      grossPricePaisa > 0 ? Number(((discountPaisa / grossPricePaisa) * 100).toFixed(2)) : 0;
  }

  // 4. Final selling price
  const finalPricePaisa = Math.max(0, grossPricePaisa - discountPaisa);

  // 5. Sales commission (basis points: 100 bps = 1.00%)
  const salesCommissionRateBps = Math.max(0, Math.round(Number(input.salesCommissionRateBps) || 0));
  const salesCommissionPaisa = Math.round(finalPricePaisa * (salesCommissionRateBps / 10000));

  // 6. Net profit & margin
  const netProfitPaisa = finalPricePaisa - totalBaseCostPaisa - salesCommissionPaisa;
  const netProfitMarginPercent =
    finalPricePaisa > 0 ? Number(((netProfitPaisa / finalPricePaisa) * 100).toFixed(2)) : 0;

  // 7. Sizing & energy specs
  const specs = calculateSystemSpecs(processedLines, settings);

  // 8. Warnings and approval requirement
  let requiresApproval = false;

  if (finalPricePaisa < totalBaseCostPaisa) {
    warnings.push('Below-cost warning: Final selling price is below the total base cost.');
    requiresApproval = true;
  } else if (netProfitMarginPercent < minMarginPercent) {
    warnings.push(
      `Low margin warning: Net profit margin (${netProfitMarginPercent}%) is below company minimum (${minMarginPercent}%).`
    );
  }

  if (discountPercent > maxDiscountPercentWithoutApproval) {
    warnings.push(
      `Discount approval required: Discount of ${discountPercent.toFixed(1)}% exceeds the ${maxDiscountPercentWithoutApproval}% threshold.`
    );
    requiresApproval = true;
  }

  return {
    ...specs,
    lines: processedLines,
    laborCostPaisa,
    transportCostPaisa,
    netMeteringCostPaisa,
    additionalCostPaisa,
    totalItemCostPaisa,
    totalItemSellingPricePaisa,
    totalBaseCostPaisa,
    grossPricePaisa,
    discountType,
    discountValue,
    discountPaisa,
    discountPercent,
    salesCommissionRateBps,
    salesCommissionPaisa,
    finalPricePaisa,
    netProfitPaisa,
    netProfitMarginPercent,
    warnings,
    requiresApproval,
  };
}

/**
 * Strips confidential cost, commission, and profit fields for roles that cannot view them
 * (e.g. Sales). Owner and Accountant retain full visibility.
 *
 * @param {object} calculation
 * @param {object|string} user
 * @returns {object} Sanitized copy
 */
function applyRoleVisibility(calculation, user) {
  if (!calculation) return calculation;

  const role = typeof user === 'string' ? user : user && user.role;
  const canSeeCosts = can(role, 'costs.view');
  const canSeeProfit = can(role, 'profit.view');

  // If user has both costs.view and profit.view (Owner, Accountant, Manager), return full data
  if (canSeeCosts && canSeeProfit) {
    return calculation;
  }

  // Create deep clone
  const sanitized = JSON.parse(JSON.stringify(calculation));

  // Strip line item costs & margins
  if (Array.isArray(sanitized.lines)) {
    sanitized.lines = sanitized.lines.map((line) => {
      const safeLine = { ...line };
      if (!canSeeCosts) {
        delete safeLine.unitCostPaisa;
        delete safeLine.totalCostPaisa;
      }
      if (!canSeeProfit) {
        delete safeLine.marginPaisa;
        delete safeLine.marginPercent;
        delete safeLine.isBelowCost;
      }
      return safeLine;
    });
  }

  // Strip system level costs
  if (!canSeeCosts) {
    delete sanitized.totalItemCostPaisa;
    delete sanitized.laborCostPaisa;
    delete sanitized.transportCostPaisa;
    delete sanitized.netMeteringCostPaisa;
    delete sanitized.additionalCostPaisa;
    delete sanitized.totalBaseCostPaisa;
  }

  // Strip system level profits & commissions
  if (!canSeeProfit) {
    delete sanitized.salesCommissionRateBps;
    delete sanitized.salesCommissionPaisa;
    delete sanitized.netProfitPaisa;
    delete sanitized.netProfitMarginPercent;

    // Filter out internal cost/margin warnings for sales
    sanitized.warnings = (sanitized.warnings || []).map((w) => {
      if (w.includes('Below-cost warning') || w.includes('priced below cost') || w.includes('Low margin')) {
        return 'Pricing review required: This configuration requires management review.';
      }
      return w;
    });
  }

  return sanitized;
}

module.exports = {
  calculateLine,
  calculateSystemSpecs,
  calculateSystem,
  applyRoleVisibility,
};
