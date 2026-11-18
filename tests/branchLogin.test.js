'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const Branch = require('../models/Branch');
const {
  buildBranchPrincipal,
  listLoginBranches,
  listAdminBranches,
} = require('../services/branchLoginService');
const { isBranchAllowedPath } = require('../middleware/branchSessionGuard');
const navigation = require('../config/navigation');
const {
  resetPasswordRules,
  branchPasswordRules,
} = require('../validators/userValidators');

test('branch password is hashed, verifiable and can be cleared', async () => {
  const branch = new Branch({ code: 'BR-9', name: 'Test Branch' });

  assert.equal(branch.loginEnabled, false);
  assert.equal(branch.loginPasswordHash, null);

  await branch.setLoginPassword('Secret123');
  assert.equal(branch.loginEnabled, true);
  assert.match(branch.loginPasswordHash, /^\$2[aby]\$/);
  assert.notEqual(branch.loginPasswordHash, 'Secret123');
  assert.ok(branch.loginPasswordChangedAt instanceof Date);

  assert.equal(await branch.verifyLoginPassword('Secret123'), true);
  assert.equal(await branch.verifyLoginPassword('secret123'), false);

  branch.clearLoginPassword();
  assert.equal(branch.loginPasswordHash, null);
  assert.equal(branch.loginEnabled, false);
  assert.equal(await branch.verifyLoginPassword('Secret123'), false);
});

test('branch password hash is never serialised', async () => {
  const branch = new Branch({ code: 'BR-8', name: 'Hidden Hash' });
  await branch.setLoginPassword('Secret123');

  const json = branch.toJSON();
  assert.equal(json.loginPasswordHash, undefined);
  assert.equal(branch.toObject().loginPasswordHash, undefined);
});

test('branch principal is a shopkeeper-scoped, user-less identity', () => {
  const principal = buildBranchPrincipal({
    _id: 'branch-1',
    code: 'BR-001',
    name: 'Gulberg Branch',
  });

  assert.equal(principal._id, null);
  assert.equal(principal.role, 'shopkeeper');
  assert.equal(principal.isBranchLogin, true);
  assert.equal(String(principal.branch), 'branch-1');
  assert.equal(principal.branchCode, 'BR-001');
  assert.equal(principal.branchName, 'Gulberg Branch');
  assert.equal(principal.initials, 'GB');
  assert.equal(principal.email, '');
  assert.equal(principal.isActive, true);
});

test('branch login service exposes login/admin listing helpers', () => {
  assert.equal(typeof listLoginBranches, 'function');
  assert.equal(typeof listAdminBranches, 'function');
});

test('branch session allow-list blocks company-wide modules', () => {
  // Allowed workspace.
  assert.equal(isBranchAllowedPath('/dashboard', 'GET'), true);
  assert.equal(isBranchAllowedPath('/pos', 'GET'), true);
  assert.equal(isBranchAllowedPath('/pos/new', 'GET'), true);
  assert.equal(isBranchAllowedPath('/pos', 'POST'), true);
  assert.equal(isBranchAllowedPath('/branches', 'GET'), true);
  assert.equal(isBranchAllowedPath('/branches/abc/stock', 'GET'), true);
  assert.equal(isBranchAllowedPath('/brands', 'GET'), true);
  assert.equal(isBranchAllowedPath('/transfers', 'GET'), true);
  assert.equal(isBranchAllowedPath('/transfers/abc', 'GET'), true);
  assert.equal(isBranchAllowedPath('/accounting/daily-closing', 'GET'), true);
  assert.equal(isBranchAllowedPath('/accounting/daily-closing/close', 'POST'), true);
  assert.equal(isBranchAllowedPath('/logout', 'POST'), true);

  // Blocked company-wide modules.
  assert.equal(isBranchAllowedPath('/accounting/dashboard', 'GET'), false);
  assert.equal(isBranchAllowedPath('/accounting/daily-closing/reopen', 'POST'), false);
  assert.equal(isBranchAllowedPath('/accounting/daily-closing/close', 'GET'), false);
  assert.equal(isBranchAllowedPath('/customers', 'GET'), false);
  assert.equal(isBranchAllowedPath('/quotations', 'GET'), false);
  assert.equal(isBranchAllowedPath('/purchases', 'GET'), false);
  assert.equal(isBranchAllowedPath('/items', 'GET'), false);
  assert.equal(isBranchAllowedPath('/users', 'GET'), false);
  assert.equal(isBranchAllowedPath('/users/branch-logins', 'GET'), false);
  assert.equal(isBranchAllowedPath('/settings', 'GET'), false);
  assert.equal(isBranchAllowedPath('/partners', 'GET'), false);

  // Writes outside the workspace stay blocked.
  assert.equal(isBranchAllowedPath('/pos/abc/cancel', 'POST'), false);
  assert.equal(isBranchAllowedPath('/transfers', 'POST'), false);
  assert.equal(isBranchAllowedPath('/branches', 'POST'), false);
});

test('only the branch workspace navigation items are flagged for branch login', () => {
  const flagged = [];
  navigation.forEach((group) => {
    group.items.forEach((item) => {
      if (item.branchLogin) flagged.push(item.url);
    });
  });

  assert.deepEqual(flagged.sort(), [
    '/accounting/daily-closing',
    '/branches',
    '/brands',
    '/dashboard',
    '/pos',
    '/transfers',
  ]);
});

test('password reset and branch password validators are exported', () => {
  assert.ok(Array.isArray(resetPasswordRules));
  assert.ok(resetPasswordRules.length >= 2);
  assert.ok(Array.isArray(branchPasswordRules));
  assert.ok(branchPasswordRules.length >= 2);
});

test('branch login and user password views compile', () => {
  const views = [
    'views/auth/login.ejs',
    'views/users/index.ejs',
    'views/users/password.ejs',
    'views/users/branch-logins.ejs',
    'views/users/branch-password.ejs',
    'views/layouts/admin.ejs',
    'views/dashboard/index.ejs',
  ];

  views.forEach((view) => {
    const file = path.join(__dirname, '..', view);
    assert.doesNotThrow(
      () => ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file }),
      `${view} should compile`
    );
  });
});
