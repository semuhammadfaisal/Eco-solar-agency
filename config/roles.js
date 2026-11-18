/**
 * Role definitions shared by models, middleware, navigation and views.
 * Keep this list as the single source of truth for role names.
 */
'use strict';

const ROLES = Object.freeze({
  OWNER: 'owner',
  MANAGER: 'manager',
  SALES: 'sales',
  SURVEYOR: 'surveyor',
  TECHNICIAN: 'technician',
  ACCOUNTANT: 'accountant',
  STOREKEEPER: 'storekeeper',
  SHOPKEEPER: 'shopkeeper',
});

const ALL_ROLES = Object.freeze(Object.values(ROLES));

const ROLE_LABELS = Object.freeze({
  [ROLES.OWNER]: 'Owner',
  [ROLES.MANAGER]: 'Manager',
  [ROLES.SALES]: 'Sales',
  [ROLES.SURVEYOR]: 'Surveyor',
  [ROLES.TECHNICIAN]: 'Technician',
  [ROLES.ACCOUNTANT]: 'Accountant',
  [ROLES.STOREKEEPER]: 'Storekeeper',
  [ROLES.SHOPKEEPER]: 'Shopkeeper / Cashier',
});

const ROLE_DESCRIPTIONS = Object.freeze({
  [ROLES.OWNER]: 'Full access, including user management and company settings.',
  [ROLES.MANAGER]: 'Operations oversight: can manage settings and view costs and profit.',
  [ROLES.SALES]: 'Customers, quotations and sales. Cannot see purchase price or profit.',
  [ROLES.SURVEYOR]: 'Site surveys and technical worksheets. No financial data.',
  [ROLES.TECHNICIAN]: 'Installation and service jobs. No financial data.',
  [ROLES.ACCOUNTANT]: 'Invoices, payments, expenses and purchase costs. Cannot see profit.',
  [ROLES.STOREKEEPER]: 'Inventory, stock movements and purchase receipts, including purchase prices.',
  [ROLES.SHOPKEEPER]: 'Fast POS and stock visibility for the assigned branch only.',
});

/** Bootstrap colour used for role badges in the UI. */
const ROLE_BADGES = Object.freeze({
  [ROLES.OWNER]: 'danger',
  [ROLES.MANAGER]: 'primary',
  [ROLES.SALES]: 'success',
  [ROLES.SURVEYOR]: 'info',
  [ROLES.TECHNICIAN]: 'warning',
  [ROLES.ACCOUNTANT]: 'secondary',
  [ROLES.STOREKEEPER]: 'dark',
  [ROLES.SHOPKEEPER]: 'info',
});

/** Roles that must always have at least one active owner. */
const PROTECTED_ROLES = Object.freeze([ROLES.OWNER]);

module.exports = {
  ROLES,
  ALL_ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  ROLE_BADGES,
  PROTECTED_ROLES,
};
