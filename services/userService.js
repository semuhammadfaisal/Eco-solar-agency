/**
 * User management service (owner-only feature).
 *
 * All business rules live here so both controllers and future API endpoints
 * behave identically:
 *   - unique email among live users
 *   - the last active owner can never be demoted, deactivated or deleted
 *   - nobody can deactivate or delete their own account
 *   - every change writes an audit entry with before/after snapshots
 */
'use strict';

const mongoose = require('mongoose');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { logAction } = require('./auditService');
const { AUDIT_ACTIONS } = require('../config/auditActions');
const { ROLES, ALL_ROLES } = require('../config/roles');
const { escapeRegex, createPagination } = require('../utils/pagination');

const MAX_SEARCH_LENGTH = 80;

/** Normalise a free-text search term. */
function cleanSearch(value) {
  return String(value || '').trim().slice(0, MAX_SEARCH_LENGTH);
}

/**
 * Build a safe Mongoose filter from list query params.
 * Regex input is escaped to prevent ReDoS / pattern injection.
 */
function buildUserFilter({ search, role, status } = {}) {
  const filter = {};

  if (role && ALL_ROLES.includes(role)) filter.role = role;
  if (status === 'active') filter.isActive = true;
  if (status === 'inactive') filter.isActive = false;

  const term = cleanSearch(search);
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
  }

  return filter;
}

/**
 * Paginated user list for the management screen.
 *
 * @param {{search?: string, role?: string, status?: string, page?: string|number, limit?: string|number}} params
 * @returns {Promise<{items: object[], total: number, pagination: object}>}
 */
async function paginateUsers({ search, role, status, page, limit }) {
  const filter = buildUserFilter({ search, role, status });

  const total = await User.countDocuments(filter);
  const pagination = createPagination(page, limit, total);

  const items = await User.find(filter)
    .sort({ createdAt: -1 })
    .skip(pagination.skip)
    .limit(pagination.limit)
    .lean();

  return { items, total, pagination };
}

/** Load a live user by id or throw a 404. */
async function getUserOrThrow(id) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('User not found.');
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found.');
  return user;
}

/** Throw 409 if the email is already used by another live account. */
async function assertEmailAvailable(email, excludeId = null) {
  const filter = { email: String(email).trim().toLowerCase() };
  if (excludeId) filter._id = mongoose.trusted({ $ne: excludeId });

  const existing = await User.findOne(filter).select('_id');
  if (existing) {
    throw ApiError.conflict('Another user already uses this email address.');
  }
}

/** Throw if removing this user would leave the company without an owner. */
async function assertAnotherActiveOwner(excludeId) {
  const remaining = await User.countActiveOwners(excludeId);
  if (remaining === 0) {
    throw ApiError.badRequest(
      'At least one active owner must remain. Assign the owner role to another user first.'
    );
  }
}

/** Validate and normalise common input fields. */
function normalizeInput(input = {}) {
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const phone = String(input.phone || '').trim();
  const role = String(input.role || '').trim();

  return { name, email, phone, role };
}

/**
 * Create a staff account.
 * @param {object} input {name,email,phone,role,isActive,password}
 * @param {object} actor Signed-in owner
 * @param {import('express').Request} req
 */
async function createUser(input, actor, req) {
  const { name, email, phone, role } = normalizeInput(input);

  if (!ALL_ROLES.includes(role)) throw ApiError.badRequest('Select a valid role.');
  await assertEmailAvailable(email);

  const user = new User({
    name,
    email,
    phone,
    role,
    isActive: input.isActive !== false,
    createdBy: actor ? actor._id : null,
    branch: mongoose.isValidObjectId(input.branch) ? input.branch : null,
  });

  await user.setPassword(input.password);
  await user.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.USER_CREATED,
    'users',
    user._id,
    null,
    user.toSafeObject(),
    { req, description: `Created ${user.name} with role ${user.role}` }
  );

  return user;
}

/**
 * Update a staff account. Only the provided fields are touched.
 * @param {string} id
 * @param {object} input {name,email,phone,role,isActive,password}
 * @param {object} actor Signed-in owner
 * @param {import('express').Request} req
 */
async function updateUser(id, input, actor, req) {
  const user = await getUserOrThrow(id);
  const before = user.toSafeObject();

  const { name, email, phone, role } = normalizeInput({
    name: input.name !== undefined ? input.name : user.name,
    email: input.email !== undefined ? input.email : user.email,
    phone: input.phone !== undefined ? input.phone : user.phone,
    role: input.role !== undefined ? input.role : user.role,
  });

  if (!ALL_ROLES.includes(role)) throw ApiError.badRequest('Select a valid role.');

  const nextIsActive =
    input.isActive === undefined ? user.isActive : Boolean(input.isActive);
  const isSelf = Boolean(actor && String(actor._id) === String(user._id));

  if (isSelf && !nextIsActive) {
    throw ApiError.badRequest('You cannot deactivate your own account.');
  }

  const losingOwner =
    user.role === ROLES.OWNER &&
    user.isActive &&
    (role !== ROLES.OWNER || !nextIsActive);

  if (losingOwner) await assertAnotherActiveOwner(user._id);

  if (email !== user.email) {
    await assertEmailAvailable(email, user._id);
    user.email = email;
  }

  user.name = name;
  user.phone = phone;
  user.role = role;
  user.isActive = nextIsActive;
  user.branch = mongoose.isValidObjectId(input.branch) ? input.branch : null;

  if (input.password) {
    await user.setPassword(input.password);
  }

  await user.save();

  const after = user.toSafeObject();

  await logAction(actor, AUDIT_ACTIONS.USER_UPDATED, 'users', user._id, before, after, {
    req,
    description: `Updated ${user.name}`,
  });

  if (before.role !== after.role) {
    await logAction(
      actor,
      AUDIT_ACTIONS.USER_ROLE_CHANGED,
      'users',
      user._id,
      { role: before.role },
      { role: after.role },
      { req, description: `Changed role of ${user.name} from ${before.role} to ${after.role}` }
    );
  }

  return user;
}

/** Update the signed-in user's own contact details without permitting role changes. */
async function updateOwnProfile(userId, input, req) {
  const user = await getUserOrThrow(userId);
  const before = user.toSafeObject();
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const phone = String(input.phone || '').trim();

  if (email !== user.email) {
    await assertEmailAvailable(email, user._id);
    user.email = email;
  }

  user.name = name;
  user.phone = phone;
  await user.save();

  const after = user.toSafeObject();
  await logAction(
    user,
    AUDIT_ACTIONS.USER_PROFILE_UPDATED,
    'users',
    user._id,
    { name: before.name, email: before.email, phone: before.phone },
    { name: after.name, email: after.email, phone: after.phone },
    { req, description: 'Updated own profile details' }
  );

  return user;
}

/**
 * Owner-initiated password reset for any staff account.
 *
 * Existing sessions are invalidated automatically by middleware/loadUser:
 * passwordChangedAt is newer than the session's sign-in time, so the next
 * request from that user is signed out.
 *
 * @param {string} id
 * @param {string} newPassword
 * @param {object} actor Signed-in owner
 * @param {import('express').Request} req
 */
async function resetPassword(id, newPassword, actor, req) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound('User not found.');

  const user = await User.findById(id).select('+passwordHash');
  if (!user) throw ApiError.notFound('User not found.');

  const sameAsOld = user.passwordHash
    ? await user.verifyPassword(newPassword)
    : false;
  if (sameAsOld) {
    throw ApiError.badRequest(
      'The new password must be different from the current password.'
    );
  }

  await user.setPassword(newPassword);
  await user.save();

  await logAction(
    actor,
    AUDIT_ACTIONS.USER_PASSWORD_RESET,
    'users',
    user._id,
    null,
    { passwordChangedAt: user.passwordChangedAt },
    {
      req,
      description: `Reset password for ${user.name} (${user.email})`,
    }
  );

  return user;
}

/**
 * Activate / deactivate an account.
 * @param {string} id
 * @param {boolean} isActive
 * @param {object} actor
 * @param {import('express').Request} req
 */
async function setActive(id, isActive, actor, req) {
  const user = await getUserOrThrow(id);

  if (actor && String(actor._id) === String(user._id) && !isActive) {
    throw ApiError.badRequest('You cannot deactivate your own account.');
  }

  if (!isActive && user.role === ROLES.OWNER && user.isActive) {
    await assertAnotherActiveOwner(user._id);
  }

  const before = { isActive: user.isActive };
  user.isActive = Boolean(isActive);
  await user.save();

  await logAction(
    actor,
    user.isActive ? AUDIT_ACTIONS.USER_ACTIVATED : AUDIT_ACTIONS.USER_DEACTIVATED,
    'users',
    user._id,
    before,
    { isActive: user.isActive },
    {
      req,
      description: `${user.isActive ? 'Activated' : 'Deactivated'} ${user.name}`,
    }
  );

  return user;
}

/**
 * Soft-delete a staff account. The row is retained for audit history.
 * @param {string} id
 * @param {object} actor
 * @param {import('express').Request} req
 */
async function softDeleteUser(id, actor, req) {
  const user = await getUserOrThrow(id);

  if (actor && String(actor._id) === String(user._id)) {
    throw ApiError.badRequest('You cannot delete your own account.');
  }

  if (user.role === ROLES.OWNER && user.isActive) {
    await assertAnotherActiveOwner(user._id);
  }

  const before = user.toSafeObject();
  await user.softDelete(actor ? actor._id : null);

  await logAction(
    actor,
    AUDIT_ACTIONS.USER_DELETED,
    'users',
    user._id,
    before,
    { deletedAt: user.deletedAt },
    { req, description: `Deleted ${user.name} (${user.email})` }
  );

  return user;
}

module.exports = {
  buildUserFilter,
  paginateUsers,
  getUserOrThrow,
  createUser,
  updateUser,
  updateOwnProfile,
  resetPassword,
  setActive,
  softDeleteUser,
};
