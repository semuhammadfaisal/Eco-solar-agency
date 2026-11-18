'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const maintenanceController = require('../controllers/maintenanceController');

router.use(isAuthenticated);

router.get('/', requirePermission('installations.view'), maintenanceController.index);
router.post('/', requirePermission('installations.manage'), maintenanceController.create);
router.post('/:id/complete', requirePermission('technician.jobs'), maintenanceController.complete);

module.exports = router;
