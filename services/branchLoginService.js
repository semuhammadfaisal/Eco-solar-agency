/**
 * Shared branch login.
 *
 * A branch has one shared password (set by the owner from User Admin) instead
 * of a staff account. Signing in with it creates a branch-scoped session that
 * behaves like a shopkeeper for the selected branch: POS, branch stock, stock
 * transfers and the product catalogue only. See middleware/branchSessionGuard.
 */
'use strict';

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Branch = require('../models/Branch');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { ROLES } = require('../config/roles');

// A valid hash compared against when the branch does not exist or has no
// password, so response timing does not reveal which branches are configured.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-branch-password', 10);

function initialsFor(name) {
  if (!name) return '?';
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/**
 * The request principal for a branch session. It is deliberately a plain
 * object, not a User document: no real user exists and actor._id stays null so
 * createdBy fields are never given a branch id.
 */
function buildBranchPrincipal(branch) {
  return {
    _id: null,
    name: branch.name,
    email: '',
    role: ROLES.SHOPKEEPER,
    roleLabel: 'Branch login',
    initials: initialsFor(branch.name),
    branch: branch._id,
    branchId: branch._id,
    branchCode: branch.code,
    branchName: branch.name,
    isActive: true,
    isBranchLogin: true,
  };
}

/** Pseudo-actor used only for audit rows written by a branch session. */
function branchActor(branch) {
  return {
    _id: null,
    name: `${branch.code} branch`,
    email: '',
    role: ROLES.SHOPKEEPER,
  };
}

/** Active branches for the login screen (never includes the hash). */
async function listLoginBranches() {
  return Branch.find({ isActive: true })
    .select('code name type loginEnabled')
    .sort({ type: -1, code: 1 })
    .lean();
}

/** All branches for the owner-only Branch Logins screen. */
async function listAdminBranches() {
  const rows = await Branch.find()
    .select('+loginPasswordHash')
    .sort({ type: -1, code: 1 })
    .lean();

  return rows.map((row) => {
    const { loginPasswordHash, ...branch } = row;
    return { ...branch, hasPassword: Boolean(loginPasswordHash) };
  });
}

/** Load a branch with its login hash for administration. */
async function getBranchOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('Branch not found.');
  const branch = await Branch.findById(id).select('+loginPasswordHash');
  if (!branch) throw ApiError.notFound('Branch not found.');
  return branch;
}

/**
 * Validate a branch password.
 * @param {string} branchId
 * @param {string} password
 * @param {{req?: import('express').Request}} [meta]
 * @returns {Promise<import('../models/Branch')>}
 */
async function authenticateBranch(branchId, password, meta = {}) {
  const branch = mongoose.isValidObjectId(branchId)
    ? await Branch.findOne({ _id: branchId, isActive: true }).select('+loginPasswordHash')
    : null;

  if (!branch || !branch.loginEnabled || !branch.loginPasswordHash) {
    await bcrypt.compare(String(password || ''), DUMMY_HASH);
    await logAction(
      null,
      AUDIT_ACTIONS.AUTH_BRANCH_LOGIN_FAILED,
      'auth',
      branch ? branch._id : null,
      null,
      null,
      {
        req: meta.req,
        description: branch
          ? `Branch login attempted for ${branch.code}, but no password is configured`
          : 'Failed branch sign-in for an unknown branch',
      }
    );
    throw ApiError.unauthorized('Invalid branch or password.');
  }

  const matches = await branch.verifyLoginPassword(password);
  if (!matches) {
    await logAction(
      null,
      AUDIT_ACTIONS.AUTH_BRANCH_LOGIN_FAILED,
      'auth',
      branch._id,
      null,
      null,
      { req: meta.req, description: `Incorrect branch password for ${branch.code}` }
    );
    throw ApiError.unauthorized('Invalid branch or password.');
  }

  return branch;
}

/** Record a successful branch sign-in (after the session is established). */
async function recordBranchLogin(branch, req) {
  await branch.markLogin(req.ip);
  await logAction(
    branchActor(branch),
    AUDIT_ACTIONS.AUTH_BRANCH_LOGIN,
    'auth',
    branch._id,
    null,
    null,
    { req, description: `Branch ${branch.code} signed in` }
  );
}

/** Record a branch sign-out before the session is destroyed. */
async function recordBranchLogout(branchId, req) {
  if (!mongoose.isValidObjectId(branchId)) return;
  const branch = await Branch.findById(branchId).select('code name');
  if (!branch) return;

  await logAction(
    branchActor(branch),
    AUDIT_ACTIONS.AUTH_BRANCH_LOGOUT,
    'auth',
    branch._id,
    null,
    null,
    { req, description: `Branch ${branch.code} signed out` }
  );
}

/**
 * Set or reset a branch's shared login password.
 * @param {string} id
 * @param {string} password
 * @param {object} actor Signed-in owner
 * @param {import('express').Request} req
 */
async function setBranchPassword(id, password, actor, req) {
  const branch = await getBranchOrThrow(id);
  if (!branch.isActive) {
    throw ApiError.badRequest('Activate this branch before enabling branch login.');
  }

  const hadPassword = Boolean(branch.loginPasswordHash);
  const hadLoginEnabled = Boolean(branch.loginEnabled);
  await branch.setLoginPassword(password);
  await branch.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.BRANCH_LOGIN_PASSWORD_SET,
    'branches',
    branch._id,
    { hasPassword: hadPassword, loginEnabled: hadLoginEnabled },
    { hasPassword: true, loginEnabled: true },
    {
      req,
      description: `${hadPassword ? 'Reset' : 'Set'} branch login password for ${branch.code}`,
    }
  );

  return branch;
}

/** Disable branch login and remove the shared password. */
async function clearBranchPassword(id, actor, req) {
  const branch = await getBranchOrThrow(id);
  const hadPassword = Boolean(branch.loginPasswordHash);
  const hadLoginEnabled = Boolean(branch.loginEnabled);

  branch.clearLoginPassword();
  await branch.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.BRANCH_LOGIN_PASSWORD_CLEARED,
    'branches',
    branch._id,
    { hasPassword: hadPassword, loginEnabled: hadLoginEnabled },
    { hasPassword: false, loginEnabled: false },
    { req, description: `Disabled branch login for ${branch.code}` }
  );

  return branch;
}

module.exports = {
  buildBranchPrincipal,
  listLoginBranches,
  listAdminBranches,
  getBranchOrThrow,
  authenticateBranch,
  recordBranchLogin,
  recordBranchLogout,
  setBranchPassword,
  clearBranchPassword,
};
