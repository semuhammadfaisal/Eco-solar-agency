/**
 * Company logo upload (multer).
 *
 * - disk storage under public/uploads/company
 * - images only (SVG is deliberately rejected: it can carry scripts)
 * - 2 MB limit, one file
 *
 * Multer errors are converted into a flash message + redirect so a bad upload
 * never produces a stack trace for the user.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config/app');
const { safeReferrer } = require('../utils/urls');

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    try {
      fs.mkdirSync(config.companyLogoDir, { recursive: true });
      cb(null, config.companyLogoDir);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `logo-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    cb(null, name);
  },
});

const uploader = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed.'));
    }
    return cb(null, true);
  },
});

const surveyStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    const destination = path.join(config.uploadsDir, 'surveys');
    try {
      fs.mkdirSync(destination, { recursive: true });
      cb(null, destination);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `survey-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const surveyUploader = multer({
  storage: surveyStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 20 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMime = new Set(['image/jpeg', 'image/png']);
    const allowedExt = new Set(['.jpg', '.jpeg', '.png']);
    if (!allowedMime.has(file.mimetype) || !allowedExt.has(ext)) {
      return cb(new Error('Survey photos must be JPG or PNG images.'));
    }
    return cb(null, true);
  },
});

/** Middleware for the settings form: single field named "logo". */
function companyLogoUpload(req, res, next) {
  uploader.single('logo')(req, res, (err) => {
    if (!err) return next();

    let message = 'The logo could not be uploaded. Please try again.';
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = `Logo is too large. Maximum size is ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`;
    } else if (err.message) {
      message = err.message;
    }

    req.flash('error', message);
    return res.redirect(safeReferrer(req, '/settings'));
  });
}

function surveyPhotoUpload(req, res, next) {
  surveyUploader.fields([
    { name: 'roofPhotos', maxCount: 5 },
    { name: 'meterPhotos', maxCount: 5 },
    { name: 'billPhotos', maxCount: 5 },
    { name: 'dbPanelPhotos', maxCount: 5 },
  ])(req, res, (err) => {
    if (!err) {
      const files = Object.values(req.files || {}).flat();
      const valid = files.every((file) => {
        let handle;
        try {
          handle = fs.openSync(file.path, 'r');
          const header = Buffer.alloc(8);
          fs.readSync(handle, header, 0, 8, 0);
          const isJpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
          const isPng = header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
          return (file.mimetype === 'image/jpeg' && isJpeg) || (file.mimetype === 'image/png' && isPng);
        } catch (_error) {
          return false;
        } finally {
          if (handle !== undefined) fs.closeSync(handle);
        }
      });
      if (valid) return next();
      files.forEach((file) => { try { fs.unlinkSync(file.path); } catch (_error) { /* already removed */ } });
      req.flash('error', 'One or more survey photos are not valid JPG or PNG files.');
      return res.redirect(safeReferrer(req, '/surveys'));
    }
    let message = 'The survey photos could not be uploaded.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'Each survey photo must be 5 MB or smaller.';
    else if (err.code === 'LIMIT_FILE_COUNT') message = 'A survey can upload at most 20 photos at once.';
    else if (err.message) message = err.message;
    req.flash('error', message);
    return res.redirect(safeReferrer(req, '/surveys'));
  });
}

const expenseStorage = multer.diskStorage({
  destination(_req, _file, cb) {
    const destination = path.join(config.uploadsDir, 'expenses');
    try {
      fs.mkdirSync(destination, { recursive: true });
      cb(null, destination);
    } catch (err) {
      cb(err);
    }
  },
  filename(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `exp-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const expenseUploader = multer({
  storage: expenseStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
    const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.webp', '.pdf']);
    if (!allowedMime.has(file.mimetype) || !allowedExt.has(ext)) {
      return cb(new Error('Expense receipt must be a JPG, PNG, WEBP image or PDF document.'));
    }
    return cb(null, true);
  },
});

function expenseReceiptUpload(req, res, next) {
  expenseUploader.single('receipt')(req, res, (err) => {
    if (!err) return next();
    let message = 'Receipt could not be uploaded.';
    if (err.code === 'LIMIT_FILE_SIZE') message = 'Receipt attachment must be 5 MB or smaller.';
    else if (err.message) message = err.message;
    req.flash('error', message);
    return res.redirect(safeReferrer(req, '/accounting/expenses'));
  });
}

module.exports = { companyLogoUpload, surveyPhotoUpload, expenseReceiptUpload };
