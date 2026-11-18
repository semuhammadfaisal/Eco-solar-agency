'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/app');
const softDeletePlugin = require('./plugins/softDelete');

const branchSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    type: { type: String, enum: ['main', 'branch'], default: 'branch', index: true },
    address: { type: String, trim: true, default: '', maxlength: 250 },
    city: { type: String, trim: true, default: '', maxlength: 80 },
    phone: { type: String, trim: true, default: '', maxlength: 20 },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true, default: '', maxlength: 1000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * Shared branch sign-in. The hash is select:false so an ordinary branch
     * query can never leak it into a view or JSON response. loginEnabled is
     * kept as a separate switch so an owner can disable a branch login without
     * destroying the password (a new password also re-enables it).
     */
    loginPasswordHash: { type: String, select: false, default: null },
    loginEnabled: { type: Boolean, default: false, index: true },
    loginPasswordChangedAt: { type: Date, default: null },
    loginLastUsedAt: { type: Date, default: null },
    loginLastLoginIp: { type: String, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.loginPasswordHash;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.loginPasswordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

branchSchema.index({ code: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
branchSchema.index({ name: 1 });
branchSchema.plugin(softDeletePlugin);

/**
 * Hash and store the shared branch password. Called by services only.
 * @param {string} plainPassword
 */
branchSchema.methods.setLoginPassword = async function setLoginPassword(plainPassword) {
  this.loginPasswordHash = await bcrypt.hash(plainPassword, config.bcryptRounds);
  this.loginEnabled = true;
  this.loginPasswordChangedAt = new Date();
};

/**
 * Compare a candidate password with the stored branch hash.
 * The document must have been loaded with .select('+loginPasswordHash').
 * @param {string} plainPassword
 * @returns {Promise<boolean>}
 */
branchSchema.methods.verifyLoginPassword = function verifyLoginPassword(plainPassword) {
  if (!this.loginPasswordHash) return Promise.resolve(false);
  return bcrypt.compare(String(plainPassword || ''), this.loginPasswordHash);
};

/** Disable branch login and remove the stored password. */
branchSchema.methods.clearLoginPassword = function clearLoginPassword() {
  this.loginPasswordHash = null;
  this.loginEnabled = false;
  this.loginPasswordChangedAt = new Date();
};

/** Record a successful branch sign-in. */
branchSchema.methods.markLogin = function markLogin(ip) {
  this.loginLastUsedAt = new Date();
  this.loginLastLoginIp = ip || null;
  return this.save({ validateBeforeSave: false });
};

module.exports = mongoose.model('Branch', branchSchema);
