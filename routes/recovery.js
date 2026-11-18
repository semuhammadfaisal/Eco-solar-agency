'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const recoveryController = require('../controllers/recoveryController');
const { ptpRules, noteRules } = require('../validators/recoveryValidators');

router.use(isAuthenticated);

// Mobile-friendly Today's Recovery list
router.get('/today', requirePermission('recovery.view'), recoveryController.todayView);

// Escalations, Broken PTPs & Defaults
router.get('/escalations', requirePermission('recovery.view'), recoveryController.escalationsView);

// Interaction & Promise-to-Pay logging
router.post('/ptp', requirePermission('recovery.manage'), ptpRules, validate, recoveryController.createPtp);
router.post('/notes', requirePermission('recovery.view'), noteRules, validate, recoveryController.createNote);
router.post('/flag/:id', requirePermission('recovery.manage'), recoveryController.flagPlan);

// Notification Logs & Retries
router.get('/logs', requirePermission('recovery.view'), recoveryController.logsIndex);
router.post('/logs/:id/retry', requirePermission('recovery.manage'), recoveryController.retryLog);

// Manual Cron Trigger
router.post('/cron/run', requirePermission('recovery.manage'), recoveryController.runCronManual);

// App Notifications (Navbar bell)
router.post('/notifications/mark-all-read', recoveryController.markAllNotificationsRead);

// Customer History API
router.get('/history/:customerId', requirePermission('recovery.view'), recoveryController.customerRecoveryHistoryJson);

module.exports = router;
