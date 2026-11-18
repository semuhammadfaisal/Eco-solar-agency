'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Counter = require('../models/Counter');
const Sale = require('../models/Sale');

async function reserveInvoiceNumber(year) {
  // Counters may pre-date this migration, so skip any manually used value.
  while (true) {
    const seq = await Counter.next(`invoice_${year}`);
    const number = `INV-${year}-${String(seq).padStart(4, '0')}`;
    if (!(await Sale.exists({ invoiceNumber: number }))) return number;
  }
}

async function run() {
  await connectDB();
  const sales = await Sale.find({
    $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber: null }, { invoiceNumber: '' }],
  }).sort({ createdAt: 1 });

  let updated = 0;
  for (const sale of sales) {
    const year = (sale.createdAt || new Date()).getFullYear();
    const invoiceNumber = await reserveInvoiceNumber(year);
    await Sale.updateOne({ _id: sale._id }, { $set: { invoiceNumber } });
    updated += 1;
    console.log(`[business numbers] ${sale.saleNumber} -> ${invoiceNumber}`);
  }

  await Sale.createIndexes();
  console.log(`[business numbers] complete; ${updated} existing sale invoice(s) numbered.`);
  await mongoose.connection.close();
}

run().catch(async (err) => {
  console.error('[business numbers] migration failed:', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
