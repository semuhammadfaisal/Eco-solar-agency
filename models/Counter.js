/**
 * Atomic sequence counter.
 *
 * Used for human-friendly document codes (CUS-0001). $inc with upsert is a
 * single atomic operation, so two concurrent customer creations can never
 * receive the same sequence number.
 */
'use strict';

const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

/**
 * Reserve and return the next integer for a named sequence.
 * @param {string} name
 * @returns {Promise<number>}
 */
counterSchema.statics.next = async function next(name) {
  const counter = await this.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return counter.seq;
};

module.exports = mongoose.model('Counter', counterSchema);
