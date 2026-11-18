/**
 * Audit trail helper.
 *
 * Every sensitive action (user/role changes, settings, financial documents)
 * calls logAction(). Failures are swallowed and logged to the console: an
 * audit write must never break the user's request.
 *
 * Signature:
 *   logAction(user, action, module, recordId, before, after, meta)
 */
'use strict';

const mongoose = require('mongoose');
const AuditLog = require('../models/AuditLog');
const { redact } = require('../utils/redact');
const { formatDate } = require('../utils/format');

function actorFields(actor) {
  if (!actor) {
    return { user: null, actorName: 'System', actorEmail: '', actorRole: '' };
  }
  return {
    user: actor._id || null,
    actorName: actor.name || 'Unknown',
    actorEmail: actor.email || '',
    actorRole: actor.role || '',
  };
}

/**
 * @param {object|null} user Actor (Mongoose user document or plain object)
 * @param {string} action One of config/auditActions AUDIT_ACTIONS
 * @param {string} module Logical module name, e.g. 'users'
 * @param {import('mongoose').Types.ObjectId|string|null} recordId Affected document
 * @param {object|null} before Snapshot before the change
 * @param {object|null} after Snapshot after the change
 * @param {{req?: import('express').Request, description?: string, ip?: string, userAgent?: string}} [meta]
 */
async function logAction(user, action, module, recordId = null, before = null, after = null, meta = {}) {
  try {
    const req = meta.req || null;

    let safeRecordId = null;
    if (recordId && mongoose.isValidObjectId(recordId)) {
      safeRecordId = recordId;
    }

    const doc = {
      ...actorFields(user),
      action,
      module,
      recordId: safeRecordId,
      description: (meta.description || '').slice(0, 500),
      before: before ? redact(before) : null,
      after: after ? redact(after) : null,
      ip: meta.ip || (req && req.ip) || null,
      userAgent:
        (meta.userAgent || (req && req.get('user-agent')) || '').slice(0, 300) || null,
    };

    await AuditLog.create(doc);
  } catch (err) {
    // Never surface audit failures to the user.
    console.error(`[audit] failed to write "${action}" for ${module}:`, err.message);
  }
}

/**
 * Human-readable label for rendering audit rows.
 * @param {{action: string, actorName: string, description: string, createdAt: Date}} entry
 */
function describeAuditEntry(entry) {
  if (!entry) return '';
  const when = formatDate(entry.createdAt);
  return `${entry.actorName} · ${entry.action} · ${when}`;
}

module.exports = { logAction, describeAuditEntry };
