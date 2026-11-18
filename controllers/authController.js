/** Sign-in / sign-out / password change controllers. */
'use strict';

const config = require('../config/app');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const {
  authenticate,
  recordSuccessfulLogin,
  recordLogout,
  changePassword,
} = require('../services/authService');
const {
  authenticateBranch,
  recordBranchLogin,
  recordBranchLogout,
  listLoginBranches,
} = require('../services/branchLoginService');

/** Only allow internal absolute paths as post-login destinations. */
function safeReturnTo(value, fallback = '/dashboard') {
  if (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    value !== '/favicon.ico' &&
    value !== '/login' &&
    value !== '/logout'
  ) {
    return value;
  }
  return fallback;
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Persist the session before the response is sent.
 *
 * express-session defers its own save to `res.end`, but it writes the response
 * body before the store confirms the write. A browser that follows the login
 * redirect immediately can therefore request `/dashboard` before the new
 * session (and its `userId`) is visible in the store, and land back on /login.
 * Awaiting the write here makes the redirect safe on slow stores.
 */
function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

exports.showLogin = asyncHandler(async (req, res) => {
  if (req.user) return res.redirect('/dashboard');

  // A CSRF token is tied to the current session. Never let the browser reuse
  // a cached login form after the server/session has changed.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  const branches = await listLoginBranches();
  const oldBranch = res.locals.oldInput && res.locals.oldInput.branch;
  const activeTab = req.query.tab === 'branch' || oldBranch ? 'branch' : 'staff';
  const selectedBranch = String(req.query.branch || oldBranch || '');

  return res.render('auth/login', {
    layout: 'layouts/auth',
    title: 'Sign in',
    signedOut: req.query.signedOut === '1',
    branches,
    activeTab,
    selectedBranch,
  });
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  let user;
  try {
    user = await authenticate(email, password, { req });
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect('/login');
    }
    throw err;
  }

  const returnTo = req.session.returnTo;
  const csrfSecret = req.session.csrfSecret; // keep the current form token valid

  // Prevent session fixation: issue a fresh session on privilege change.
  await regenerateSession(req);
  if (csrfSecret) req.session.csrfSecret = csrfSecret;
  // A stored destination is single-use. Never let a stale value (for example a
  // browser favicon request) leak into a later login.
  delete req.session.returnTo;
  delete req.session.branchId;
  req.session.userId = user._id.toString();
  req.session.authAt = Date.now();

  await recordSuccessfulLogin(user, req);
  req.loginSucceeded = true;

  const firstName = user.name.trim().split(/\s+/)[0];
  req.flash('success', `Welcome back, ${firstName}.`);

  await saveSession(req);

  return res.redirect(safeReturnTo(returnTo));
});

exports.branchLogin = asyncHandler(async (req, res) => {
  const { branch, password } = req.body;
  const branchRedirect = `/login?tab=branch${
    branch ? `&branch=${encodeURIComponent(String(branch))}` : ''
  }`;

  let branchDoc;
  try {
    branchDoc = await authenticateBranch(branch, password, { req });
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect(branchRedirect);
    }
    throw err;
  }

  const returnTo = req.session.returnTo;
  const csrfSecret = req.session.csrfSecret; // keep the current form token valid

  // Prevent session fixation: issue a fresh session on privilege change.
  await regenerateSession(req);
  if (csrfSecret) req.session.csrfSecret = csrfSecret;
  delete req.session.returnTo;
  delete req.session.userId;
  req.session.branchId = branchDoc._id.toString();
  req.session.branchAuthAt = Date.now();

  await recordBranchLogin(branchDoc, req);
  req.loginSucceeded = true;

  req.flash('success', `Signed in to ${branchDoc.name}.`);

  await saveSession(req);

  return res.redirect(safeReturnTo(returnTo));
});

exports.logout = asyncHandler(async (req, res) => {
  if (req.user) {
    if (req.user.isBranchLogin) await recordBranchLogout(req.user.branch, req);
    else await recordLogout(req.user, req);
  }

  await new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });

  res.clearCookie(config.sessionCookieName);
  return res.redirect('/login?signedOut=1');
});

exports.showChangePassword = (req, res) => {
  return res.render('auth/change-password', {
    layout: 'layouts/admin',
    title: 'Change password',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Change password' },
    ],
  });
};

exports.changePassword = asyncHandler(async (req, res) => {
  try {
    await changePassword(
      req.user._id,
      req.body.currentPassword,
      req.body.newPassword,
      req
    );
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect('/change-password');
    }
    throw err;
  }

  req.session.authAt = Date.now();
  req.flash('success', 'Your password has been changed successfully.');
  return res.redirect('/change-password');
});
