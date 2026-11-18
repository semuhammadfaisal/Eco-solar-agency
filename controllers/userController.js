/** User management controllers (owner only). */
'use strict';

const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const userService = require('../services/userService');
const {
  ALL_ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_BADGES,
} = require('../config/roles');
const { safeReferrer } = require('../utils/urls');
const branchInventoryService = require('../services/branchInventoryService');
const branchLoginService = require('../services/branchLoginService');
const { formatDateTime } = require('../utils/format');

const usersBreadcrumb = { label: 'Users', url: '/users' };

exports.index = asyncHandler(async (req, res) => {
  const { search = '', role = '', status = '' } = req.query;

  const { items, total, pagination } = await userService.paginateUsers({
    search,
    role,
    status,
    page: req.query.page,
    limit: req.query.limit,
  });

  return res.render('users/index', {
    layout: 'layouts/admin',
    title: 'Users',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Users' }],
    users: items,
    total,
    pagination,
    filters: {
      search: String(search).slice(0, 80),
      role,
      status,
    },
    roles: ALL_ROLES,
    roleLabels: ROLE_LABELS,
    roleBadges: ROLE_BADGES,
    currentUserId: String(req.user._id),
  });
});

exports.newForm = asyncHandler(async (req, res) => {
  return res.render('users/form', {
    layout: 'layouts/admin',
    title: 'Add user',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      usersBreadcrumb,
      { label: 'Add user' },
    ],
    user: null,
    formAction: '/users',
    formMethod: 'POST',
    roles: ALL_ROLES,
    roleLabels: ROLE_LABELS,
    roleDescriptions: ROLE_DESCRIPTIONS,
    isEdit: false,
    branches: await branchInventoryService.listBranches(),
  });
});

exports.create = asyncHandler(async (req, res) => {
  const user = await userService.createUser(
    {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      role: req.body.role,
      isActive: req.body.isActive !== '0',
      password: req.body.password,
      branch: req.body.branch,
    },
    req.user,
    req
  );

  req.flash('success', `${user.name} has been added.`);
  return res.redirect('/users');
});

exports.editForm = asyncHandler(async (req, res) => {
  const user = await userService.getUserOrThrow(req.params.id);

  return res.render('users/form', {
    layout: 'layouts/admin',
    title: `Edit ${user.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      usersBreadcrumb,
      { label: user.name },
    ],
    user,
    formAction: `/users/${user._id}`,
    formMethod: 'PUT',
    roles: ALL_ROLES,
    roleLabels: ROLE_LABELS,
    roleDescriptions: ROLE_DESCRIPTIONS,
    isEdit: true,
    isSelf: String(user._id) === String(req.user._id),
    branches: await branchInventoryService.listBranches(),
  });
});

exports.update = asyncHandler(async (req, res) => {
  const user = await userService.updateUser(
    req.params.id,
    {
      name: req.body.name,
      email: req.body.email,
      phone: req.body.phone,
      role: req.body.role,
      isActive: req.body.isActive !== '0',
      password: req.body.password || undefined,
      branch: req.body.branch,
    },
    req.user,
    req
  );

  // Changing your own password from the edit form would otherwise invalidate
  // this session on the next request.
  if (req.body.password && String(user._id) === String(req.user._id)) {
    req.session.authAt = Date.now();
  }

  req.flash('success', `${user.name} has been updated.`);
  return res.redirect('/users');
});

exports.toggleActive = asyncHandler(async (req, res) => {
  const user = await userService.getUserOrThrow(req.params.id);
  const updated = await userService.setActive(user._id, !user.isActive, req.user, req);

  req.flash(
    'success',
    `${updated.name} has been ${updated.isActive ? 'activated' : 'deactivated'}.`
  );
  return res.redirect(safeReferrer(req, '/users'));
});

exports.destroy = asyncHandler(async (req, res) => {
  try {
    const user = await userService.softDeleteUser(req.params.id, req.user, req);
    req.flash('success', `${user.name} has been deleted.`);
  } catch (err) {
    if (err instanceof ApiError) req.flash('error', err.message);
    else throw err;
  }

  return res.redirect(safeReferrer(req, '/users'));
});

/* ------------------------------------------------------------------ *
 * Owner-initiated password reset
 * ------------------------------------------------------------------ */

exports.passwordForm = asyncHandler(async (req, res) => {
  const user = await userService.getUserOrThrow(req.params.id);

  return res.render('users/password', {
    layout: 'layouts/admin',
    title: `Reset password · ${user.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      usersBreadcrumb,
      { label: user.name },
      { label: 'Reset password' },
    ],
    targetUser: user,
    roleLabels: ROLE_LABELS,
    formAction: `/users/${user._id}/password`,
    isSelf: String(user._id) === String(req.user._id),
  });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const target = await userService.getUserOrThrow(req.params.id);
  const isSelf = String(target._id) === String(req.user._id);

  await userService.resetPassword(
    target._id,
    req.body.newPassword,
    req.user,
    req
  );

  // Resetting your own password would otherwise invalidate this very session
  // on the next request, so move the session's auth marker forward.
  if (isSelf) req.session.authAt = Date.now();

  req.flash(
    'success',
    isSelf
      ? 'Your password has been changed. Other sessions have been signed out.'
      : `${target.name}'s password has been reset. Their other sessions have been signed out.`
  );
  return res.redirect('/users');
});

/* ------------------------------------------------------------------ *
 * Shared branch logins
 * ------------------------------------------------------------------ */

exports.branchLogins = asyncHandler(async (req, res) => {
  const branches = await branchLoginService.listAdminBranches();

  return res.render('users/branch-logins', {
    layout: 'layouts/admin',
    title: 'Branch logins',
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      usersBreadcrumb,
      { label: 'Branch logins' },
    ],
    branches,
    formatDateTime,
  });
});

exports.branchPasswordForm = asyncHandler(async (req, res) => {
  const branch = await branchLoginService.getBranchOrThrow(req.params.id);

  return res.render('users/branch-password', {
    layout: 'layouts/admin',
    title: `Branch password · ${branch.name}`,
    breadcrumbs: [
      { label: 'Dashboard', url: '/dashboard' },
      usersBreadcrumb,
      { label: 'Branch logins', url: '/users/branch-logins' },
      { label: branch.name },
    ],
    branch,
    hasPassword: Boolean(branch.loginPasswordHash),
    formAction: `/users/branch-logins/${branch._id}/password`,
  });
});

exports.setBranchPassword = asyncHandler(async (req, res) => {
  const branch = await branchLoginService.setBranchPassword(
    req.params.id,
    req.body.password,
    req.user,
    req
  );

  req.flash(
    'success',
    `Branch login ${branch.loginEnabled ? 'enabled' : 'updated'} for ${branch.name}.`
  );
  return res.redirect('/users/branch-logins');
});

exports.clearBranchPassword = asyncHandler(async (req, res) => {
  const branch = await branchLoginService.clearBranchPassword(
    req.params.id,
    req.user,
    req
  );

  req.flash(
    'success',
    `Branch login disabled for ${branch.name}. Any open branch session has been signed out.`
  );
  return res.redirect('/users/branch-logins');
});
