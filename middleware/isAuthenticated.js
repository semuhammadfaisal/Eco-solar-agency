/** Require a signed-in, active user for a route. */
'use strict';

module.exports = function isAuthenticated(req, res, next) {
  if (req.user) return next();

  // Remember where the user was heading (page GETs only) so login can resume it.
  // Ignore asset/metadata requests browsers fire on their own.
  if (
    req.method === 'GET' &&
    req.accepts('html') &&
    req.path !== '/favicon.ico'
  ) {
    req.session.returnTo = req.originalUrl;
  }
  req.flash('error', 'Please sign in to continue.');
  return res.redirect('/login');
};
