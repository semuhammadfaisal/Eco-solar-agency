/**
 * Partner vocabulary.
 *
 * A partner holds an equity share of the business (stored as integer basis
 * points so 33.33% is exactly 3333 bps) and a running cash account. These
 * labels are shared by the model, validators, service and views.
 */
'use strict';

const PARTNER_TRANSACTION_TYPES = Object.freeze(['contribution', 'drawing', 'expense']);

const PARTNER_TRANSACTION_LABELS = Object.freeze({
  contribution: 'Capital in',
  drawing: 'Cash taken',
  expense: 'Expense paid',
});

const PARTNER_TRANSACTION_BADGES = Object.freeze({
  contribution: 'success',
  drawing: 'danger',
  expense: 'warning',
});

const PARTNER_TRANSACTION_HINTS = Object.freeze({
  contribution: 'Money the partner put into the business. Increases what the partner is owed.',
  drawing: 'Cash or bank money the partner took out. Reduces what the partner is owed.',
  expense: 'A business expense the partner paid personally. Increases what the partner is owed.',
});

/** Cash and bank accounts a partner can take money from or pay into. */
const PARTNER_PAYMENT_ACCOUNTS = Object.freeze([
  { code: '1010', label: 'Cash in hand' },
  { code: '1020', label: 'Bank Alfalah' },
]);

const PARTNER_PAYMENT_CODES = Object.freeze(
  PARTNER_PAYMENT_ACCOUNTS.map((account) => account.code)
);

module.exports = {
  PARTNER_TRANSACTION_TYPES,
  PARTNER_TRANSACTION_LABELS,
  PARTNER_TRANSACTION_BADGES,
  PARTNER_TRANSACTION_HINTS,
  PARTNER_PAYMENT_ACCOUNTS,
  PARTNER_PAYMENT_CODES,
};
