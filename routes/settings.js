/** Company settings routes — owner + manager. */
'use strict';

const express = require('express');
const settingsController = require('../controllers/settingsController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { companyLogoUpload } = require('../middleware/upload');
const { settingsRules } = require('../validators/settingsValidators');

const router = express.Router();

router.use(isAuthenticated, requirePermission('settings.manage'));

router.get('/', settingsController.show);

// multipart form: the file must be parsed before validation runs on the body.
router.put('/', companyLogoUpload, settingsRules, validate, settingsController.update);

module.exports = router;
