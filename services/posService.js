'use strict';

const mongoose = require('mongoose');
const PosSale = require('../models/PosSale');
const Item = require('../models/Item');
const StockMovement = require('../models/StockMovement');
const Counter = require('../models/Counter');
const ApiError = require('../utils/ApiError');
const { toPaisa } = require('../utils/money');
const { text } = require('../utils/inputs');
const branchInventory = require('./branchInventoryService');
const accountingService = require('./accountingService');

async function nextNumber() {
  const year = new Date().getFullYear();
  const seq = await Counter.next(`pos_sale_${year}`);
  return `POS-${year}-${String(seq).padStart(5, '0')}`;
}

function arr(value) { return Array.isArray(value) ? value : value === undefined ? [] : [value]; }
function money(value, label) {
  try { const amount = toPaisa(String(value || '0')); if (amount < 0) throw new Error(); return amount; }
  catch (_err) { throw ApiError.badRequest(`Enter a valid ${label}.`); }
}

async function productOptions(branchId) {
  const { items } = await branchInventory.balancesForBranch(branchId);
  return items.filter((item) => item.branchStock > 0).map((item) => ({
    _id: item._id, sku: item.sku, name: item.name, brand: item.brand, unit: item.unit,
    stock: item.branchStock, wholesalePricePaisa: item.wholesalePricePaisa || item.sellingPricePaisa || 0,
    retailPricePaisa: item.retailPricePaisa || item.sellingPricePaisa || 0,
  }));
}

async function createSale(input, actor) {
  const branch = await branchInventory.getAccessibleBranch(actor, input.branch);
  const saleType = input.saleType === 'wholesale' ? 'wholesale' : 'retail';
  const itemIds = arr(input.item);
  const quantities = arr(input.quantity);
  const prices = arr(input.unitPrice);
  const discounts = arr(input.lineDiscount);
  const itemDocs = await Item.find({ _id: { $in: itemIds.filter(mongoose.isValidObjectId) } });
  const itemMap = new Map(itemDocs.map((item) => [String(item._id), item]));
  const lines = [];
  for (let i = 0; i < itemIds.length; i += 1) {
    const item = itemMap.get(String(itemIds[i]));
    if (!item) continue;
    const quantity = Number(quantities[i]);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (item.hasSerial) throw ApiError.badRequest(`${item.sku} is serial-tracked; POS serial selection must be configured before sale.`);
    const listed = saleType === 'wholesale'
      ? Number(item.wholesalePricePaisa || item.sellingPricePaisa || 0)
      : Number(item.retailPricePaisa || item.sellingPricePaisa || 0);
    const unitPrice = prices[i] === '' || prices[i] === undefined ? listed : money(prices[i], 'unit price');
    const discount = money(discounts[i] || '0', 'line discount');
    const gross = Math.round(quantity * unitPrice);
    if (discount > gross) throw ApiError.badRequest(`Discount for ${item.sku} cannot exceed its line value.`);
    const discountPercent = gross ? (discount / gross) * 100 : 0;
    if (['shopkeeper', 'sales'].includes(actor.role) && discountPercent > Number(item.maxDiscountPercent || 0) + 0.001) {
      throw ApiError.forbidden(`Discount for ${item.sku} exceeds the permitted ${item.maxDiscountPercent || 0}%.`);
    }
    const lineTotal = gross - discount;
    const costTotal = Math.round(quantity * Number(item.avgCostPaisa || item.lastPurchasePricePaisa || item.purchasePricePaisa || 0));
    lines.push({ item: item._id, sku: item.sku, name: item.name, unit: item.unit, quantity, priceType: saleType, listedUnitPricePaisa: listed, unitPricePaisa: unitPrice, discountPaisa: discount, lineTotalPaisa: lineTotal, unitCostPaisa: quantity ? Math.round(costTotal / quantity) : 0, costTotalPaisa: costTotal, profitPaisa: lineTotal - costTotal });
  }
  if (!lines.length) throw ApiError.badRequest('Add at least one product to the sale.');

  const reserved = [];
  try {
    for (const line of lines) {
      const balance = await branchInventory.deductStock(branch._id, line.item, line.quantity);
      reserved.push({ line, balance });
    }
  } catch (err) {
    for (const row of reserved) {
      await branchInventory.addStock(branch._id, row.line.item, row.line.quantity).catch(() => {});
      await branchInventory.syncItemTotal(row.line.item).catch(() => {});
    }
    if (sale && sale._id) await PosSale.updateOne({ _id: sale._id }, { $set: { status: 'cancelled', notes: 'Automatically cancelled because stock ledger posting failed.' } }).catch(() => {});
    throw err;
  }

  const subtotal = lines.reduce((sum, line) => sum + line.listedUnitPricePaisa * line.quantity, 0);
  const total = lines.reduce((sum, line) => sum + line.lineTotalPaisa, 0);
  const discount = subtotal - total;
  const totalCost = lines.reduce((sum, line) => sum + line.costTotalPaisa, 0);
  const paymentMethod = ['cash', 'bank', 'credit', 'mixed'].includes(input.paymentMethod) ? input.paymentMethod : 'cash';
  let paid = paymentMethod === 'credit' ? money(input.paid || '0', 'paid amount') : (input.paid ? money(input.paid, 'paid amount') : total);
  paid = Math.min(paid, total);
  let sale;
  try {
    sale = await PosSale.create({
      number: await nextNumber(), branch: branch._id, customer: mongoose.isValidObjectId(input.customer) ? input.customer : null,
      customerName: text(input.customerName, 150) || 'Walk-in Customer', customerPhone: text(input.customerPhone, 20), saleType, paymentMethod,
      items: lines, subtotalPaisa: subtotal, discountPaisa: discount, totalPaisa: total, paidPaisa: paid, duePaisa: total - paid,
      totalCostPaisa: totalCost, profitPaisa: total - totalCost, status: 'completed', notes: text(input.notes, 1000),
      createdBy: actor && actor._id ? actor._id : null,
      createdByName: actor ? (actor.name || actor.branchName || actor.branchCode || 'Branch login') : '',
    });
    for (const row of reserved) {
      await StockMovement.create({ item: row.line.item, branch: branch._id, type: 'OUT', qty: -row.line.quantity, unitCostPaisa: row.line.unitCostPaisa, balanceAfter: row.balance.quantity, reference: sale.number, referenceType: 'pos_sale', referenceId: sale._id, location: branch.name, occurredAt: sale.soldAt, createdBy: actor._id });
      await branchInventory.syncItemTotal(row.line.item);
    }
    try {
      const receiptAccount = paymentMethod === 'bank' ? '1020' : '1010';
      const journalLines = [];
      if (paid > 0) journalLines.push({ accountCode: receiptAccount, debitPaisa: paid, creditPaisa: 0, description: `${sale.number} payment received` });
      if (sale.duePaisa > 0) journalLines.push({ accountCode: '1030', debitPaisa: sale.duePaisa, creditPaisa: 0, description: `${sale.number} customer credit` });
      journalLines.push({ accountCode: '4010', debitPaisa: 0, creditPaisa: total, description: `${sale.number} POS revenue` });
      if (totalCost > 0) {
        journalLines.push({ accountCode: '5010', debitPaisa: totalCost, creditPaisa: 0, description: `${sale.number} cost of goods sold` });
        journalLines.push({ accountCode: '1040', debitPaisa: 0, creditPaisa: totalCost, description: `${sale.number} inventory issued` });
      }
      await accountingService.createJournalEntry({ date: sale.soldAt, memo: `POS sale ${sale.number} — ${sale.customerName}`, referenceType: 'sale', referenceId: sale._id, lines: journalLines, actor }, {});
    } catch (accountingError) {
      console.error('[accounting] POS posting error:', accountingError.message);
    }
  } catch (err) {
    for (const row of reserved) await branchInventory.addStock(branch._id, row.line.item, row.line.quantity).catch(() => {});
    throw err;
  }
  return sale;
}

async function listSales(query, actor) {
  const filter = { status: { $ne: 'cancelled' } };
  if (actor && ['shopkeeper', 'sales'].includes(actor.role) && actor.branch) filter.branch = actor.branch;
  else if (query.branch && mongoose.isValidObjectId(query.branch)) filter.branch = query.branch;
  if (query.from || query.to) {
    filter.soldAt = {};
    if (query.from) filter.soldAt.$gte = new Date(`${query.from}T00:00:00`);
    if (query.to) filter.soldAt.$lte = new Date(`${query.to}T23:59:59.999`);
  }
  const sales = await PosSale.find(filter).populate('branch', 'code name').populate('createdBy', 'name').sort({ soldAt: -1 }).limit(500).lean();
  const totals = sales.reduce((acc, sale) => { acc.sales += sale.totalPaisa || 0; acc.discount += sale.discountPaisa || 0; acc.profit += sale.profitPaisa || 0; return acc; }, { sales: 0, discount: 0, profit: 0 });
  return { sales, totals };
}

async function getSale(id, actor) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('POS sale not found.');
  const sale = await PosSale.findById(id).populate('branch').populate('createdBy', 'name').lean();
  if (!sale) throw ApiError.notFound('POS sale not found.');
  if (actor && ['shopkeeper', 'sales'].includes(actor.role) && actor.branch && String(sale.branch._id) !== String(actor.branch)) throw ApiError.forbidden();
  return sale;
}

async function cancelSale(id, actor) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('POS sale not found.');
  const sale = await PosSale.findOneAndUpdate(
    { _id: id, status: 'completed' },
    { $set: { status: 'cancelled' } },
    { new: true }
  );
  if (!sale) {
    const exists = await PosSale.exists({ _id: id });
    if (!exists) throw ApiError.notFound('POS sale not found.');
    throw ApiError.conflict('Only a completed POS sale can be cancelled.');
  }
  const branch = await branchInventory.getAccessibleBranch(null, sale.branch);
  for (const line of sale.items) {
    const balance = await branchInventory.addStock(sale.branch, line.item, line.quantity);
    await branchInventory.syncItemTotal(line.item);
    await StockMovement.create({ item: line.item, branch: sale.branch, type: 'IN', qty: line.quantity, unitCostPaisa: line.unitCostPaisa, balanceAfter: balance.quantity, reference: `${sale.number}-VOID`, referenceType: 'pos_return', referenceId: sale._id, location: branch.name, notes: 'POS sale cancelled and stock restored', occurredAt: new Date(), createdBy: actor._id });
  }
  sale.notes = `${sale.notes || ''}\nCancelled by ${actor.name} on ${new Date().toISOString()}`.trim();
  await sale.save();
  try {
    const receiptAccount = sale.paymentMethod === 'bank' ? '1020' : '1010';
    const lines = [{ accountCode: '4010', debitPaisa: sale.totalPaisa, creditPaisa: 0, description: `${sale.number} POS cancellation` }];
    if (sale.paidPaisa > 0) lines.push({ accountCode: receiptAccount, debitPaisa: 0, creditPaisa: sale.paidPaisa, description: `${sale.number} refund/reversal` });
    if (sale.duePaisa > 0) lines.push({ accountCode: '1030', debitPaisa: 0, creditPaisa: sale.duePaisa, description: `${sale.number} receivable reversal` });
    if (sale.totalCostPaisa > 0) {
      lines.push({ accountCode: '1040', debitPaisa: sale.totalCostPaisa, creditPaisa: 0, description: `${sale.number} inventory restored` });
      lines.push({ accountCode: '5010', debitPaisa: 0, creditPaisa: sale.totalCostPaisa, description: `${sale.number} COGS reversal` });
    }
    await accountingService.createJournalEntry({ date: new Date(), memo: `Cancelled POS sale ${sale.number}`, referenceType: 'sale', referenceId: sale._id, lines, actor }, {});
  } catch (accountingError) {
    console.error('[accounting] POS cancellation posting error:', accountingError.message);
  }
  return sale;
}

module.exports = { productOptions, createSale, listSales, getSale, cancelSale };
