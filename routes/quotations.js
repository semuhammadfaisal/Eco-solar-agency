'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const quotationController = require('../controllers/quotationController');
const { quotationRules, statusRules, emailRules } = require('../validators/quotationValidators');

router.use(isAuthenticated);

router.get('/', requirePermission('quotations.view'), quotationController.index);
router.get('/new', requirePermission('quotations.manage'), quotationController.newForm);
router.post(
  '/',
  requirePermission('quotations.manage'),
  quotationRules,
  validate,
  quotationController.create
);

router.get('/:id', requirePermission('quotations.view'), quotationController.show);
router.get('/:id/pdf', requirePermission('quotations.view'), quotationController.downloadPdf);
router.post('/:id/duplicate', requirePermission('quotations.manage'), quotationController.duplicate);
router.post(
  '/:id/status',
  requirePermission('quotations.manage'),
  statusRules,
  validate,
  quotationController.updateStatus
);
router.post(
  '/:id/email',
  requirePermission('quotations.manage'),
  emailRules,
  validate,
  quotationController.sendEmail
);
router.delete('/:id', requirePermission('quotations.manage'), quotationController.destroy);

module.exports = router;
