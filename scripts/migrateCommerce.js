'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Item = require('../models/Item');
const Brand = require('../models/Brand');
const BranchStock = require('../models/BranchStock');
const { ensureMainBranch } = require('../services/branchInventoryService');

async function run() {
  await connectDB();
  const main = await ensureMainBranch();
  const items = await Item.find();
  let brandsCreated = 0;
  let balancesCreated = 0;
  for (const item of items) {
    if (item.brand && !item.brandRef) {
      let brand = await Brand.findOne({ name: new RegExp(`^${item.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });
      if (!brand) {
        brand = await Brand.create({ name: item.brand, isActive: true });
        brandsCreated += 1;
      }
      item.brandRef = brand._id;
      if (!item.wholesalePricePaisa) item.wholesalePricePaisa = item.sellingPricePaisa || 0;
      if (!item.retailPricePaisa) item.retailPricePaisa = item.sellingPricePaisa || 0;
      await item.save();
    }
    const existing = await BranchStock.findOne({ branch: main._id, item: item._id });
    if (!existing) {
      await BranchStock.create({ branch: main._id, item: item._id, quantity: Number(item.currentStock || 0), minStock: Number(item.minStock || 0) });
      balancesCreated += 1;
    }
  }
  console.log(`[commerce migration] Main branch: ${main.name}; brands created: ${brandsCreated}; stock balances created: ${balancesCreated}`);
  await mongoose.connection.close();
}

run().catch(async (err) => {
  console.error('[commerce migration] failed:', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
