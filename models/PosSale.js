'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const posLineSchema = new mongoose.Schema(
  {
    item: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
    sku: { type: String, trim: true, default: '' },
    name: { type: String, trim: true, default: '' },
    unit: { type: String, trim: true, default: 'pcs' },
    quantity: { type: Number, required: true, min: 0.0001 },
    priceType: { type: String, enum: ['wholesale', 'retail', 'custom'], default: 'retail' },
    listedUnitPricePaisa: { type: Number, required: true, min: 0 },
    unitPricePaisa: { type: Number, required: true, min: 0 },
    discountPaisa: { type: Number, default: 0, min: 0 },
    lineTotalPaisa: { type: Number, required: true, min: 0 },
    unitCostPaisa: { type: Number, required: true, min: 0 },
    costTotalPaisa: { type: Number, required: true, min: 0 },
    profitPaisa: { type: Number, required: true },
  },
  { _id: true }
);

const posSaleSchema = new mongoose.Schema(
  {
    number: { type: String, required: true, trim: true, uppercase: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    customerName: { type: String, trim: true, default: 'Walk-in Customer', maxlength: 150 },
    customerPhone: { type: String, trim: true, default: '', maxlength: 20 },
    saleType: { type: String, enum: ['retail', 'wholesale'], default: 'retail', index: true },
    paymentMethod: { type: String, enum: ['cash', 'bank', 'credit', 'mixed'], default: 'cash' },
    items: { type: [posLineSchema], validate: (lines) => Array.isArray(lines) && lines.length > 0 },
    subtotalPaisa: { type: Number, required: true, min: 0 },
    discountPaisa: { type: Number, default: 0, min: 0 },
    totalPaisa: { type: Number, required: true, min: 0 },
    paidPaisa: { type: Number, default: 0, min: 0 },
    duePaisa: { type: Number, default: 0, min: 0 },
    totalCostPaisa: { type: Number, required: true, min: 0 },
    profitPaisa: { type: Number, required: true },
    status: { type: String, enum: ['completed', 'cancelled', 'returned'], default: 'completed', index: true },
    soldAt: { type: Date, default: Date.now, index: true },
    notes: { type: String, trim: true, default: '', maxlength: 1000 },
    // Shared branch logins have no User document, so the actor id is optional
    // and the display name is snapshotted instead.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    createdByName: { type: String, trim: true, default: '', maxlength: 150 },
  },
  { timestamps: true }
);

posSaleSchema.index({ number: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
posSaleSchema.index({ branch: 1, soldAt: -1 });
posSaleSchema.plugin(softDeletePlugin);
module.exports = mongoose.model('PosSale', posSaleSchema);
