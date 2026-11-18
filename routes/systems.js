'use strict';

const express = require('express');
const router = express.Router();
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const systemConfigController = require('../controllers/systemConfigController');
const { systemConfigRules, approvalRules } = require('../validators/systemValidators');

// Scope auth to this router's own paths. This router is mounted at "/", so an
// unscoped router.use() would intercept every unmatched request in the app.
router.use(['/system-builder', '/system-configs'], isAuthenticated);

// System Builder
router.get(
  '/system-builder',
  requirePermission('systems.manage'),
  systemConfigController.builder
);
router.post(
  '/system-builder/calculate',
  requirePermission('systems.manage'),
  systemConfigController.calculateAjax
);
router.post(
  '/system-builder',
  requirePermission('systems.manage'),
  systemConfigRules,
  validate,
  systemConfigController.create
);

// Saved System Configs & BOM
router.get(
  '/system-configs',
  requirePermission('systems.view'),
  systemConfigController.index
);
router.get(
  '/system-configs/:id',
  requirePermission('systems.view'),
  systemConfigController.show
);
router.get(
  '/system-configs/:id/print',
  requirePermission('systems.view'),
  systemConfigController.print
);
router.post(
  '/system-configs/:id/approve',
  requirePermission('systems.approve'),
  approvalRules,
  systemConfigController.approve
);
router.post(
  '/system-configs/:id/reject',
  requirePermission('systems.approve'),
  approvalRules,
  systemConfigController.reject
);
router.delete(
  '/system-configs/:id',
  requirePermission('systems.manage'),
  systemConfigController.destroy
);

module.exports = router;
