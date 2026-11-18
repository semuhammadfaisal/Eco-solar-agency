/** Company settings controllers (owner + manager). */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const settingsService = require('../services/settingsService');

exports.show = asyncHandler(async (req, res) => {
  const settings = await settingsService.getSettings();

  return res.render('settings/index', {
    layout: 'layouts/admin',
    title: 'Company settings',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'Company settings' },
    ],
    settings,
    canEdit: req.user.role === 'owner' || req.user.role === 'manager',
  });
});

exports.update = asyncHandler(async (req, res) => {
  try {
    await settingsService.updateSettings(
      req.body,
      {
        logoFile: req.file || null,
        removeLogo: req.body.removeLogo === '1',
      },
      req.user,
      req
    );
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      return res.redirect('/settings');
    }
    throw err;
  }

  req.flash('success', 'Company settings have been saved.');
  return res.redirect('/settings');
});
