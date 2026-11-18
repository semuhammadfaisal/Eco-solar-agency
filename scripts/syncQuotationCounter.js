'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Quotation = require('../models/Quotation');
const Counter = require('../models/Counter');

async function run() {
  await connectDB();
  const year = new Date().getFullYear();
  const pattern = new RegExp(`^QT-${year}-(\\d+)$`, 'i');
  const rows = await Quotation.find({ quotationNumber: pattern })
    .setOptions({ withDeleted: true })
    .select('quotationNumber')
    .lean();

  const highest = rows.reduce((max, row) => {
    const match = pattern.exec(row.quotationNumber || '');
    return match ? Math.max(max, Number(match[1]) || 0) : max;
  }, 0);

  const counter = await Counter.findByIdAndUpdate(
    `quotation_${year}`,
    { $max: { seq: highest } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  console.log(`[quotation counter] ${year}: highest existing=${highest}, counter=${counter.seq}, next candidate=${counter.seq + 1}`);
  await mongoose.connection.close();
}

run().catch(async (err) => {
  console.error('[quotation counter] sync failed:', err.message);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
