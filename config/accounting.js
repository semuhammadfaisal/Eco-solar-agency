'use strict';

/**
 * Standard Pakistani Solar Business Chart of Accounts (COA) and configuration.
 *
 * Account codes follow standard numbering conventions:
 *   1000-1999: Assets (Normal balance: DEBIT)
 *   2000-2999: Liabilities (Normal balance: CREDIT)
 *   3000-3999: Equity (Normal balance: CREDIT)
 *   4000-4999: Revenue / Income (Normal balance: CREDIT)
 *   5000-5999: Cost of Goods Sold (COGS) (Normal balance: DEBIT)
 *   6000-6999: Operating Expenses (Normal balance: DEBIT)
 */

const ACCOUNT_TYPES = Object.freeze({
  ASSET: 'asset',
  LIABILITY: 'liability',
  EQUITY: 'equity',
  INCOME: 'income',
  EXPENSE: 'expense',
});

const NORMAL_BALANCES = Object.freeze({
  DEBIT: 'debit',
  CREDIT: 'credit',
});

const DEFAULT_CHART_OF_ACCOUNTS = Object.freeze([
  // ASSETS (1000 - 1999)
  {
    code: '1010',
    name: 'Cash in Hand (Counter & Safe)',
    type: ACCOUNT_TYPES.ASSET,
    subtype: 'cash',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Physical cash received and paid at solar showroom / office',
    isSystem: true,
  },
  {
    code: '1020',
    name: 'Bank Alfalah (Main Business Account)',
    type: ACCOUNT_TYPES.ASSET,
    subtype: 'bank',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Primary corporate bank account for customer pay-ins and supplier cheques',
    isSystem: true,
  },
  {
    code: '1030',
    name: 'Accounts Receivable (Customers)',
    type: ACCOUNT_TYPES.ASSET,
    subtype: 'receivable',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Unpaid solar contract and installment amounts due from customers',
    isSystem: true,
  },
  {
    code: '1040',
    name: 'Inventory Asset (Solar Equipment)',
    type: ACCOUNT_TYPES.ASSET,
    subtype: 'inventory',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Tier-1 solar panels, inverters, batteries, cables and mounting structures in stock',
    isSystem: true,
  },

  // LIABILITIES (2000 - 2999)
  {
    code: '2010',
    name: 'Accounts Payable (Suppliers & Vendors)',
    type: ACCOUNT_TYPES.LIABILITY,
    subtype: 'payable',
    normalBalance: NORMAL_BALANCES.CREDIT,
    description: 'Outstanding invoices owed to solar panel, inverter and mounting suppliers',
    isSystem: true,
  },
  {
    code: '2020',
    name: 'Customer Advances & Booking Deposits',
    type: ACCOUNT_TYPES.LIABILITY,
    subtype: 'advance',
    normalBalance: NORMAL_BALANCES.CREDIT,
    description: 'Advance payments collected prior to system commissioning and sign-off',
    isSystem: true,
  },
  {
    code: '2030',
    name: 'Accrued Salaries & Commissions Payable',
    type: ACCOUNT_TYPES.LIABILITY,
    subtype: 'accrued',
    normalBalance: NORMAL_BALANCES.CREDIT,
    description: 'Earned payroll and sales commissions awaiting monthly disbursement',
    isSystem: true,
  },

  // EQUITY (3000 - 3999)
  {
    code: '3010',
    name: "Owner's Equity & Invested Capital",
    type: ACCOUNT_TYPES.EQUITY,
    subtype: 'capital',
    normalBalance: NORMAL_BALANCES.CREDIT,
    description: 'Capital injected by business owners and partners',
    isSystem: true,
  },
  {
    code: '3020',
    name: 'Retained Earnings',
    type: ACCOUNT_TYPES.EQUITY,
    subtype: 'retained',
    normalBalance: NORMAL_BALANCES.CREDIT,
    description: 'Cumulative retained profits from prior periods',
    isSystem: true,
  },
  {
    code: '3030',
    name: 'Partner Drawings',
    type: ACCOUNT_TYPES.EQUITY,
    subtype: 'drawings',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Cash and bank amounts withdrawn by partners (contra-equity)',
    isSystem: true,
  },

  // REVENUE / INCOME (4000 - 4999)
  {
    code: '4010',
    name: 'Solar System Installation Revenue',
    type: ACCOUNT_TYPES.INCOME,
    subtype: 'sales',
    normalBalance: NORMAL_BALANCES.CREDIT,
    description: 'Turnkey solar PV contract sales (On-grid, Hybrid, Off-grid, Net Metering)',
    isSystem: true,
  },
  {
    code: '4020',
    name: 'After-Sales & Maintenance Service Income',
    type: ACCOUNT_TYPES.INCOME,
    subtype: 'services',
    normalBalance: NORMAL_BALANCES.CREDIT,
    description: 'Post-warranty repairs, periodic maintenance, panel cleaning and service charges',
    isSystem: true,
  },
  {
    code: '4030',
    name: 'Late Payment Fee & Markup Income',
    type: ACCOUNT_TYPES.INCOME,
    subtype: 'other_income',
    normalBalance: NORMAL_BALANCES.CREDIT,
    description: 'Installment markup and penalties collected on delinquent accounts',
    isSystem: true,
  },

  // COST OF GOODS SOLD (5000 - 5999)
  {
    code: '5010',
    name: 'COGS - Solar Hardware (Panels & Inverters)',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'cogs',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Cost of panels, inverters, batteries and accessories delivered to customer sites',
    isSystem: true,
  },
  {
    code: '5020',
    name: 'COGS - Direct Installation Labor',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'cogs',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Direct technician wages and contractor fees for system civil and electrical installation',
    isSystem: true,
  },
  {
    code: '5030',
    name: 'COGS - Freight, Transport & Net Metering',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'cogs',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Site logistics, crane/lifting charges, DISCO net metering application and inspection fees',
    isSystem: true,
  },

  // OPERATING EXPENSES (6000 - 6999)
  {
    code: '6010',
    name: 'Salaries & Staff Wages Expense',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'payroll',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Monthly office, sales, surveying and managerial salaries',
    isSystem: true,
  },
  {
    code: '6020',
    name: 'Sales Commission Expense',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'payroll',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Performance commissions paid to sales officers on won contracts',
    isSystem: true,
  },
  {
    code: '6030',
    name: 'Office Rent & Utilities Expense',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'operating',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Showroom and warehouse rent, electricity, internet, water and tea/refreshments',
    isSystem: true,
  },
  {
    code: '6040',
    name: 'Travel, Fuel & Vehicle Maintenance',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'operating',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Surveying motorbike fuel, installation truck diesel and vehicle repairs',
    isSystem: true,
  },
  {
    code: '6050',
    name: 'Marketing, Ads & Promotional Expense',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'operating',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Digital advertising (Facebook, Google), flex banners, standees and flyers',
    isSystem: true,
  },
  {
    code: '6060',
    name: 'Office Supplies & Miscellaneous Expense',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'operating',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description: 'Printing, stamp papers, legal fees, bank charges and sundries',
    isSystem: true,
  },
  {
    code: '6070',
    name: 'Cash Over & Short',
    type: ACCOUNT_TYPES.EXPENSE,
    subtype: 'operating',
    normalBalance: NORMAL_BALANCES.DEBIT,
    description:
      'Cash drawer count differences. Shortages are debited and overages are credited during daily closing.',
    isSystem: true,
  },
]);

const REFERENCE_TYPES = Object.freeze({
  SALE: 'sale',
  PAYMENT: 'payment',
  PURCHASE: 'purchase',
  SUPPLIER_PAYMENT: 'supplier_payment',
  EXPENSE: 'expense',
  SALARY: 'salary',
  COMMISSION: 'commission',
  SERVICE_CHARGE: 'service_charge',
  PARTNER_TRANSACTION: 'partner_transaction',
  CLOSING: 'closing',
  MANUAL: 'manual',
});

const PAYMENT_ACCOUNTS = Object.freeze([
  { code: '1010', name: 'Cash in Hand (Counter & Safe)', mode: 'cash' },
  { code: '1020', name: 'Bank Alfalah (Main Business Account)', mode: 'bank' },
]);

const EXPENSE_CATEGORIES = Object.freeze([
  { code: '6010', name: 'Salaries & Staff Wages' },
  { code: '6020', name: 'Sales Commission' },
  { code: '6030', name: 'Office Rent & Utilities' },
  { code: '6040', name: 'Travel, Fuel & Vehicle Maintenance' },
  { code: '6050', name: 'Marketing, Ads & Promotional' },
  { code: '6060', name: 'Office Supplies & Sundry Expense' },
]);

module.exports = {
  ACCOUNT_TYPES,
  NORMAL_BALANCES,
  DEFAULT_CHART_OF_ACCOUNTS,
  REFERENCE_TYPES,
  PAYMENT_ACCOUNTS,
  EXPENSE_CATEGORIES,
};
