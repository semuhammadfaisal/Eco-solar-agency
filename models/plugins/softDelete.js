/**
 * Soft-delete plugin.
 *
 * Adds deletedAt/deletedBy, hides soft-deleted documents from every find and
 * count query by default, and exposes softDelete()/restore() instance methods.
 *
 * Need deleted rows too? Pass the option explicitly:
 *   User.find().setOptions({ withDeleted: true })
 *
 * Aggregations do not run Mongoose query middleware, so any pipeline that
 * must respect soft delete needs { deletedAt: null } in its $match stage.
 */
'use strict';

const mongoose = require('mongoose');

module.exports = function softDeletePlugin(schema) {
  schema.add({
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  });

  schema.index({ deletedAt: 1 });

  function excludeDeleted(next) {
    if (this.getOptions().withDeleted) return next();
    // Only add the filter when the caller has not specified deletedAt itself.
    if (this.getFilter().deletedAt === undefined) {
      this.where({ deletedAt: null });
    }
    return next();
  }

  schema.pre(/^find/, excludeDeleted);
  schema.pre('countDocuments', excludeDeleted);
  schema.pre('distinct', excludeDeleted);

  /**
   * Mark the document as deleted. Also deactivates user accounts so a
   * soft-deleted user can never sign in even if a session still exists.
   */
  schema.methods.softDelete = async function softDelete(userId = null) {
    this.deletedAt = new Date();
    this.deletedBy = userId || null;
    if (schema.path('isActive')) this.isActive = false;
    return this.save({ validateBeforeSave: false });
  };

  /** Undo a soft delete (only useful while the unique index permits it). */
  schema.methods.restore = async function restore() {
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save({ validateBeforeSave: false });
  };
};
