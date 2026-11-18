/**
 * 404 and central error handling.
 *
 * - HTML requests get friendly Bootstrap pages.
 * - CSRF failures return 403 with an explanation instead of a stack trace.
 * - Stack traces and internal messages are hidden in production.
 */
'use strict';

const config = require('../config/app');

/** Locals required by the bare error layout. */
function baseLocals(req, res) {
  return {
    appName: res.locals.appName || config.appName,
    settings: res.locals.settings || {},
    csrfToken: res.locals.csrfToken || '',
    currentPath: req.path,
    year: new Date().getFullYear(),
    currentUser: res.locals.currentUser || null,
    breadcrumbs: [],
    pageStyles: [],
    pageScripts: [],
    formErrors: [],
    oldInput: {},
    flash: { success: [], error: [], warning: [], info: [] },
  };
}

/** Route not matched by the app. */
function notFoundHandler(req, res) {
  return res.status(404).render('errors/404', {
    layout: 'layouts/bare',
    ...baseLocals(req, res),
    title: 'Page not found',
  });
}

/* eslint-disable no-unused-vars */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const isProduction = config.isProduction;
  let status = err.status || err.statusCode || 500;
  let message = err.isOperational
    ? err.message
    : 'Something went wrong on our side. Please try again in a moment.';

  // CSRF token missing / expired / tampered with.
  if (err.code === 'EBADCSRFTOKEN') {
    // Login forms are commonly left open for a while or across a local server
    // restart. Recover with a fresh form/token instead of trapping the user on
    // a 403 page. Keep only the email/branch selection; never flash a password.
    if (
      req.method === 'POST' &&
      (req.path === '/login' || req.path === '/login/branch')
    ) {
      if (req.path === '/login/branch') {
        if (req.body && req.body.branch) {
          req.flash('oldInput', { branch: req.body.branch });
        }
        req.flash('error', 'Your branch sign-in form expired. Please sign in again.');
        return res.redirect(303, '/login?tab=branch');
      }
      if (req.body && req.body.email) {
        req.flash('oldInput', { email: req.body.email });
      }
      req.flash('error', 'Your sign-in form expired. Please sign in again.');
      return res.redirect(303, '/login');
    }

    status = 403;
    message =
      'Your form session expired or the security token was invalid. Please go back, refresh the page and try again.';
  }

  // Multer limits that escaped the upload middleware.
  if (typeof err.code === 'string' && err.code.startsWith('LIMIT_')) {
    status = 400;
    message = 'The uploaded file is too large or invalid.';
  }

  // Invalid MongoDB ObjectId from a hand-typed URL.
  if (err.name === 'CastError') {
    status = 404;
    message = 'The requested record was not found.';
  }

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl} -> ${status}`);
    console.error(err.stack || err);
  } else if (status !== 403) {
    console.warn(`[warn] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
  }

  if (status >= 500 && isProduction) {
    message = 'Something went wrong on our side. Our team has been notified.';
  }

  const view = status === 403 ? 'errors/403' : status === 404 ? 'errors/404' : 'errors/500';
  const title = status === 403 ? 'Access denied' : status === 404 ? 'Not found' : 'Server error';

  return res.status(status).render(view, {
    layout: 'layouts/bare',
    ...baseLocals(req, res),
    title,
    message,
    // Only expose technical details outside production.
    technical: isProduction ? null : err.stack || err.message,
  });
}

module.exports = { notFoundHandler, errorHandler };
