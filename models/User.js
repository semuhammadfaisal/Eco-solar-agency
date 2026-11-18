/**
 * User model.
 *
 * Security notes:
 *  - passwordHash is select:false, so it is never returned by an ordinary
 *    query and cannot leak into a view or JSON response by accident.
 *  - The email unique index is partial (only for non-deleted users), which
 *    lets a soft-deleted account release its address.
 */
'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const config = require('../config/app');
const { ALL_ROLES, ROLES, ROLE_LABELS, ROLE_BADGES } = require('../config/roles');
const softDeletePlugin = require('./plugins/softDelete');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [120, 'Name cannot exceed 120 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: [190, 'Email cannot exceed 190 characters'],
      validate: {
        validator: (value) => EMAIL_PATTERN.test(value),
        message: 'Enter a valid email address',
      },
    },
    phone: {
      type: String,
      trim: true,
      default: '',
      maxlength: [20, 'Phone cannot exceed 20 characters'],
      validate: {
        validator: (value) => !value || /^[0-9+\-()\s]{7,20}$/.test(value),
        message: 'Enter a valid phone number',
      },
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: { values: ALL_ROLES, message: 'Invalid role' },
      default: ROLES.SALES,
      index: true,
    },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', default: null, index: true },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },
    passwordChangedAt: { type: Date, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  }
);

// One account per email among *live* users only.
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
userSchema.index({ role: 1, isActive: 1 });

userSchema.virtual('initials').get(function initials() {
  if (!this.name) return '?';
  return this.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
});

userSchema.virtual('roleLabel').get(function roleLabel() {
  return ROLE_LABELS[this.role] || this.role;
});

userSchema.virtual('roleBadge').get(function roleBadge() {
  return ROLE_BADGES[this.role] || 'secondary';
});

/**
 * Hash and store a new password. Called by services only — controllers never
 * touch passwordHash directly.
 * @param {string} plainPassword
 */
userSchema.methods.setPassword = async function setPassword(plainPassword) {
  this.passwordHash = await bcrypt.hash(plainPassword, config.bcryptRounds);
  this.passwordChangedAt = new Date();
};

/**
 * Compare a candidate password with the stored hash.
 * The document must have been loaded with .select('+passwordHash').
 * @param {string} plainPassword
 * @returns {Promise<boolean>}
 */
userSchema.methods.verifyPassword = function verifyPassword(plainPassword) {
  if (!this.passwordHash) {
    return Promise.reject(new Error('passwordHash not loaded on this user document'));
  }
  return bcrypt.compare(plainPassword, this.passwordHash);
};

/** Record a successful sign-in. */
userSchema.methods.markLogin = function markLogin(ip) {
  this.lastLoginAt = new Date();
  this.lastLoginIp = ip || null;
  return this.save({ validateBeforeSave: false });
};

/** Plain object safe to render or serialise (never contains the hash). */
userSchema.methods.toSafeObject = function toSafeObject() {
  const obj = this.toObject({ depopulate: true, virtuals: true });
  delete obj.passwordHash;
  delete obj.__v;
  return obj;
};

/**
 * How many other active owners exist (used to protect the last owner account).
 * @param {import('mongoose').Types.ObjectId|string} [excludeId]
 */
userSchema.statics.countActiveOwners = function countActiveOwners(excludeId = null) {
  const filter = { role: ROLES.OWNER, isActive: true };
  if (excludeId) filter._id = mongoose.trusted({ $ne: excludeId });
  return this.countDocuments(filter);
};

userSchema.plugin(softDeletePlugin);

module.exports = mongoose.model('User', userSchema);
