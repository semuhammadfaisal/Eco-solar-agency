'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const brandSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, default: '', maxlength: 500 },
    contactName: { type: String, trim: true, default: '', maxlength: 120 },
    phone: { type: String, trim: true, default: '', maxlength: 20 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

brandSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 }, partialFilterExpression: { deletedAt: null } }
);
brandSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Brand', brandSchema);
