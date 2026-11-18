/**
 * Authentication routes.
 *
 * The login endpoint is rate-limited per IP. Successful requests are skipped
 * so normal users are never locked out by their own valid sign-ins.
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config/app');
const authController = require('../controllers/authController');
const profileController = require('../controllers/profileController');
const isAuthenticated = require('../middleware/isAuthenticated');
const validate = require('../middleware/validate');
const { loginRules, branchLoginRules, changePasswordRules, profileRules } = require('../validators/authValidators');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: config.loginRateWindowMinutes * 60 * 1000,
  limit: config.loginRateMaxAttempts,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  // Failed sign-ins redirect to /login with 302, which express-rate-limit
  // would otherwise treat as a success and never count. The controller sets
  // req.loginSucceeded only after credentials are accepted.
  requestWasSuccessful: (req) => req.loginSucceeded === true,
  handler(req, res) {
    req.flash(
      'error',
      `Too many sign-in attempts. Please wait ${config.loginRateWindowMinutes} minutes and try again.`
    );
    return res.redirect(429, '/login');
  },
});

router.get('/login', authController.showLogin);
router.post('/login', loginLimiter, loginRules, validate, authController.login);
router.post(
  '/login/branch',
  loginLimiter,
  branchLoginRules,
  validate,
  authController.branchLogin
);

router.post('/logout', isAuthenticated, authController.logout);

router.get('/profile', isAuthenticated, profileController.show);
router.put('/profile', isAuthenticated, profileRules, validate, profileController.update);

router.get('/change-password', isAuthenticated, authController.showChangePassword);
router.post(
  '/change-password',
  isAuthenticated,
  changePasswordRules,
  validate,
  authController.changePassword
);

module.exports = router;
