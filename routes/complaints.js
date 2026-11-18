'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const complaintController = require('../controllers/complaintController');
const {
  createComplaintRules,
  assignTechnicianRules,
  resolveComplaintRules,
} = require('../validators/complaintValidators');

router.use(isAuthenticated);

router.get('/', requirePermission('complaints.view'), complaintController.index);
router.post(
  '/',
  requirePermission('complaints.manage'),
  createComplaintRules,
  validate,
  complaintController.create
);
router.get('/:id', requirePermission('complaints.view'), complaintController.show);

router.post(
  '/:id/assign',
  requirePermission('complaints.manage'),
  assignTechnicianRules,
  validate,
  complaintController.assign
);

router.post(
  '/:id/resolve',
  requirePermission('complaints.manage'),
  resolveComplaintRules,
  validate,
  complaintController.resolve
);

module.exports = router;
