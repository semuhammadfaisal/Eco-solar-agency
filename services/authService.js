/**
 * Authentication service — credential checks, password changes and the
 * matching audit entries.
 */
'use strict';

const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');

// A valid hash compared against when the email does not exist, so response
// timing does not reveal which accounts are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

/**
 * Validate credentials.
 * @param {string} email
 * @param {string} password
 * @param {{req?: import('express').Request}} [meta]
 * @returns {Promise<import('../models/User')>}
 */
async function authenticate(email, password, meta = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    await logAction(null, AUDIT_ACTIONS.AUTH_LOGIN_FAILED, 'auth', null, null, null, {
      req: meta.req,
      description: `Failed sign-in for unknown email ${normalizedEmail}`,
    });
    throw ApiError.unauthorized('Invalid email or password.');
  }

  const passwordMatches = await user.verifyPassword(password);

  if (!passwordMatches) {
    await logAction(user, AUDIT_ACTIONS.AUTH_LOGIN_FAILED, 'auth', user._id, null, null, {
      req: meta.req,
      description: 'Incorrect password',
    });
    throw ApiError.unauthorized('Invalid email or password.');
  }

  if (!user.isActive) {
    throw ApiError.forbidden(
      'Your account has been deactivated. Please contact the system owner.'
    );
  }

  return user;
}

/** Record a successful sign-in (called after the session is established). */
async function recordSuccessfulLogin(user, req) {
  await user.markLogin(req.ip);
  await logAction(user, AUDIT_ACTIONS.AUTH_LOGIN, 'auth', user._id, null, null, {
    req,
    description: 'Signed in',
  });
}

/** Record a sign-out before the session is destroyed. */
async function recordLogout(user, req) {
  await logAction(user, AUDIT_ACTIONS.AUTH_LOGOUT, 'auth', user._id, null, null, {
    req,
    description: 'Signed out',
  });
}

/**
 * Change the signed-in user's own password.
 * The user document must be reloaded with the hash selected.
 *
 * @param {import('mongoose').Types.ObjectId|string} userId
 * @param {string} currentPassword
 * @param {string} newPassword
 * @param {import('express').Request} req
 */
async function changePassword(userId, currentPassword, newPassword, req) {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw ApiError.notFound('User not found.');

  const currentMatches = await user.verifyPassword(currentPassword);
  if (!currentMatches) {
    throw ApiError.badRequest('Your current password is incorrect.');
  }

  const sameAsOld = await bcrypt.compare(newPassword, user.passwordHash);
  if (sameAsOld) {
    throw ApiError.badRequest('The new password must be different from the current password.');
  }

  await user.setPassword(newPassword);
  await user.save();

  await logAction(user, AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED, 'auth', user._id, null, null, {
    req,
    description: 'Changed own password',
  });

  return user;
}

module.exports = { authenticate, recordSuccessfulLogin, recordLogout, changePassword };
