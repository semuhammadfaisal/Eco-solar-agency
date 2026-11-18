'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const installationController = require('../controllers/installationController');
const {
  createInstallationRules,
  scheduleRules,
  signoffRules,
} = require('../validators/installationValidators');

router.use(isAuthenticated);

// The technician workspace was removed; keep old bookmarks working.
router.get('/my-jobs', (req, res) => res.redirect('/installations'));

// Standard list, show, create
router.get('/', requirePermission('installations.view'), installationController.index);
router.post(
  '/',
  requirePermission('installations.manage'),
  createInstallationRules,
  validate,
  installationController.create
);
router.get('/:id', requirePermission('installations.view'), installationController.show);

// Material Issue
router.post(
  '/:id/issue-materials',
  requirePermission('material.issue'),
  installationController.issueMaterials
);

// Schedule
router.post(
  '/:id/schedule',
  requirePermission('installations.manage'),
  scheduleRules,
  validate,
  installationController.updateSchedule
);

// Checklist & Technical Readings
router.post(
  '/:id/checklist',
  requirePermission('technician.jobs'),
  installationController.updateChecklist
);

// Customer Sign-off
router.post(
  '/:id/signoff',
  requirePermission('technician.jobs'),
  signoffRules,
  validate,
  installationController.recordSignoff
);

// Commissioning & Commissioning Report PDF
router.post(
  '/:id/commission',
  requirePermission('installations.commission'),
  installationController.commission
);
router.get(
  '/:id/commissioning-pdf',
  requirePermission('installations.view'),
  installationController.commissioningPdf
);

module.exports = router;
