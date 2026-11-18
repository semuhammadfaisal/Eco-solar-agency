'use strict';

const express = require('express');
const controller = require('../controllers/surveyController');
const isAuthenticated = require('../middleware/isAuthenticated');
const requirePermission = require('../middleware/requirePermission');
const validate = require('../middleware/validate');
const { surveyPhotoUpload } = require('../middleware/upload');
const { createSurveyRules, updateSurveyRules } = require('../validators/surveyValidators');

const router = express.Router();
router.use(isAuthenticated, requirePermission('surveys.view'));

router.get('/', controller.index);
router.get('/calendar', controller.calendar);
router.get('/new', requirePermission('surveys.schedule'), controller.newForm);
router.post('/', requirePermission('surveys.schedule'), surveyPhotoUpload, createSurveyRules, validate, controller.create);
router.get('/:id/report.pdf', controller.report);
router.get('/:id/edit', requirePermission('surveys.perform'), controller.editForm);
router.put('/:id', requirePermission('surveys.perform'), surveyPhotoUpload, updateSurveyRules, validate, controller.update);
router.get('/:id', controller.show);

module.exports = router;
