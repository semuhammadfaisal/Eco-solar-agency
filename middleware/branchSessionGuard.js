/**
 * Server-side allow-list for shared branch logins.
 *
 * A branch session is deliberately a small workspace. Hiding navigation is not
 * enough: a typed URL must be rejected too, otherwise a branch password would
 * expose company-wide CRM, purchasing or accounting data.
 */
'use strict';

const ApiError = require('../utils/ApiError');

const ALLOWED = [
  { prefix: '/dashboard', methods: ['GET'] },
  { prefix: '/pos', methods: ['GET'] },
  { exact: '/pos', methods: ['POST'] },
  { prefix: '/branches', methods: ['GET'] },
  { prefix: '/transfers', methods: ['GET'] },
  { prefix: '/brands', methods: ['GET'] },
  // A branch login may view and close its own drawer, but may never reopen a
  // closed drawer (that is owner/accountant only).
  { exact: '/accounting/daily-closing', methods: ['GET'] },
  { exact: '/accounting/daily-closing/adjustment', methods: ['POST'] },
  { exact: '/accounting/daily-closing/close', methods: ['POST'] },
  { exact: '/accounting/daily-closing/quick-close', methods: ['POST'] },
  { exact: '/accounting/daily-closing/snooze', methods: ['POST'] },
  { prefix: '/logout', methods: ['POST'] },
  { prefix: '/login', methods: ['GET', 'POST'] },
];

function matchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * @param {string} pathname req.path
 * @param {string} method HTTP method
 * @returns {boolean} true when a branch session may call this route
 */
function isBranchAllowedPath(pathname, method) {
  if (pathname === '/') return method === 'GET';
  return ALLOWED.some(
    (entry) =>
      entry.methods.includes(method) &&
      (entry.exact ? pathname === entry.exact : matchesPrefix(pathname, entry.prefix))
  );
}

module.exports = function branchSessionGuard(req, res, next) {
  if (!req.user || !req.user.isBranchLogin) return next();
  if (isBranchAllowedPath(req.path, req.method)) return next();

  if (req.method === 'GET') {
    req.flash('error', 'That area is not available for branch login.');
    return res.redirect('/dashboard');
  }

  return next(
    ApiError.forbidden('That action is not available for branch login.')
  );
};

module.exports.isBranchAllowedPath = isBranchAllowedPath;
