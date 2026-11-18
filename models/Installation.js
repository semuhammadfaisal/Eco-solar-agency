'use strict';

const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');
const { INSTALLATION_STATUSES } = require('../config/installments');

const materialIssuedLineSchema = new mongoose.Schema(
  {
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Item',
      required: true,
    },
    serialNumber: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SerialNo',
      default: null,
    },
    serialString: {
      type: String,
      trim: true,
      default: '',
    },
    qty: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    issuedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { _id: true }
);

const technicalChecklistSchema = new mongoose.Schema(
  {
    structureTorqued: { type: Boolean, default: false },
    panelClampsFastened: { type: Boolean, default: false },
    structureEarthingConnected: { type: Boolean, default: false },
    stringPolarityChecked: { type: Boolean, default: false },
    dcIsolatorInstalled: { type: Boolean, default: false },
    dcSurgeProtection: { type: Boolean, default: false },
    acBreakerSized: { type: Boolean, default: false },
    earthingPitResistanceTested: { type: Boolean, default: false },
    inverterFirmwareUpdated: { type: Boolean, default: false },
    gridAntiIslandingVerified: { type: Boolean, default: false },
  },
  { _id: false }
);

const technicalReadingsSchema = new mongoose.Schema(
  {
    vocReadingVolts: { type: Number, default: null, min: 0 },
    iscReadingAmps: { type: Number, default: null, min: 0 },
    earthResistanceOhms: { type: Number, default: null, min: 0 },
    gridVoltageVolts: { type: Number, default: null, min: 0 },
  },
  { _id: false }
);

const customerSignoffSchema = new mongoose.Schema(
  {
    signedBy: { type: String, trim: true, default: '', maxlength: 120 },
    signerCnic: { type: String, trim: true, default: '', maxlength: 20 },
    signedAt: { type: Date, default: null },
    rating: { type: Number, default: 5, min: 1, max: 5 },
    feedback: { type: String, trim: true, default: '', maxlength: 1000 },
    signatureData: { type: String, default: '' },
  },
  { _id: false }
);

const installationSchema = new mongoose.Schema(
  {
    installationNumber: {
      type: String,
      required: [true, 'Installation number is required'],
      trim: true,
      uppercase: true,
      maxlength: [30, 'Installation number cannot exceed 30 characters'],
    },
    sale: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Sale',
      required: [true, 'Sale contract is required'],
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },
    leadTechnician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    technicians: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    status: {
      type: String,
      enum: INSTALLATION_STATUSES,
      default: 'approved',
      index: true,
    },
    scheduledStartDate: {
      type: Date,
      default: null,
      index: true,
    },
    scheduledEndDate: {
      type: Date,
      default: null,
    },
    actualStartDate: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
      index: true,
    },
    commissionedAt: {
      type: Date,
      default: null,
    },
    checklist: {
      type: technicalChecklistSchema,
      default: () => ({}),
    },
    readings: {
      type: technicalReadingsSchema,
      default: () => ({}),
    },
    materialsIssued: {
      type: [materialIssuedLineSchema],
      default: [],
    },
    beforePhotos: {
      type: [String],
      default: [],
    },
    afterPhotos: {
      type: [String],
      default: [],
    },
    customerSignoff: {
      type: customerSignoffSchema,
      default: () => ({}),
    },
    commissioningNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: [2000, 'Notes cannot exceed 2000 characters'],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

installationSchema.index(
  { installationNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
installationSchema.index({ customer: 1, status: 1 });
installationSchema.index({ leadTechnician: 1, status: 1 });

installationSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('Installation', installationSchema);
