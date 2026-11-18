'use strict';

const mongoose = require('mongoose');
const Branch = require('../models/Branch');
const Brand = require('../models/Brand');
const BranchStock = require('../models/BranchStock');
const PosSale = require('../models/PosSale');
const Item = require('../models/Item');

async function getCommerceDashboard(actor) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const restrictedBranch = actor && ['shopkeeper', 'sales'].includes(actor.role) && actor.branch
    ? new mongoose.Types.ObjectId(String(actor.branch)) : null;
  const saleMatch = { status: 'completed', soldAt: { $gte: start, $lt: end } };
  if (restrictedBranch) saleMatch.branch = restrictedBranch;
  const stockMatch = restrictedBranch ? { branch: restrictedBranch } : {};

  const [branchCount, brandCount, salesRows, branchRows, lowStockRows, stockRows, legacyStockRows] = await Promise.all([
    restrictedBranch ? Promise.resolve(1) : Branch.countDocuments({ isActive: true }),
    Brand.countDocuments({ isActive: true }),
    PosSale.aggregate([{ $match: saleMatch }, { $group: { _id: null, salesPaisa: { $sum: '$totalPaisa' }, profitPaisa: { $sum: '$profitPaisa' }, discountsPaisa: { $sum: '$discountPaisa' }, count: { $sum: 1 } } }]),
    PosSale.aggregate([{ $match: saleMatch }, { $group: { _id: '$branch', salesPaisa: { $sum: '$totalPaisa' }, profitPaisa: { $sum: '$profitPaisa' }, count: { $sum: 1 } } }, { $sort: { salesPaisa: -1 } }, { $lookup: { from: 'branches', localField: '_id', foreignField: '_id', as: 'branch' } }, { $unwind: { path: '$branch', preserveNullAndEmptyArrays: true } }]),
    BranchStock.aggregate([{ $match: stockMatch }, { $match: { $expr: { $lte: ['$quantity', '$minStock'] } } }, { $count: 'count' }]),
    BranchStock.aggregate([{ $match: stockMatch }, { $group: { _id: null, units: { $sum: '$quantity' } } }]),
    restrictedBranch ? Promise.resolve([]) : Item.aggregate([{ $match: { deletedAt: null } }, { $group: { _id: null, units: { $sum: '$currentStock' } } }]),
  ]);
  const totals = salesRows[0] || { salesPaisa: 0, profitPaisa: 0, discountsPaisa: 0, count: 0 };
  return {
    branchCount, brandCount, todaySalesPaisa: totals.salesPaisa || 0, todayProfitPaisa: totals.profitPaisa || 0,
    todayDiscountsPaisa: totals.discountsPaisa || 0, todayTransactions: totals.count || 0,
    lowStockCount: lowStockRows[0] ? lowStockRows[0].count : 0,
    totalUnits: stockRows[0] ? stockRows[0].units : (legacyStockRows[0] ? legacyStockRows[0].units : 0),
    branchSales: branchRows.map((row) => ({ name: row.branch ? row.branch.name : 'Unknown', salesPaisa: row.salesPaisa, profitPaisa: row.profitPaisa, count: row.count })),
  };
}

module.exports = { getCommerceDashboard };
