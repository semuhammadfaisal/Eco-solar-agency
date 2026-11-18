/** Role helpers shared by middleware and views. */
'use strict';

/**
 * @param {{role?: string}|null|undefined} user
 * @param {string|string[]} roles
 * @returns {boolean}
 */
function hasRole(user, roles) {
  if (!user || !user.role) return false;
  const allowed = Array.isArray(roles) ? roles : [roles];
  return allowed.includes(user.role);
}

module.exports = { hasRole };
