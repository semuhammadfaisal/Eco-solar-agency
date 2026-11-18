/** Dashboard controller. */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { getDashboardData } = require('../services/dashboardService');
const { ROLE_LABELS } = require('../config/roles');
const { getCommerceDashboard } = require('../services/commerceDashboardService');

exports.index = asyncHandler(async (req, res) => {
  const [data, commerce] = await Promise.all([getDashboardData(req.user), getCommerceDashboard(req.user)]);
  data.commerce = commerce;

  return res.render('dashboard/index', {
    layout: 'layouts/admin',
    title: 'Dashboard',
    breadcrumbs: [],
    stats: data,
    roleLabel: ROLE_LABELS[req.user.role] || req.user.role,
  });
});
