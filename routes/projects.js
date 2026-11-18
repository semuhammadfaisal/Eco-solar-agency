'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const saleController = require('../controllers/saleController');
const { createProjectRules } = require('../validators/projectValidators');

router.use(isAuthenticated);

router.get('/', requirePermission('sales.view'), saleController.index);

router.get('/new', requirePermission('projects.manage'), saleController.newForm);
router.post(
  '/',
  requirePermission('projects.manage'),
  createProjectRules,
  validate,
  saleController.create
);

router.get('/:id', requirePermission('sales.view'), saleController.show);
router.post('/:id/status', requirePermission('projects.manage'), saleController.updateStatus);

module.exports = router;
