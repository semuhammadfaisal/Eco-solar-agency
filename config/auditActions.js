/**
 * Canonical audit action keys. Using constants avoids typos and keeps the
 * audit trail queryable ("show me every user.role-change").
 */
'use strict';

const AUDIT_ACTIONS = Object.freeze({
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_LOGIN_FAILED: 'auth.login-failed',
  AUTH_PASSWORD_CHANGED: 'auth.password-changed',
  AUTH_BRANCH_LOGIN: 'auth.branch-login',
  AUTH_BRANCH_LOGOUT: 'auth.branch-logout',
  AUTH_BRANCH_LOGIN_FAILED: 'auth.branch-login-failed',
  USER_PROFILE_UPDATED: 'user.profile-updated',

  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_ROLE_CHANGED: 'user.role-changed',
  USER_ACTIVATED: 'user.activated',
  USER_DEACTIVATED: 'user.deactivated',
  USER_DELETED: 'user.deleted',
  USER_PASSWORD_RESET: 'user.password-reset',

  BRANCH_LOGIN_PASSWORD_SET: 'branch.login-password-set',
  BRANCH_LOGIN_PASSWORD_CLEARED: 'branch.login-password-cleared',

  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_DELETED: 'customer.deleted',

  EMPLOYEE_CREATED: 'employee.created',
  EMPLOYEE_UPDATED: 'employee.updated',
  EMPLOYEE_DELETED: 'employee.deleted',

  PARTNER_CREATED: 'partner.created',
  PARTNER_UPDATED: 'partner.updated',
  PARTNER_DELETED: 'partner.deleted',
  PARTNER_TRANSACTION_RECORDED: 'partner.transaction-recorded',

  ATTENDANCE_MARKED: 'attendance.marked',
  ATTENDANCE_UPDATED: 'attendance.updated',

  SURVEY_CREATED: 'survey.created',
  SURVEY_UPDATED: 'survey.updated',
  SURVEY_STATUS_CHANGED: 'survey.status-changed',
  SURVEY_PHOTOS_ADDED: 'survey.photos-added',

  SUPPLIER_CREATED: 'supplier.created',
  SUPPLIER_UPDATED: 'supplier.updated',
  SUPPLIER_DELETED: 'supplier.deleted',

  ITEM_CREATED: 'item.created',
  ITEM_UPDATED: 'item.updated',
  ITEM_DELETED: 'item.deleted',

  PURCHASE_CREATED: 'purchase.created',
  PURCHASE_UPDATED: 'purchase.updated',
  PURCHASE_RECEIVED: 'purchase.received',
  PURCHASE_PAYMENT_RECORDED: 'purchase.payment-recorded',
  PURCHASE_CANCELLED: 'purchase.cancelled',

  STOCK_ADJUSTED: 'stock.adjusted',
  STOCK_RECEIVED: 'stock.received',
  STOCK_RETURNED: 'stock.returned',

  SERIAL_REGISTERED: 'serial.registered',
  SERIAL_UPDATED: 'serial.updated',
  SERIAL_STATUS_CHANGED: 'serial.status-changed',

  PACKAGE_CREATED: 'package.created',
  PACKAGE_UPDATED: 'package.updated',
  PACKAGE_DELETED: 'package.deleted',

  SYSTEM_CONFIG_CREATED: 'system_config.created',
  SYSTEM_CONFIG_UPDATED: 'system_config.updated',
  SYSTEM_CONFIG_APPROVED: 'system_config.approved',
  SYSTEM_CONFIG_REJECTED: 'system_config.rejected',
  SYSTEM_CONFIG_DELETED: 'system_config.deleted',

  QUOTATION_CREATED: 'quotation.created',
  QUOTATION_UPDATED: 'quotation.updated',
  QUOTATION_REVISION_CREATED: 'quotation.revision-created',
  QUOTATION_STATUS_CHANGED: 'quotation.status-changed',
  QUOTATION_EMAILED: 'quotation.emailed',
  QUOTATION_DELETED: 'quotation.deleted',

  SALE_CREATED: 'sale.created',
  SALE_STATUS_CHANGED: 'sale.status-changed',

  INSTALLMENT_PLAN_CREATED: 'installment_plan.created',
  INSTALLMENT_PLAN_UPDATED: 'installment_plan.updated',
  INSTALLMENT_PAYMENT_RECORDED: 'installment.payment-recorded',
  INSTALLMENT_RESCHEDULED: 'installment.rescheduled',
  INSTALLMENT_LATE_FEE_WAIVED: 'installment.late-fee-waived',
  SECURITY_CHECKLIST_UPDATED: 'installment_security.checklist-updated',
  SECURITY_OVERRIDE_GRANTED: 'installment_security.override-granted',
  CHEQUE_CREATED: 'cheque.created',
  CHEQUE_STATUS_CHANGED: 'cheque.status-changed',
  CHEQUE_BOUNCED: 'cheque.bounced',

  PROMISE_TO_PAY_RECORDED: 'recovery.ptp-recorded',
  PROMISE_TO_PAY_UPDATED: 'recovery.ptp-updated',
  RECOVERY_NOTE_CREATED: 'recovery.note-created',
  PLAN_FLAGGED_RECOVERY: 'recovery.plan-flagged',
  NOTIFICATION_SENT: 'notification.sent',
  NOTIFICATION_RETRIED: 'notification.retried',

  INSTALLATION_CREATED: 'installation.created',
  INSTALLATION_UPDATED: 'installation.updated',
  INSTALLATION_SCHEDULED: 'installation.scheduled',
  MATERIAL_ISSUED: 'installation.material-issued',
  INSTALLATION_COMPLETED: 'installation.completed',
  INSTALLATION_COMMISSIONED: 'installation.commissioned',
  CUSTOMER_SIGNOFF_RECORDED: 'installation.customer-signoff',

  WARRANTY_CREATED: 'warranty.created',
  WARRANTY_CLAIMED: 'warranty.claimed',

  COMPLAINT_CREATED: 'complaint.created',
  COMPLAINT_UPDATED: 'complaint.updated',
  COMPLAINT_RESOLVED: 'complaint.resolved',

  MAINTENANCE_SCHEDULED: 'maintenance.scheduled',
  MAINTENANCE_COMPLETED: 'maintenance.completed',

  // Step 10: Accounting & Ledger
  JOURNAL_ENTRY_POSTED: 'accounting.journal-posted',
  EXPENSE_CREATED: 'accounting.expense-created',
  EXPENSE_DELETED: 'accounting.expense-deleted',
  SUPPLIER_PAYMENT_POSTED: 'accounting.supplier-payment',
  SALARY_DISBURSED: 'accounting.salary-disbursed',
  COMMISSION_DISBURSED: 'accounting.commission-disbursed',
  ACCOUNT_CREATED: 'accounting.account-created',
  DAILY_CLOSING_PERFORMED: 'accounting.daily-closing',
  DAILY_CLOSING_ADJUSTMENT: 'accounting.closing-adjustment',
  DAILY_CLOSING_REOPENED: 'accounting.closing-reopened',

  SETTINGS_UPDATED: 'settings.updated',
  SETTINGS_LOGO_UPDATED: 'settings.logo-updated',
});

module.exports = { AUDIT_ACTIONS };
