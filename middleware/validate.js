/**
 * express-validator result handler.
 *
 * On failure it flashes readable errors and the submitted values (minus any
 * password field), then redirects back to the form. The form view repopulates
 * from `oldInput`, so users never lose their work.
 */
'use strict';

const { validationResult } = require('express-validator');
const fs = require('fs');
const { safeReferrer } = require('../utils/urls');

const SENSITIVE_FIELD = /password|passcode|confirm|secret/i;

/** Copy the body but drop secrets before they reach the session store. */
function sanitisedOldInput(body = {}) {
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_FIELD.test(key)) continue;
    if (key === '_csrf' || key === '_method') continue;
    out[key] = typeof value === 'string' ? value.slice(0, 2000) : value;
  }
  return out;
}

module.exports = function validate(req, res, next) {
  const result = validationResult(req);

  if (result.isEmpty()) return next();

  const messages = [...new Set(result.array().map((error) => error.msg).filter(Boolean))];
  req.flash('formErrors', messages);
  req.flash('oldInput', sanitisedOldInput(req.body));

  // Multer runs before validation on multipart forms. Remove rejected files
  // so malformed submissions cannot leave orphaned uploads behind.
  const uploaded = [];
  if (req.file && req.file.path) uploaded.push(req.file.path);
  if (Array.isArray(req.files)) uploaded.push(...req.files.map((file) => file.path));
  else if (req.files && typeof req.files === 'object') {
    for (const files of Object.values(req.files)) uploaded.push(...files.map((file) => file.path));
  }
  uploaded.filter(Boolean).forEach((filePath) => fs.unlink(filePath, () => {}));

  return res.redirect(safeReferrer(req, '/'));
};

module.exports.sanitisedOldInput = sanitisedOldInput;
