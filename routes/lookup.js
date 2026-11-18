'use strict';

const express = require('express');
const isAuthenticated = require('../middleware/isAuthenticated');
const lookupController = require('../controllers/lookupController');

const router = express.Router();
router.get('/lookup', isAuthenticated, lookupController.index);

module.exports = router;
