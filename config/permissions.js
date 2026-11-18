/**
 * Permission map.
 *
 * Route access is enforced with requireRole()/requirePermission(), and
 * field-level visibility (purchase price, profit) is enforced by
 * utils/sanitize.js using these same permissions. Never rely on hiding
 * a column in an EJS template alone.
 */
'use strict';

const { ROLES, ALL_ROLES } = require('./roles');

const PERMISSIONS = Object.freeze({
  // Administration
  'users.manage': [ROLES.OWNER],
  'settings.manage': [ROLES.OWNER, ROLES.MANAGER],
  'audit.view': [ROLES.OWNER],

  // CRM
  'customers.view': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.SURVEYOR,
    ROLES.TECHNICIAN,
    ROLES.ACCOUNTANT,
  ],
  'customers.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES],

  // Site surveys. Surveyor ownership is additionally enforced in the service.
  'surveys.view': [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.SURVEYOR],
  'surveys.schedule': [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES],
  'surveys.perform': [ROLES.OWNER, ROLES.MANAGER, ROLES.SURVEYOR],

  // People
  'employees.view': [ROLES.OWNER, ROLES.MANAGER],
  'employees.manage': [ROLES.OWNER],
  'attendance.view': [ROLES.OWNER, ROLES.MANAGER],
  'attendance.manage': [ROLES.OWNER, ROLES.MANAGER],

  // Business partners (equity, profit share and partner cash records)
  'partners.view': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
  'partners.manage': [ROLES.OWNER],
  'partners.transactions': [ROLES.OWNER, ROLES.ACCOUNTANT],

  // Inventory & purchasing
  'inventory.view': ALL_ROLES,
  'inventory.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.STOREKEEPER],
  'purchases.view': [ROLES.OWNER, ROLES.ACCOUNTANT, ROLES.STOREKEEPER],
  'purchases.manage': [ROLES.OWNER, ROLES.STOREKEEPER],
  'purchases.payment': [ROLES.OWNER, ROLES.ACCOUNTANT],
  'valuation.view': [ROLES.OWNER, ROLES.ACCOUNTANT, ROLES.STOREKEEPER],
  'branches.view': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT, ROLES.STOREKEEPER, ROLES.SHOPKEEPER],
  'branches.manage': [ROLES.OWNER],
  'brands.manage': [ROLES.OWNER, ROLES.MANAGER],
  'transfers.view': [ROLES.OWNER, ROLES.MANAGER, ROLES.STOREKEEPER, ROLES.SHOPKEEPER],
  'transfers.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.STOREKEEPER],
  'pos.view': [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT, ROLES.SHOPKEEPER],
  'pos.sell': [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.SHOPKEEPER],
  'pos.cancel': [ROLES.OWNER, ROLES.MANAGER],

  // Packages & System Builder
  'packages.view': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.SURVEYOR,
    ROLES.TECHNICIAN,
    ROLES.ACCOUNTANT,
  ],
  'packages.manage': [ROLES.OWNER, ROLES.MANAGER],
  'systems.view': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.SURVEYOR,
    ROLES.TECHNICIAN,
    ROLES.ACCOUNTANT,
  ],
  'systems.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES],
  'systems.approve': [ROLES.OWNER],

  // Quotations & Revisions
  'quotations.view': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.ACCOUNTANT,
  ],
  'quotations.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES],
  'quotations.approve': [ROLES.OWNER, ROLES.MANAGER],

  // Sales / Confirmed Projects
  'sales.view': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.ACCOUNTANT,
  ],
  'sales.manage': [ROLES.OWNER, ROLES.MANAGER],
  // Project creation and stage updates are a salesperson function; material
  // issue stays behind the stricter sales.manage permission.
  'projects.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES],

  // Installments, Collections & Security
  'installments.view': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.ACCOUNTANT,
  ],
  'installments.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
  'installments.collect': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.ACCOUNTANT,
  ],
  'installments.reschedule': [ROLES.OWNER, ROLES.MANAGER],
  'installments.waive': [ROLES.OWNER, ROLES.MANAGER],
  'installments.security_override': [ROLES.OWNER],

  // Recovery & Reminders
  'recovery.view': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.ACCOUNTANT,
  ],
  'recovery.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],

  // Step 9: Installation, Material Issue, Warranty & After-Sales
  'installations.view': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.TECHNICIAN,
    ROLES.ACCOUNTANT,
    ROLES.STOREKEEPER,
  ],
  'installations.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.TECHNICIAN],
  'installations.commission': [ROLES.OWNER, ROLES.MANAGER],
  'material.issue': [ROLES.OWNER, ROLES.MANAGER, ROLES.STOREKEEPER],
  'warranty.view': ALL_ROLES,
  'warranty.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
  'complaints.view': [
    ROLES.OWNER,
    ROLES.MANAGER,
    ROLES.SALES,
    ROLES.TECHNICIAN,
    ROLES.ACCOUNTANT,
  ],
  'complaints.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.TECHNICIAN],
  'technician.jobs': [ROLES.OWNER, ROLES.MANAGER, ROLES.TECHNICIAN],

  // Financial visibility (enforced server-side, not just in views)
  'costs.view': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
  'profit.view': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],

  // Step 10: Accounting, Double-Entry Ledger & Financial Reports
  'accounting.view': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
  'accounting.manage': [ROLES.OWNER, ROLES.ACCOUNTANT],
  'reports.financial': [ROLES.OWNER, ROLES.ACCOUNTANT],

  // Daily closing & cash drawer. Shopkeepers (and shared branch logins) may
  // close their own branch drawer, but only owners/accountants may reopen a
  // closed drawer.
  'closing.view': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT, ROLES.SHOPKEEPER],
  'closing.manage': [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT, ROLES.SHOPKEEPER],
  'closing.reopen': [ROLES.OWNER, ROLES.ACCOUNTANT],

  /**
   * Purchase prices are deliberately narrower than costs.view: only the
   * owner, accountant and storekeeper may ever receive these fields.
   */
  'purchase_prices.view': [ROLES.OWNER, ROLES.ACCOUNTANT, ROLES.STOREKEEPER],
});

/**
 * @param {string|{role?: string}|null|undefined} subject A user document, a role string, or null.
 * @param {string} permission A key of PERMISSIONS.
 * @returns {boolean}
 */
function can(subject, permission) {
  const role = typeof subject === 'string' ? subject : subject && subject.role;
  if (!role) return false;
  const allowed = PERMISSIONS[permission];
  return Array.isArray(allowed) && allowed.includes(role);
}

/** All permission keys granted to a role (handy for debugging / future APIs). */
function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((permission) => can(role, permission));
}

module.exports = { PERMISSIONS, can, permissionsFor };
