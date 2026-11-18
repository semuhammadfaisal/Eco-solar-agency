/** Dashboard routes. */
'use strict';

const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const isAuthenticated = require('../middleware/isAuthenticated');

const router = express.Router();

router.get('/dashboard', isAuthenticated, dashboardController.index);

module.exports = router;
