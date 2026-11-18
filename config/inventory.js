/**
 * Inventory vocabulary: item categories, units, serial statuses, stock
 * movement types, purchase/payment statuses and warranty defaults.
 *
 * These lists are shared by models, validators, services and views so the
 * stored values and the labels shown in the UI can never drift apart.
 */
'use strict';

const ITEM_CATEGORIES = Object.freeze([
  'panel',
  'inverter',
  'battery',
  'power_bank',
  'structure',
  'cable',
  'breaker',
  'earthing',
  'accessory',
  'other',
]);

const ITEM_CATEGORY_LABELS = Object.freeze({
  panel: 'Solar panel',
  inverter: 'Inverter',
  battery: 'Battery',
  power_bank: 'Power bank',
  structure: 'Mounting structure',
  cable: 'Cable',
  breaker: 'Breaker / protection',
  earthing: 'Earthing',
  accessory: 'Accessory',
  other: 'Other',
});

const ITEM_CATEGORY_BADGES = Object.freeze({
  panel: 'warning',
  inverter: 'primary',
  battery: 'success',
  power_bank: 'dark',
  structure: 'secondary',
  cable: 'info',
  breaker: 'danger',
  earthing: 'dark',
  accessory: 'light',
  other: 'light',
});

const ITEM_CATEGORY_ICONS = Object.freeze({
  panel: 'bi-sun',
  inverter: 'bi-lightning-charge',
  battery: 'bi-battery-full',
  power_bank: 'bi-battery-charging',
  structure: 'bi-diagram-3',
  cable: 'bi-plug',
  breaker: 'bi-shield-check',
  earthing: 'bi-arrow-down-circle',
  accessory: 'bi-tools',
  other: 'bi-box',
});

const ITEM_UNITS = Object.freeze(['pcs', 'set', 'meter', 'kg', 'roll', 'box', 'lot']);

const ITEM_UNIT_LABELS = Object.freeze({
  pcs: 'Pieces',
  set: 'Set',
  meter: 'Meter',
  kg: 'Kilogram',
  roll: 'Roll',
  box: 'Box',
  lot: 'Lot',
});

/** Serial lifecycle. `in_stock` and `defective` are considered on-hand. */
const SERIAL_STATUSES = Object.freeze([
  'in_stock',
  'issued',
  'installed',
  'returned',
  'defective',
]);

const SERIAL_STATUS_LABELS = Object.freeze({
  in_stock: 'In stock',
  issued: 'Issued',
  installed: 'Installed',
  returned: 'Returned',
  defective: 'Defective',
});

const SERIAL_STATUS_BADGES = Object.freeze({
  in_stock: 'success',
  issued: 'primary',
  installed: 'info',
  returned: 'warning',
  defective: 'danger',
});

/** Statuses that physically sit in the warehouse (they count towards stock). */
const SERIAL_ON_HAND_STATUSES = Object.freeze(['in_stock', 'defective']);

/**
 * Movement types are stored in upper case because they are ledger constants.
 * `qty` is signed: IN is positive, OUT/RETURN negative, ADJUSTMENT either.
 */
const STOCK_MOVEMENT_TYPES = Object.freeze(['IN', 'OUT', 'RETURN', 'ADJUSTMENT']);

const STOCK_MOVEMENT_LABELS = Object.freeze({
  IN: 'Stock in',
  OUT: 'Stock out',
  RETURN: 'Supplier return',
  ADJUSTMENT: 'Adjustment',
});

const STOCK_MOVEMENT_BADGES = Object.freeze({
  IN: 'success',
  OUT: 'danger',
  RETURN: 'warning',
  ADJUSTMENT: 'info',
});

const PURCHASE_STATUSES = Object.freeze(['ordered', 'partial', 'received', 'cancelled']);

const PURCHASE_STATUS_LABELS = Object.freeze({
  ordered: 'Ordered (PO)',
  partial: 'Partially received',
  received: 'Received (GRN)',
  cancelled: 'Cancelled',
});

const PURCHASE_STATUS_BADGES = Object.freeze({
  ordered: 'info',
  partial: 'warning',
  received: 'success',
  cancelled: 'danger',
});

const PAYMENT_STATUSES = Object.freeze(['unpaid', 'partial', 'paid']);

const PAYMENT_STATUS_LABELS = Object.freeze({
  unpaid: 'Unpaid',
  partial: 'Partially paid',
  paid: 'Paid',
});

const PAYMENT_STATUS_BADGES = Object.freeze({
  unpaid: 'danger',
  partial: 'warning',
  paid: 'success',
});

/** Default warranty terms offered on the item form (years). */
const DEFAULT_PRODUCT_WARRANTY_YEARS = 1;
const DEFAULT_PERFORMANCE_WARRANTY_YEARS = 25;

/** Maximum number of serial numbers accepted in a single GRN line. */
const MAX_SERIALS_PER_LINE = 500;

module.exports = {
  ITEM_CATEGORIES,
  ITEM_CATEGORY_LABELS,
  ITEM_CATEGORY_BADGES,
  ITEM_CATEGORY_ICONS,
  ITEM_UNITS,
  ITEM_UNIT_LABELS,
  SERIAL_STATUSES,
  SERIAL_STATUS_LABELS,
  SERIAL_STATUS_BADGES,
  SERIAL_ON_HAND_STATUSES,
  STOCK_MOVEMENT_TYPES,
  STOCK_MOVEMENT_LABELS,
  STOCK_MOVEMENT_BADGES,
  PURCHASE_STATUSES,
  PURCHASE_STATUS_LABELS,
  PURCHASE_STATUS_BADGES,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_BADGES,
  DEFAULT_PRODUCT_WARRANTY_YEARS,
  DEFAULT_PERFORMANCE_WARRANTY_YEARS,
  MAX_SERIALS_PER_LINE,
};
