/**
 * Permission-based access control (config/permissions.js).
 * Use this for capabilities that may be shared across several roles.
 *
 * Example: router.get('/costs', requirePermission('costs.view'), controller.show);
 */
'use strict';

const { can } = require('../config/permissions');
const { forbiddenPage } = require('./requireRole');

/**
 * @param {string} permission Key from config/permissions.js
 */
function requirePermission(permission) {
  return function permissionGuard(req, res, next) {
    if (!req.user) {
      if (req.method === 'GET') req.session.returnTo = req.originalUrl;
      req.flash('error', 'Please sign in to continue.');
      return res.redirect('/login');
    }

    if (!can(req.user, permission)) {
      return forbiddenPage(req, res);
    }

    return next();
  };
}

module.exports = requirePermission;
