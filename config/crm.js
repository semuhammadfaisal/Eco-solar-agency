/**
 * CRM vocabulary: customer types, acquisition sources, DISCOs, employee
 * statuses and attendance statuses.
 *
 * Keeping these lists here means models, validators, views and services all
 * agree on the same values. Views read the labels through `crm` in res.locals.
 */
'use strict';

const CUSTOMER_TYPES = Object.freeze(['residential', 'commercial', 'industrial']);

const CUSTOMER_TYPE_LABELS = Object.freeze({
  residential: 'Residential',
  commercial: 'Commercial',
  industrial: 'Industrial',
});

const CUSTOMER_TYPE_BADGES = Object.freeze({
  residential: 'success',
  commercial: 'primary',
  industrial: 'warning',
});

const CUSTOMER_SOURCES = Object.freeze([
  'facebook',
  'instagram',
  'google',
  'referral',
  'walk_in',
  'phone',
  'whatsapp',
  'other',
]);

const CUSTOMER_SOURCE_LABELS = Object.freeze({
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google',
  referral: 'Referral',
  walk_in: 'Walk-in',
  phone: 'Phone call',
  whatsapp: 'WhatsApp',
  other: 'Other',
});

const DISCO_COMPANIES = Object.freeze([
  'LESCO',
  'K-Electric',
  'IESCO',
  'GEPCO',
  'FESCO',
  'MEPCO',
  'PESCO',
  'HESCO',
  'SEPCO',
  'QESCO',
  'TESCO',
  'Other',
]);

const EMPLOYEE_STATUSES = Object.freeze(['active', 'on_leave', 'inactive', 'terminated']);

const EMPLOYEE_STATUS_LABELS = Object.freeze({
  active: 'Active',
  on_leave: 'On leave',
  inactive: 'Inactive',
  terminated: 'Terminated',
});

const EMPLOYEE_STATUS_BADGES = Object.freeze({
  active: 'success',
  on_leave: 'warning',
  inactive: 'secondary',
  terminated: 'danger',
});

const ATTENDANCE_STATUSES = Object.freeze(['present', 'absent', 'leave', 'half_day', 'late']);

const ATTENDANCE_STATUS_LABELS = Object.freeze({
  present: 'Present',
  absent: 'Absent',
  leave: 'Leave',
  half_day: 'Half day',
  late: 'Late',
});

const ATTENDANCE_STATUS_BADGES = Object.freeze({
  present: 'success',
  absent: 'danger',
  leave: 'info',
  half_day: 'warning',
  late: 'primary',
});

/** Statuses that still count as part of the active workforce. */
const WORKFORCE_STATUSES = Object.freeze(['active', 'on_leave']);

module.exports = {
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  CUSTOMER_TYPE_BADGES,
  CUSTOMER_SOURCES,
  CUSTOMER_SOURCE_LABELS,
  DISCO_COMPANIES,
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_STATUS_BADGES,
  ATTENDANCE_STATUSES,
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_BADGES,
  WORKFORCE_STATUSES,
};
