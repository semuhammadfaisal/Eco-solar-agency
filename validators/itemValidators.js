/** Inventory item form validation. */
'use strict';

const { body } = require('express-validator');
const { toPaisa } = require('../utils/money');
const { ITEM_CATEGORIES, ITEM_UNITS } = require('../config/inventory');

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

const itemRules = [
  body('sku')
    .trim()
    .notEmpty()
    .withMessage('SKU is required.')
    .bail()
    .matches(/^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$/)
    .withMessage('SKU must be 2–40 characters using letters, digits and . _ / - only.'),
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Item name is required.')
    .bail()
    .isLength({ max: 150 })
    .withMessage('Item name cannot exceed 150 characters.'),
  body('category').trim().isIn(ITEM_CATEGORIES).withMessage('Select a valid category.'),
  body('unit').trim().isIn(ITEM_UNITS).withMessage('Select a valid unit.'),
  body('brand').optional().trim().isLength({ max: 100 }).withMessage('Brand cannot exceed 100 characters.'),
  body('model').optional().trim().isLength({ max: 100 }).withMessage('Model cannot exceed 100 characters.'),
  body('wattage')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 1000000 })
    .withMessage('Wattage must be between 0 and 1,000,000 W.'),
  body('capacityKw')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 1000000 })
    .withMessage('Capacity must be between 0 and 1,000,000 kW.'),
  body('specs').optional().trim().isLength({ max: 2000 }).withMessage('Specifications cannot exceed 2000 characters.'),
  body('minStock')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0 })
    .withMessage('Minimum stock cannot be negative.'),
  moneyRule('purchasePrice', 'Purchase price'),
  moneyRule('sellingPrice', 'Selling price'),
  moneyRule('wholesalePrice', 'Wholesale price'),
  moneyRule('retailPrice', 'Retail price'),
  body('maxDiscountPercent').optional({ values: 'falsy' }).isFloat({ min: 0, max: 100 }).withMessage('Maximum discount must be between 0 and 100%.'),
  body('productWarrantyYears')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 50 })
    .withMessage('Product warranty must be between 0 and 50 years.'),
  body('performanceWarrantyYears')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: 50 })
    .withMessage('Performance warranty must be between 0 and 50 years.'),
  body('location').optional().trim().isLength({ max: 100 }).withMessage('Location cannot exceed 100 characters.'),
  body('notes').optional().trim().isLength({ max: 1000 }).withMessage('Notes cannot exceed 1000 characters.'),
];

const stockInRules = [
  body('item')
    .trim()
    .notEmpty()
    .withMessage('Select an item.')
    .bail()
    .isMongoId()
    .withMessage('Select a valid item.'),
  body('branch')
    .optional({ values: 'falsy' })
    .trim()
    .isMongoId()
    .withMessage('Select a valid branch.'),
  body('qty')
    .trim()
    .notEmpty()
    .withMessage('Quantity is required.')
    .bail()
    .isFloat({ gt: 0 })
    .withMessage('Quantity must be greater than zero.'),
  moneyRule('unitCost', 'Unit cost'),
  body('reference')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 120 })
    .withMessage('Reference cannot exceed 120 characters.'),
  body('location')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 100 })
    .withMessage('Location cannot exceed 100 characters.'),
  body('notes')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Notes cannot exceed 500 characters.'),
  body('serials')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Serial numbers must be plain text.'),
];

module.exports = {
  createItemRules: itemRules,
  updateItemRules: itemRules,
  stockInRules,
};
