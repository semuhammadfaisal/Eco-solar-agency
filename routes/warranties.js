'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const warrantyController = require('../controllers/warrantyController');
const { claimRules } = require('../validators/warrantyValidators');

router.use(isAuthenticated);

router.get('/', requirePermission('warranty.view'), warrantyController.index);
router.get('/:id', requirePermission('warranty.view'), warrantyController.show);
router.get('/:id/certificate-pdf', requirePermission('warranty.view'), warrantyController.certificatePdf);
router.post(
  '/:id/claim',
  requirePermission('warranty.manage'),
  claimRules,
  validate,
  warrantyController.claim
);

module.exports = router;
