'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const packageController = require('../controllers/packageController');
const { packageRules } = require('../validators/packageValidators');

router.use(isAuthenticated);

router.get('/', requirePermission('packages.view'), packageController.index);
router.get('/new', requirePermission('packages.manage'), packageController.newForm);
router.post(
  '/',
  requirePermission('packages.manage'),
  packageRules,
  validate,
  packageController.create
);

router.get('/:id/json', requirePermission('packages.view'), packageController.getJson);
router.get('/:id', requirePermission('packages.view'), packageController.show);
router.get('/:id/edit', requirePermission('packages.manage'), packageController.editForm);
router.put(
  '/:id',
  requirePermission('packages.manage'),
  packageRules,
  validate,
  packageController.update
);
router.delete('/:id', requirePermission('packages.manage'), packageController.destroy);

module.exports = router;
