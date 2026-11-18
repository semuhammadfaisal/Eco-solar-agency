'use strict';

const mongoose = require('mongoose');

const branchStockSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true, index: true },
    quantity: { type: Number, default: 0 },
    minStock: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

branchStockSchema.index({ branch: 1, item: 1 }, { unique: true });
branchStockSchema.index({ item: 1, quantity: 1 });

module.exports = mongoose.model('BranchStock', branchStockSchema);
