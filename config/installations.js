'use strict';

/**
 * Vocabulary & configuration for Installations, Warranties, Complaints, and Maintenance.
 */

const INSTALLATION_STATUSES = Object.freeze([
  'approved',
  'material_issued',
  'scheduled',
  'in_progress',
  'completed',
  'net_metering_pending',
  'commissioned',
]);

const INSTALLATION_STATUS_LABELS = Object.freeze({
  approved: 'Approved / Pending Material',
  material_issued: 'Material Issued',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Installation Completed',
  net_metering_pending: 'Net-Metering Inspection Pending',
  commissioned: 'Fully Commissioned',
});

const INSTALLATION_STATUS_BADGES = Object.freeze({
  approved: 'secondary',
  material_issued: 'info',
  scheduled: 'primary',
  in_progress: 'warning',
  completed: 'success',
  net_metering_pending: 'warning',
  commissioned: 'success',
});

const INSTALLATION_CHECKLIST = Object.freeze([
  { key: 'structureTorqued', label: 'Mounting structure anchored & torqued to spec' },
  { key: 'panelClampsFastened', label: 'Mid & end clamps securely fastened' },
  { key: 'structureEarthingConnected', label: 'Frame grounding & copper bond complete' },
  { key: 'stringPolarityChecked', label: 'DC string Voc & polarity verified with multimeter' },
  { key: 'dcIsolatorInstalled', label: 'DC disconnect switch / isolator wired' },
  { key: 'dcSurgeProtection', label: 'DC surge protective device (SPD) connected' },
  { key: 'acBreakerSized', label: 'AC main breaker & distribution board connected' },
  { key: 'earthingPitResistanceTested', label: 'Earth resistance test passed (< 5 Ohms)' },
  { key: 'inverterFirmwareUpdated', label: 'Inverter firmware updated & Wi-Fi dongle paired' },
  { key: 'gridAntiIslandingVerified', label: 'Anti-islanding & grid safety test passed' },
]);

const WARRANTY_TYPES = Object.freeze([
  'panel_product',
  'panel_performance',
  'inverter',
  'battery',
  'workmanship',
  'other',
]);

const WARRANTY_TYPE_LABELS = Object.freeze({
  panel_product: 'Solar Panel Product Warranty',
  panel_performance: 'Solar Panel 25-Year Performance Warranty',
  inverter: 'Inverter Standard Warranty',
  battery: 'Battery Storage Warranty',
  workmanship: 'Installation Workmanship Warranty',
  other: 'General Equipment Warranty',
});

const WARRANTY_TYPE_BADGES = Object.freeze({
  panel_product: 'warning',
  panel_performance: 'success',
  inverter: 'primary',
  battery: 'info',
  workmanship: 'dark',
  other: 'secondary',
});

const DEFAULT_WARRANTY_DURATIONS_YEARS = Object.freeze({
  panel_product: 12,
  panel_performance: 25,
  inverter: 5,
  battery: 5,
  workmanship: 2,
  other: 1,
});

const WARRANTY_STATUSES = Object.freeze(['active', 'expiring', 'expired', 'claimed']);

const WARRANTY_STATUS_LABELS = Object.freeze({
  active: 'Active / Valid',
  expiring: 'Expiring Soon (30d)',
  expired: 'Expired',
  claimed: 'Claimed / Replaced',
});

const WARRANTY_STATUS_BADGES = Object.freeze({
  active: 'success',
  expiring: 'warning',
  expired: 'danger',
  claimed: 'info',
});

const COMPLAINT_TYPES = Object.freeze([
  'inverter_fault',
  'generation_drop',
  'physical_damage',
  'net_metering_issue',
  'wiring_earthing',
  'battery_issue',
  'other',
]);

const COMPLAINT_TYPE_LABELS = Object.freeze({
  inverter_fault: 'Inverter Fault / Error Code',
  generation_drop: 'Low Generation / Yield Drop',
  physical_damage: 'Physical Damage / Hail / Storm',
  net_metering_issue: 'DISCO Green Meter / Net-Metering',
  wiring_earthing: 'AC/DC Wiring or Earthing Alarm',
  battery_issue: 'Battery Backup / BMS Failure',
  other: 'General Inquiry / Maintenance',
});

const COMPLAINT_PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent']);

const COMPLAINT_PRIORITY_LABELS = Object.freeze({
  low: 'Low (Within 7 Days)',
  medium: 'Medium (Within 72 Hours)',
  high: 'High (Within 48 Hours)',
  urgent: 'Urgent (Within 24 Hours)',
});

const COMPLAINT_PRIORITY_BADGES = Object.freeze({
  low: 'secondary',
  medium: 'info',
  high: 'warning',
  urgent: 'danger',
});

const COMPLAINT_SLA_HOURS = Object.freeze({
  urgent: 24,
  high: 48,
  medium: 72,
  low: 168,
});

const COMPLAINT_STATUSES = Object.freeze([
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
]);

const COMPLAINT_STATUS_LABELS = Object.freeze({
  open: 'Open / Unassigned',
  assigned: 'Technician Assigned',
  in_progress: 'Site Visit / In Progress',
  resolved: 'Resolved / Work Done',
  closed: 'Closed & Verified',
});

const COMPLAINT_STATUS_BADGES = Object.freeze({
  open: 'danger',
  assigned: 'primary',
  in_progress: 'warning',
  resolved: 'info',
  closed: 'success',
});

const MAINTENANCE_TYPES = Object.freeze([
  'panel_cleaning',
  'inverter_inspection',
  'quarterly_preventive',
  'annual_health_check',
]);

const MAINTENANCE_TYPE_LABELS = Object.freeze({
  panel_cleaning: 'Solar Panel Dust & Cleaning Service',
  inverter_inspection: 'Inverter Performance & Thermal Inspection',
  quarterly_preventive: 'Quarterly Preventive Maintenance',
  annual_health_check: 'Annual Complete System Health Audit',
});

const MAINTENANCE_FREQUENCIES = Object.freeze([
  'monthly',
  'quarterly',
  'bi_annual',
  'annual',
  'one_time',
]);

const MAINTENANCE_FREQUENCY_LABELS = Object.freeze({
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  bi_annual: 'Bi-Annual (Every 6 Months)',
  annual: 'Annual',
  one_time: 'One-Time On Demand',
});

module.exports = {
  INSTALLATION_STATUSES,
  INSTALLATION_STATUS_LABELS,
  INSTALLATION_STATUS_BADGES,
  INSTALLATION_CHECKLIST,
  WARRANTY_TYPES,
  WARRANTY_TYPE_LABELS,
  WARRANTY_TYPE_BADGES,
  DEFAULT_WARRANTY_DURATIONS_YEARS,
  WARRANTY_STATUSES,
  WARRANTY_STATUS_LABELS,
  WARRANTY_STATUS_BADGES,
  COMPLAINT_TYPES,
  COMPLAINT_TYPE_LABELS,
  COMPLAINT_PRIORITIES,
  COMPLAINT_PRIORITY_LABELS,
  COMPLAINT_PRIORITY_BADGES,
  COMPLAINT_SLA_HOURS,
  COMPLAINT_STATUSES,
  COMPLAINT_STATUS_LABELS,
  COMPLAINT_STATUS_BADGES,
  MAINTENANCE_TYPES,
  MAINTENANCE_TYPE_LABELS,
  MAINTENANCE_FREQUENCIES,
  MAINTENANCE_FREQUENCY_LABELS,
};
