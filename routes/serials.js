/**
 * Serial number routes. Search and history are available to every signed-in
 * role; only owner, manager and storekeeper can move a serial through its
 * lifecycle.
 */
'use strict';

const express = require('express');
const serialController = require('../controllers/serialController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { serialStatusRules, serialCreateRules, serialUpdateRules } = require('../validators/serialValidators');

const router = express.Router();

router.use(isAuthenticated, requirePermission('inventory.view'));

router.get('/', serialController.index);

router.get('/new', requirePermission('inventory.manage'), serialController.newForm);
router.post(
  '/',
  requirePermission('inventory.manage'),
  serialCreateRules,
  validate,
  serialController.create
);

router.get('/:id/edit', requirePermission('inventory.manage'), serialController.editForm);
router.post(
  '/:id',
  requirePermission('inventory.manage'),
  serialUpdateRules,
  validate,
  serialController.update
);

router.get('/:id', serialController.show);
router.post(
  '/:id/status',
  requirePermission('inventory.manage'),
  serialStatusRules,
  validate,
  serialController.changeStatus
);

module.exports = router;
