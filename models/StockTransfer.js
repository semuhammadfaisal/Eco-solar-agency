'use strict';

const mongoose = require('mongoose');

const lineSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    sku: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, default: '' },
    unit: { type: String, trim: true, default: 'pcs' },
    quantity: { type: Number, required: true, min: 0.0001 },
    /** Purchase (moving-average) cost of the unit leaving the source branch. */
    unitCostPaisa: { type: Number, default: 0, min: 0 },
    /** Price the destination branch takes the unit at (transfer price). */
    branchPricePaisa: { type: Number, default: 0, min: 0 },
    /** (branch price - unit cost) x quantity, stored in integer paisa. */
    profitPaisa: { type: Number, default: 0 },
  },
  { _id: true }
);

const stockTransferSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, trim: true, uppercase: true, unique: true },
    sourceBranch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    destinationBranch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    status: { type: String, enum: ['draft', 'sent', 'received', 'cancelled'], default: 'received', index: true },
    items: { type: [lineSchema], validate: (lines) => Array.isArray(lines) && lines.length > 0 },
    /** Sum of quantity x purchase cost for every line. */
    totalCostPaisa: { type: Number, default: 0, min: 0 },
    /** Sum of quantity x branch price for every line. */
    totalBranchValuePaisa: { type: Number, default: 0, min: 0 },
    /** totalBranchValuePaisa - totalCostPaisa. Negative means the transfer runs at a loss. */
    totalProfitPaisa: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: '', maxlength: 1000 },
    transferredAt: { type: Date, default: Date.now, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

stockTransferSchema.index({ transferredAt: -1 });
module.exports = mongoose.model('StockTransfer', stockTransferSchema);
