'use strict';

const QUOTATION_STATUSES = Object.freeze(['draft', 'sent', 'approved', 'rejected', 'expired']);

const QUOTATION_STATUS_LABELS = Object.freeze({
  draft: 'Draft',
  sent: 'Sent',
  approved: 'Approved',
  rejected: 'Rejected',
  expired: 'Expired',
});

const QUOTATION_STATUS_BADGES = Object.freeze({
  draft: 'secondary',
  sent: 'info',
  approved: 'success',
  rejected: 'danger',
  expired: 'warning',
});

const PAYMENT_OPTIONS = Object.freeze(['cash', 'installment']);

const PAYMENT_OPTION_LABELS = Object.freeze({
  cash: '100% Cash / Advance',
  installment: 'Milestone / Installment Plan',
});

const DEFAULT_MILESTONES = Object.freeze([
  { label: 'Advance on Booking & Contract Signing', percent: 50 },
  { label: 'Upon Delivery of Equipment at Project Site', percent: 40 },
  { label: 'Upon Testing, Commissioning & Net-Metering', percent: 10 },
]);

const SALE_STATUSES = Object.freeze(['confirmed', 'in_progress', 'completed', 'cancelled']);

const SALE_STATUS_LABELS = Object.freeze({
  confirmed: 'Confirmed',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
});

const SALE_STATUS_BADGES = Object.freeze({
  confirmed: 'primary',
  in_progress: 'warning',
  completed: 'success',
  cancelled: 'danger',
});

module.exports = {
  QUOTATION_STATUSES,
  QUOTATION_STATUS_LABELS,
  QUOTATION_STATUS_BADGES,
  PAYMENT_OPTIONS,
  PAYMENT_OPTION_LABELS,
  DEFAULT_MILESTONES,
  SALE_STATUSES,
  SALE_STATUS_LABELS,
  SALE_STATUS_BADGES,
};
