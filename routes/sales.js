/**
 * Legacy /sales URLs.
 *
 * The module was renamed to Projects. Keep old bookmarks and any external
 * links working by redirecting to the new routes.
 */
'use strict';

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => res.redirect(301, '/projects'));
router.get('/:id', (req, res) => res.redirect(301, `/projects/${req.params.id}`));

module.exports = router;
