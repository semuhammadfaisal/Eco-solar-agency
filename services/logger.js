'use strict';

/**
 * Production Logging Service.
 *
 * Provides:
 * - Structured file-based logging (`logs/error.log` and `logs/combined.log`)
 * - Console output with color formatting for development
 * - Stream integration for Morgan HTTP request logging
 */

const fs = require('fs');
const path = require('path');
const config = require('../config/app');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

try {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
} catch (_e) {}

const errorLogStream = fs.createWriteStream(path.join(LOGS_DIR, 'error.log'), { flags: 'a' });
const combinedLogStream = fs.createWriteStream(path.join(LOGS_DIR, 'combined.log'), { flags: 'a' });

function formatLog(level, message, meta = null) {
  const timestamp = new Date().toISOString();
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}\n`;
}

const logger = {
  info(message, meta) {
    const formatted = formatLog('info', message, meta);
    combinedLogStream.write(formatted);
    if (!config.isProduction) {
      console.log(`\x1b[36m[info]\x1b[0m ${message}`, meta || '');
    }
  },

  warn(message, meta) {
    const formatted = formatLog('warn', message, meta);
    combinedLogStream.write(formatted);
    console.warn(`\x1b[33m[warn]\x1b[0m ${message}`, meta || '');
  },

  error(message, errorOrMeta) {
    let meta = errorOrMeta;
    if (errorOrMeta instanceof Error) {
      meta = {
        name: errorOrMeta.name,
        message: errorOrMeta.message,
        stack: errorOrMeta.stack,
      };
    }
    const formatted = formatLog('error', message, meta);
    errorLogStream.write(formatted);
    combinedLogStream.write(formatted);
    console.error(`\x1b[31m[error]\x1b[0m ${message}`, meta || '');
  },

  // Stream adapter for Morgan HTTP logger
  httpStream: {
    write(message) {
      combinedLogStream.write(`[${new Date().toISOString()}] [HTTP] ${message}`);
    },
  },
};

module.exports = logger;
