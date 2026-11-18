/**
 * Central application configuration.
 * Values that are safe to share are read from environment variables once,
 * validated/clamped here, and imported everywhere else.
 */
'use strict';

const path = require('path');

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

const env = process.env.NODE_ENV || 'development';
const isProduction = env === 'production';

const config = {
  env,
  isProduction,
  port: int(process.env.PORT, 3000),

  appName: process.env.APP_NAME || 'Solar Agency',
  appUrl: (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, ''),

  // MongoDB
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/solar_agency',

  // Sessions
  sessionSecret: process.env.SESSION_SECRET || 'insecure-development-secret-change-me',
  sessionCookieName: 'solar.sid',
  sessionMaxAgeDays: clamp(int(process.env.SESSION_MAX_AGE_DAYS, 14), 1, 90),

  // Password hashing. 12 is the default; never go below 10.
  bcryptRounds: clamp(int(process.env.BCRYPT_ROUNDS, 12), 10, 15),

  // Login throttling
  loginRateWindowMinutes: clamp(int(process.env.LOGIN_RATE_WINDOW_MINUTES, 15), 1, 1440),
  loginRateMaxAttempts: clamp(int(process.env.LOGIN_RATE_MAX_ATTEMPTS, 10), 3, 100),

  // Business defaults
  currency: 'PKR',
  timezone: 'Asia/Karachi',
  defaultPageSize: 15,
  maxPageSize: 100,

  // Uploads
  uploadsDir: path.join(__dirname, '..', 'public', 'uploads'),
  companyLogoDir: path.join(__dirname, '..', 'public', 'uploads', 'company'),
  maxUploadBytes: 2 * 1024 * 1024, // 2 MB
};

module.exports = config;
