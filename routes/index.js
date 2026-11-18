/** Root router: mounts every feature router. */
'use strict';

const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  return res.redirect(req.user ? '/dashboard' : '/login');
});

router.use(require('./auth'));
router.use(require('./dashboard'));
router.use(require('./lookup'));
router.use('/users', require('./users'));
router.use('/settings', require('./settings'));
router.use('/customers', require('./customers'));
router.use('/employees', require('./employees'));
router.use('/partners', require('./partners'));
router.use('/items', require('./items'));
router.use('/suppliers', require('./suppliers'));
router.use('/purchases', require('./purchases'));
router.use('/stock', require('./stock'));
router.use('/serials', require('./serials'));
router.use('/surveys', require('./surveys'));
router.use('/packages', require('./packages'));
router.use(require('./systems'));
router.use('/quotations', require('./quotations'));
router.use('/projects', require('./projects'));
// Legacy /sales URLs redirect to /projects.
router.use('/sales', require('./sales'));
router.use('/installments', require('./installments'));
router.use('/recovery', require('./recovery'));
router.use('/installations', require('./installations'));
router.use('/warranties', require('./warranties'));
router.use('/complaints', require('./complaints'));
router.use('/maintenance', require('./maintenance'));
router.use('/accounting', require('./accounting'));
router.use(require('./commerce'));

module.exports = router;
