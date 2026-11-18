/**
 * Load the signed-in principal from the session on every request.
 *
 * Two session kinds are supported:
 *   - req.session.userId    a normal staff account
 *   - req.session.branchId  a shared branch login (no User document)
 *
 * A user that was deactivated, soft-deleted or had their password changed after
 * signing in is logged out immediately. The same applies to a branch whose
 * login was disabled or whose shared password was reset.
 */
'use strict';

const User = require('../models/User');
const Branch = require('../models/Branch');
const config = require('../config/app');
const { buildBranchPrincipal } = require('../services/branchLoginService');

function forceSignOut(req, res, next, message) {
  // Regenerate (not destroy) so the flash message has a live session.
  return req.session.regenerate((err) => {
    if (err) return next(err);
    req.flash('error', message);
    res.clearCookie(config.sessionCookieName);
    return res.redirect('/login');
  });
}

function timestamp(value) {
  if (!value) return 0;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

module.exports = async function loadUser(req, res, next) {
  res.locals.currentUser = null;

  const userId = req.session && req.session.userId;
  const branchId = req.session && req.session.branchId;

  if (userId) {
    try {
      const user = await User.findById(userId);

      if (!user || !user.isActive) {
        return forceSignOut(
          req,
          res,
          next,
          'Your session has ended. Please sign in again.'
        );
      }

      // Invalidate sessions that predate a password reset. Sessions created
      // before this check was introduced fall back to the last sign-in time.
      const sessionAuthAt =
        timestamp(req.session.authAt) || timestamp(user.lastLoginAt);
      const passwordChangedAt = timestamp(user.passwordChangedAt);
      if (passwordChangedAt && passwordChangedAt > sessionAuthAt + 2000) {
        return forceSignOut(
          req,
          res,
          next,
          'Your password was changed. Please sign in again.'
        );
      }

      // A session should never be both a staff and a branch login.
      if (req.session.branchId) delete req.session.branchId;

      req.user = user;
      res.locals.currentUser = user;
      return next();
    } catch (err) {
      if (err.name === 'CastError') {
        delete req.session.userId;
        return next();
      }
      return next(err);
    }
  }

  if (branchId) {
    try {
      const branch = await Branch.findById(branchId).select('+loginPasswordHash');
      const sessionAuthAt =
        timestamp(req.session.branchAuthAt) ||
        timestamp(branch && branch.loginLastUsedAt);
      const passwordChangedAt = timestamp(branch && branch.loginPasswordChangedAt);

      const unavailable =
        !branch ||
        !branch.isActive ||
        !branch.loginEnabled ||
        !branch.loginPasswordHash ||
        (passwordChangedAt && passwordChangedAt > sessionAuthAt + 2000);

      if (unavailable) {
        return forceSignOut(
          req,
          res,
          next,
          'Branch login is no longer available. Please sign in again.'
        );
      }

      req.user = buildBranchPrincipal(branch);
      res.locals.currentUser = req.user;
      res.locals.branchSession = true;
      return next();
    } catch (err) {
      if (err.name === 'CastError') {
        delete req.session.branchId;
        return next();
      }
      return next(err);
    }
  }

  return next();
};
