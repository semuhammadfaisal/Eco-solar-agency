'use strict';

/**
 * Automated MongoDB Backup Script.
 *
 * Runs `mongodump` with Gzip compression and archive mode.
 * Automatically prunes archives older than retention threshold (default 14 days).
 *
 * CLI Usage:
 *   node scripts/backup.js
 *
 * Programmatic Usage:
 *   const { performBackup } = require('./scripts/backup');
 *   await performBackup();
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config/app');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS, 10) || 14;

/**
 * Executes mongodump and returns a promise resolving on completion.
 */
function runMongodump(archivePath, mongoUri) {
  return new Promise((resolve, reject) => {
    // Hide passwords from logs
    const safeUri = mongoUri.replace(/\/\/([^@/]+)@/, '//***:***@');
    console.log(`[backup] Starting mongodump to ${archivePath} (${safeUri})...`);

    const args = [`--uri=${mongoUri}`, `--archive=${archivePath}`, '--gzip'];

    const child = spawn('mongodump', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        const warnMsg =
          '[backup] mongodump utility not found in system PATH. Ensure MongoDB Database Tools are installed.';
        console.warn(warnMsg);
        return resolve({ success: false, skipped: true, error: warnMsg });
      }
      return reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[backup] Archive created successfully: ${archivePath}`);
        return resolve({ success: true, archivePath });
      } else {
        const err = new Error(`mongodump process exited with code ${code}: ${stderr}`);
        console.error(`[backup] ${err.message}`);
        return reject(err);
      }
    });
  });
}

/**
 * Prunes backup archives older than the retention threshold.
 */
function pruneOldBackups(backupDir, retentionDays) {
  if (!fs.existsSync(backupDir)) return 0;

  const now = Date.now();
  const cutoffMs = retentionDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(backupDir);
  let prunedCount = 0;

  for (const file of files) {
    if (!file.startsWith('backup-') || !file.endsWith('.gz')) continue;

    const filePath = path.join(backupDir, file);
    try {
      const stats = fs.statSync(filePath);
      const ageMs = now - stats.mtimeMs;
      if (ageMs > cutoffMs) {
        fs.unlinkSync(filePath);
        prunedCount++;
        console.log(`[backup] Pruned old backup archive: ${file} (age: ${(ageMs / 86400000).toFixed(1)} days)`);
      }
    } catch (e) {
      console.warn(`[backup] Could not stat/delete ${filePath}:`, e.message);
    }
  }

  return prunedCount;
}

/**
 * Main backup runner.
 */
async function performBackup(options = {}) {
  const backupDir = options.backupDir || BACKUP_DIR;
  const retentionDays = options.retentionDays !== undefined ? options.retentionDays : RETENTION_DAYS;
  const mongoUri = options.mongoUri || config.mongoUri;

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(backupDir, `backup-${timestamp}.gz`);

  try {
    const result = await runMongodump(archivePath, mongoUri);
    const prunedCount = pruneOldBackups(backupDir, retentionDays);
    return {
      success: result.success,
      skipped: result.skipped || false,
      archivePath: result.archivePath || null,
      prunedCount,
      timestamp,
    };
  } catch (err) {
    console.error('[backup] Backup failed:', err.message);
    return {
      success: false,
      error: err.message,
    };
  }
}

if (require.main === module) {
  performBackup()
    .then((res) => {
      console.log('[backup] Execution finished:', res);
      process.exit(res.success || res.skipped ? 0 : 1);
    })
    .catch((err) => {
      console.error('[backup] Fatal error:', err);
      process.exit(1);
    });
}

module.exports = { performBackup, pruneOldBackups };
