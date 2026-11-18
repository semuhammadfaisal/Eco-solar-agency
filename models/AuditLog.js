/**
 * AuditLog — append-only record of sensitive actions.
 *
 * before/after snapshots are stored without secrets (see utils/redact.js) and
 * capped in size to keep documents small. Audit rows are never updated or
 * deleted by the application.
 */
'use strict';

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    // Actor snapshot, denormalised so the trail survives role/name changes.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    actorName: { type: String, default: 'System', maxlength: 120 },
    actorEmail: { type: String, default: '', maxlength: 190 },
    actorRole: { type: String, default: '', maxlength: 30 },

    action: { type: String, required: true, maxlength: 60, index: true },
    module: { type: String, required: true, maxlength: 40, index: true },
    recordId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    description: { type: String, default: '', maxlength: 500 },

    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },

    ip: { type: String, default: null, maxlength: 60 },
    userAgent: { type: String, default: null, maxlength: 300 },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    // Audit rows must never be silently dropped by strict mode.
    strict: true,
  }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ module: 1, recordId: 1, createdAt: -1 });
auditLogSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
