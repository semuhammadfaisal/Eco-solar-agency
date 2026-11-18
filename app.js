/**
 * Solar Business Management System — application entry point.
 *
 * Middleware order matters:
 *   security headers → static assets → body parsing → method override →
 *   session → flash → current user → CSRF → view locals → routes → errors
 */
'use strict';

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');
const csrf = require('csurf');
const mongoose = require('mongoose');

const config = require('./config/app');
const { connectDB } = require('./config/db');
const { initCronJobs } = require('./services/cronService');
const logger = require('./services/logger');
const routes = require('./routes');
const loadUser = require('./middleware/loadUser');
const branchSessionGuard = require('./middleware/branchSessionGuard');
const locals = require('./middleware/locals');
const closingReminder = require('./middleware/closingReminder');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

/* -------------------------------------------------------------------------- */
/* Core settings                                                              */
/* -------------------------------------------------------------------------- */

app.set('trust proxy', 1); // correct req.ip / secure cookies behind a proxy
app.disable('x-powered-by');
app.set('view cache', config.isProduction);

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(expressLayouts);
app.set('layout', 'layouts/admin');

/* -------------------------------------------------------------------------- */
/* Security headers                                                           */
/* -------------------------------------------------------------------------- */

app.use(
  helmet({
    // UI dependencies are served from /vendor (see the static mounts below),
    // so scripts only need 'self'. Inline EJS scripts and Alpine expressions
    // require 'unsafe-inline' and 'unsafe-eval'.
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'font-src': ["'self'", 'data:'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'self'"],
        // Local development runs over http; only force https upgrades in prod.
        'upgrade-insecure-requests': config.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction,
    referrerPolicy: { policy: 'same-origin' },
  })
);

// Compress HTML, JSON, CSS and JavaScript responses. Small payloads stay
// uncompressed to avoid spending CPU where compression cannot help.
app.use(compression({ threshold: 1024 }));

// The multipart settings form passes _csrf in the query string (CSRF is
// checked before the body is parsed), so redact it from access logs.
morgan.token('url', (req) =>
  (req.originalUrl || req.url).replace(/([?&]_csrf=)[^&]*/i, '$1[redacted]')
);

app.use(
  morgan(config.isProduction ? 'combined' : 'dev', {
    stream: config.isProduction ? logger.httpStream : process.stdout,
    skip: (req) => req.path.startsWith('/css') || req.path.startsWith('/js'),
  })
);

/* -------------------------------------------------------------------------- */
/* Static assets & parsers                                                    */
/* -------------------------------------------------------------------------- */

app.use(
  express.static(path.join(__dirname, 'public'), {
    maxAge: config.isProduction ? '7d' : 0,
    etag: true,
  })
);

// Serve UI dependencies locally. This removes external DNS/TLS/CDN latency
// and keeps the application usable on unreliable or offline shop networks.
const vendorCache = {
  maxAge: config.isProduction ? '30d' : '1h',
  immutable: config.isProduction,
  etag: true,
};
app.use(
  '/vendor/bootstrap',
  express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'css'), vendorCache)
);
app.use(
  '/vendor/bootstrap',
  express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist', 'js'), vendorCache)
);
app.use(
  '/vendor/bootstrap-icons',
  express.static(path.join(__dirname, 'node_modules', 'bootstrap-icons', 'font'), vendorCache)
);
app.use(
  '/vendor/alpine',
  express.static(path.join(__dirname, 'node_modules', 'alpinejs', 'dist'), vendorCache)
);
app.use(
  '/vendor/chart',
  express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist'), vendorCache)
);
app.use(
  '/vendor/fullcalendar',
  express.static(path.join(__dirname, 'node_modules', 'fullcalendar'), vendorCache)
);

// Browsers request this automatically. Answer it directly so it never falls
// through to the app router (which would trigger an auth redirect and store
// /favicon.ico as the post-login destination).
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Keep health probes lightweight: they must not create a session, require a
// CSRF token, or render a page. Render uses this endpoint to decide whether a
// deployment is healthy; an external uptime monitor can use the same URL.
app.get('/healthz', (req, res) => {
  const databaseConnected = mongoose.connection.readyState === 1;

  res
    .status(databaseConnected ? 200 : 503)
    .set('Cache-Control', 'no-store')
    .json({
      status: databaseConnected ? 'ok' : 'unavailable',
      database: databaseConnected ? 'connected' : 'disconnected',
      uptimeSeconds: Math.floor(process.uptime()),
    });
});

app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// HTML forms can only send GET/POST; _method enables PUT/PATCH/DELETE routes.
// A custom getter also honours ?_method=… which is required for multipart forms
// (the body is not parsed yet when this middleware runs).
app.use(
  methodOverride((req) => (req.body && req.body._method) || (req.query && req.query._method))
);

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

if (config.isProduction && config.sessionSecret.includes('insecure-development')) {
  throw new Error('SESSION_SECRET must be set to a strong random value in production.');
}

// connect-mongo encrypts stored session payloads. Its crypto layer (kruptein)
// requires a passphrase containing upper/lower case, digits and symbols, so
// derive a deterministic secret with a guaranteed-complexity prefix.
const sessionCryptoSecret =
  'Aa1!Bb2@' +
  crypto.createHash('sha256').update(config.sessionSecret).digest('hex');

const sessionStore = MongoStore.create({
  mongoUrl: config.mongoUri,
  collectionName: 'sessions',
  ttl: config.sessionMaxAgeDays * 24 * 60 * 60,
  autoRemove: 'native',
  // Avoid a remote MongoDB write on every page view. Active sessions are
  // touched at most once per hour while the browser cookie can still roll.
  touchAfter: 60 * 60,
  // connect-mongo 5.x encrypts the serialized session, then JSON.parses the
  // decrypted value in decryptSession(), and finally runs unserialize(). With
  // kruptein 3.4 an object round-trips as an object, so the parse step breaks.
  // Serializing to a string explicitly keeps every step consistent:
  //   set:   JSON.stringify(session) -> encrypt
  //   get:   decrypt -> JSON.parse -> identity
  serialize: JSON.stringify,
  crypto: {
    secret: sessionCryptoSecret,
  },
});

app.use(
  session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProduction,
      maxAge: config.sessionMaxAgeDays * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(flash());

/* -------------------------------------------------------------------------- */
/* Auth context, CSRF and view locals                                         */
/* -------------------------------------------------------------------------- */

app.use(loadUser);

// Shared branch logins may only reach their small workspace. The allow-list
// runs before CSRF so blocked POSTs fail cleanly instead of showing a token
// error, and it protects typed URLs as well as hidden menu items.
app.use(branchSessionGuard);

// csurf is deprecated upstream but is still functional and explicitly
// requested. It stores the secret in req.session.csrfSecret (no cookie).
app.use(
  csrf({
    cookie: false,
  })
);

app.use(locals);
app.use(closingReminder);

/* -------------------------------------------------------------------------- */
/* Routes & error handling                                                    */
/* -------------------------------------------------------------------------- */

app.use('/', routes);

app.use(notFoundHandler);
app.use(errorHandler);

/* -------------------------------------------------------------------------- */
/* Server lifecycle                                                           */
/* -------------------------------------------------------------------------- */

async function start() {
  await connectDB();
  initCronJobs();

  const server = app.listen(config.port, () => {
    console.log(`[app] ${config.appName} running at http://localhost:${config.port} (${config.env})`);
  });

  const shutdown = (signal) => {
    console.log(`\n[app] ${signal} received, shutting down...`);
    server.close(async () => {
      await mongoose.connection.close();
      process.exit(0);
    });
    // Do not hang forever on keep-alive connections.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

process.on('unhandledRejection', (reason) => {
  console.error('[app] unhandled promise rejection:', reason);
});

if (require.main === module) {
  start().catch((err) => {
    console.error('[app] failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = app;
