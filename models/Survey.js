'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const {
  SURVEY_STATUSES,
  ROOF_TYPES,
  DIRECTIONS,
  SHADING_LEVELS,
  STRUCTURE_TYPES,
  PHASES,
  METER_TYPES,
  SYSTEM_TYPES,
  SURVEY_PHOTO_TYPES,
} = require('../config/surveys');

const billMonthSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, maxlength: 20 },
    units: { type: Number, default: 0, min: 0, max: 10000000 },
    amountPaisa: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const photoSchema = new mongoose.Schema(
  {
    type: { type: String, enum: SURVEY_PHOTO_TYPES, required: true },
    path: { type: String, required: true, maxlength: 300 },
    originalName: { type: String, default: '', maxlength: 180 },
    mimeType: { type: String, default: '', maxlength: 80 },
    size: { type: Number, default: 0, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const surveySchema = new mongoose.Schema(
  {
    number: { type: String, required: true, uppercase: true, trim: true, maxlength: 24 },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    surveyor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scheduledAt: { type: Date, required: true, index: true },
    completedAt: { type: Date, default: null },
    status: { type: String, enum: SURVEY_STATUSES, default: 'scheduled', index: true },

    roofType: { type: String, enum: ['', ...ROOF_TYPES], default: '' },
    roofAreaSqFt: { type: Number, default: null, min: 0, max: 10000000 },
    direction: { type: String, enum: ['', ...DIRECTIONS], default: '' },
    tiltDegrees: { type: Number, default: null, min: 0, max: 90 },
    shading: { type: String, enum: ['', ...SHADING_LEVELS], default: '' },
    structureType: { type: String, enum: ['', ...STRUCTURE_TYPES], default: '' },
    floorHeight: { type: Number, default: null, min: 0, max: 500 },

    monthlyUsage: {
      type: [billMonthSchema],
      default: [],
      validate: { validator: (rows) => rows.length <= 12, message: 'Only 12 billing months are allowed' },
    },
    sanctionedLoadKw: { type: Number, default: null, min: 0, max: 100000 },
    phase: { type: String, enum: ['', ...PHASES], default: '' },
    meterType: { type: String, enum: ['', ...METER_TYPES], default: '' },
    cableDistanceMeters: { type: Number, default: null, min: 0, max: 100000 },
    recommendedKw: { type: Number, default: null, min: 0, max: 100000 },
    suggestedKw: { type: Number, default: null, min: 0, max: 100000 },
    systemType: { type: String, enum: ['', ...SYSTEM_TYPES], default: '' },
    recommendationBasis: { type: String, default: '', maxlength: 300 },
    remarks: { type: String, trim: true, default: '', maxlength: 3000 },
    photos: { type: [photoSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

surveySchema.index({ number: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
surveySchema.index({ surveyor: 1, scheduledAt: 1 });
surveySchema.index({ status: 1, scheduledAt: 1 });
surveySchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Survey', surveySchema);
