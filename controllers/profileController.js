'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const userService = require('../services/userService');

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

exports.show = (req, res) => {
  return res.render('profile/index', {
    layout: 'layouts/admin',
    title: 'My profile',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      { label: 'My profile' },
    ],
    profile: req.user,
  });
};

exports.update = asyncHandler(async (req, res) => {
  try {
    await userService.updateOwnProfile(req.user._id, req.body, req);
  } catch (err) {
    if (err instanceof ApiError) {
      req.flash('error', err.message);
      req.flash('oldInput', {
        name: req.body.name,
        email: req.body.email,
        phone: req.body.phone,
      });
      return res.redirect('/profile');
    }
    throw err;
  }

  req.flash('success', 'Your profile details have been updated.');
  await saveSession(req);
  return res.redirect('/profile');
});
