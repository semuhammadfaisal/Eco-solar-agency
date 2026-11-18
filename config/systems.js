'use strict';

const SYSTEM_TYPES = Object.freeze(['on_grid', 'hybrid', 'off_grid']);

const SYSTEM_TYPE_LABELS = Object.freeze({
  on_grid: 'On-grid',
  hybrid: 'Hybrid',
  off_grid: 'Off-grid',
});

const SYSTEM_TYPE_BADGES = Object.freeze({
  on_grid: 'primary',
  hybrid: 'success',
  off_grid: 'warning',
});

const APPROVAL_STATUSES = Object.freeze(['none', 'pending', 'approved', 'rejected']);

const APPROVAL_STATUS_LABELS = Object.freeze({
  none: 'Not required',
  pending: 'Pending owner approval',
  approved: 'Approved',
  rejected: 'Rejected',
});

const APPROVAL_STATUS_BADGES = Object.freeze({
  none: 'secondary',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
});

const DISCOUNT_TYPES = Object.freeze(['percent', 'amount']);

module.exports = {
  SYSTEM_TYPES,
  SYSTEM_TYPE_LABELS,
  SYSTEM_TYPE_BADGES,
  APPROVAL_STATUSES,
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUS_BADGES,
  DISCOUNT_TYPES,
};
