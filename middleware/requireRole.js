/**
 * Role-based access control.
 *
 * Usage:
 *   router.get('/users', requireRole('owner'), controller.index);
 *   router.get('/reports', requireRole(['owner', 'manager']), controller.reports);
 *
 * This is the authoritative check. Hiding a menu item is never enough.
 */
'use strict';

const { hasRole } = require('../utils/roles');

function forbiddenPage(req, res, message) {
  return res.status(403).render('errors/403', {
    layout: 'layouts/bare',
    title: 'Access denied',
    message:
      message ||
      'Your role does not have access to this page. If you believe this is a mistake, contact the system owner.',
    currentPath: req.path,
  });
}

/**
 * @param {...(string|string[])} roles Allowed roles
 */
function requireRole(...roles) {
  const allowed = roles.flat();

  return function roleGuard(req, res, next) {
    if (!req.user) {
      if (req.method === 'GET') req.session.returnTo = req.originalUrl;
      req.flash('error', 'Please sign in to continue.');
      return res.redirect('/login');
    }

    if (!hasRole(req.user, allowed)) {
      return forbiddenPage(req, res);
    }

    return next();
  };
}

module.exports = requireRole;
module.exports.forbiddenPage = forbiddenPage;
