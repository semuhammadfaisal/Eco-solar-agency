/** Purchase order, GRN, payment and supplier-return validation. */
'use strict';

const { body } = require('express-validator');
const { toPaisa } = require('../utils/money');
const { parseDateKey } = require('../utils/dates');

function moneyRule(field, label, { required = false } = {}) {
  const chain = required
    ? body(field).trim().notEmpty().withMessage(`${label} is required.`).bail()
    : body(field).optional({ values: 'falsy' }).trim();

  return chain.custom((value) => {
    try {
      const paisa = toPaisa(value);
      if (paisa < 0) throw new Error('negative');
      return true;
    } catch (_err) {
      throw new Error(`Enter a valid ${label.toLowerCase()}.`);
    }
  });
}

const dateRule = (field, label, required = false) => {
  const chain = required
    ? body(field).trim().notEmpty().withMessage(`${label} is required.`).bail()
    : body(field).optional({ values: 'falsy' }).trim();

  return chain.custom((value) => {
    if (!parseDateKey(String(value).slice(0, 10))) {
      throw new Error(`Enter a valid ${label.toLowerCase()}.`);
    }
    return true;
  });
};

const itemLinesRule = body('items').custom((value) => {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Add at least one item to the purchase order.');
  }
  return true;
});

const purchaseRules = [
  body('supplier').trim().notEmpty().withMessage('Select a supplier.').bail().isMongoId().withMessage('Select a valid supplier.'),
  itemLinesRule,
  body('items.*.item').isMongoId().withMessage('Select a valid item on every line.'),
  body('items.*.qty')
    .isFloat({ gt: 0 })
    .withMessage('Every line needs a quantity greater than zero.'),
  moneyRule('items.*.unitCost', 'Unit cost', { required: true }),
  body('invoiceNo')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 60 })
    .withMessage('Invoice number cannot exceed 60 characters.'),
  dateRule('purchaseDate', 'Purchase date'),
  moneyRule('paidAmount', 'Amount paid'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
];

const grnRules = [
  dateRule('receivedAt', 'Received date', true),
  body('received.*')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0 })
    .withMessage('Received quantities must be zero or greater.'),
  body('serials.*')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Invalid serial number list.')
    .isLength({ max: 40000 })
    .withMessage('The serial list is too long.'),
  body('invoiceNo')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 60 })
    .withMessage('Invoice number cannot exceed 60 characters.'),
  body('location').optional().trim().isLength({ max: 100 }).withMessage('Location cannot exceed 100 characters.'),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters.'),
];

const paymentRules = [moneyRule('amount', 'Payment amount', { required: true })];

const supplierReturnRules = [
  body('supplier').trim().notEmpty().withMessage('Select a supplier.').bail().isMongoId().withMessage('Select a valid supplier.'),
  body('item').trim().notEmpty().withMessage('Select an item.').bail().isMongoId().withMessage('Select a valid item.'),
  body('purchase').optional({ values: 'falsy' }).isMongoId().withMessage('Select a valid purchase.'),
  body('qty').isFloat({ gt: 0 }).withMessage('Quantity must be greater than zero.'),
  body('reason')
    .trim()
    .notEmpty()
    .withMessage('A reason is required for a supplier return.')
    .bail()
    .isLength({ max: 300 })
    .withMessage('Reason cannot exceed 300 characters.'),
  body('serials')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Invalid serial number list.')
    .isLength({ max: 40000 })
    .withMessage('The serial list is too long.'),
  body('location').optional().trim().isLength({ max: 100 }).withMessage('Location cannot exceed 100 characters.'),
];

module.exports = {
  createPurchaseRules: purchaseRules,
  updatePurchaseRules: purchaseRules,
  grnRules,
  paymentRules,
  supplierReturnRules,
};
