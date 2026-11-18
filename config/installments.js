'use strict';

const INSTALLMENT_STATUSES = Object.freeze(['pending', 'partial', 'paid', 'overdue']);

const INSTALLMENT_STATUS_LABELS = Object.freeze({
  pending: 'Pending',
  partial: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
});

const INSTALLMENT_STATUS_BADGES = Object.freeze({
  pending: 'secondary',
  partial: 'warning',
  paid: 'success',
  overdue: 'danger',
});

const PLAN_STATUSES = Object.freeze(['active', 'completed', 'defaulted', 'rescheduled']);

const PLAN_STATUS_LABELS = Object.freeze({
  active: 'Active',
  completed: 'Completed',
  defaulted: 'Defaulted / Recovery',
  rescheduled: 'Rescheduled',
});

const PLAN_STATUS_BADGES = Object.freeze({
  active: 'primary',
  completed: 'success',
  defaulted: 'danger',
  rescheduled: 'warning',
});

const FREQUENCIES = Object.freeze(['monthly', 'bi_monthly', 'quarterly']);

const FREQUENCY_LABELS = Object.freeze({
  monthly: 'Monthly',
  bi_monthly: 'Bi-Monthly (Every 2 Months)',
  quarterly: 'Quarterly (Every 3 Months)',
});

const PAYMENT_METHODS = Object.freeze(['cash', 'bank', 'cheque', 'online']);

const PAYMENT_METHOD_LABELS = Object.freeze({
  cash: 'Cash In Hand',
  bank: 'Bank Deposit / Pay Order',
  cheque: 'Cheque',
  online: 'Online Banking / Raast',
});

const CHEQUE_STATUSES = Object.freeze(['held', 'deposited', 'cleared', 'bounced']);

const CHEQUE_STATUS_LABELS = Object.freeze({
  held: 'Held in Vault',
  deposited: 'Deposited in Bank',
  cleared: 'Cleared / Realized',
  bounced: 'Bounced / Dishonored',
});

const CHEQUE_STATUS_BADGES = Object.freeze({
  held: 'secondary',
  deposited: 'info',
  cleared: 'success',
  bounced: 'danger',
});

const SECURITY_CHECKLIST_ITEMS = Object.freeze({
  stampAgreement: 'Legal Stamp Agreement Signed',
  customerCnicCopy: 'Customer CNIC Copy (Verified)',
  guarantorCnicCopy: 'Guarantor CNIC Copy (Verified)',
  utilityBillCopy: 'Electricity / Utility Bill Copy',
  promissoryNote: 'Signed Promissory Note / Undated Cheques',
  postDatedCheques: 'Post-Dated Monthly Cheques in Vault',
});

module.exports = {
  INSTALLMENT_STATUSES,
  INSTALLMENT_STATUS_LABELS,
  INSTALLMENT_STATUS_BADGES,
  PLAN_STATUSES,
  PLAN_STATUS_LABELS,
  PLAN_STATUS_BADGES,
  FREQUENCIES,
  FREQUENCY_LABELS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  CHEQUE_STATUSES,
  CHEQUE_STATUS_LABELS,
  CHEQUE_STATUS_BADGES,
  SECURITY_CHECKLIST_ITEMS,
};
