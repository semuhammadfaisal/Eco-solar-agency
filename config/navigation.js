/**
 * Sidebar navigation.
 *
 * Every item declares the roles allowed to see it. The sidebar filters these
 * through hasRole() so a sales user never receives links they cannot open.
 * Route-level requireRole() remains the authoritative check.
 */
'use strict';

const { ROLES, ALL_ROLES } = require('./roles');

const navigation = [
  {
    label: 'Overview',
    items: [
      {
        label: 'Dashboard',
        icon: 'bi-speedometer2',
        url: '/dashboard',
        roles: ALL_ROLES,
        branchLogin: true,
      },
    ],
  },
  {
    label: 'Sales & CRM',
    items: [
      {
        label: 'Quotations',
        icon: 'bi-file-earmark-text',
        url: '/quotations',
        match: '/quotations',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT],
      },
      {
        label: 'Projects',
        icon: 'bi-briefcase',
        url: '/projects',
        match: '/projects',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT],
      },
      {
        label: 'Fast Sales / POS',
        icon: 'bi-cart-check',
        url: '/pos',
        match: '/pos',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT, ROLES.SHOPKEEPER],
        branchLogin: true,
      },
      {
        label: 'Customers',
        icon: 'bi-people-fill',
        url: '/customers',
        match: '/customers',
        roles: [
          ROLES.OWNER,
          ROLES.MANAGER,
          ROLES.SALES,
          ROLES.SURVEYOR,
          ROLES.TECHNICIAN,
          ROLES.ACCOUNTANT,
        ],
      },
    ],
  },
  {
    label: 'Finance & Installments',
    items: [
      {
        label: 'Installment Plans',
        icon: 'bi-calendar3-range',
        url: '/installments',
        match: '/installments',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT],
      },
      {
        label: 'Collection Calendar',
        icon: 'bi-calendar-event',
        url: '/installments/calendar',
        match: '/installments/calendar',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT],
      },
      {
        label: 'Cheque Register',
        icon: 'bi-journal-check',
        url: '/installments/cheques',
        match: '/installments/cheques',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Payment Receipts',
        icon: 'bi-receipt-cutoff',
        url: '/installments/receipts',
        match: '/installments/receipts',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT],
      },
      {
        label: "Today's Recovery",
        icon: 'bi-phone-flip',
        url: '/recovery/today',
        match: '/recovery/today',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT],
      },
      {
        label: 'Escalations & PTP',
        icon: 'bi-exclamation-octagon',
        url: '/recovery/escalations',
        match: '/recovery/escalations',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Notification Logs',
        icon: 'bi-send-check',
        url: '/recovery/logs',
        match: '/recovery/logs',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        label: 'Installations',
        icon: 'bi-tools',
        url: '/installations',
        match: '/installations',
        roles: [
          ROLES.OWNER,
          ROLES.MANAGER,
          ROLES.SALES,
          ROLES.TECHNICIAN,
          ROLES.ACCOUNTANT,
          ROLES.STOREKEEPER,
        ],
      },
      {
        label: 'Site surveys',
        icon: 'bi-clipboard2-check',
        url: '/surveys',
        match: '/surveys',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.SURVEYOR],
      },
    ],
  },
  {
    label: 'After-Sales & Service',
    items: [
      {
        label: 'Warranty Records',
        icon: 'bi-shield-check',
        url: '/warranties',
        match: '/warranties',
        roles: ALL_ROLES,
      },
      {
        label: 'Complaint Tickets',
        icon: 'bi-headset',
        url: '/complaints',
        match: '/complaints',
        roles: [
          ROLES.OWNER,
          ROLES.MANAGER,
          ROLES.SALES,
          ROLES.TECHNICIAN,
          ROLES.ACCOUNTANT,
        ],
      },
      {
        label: 'Maintenance Schedule',
        icon: 'bi-calendar-check-fill',
        url: '/maintenance',
        match: '/maintenance',
        roles: [
          ROLES.OWNER,
          ROLES.MANAGER,
          ROLES.SALES,
          ROLES.TECHNICIAN,
        ],
      },
    ],
  },
  {
    label: 'Systems & Pricing',
    items: [
      {
        label: 'System Builder',
        icon: 'bi-cpu',
        url: '/system-builder',
        match: '/system-builder',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT],
      },
      {
        label: 'Saved Systems / BOM',
        icon: 'bi-file-earmark-spreadsheet',
        url: '/system-configs',
        match: '/system-configs',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT],
      },
      {
        label: 'Package Templates',
        icon: 'bi-collection',
        url: '/packages',
        match: '/packages',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT],
      },
    ],
  },
  {
    label: 'Stock',
    items: [
      {
        label: 'Branches & Shops',
        icon: 'bi-shop',
        url: '/branches',
        match: '/branches',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT, ROLES.STOREKEEPER, ROLES.SHOPKEEPER],
        branchLogin: true,
      },
      {
        label: 'Brands',
        icon: 'bi-tags',
        url: '/brands',
        match: '/brands',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.SALES, ROLES.ACCOUNTANT, ROLES.STOREKEEPER, ROLES.SHOPKEEPER],
        branchLogin: true,
      },
      {
        label: 'Inventory',
        icon: 'bi-box-seam',
        url: '/items',
        match: '/items',
        roles: [
          ROLES.OWNER,
          ROLES.MANAGER,
          ROLES.SALES,
          ROLES.SURVEYOR,
          ROLES.TECHNICIAN,
          ROLES.ACCOUNTANT,
          ROLES.STOREKEEPER,
        ],
      },
      {
        label: 'Stock transfers',
        icon: 'bi-arrow-left-right',
        url: '/transfers',
        match: '/transfers',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.STOREKEEPER, ROLES.SHOPKEEPER],
        branchLogin: true,
      },
      {
        label: 'Stock ledger',
        icon: 'bi-arrow-left-right',
        url: '/stock',
        roles: [
          ROLES.OWNER,
          ROLES.MANAGER,
          ROLES.SALES,
          ROLES.SURVEYOR,
          ROLES.TECHNICIAN,
          ROLES.ACCOUNTANT,
          ROLES.STOREKEEPER,
        ],
      },
      {
        label: 'Serial numbers',
        icon: 'bi-upc-scan',
        url: '/serials',
        match: '/serials',
        roles: [
          ROLES.OWNER,
          ROLES.MANAGER,
          ROLES.SALES,
          ROLES.SURVEYOR,
          ROLES.TECHNICIAN,
          ROLES.ACCOUNTANT,
          ROLES.STOREKEEPER,
        ],
      },
    ],
  },
  {
    label: 'Purchasing',
    items: [
      {
        label: 'Purchases',
        icon: 'bi-receipt',
        url: '/purchases',
        match: '/purchases',
        roles: [ROLES.OWNER, ROLES.ACCOUNTANT, ROLES.STOREKEEPER],
      },
      {
        label: 'Suppliers',
        icon: 'bi-truck',
        url: '/suppliers',
        match: '/suppliers',
        roles: [ROLES.OWNER, ROLES.ACCOUNTANT, ROLES.STOREKEEPER],
      },
      {
        label: 'Supplier returns',
        icon: 'bi-arrow-return-left',
        url: '/stock/returns',
        match: '/stock/returns',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.STOREKEEPER],
      },
      {
        label: 'Valuation report',
        icon: 'bi-calculator',
        url: '/stock/valuation',
        match: '/stock/valuation',
        roles: [ROLES.OWNER, ROLES.ACCOUNTANT, ROLES.STOREKEEPER],
      },
    ],
  },
  {
    label: 'Accounts & Ledger',
    items: [
      {
        label: 'Daily Closing',
        icon: 'bi-safe',
        url: '/accounting/daily-closing',
        match: '/accounting/daily-closing',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT, ROLES.SHOPKEEPER],
        branchLogin: true,
      },
      {
        label: 'Financial Dashboard',
        icon: 'bi-speedometer',
        url: '/accounting/dashboard',
        match: '/accounting/dashboard',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Expense Register',
        icon: 'bi-wallet2',
        url: '/accounting/expenses',
        match: '/accounting/expenses',
        roles: [ROLES.OWNER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Supplier Payments',
        icon: 'bi-credit-card-2-front',
        url: '/accounting/supplier-payments',
        match: '/accounting/supplier-payments',
        roles: [ROLES.OWNER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Cash Book',
        icon: 'bi-cash-stack',
        url: '/accounting/cash-book',
        match: '/accounting/cash-book',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Bank Book',
        icon: 'bi-bank',
        url: '/accounting/bank-book',
        match: '/accounting/bank-book',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Salary & Commission Sheet',
        icon: 'bi-person-lines-fill',
        url: '/accounting/salary-sheet',
        match: '/accounting/salary-sheet',
        roles: [ROLES.OWNER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Trial Balance',
        icon: 'bi-scale',
        url: '/accounting/trial-balance',
        match: '/accounting/trial-balance',
        roles: [ROLES.OWNER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Profit & Loss Statement',
        icon: 'bi-graph-up-arrow',
        url: '/accounting/profit-loss',
        match: '/accounting/profit-loss',
        roles: [ROLES.OWNER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Accounts Receivable',
        icon: 'bi-arrow-down-left-circle',
        url: '/accounting/receivables',
        match: '/accounting/receivables',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
      },
      {
        label: 'Accounts Payable',
        icon: 'bi-arrow-up-right-circle',
        url: '/accounting/payables',
        match: '/accounting/payables',
        roles: [ROLES.OWNER, ROLES.ACCOUNTANT],
      },
    ],
  },
  {
    label: 'People',
    items: [
      {
        label: 'Employees',
        icon: 'bi-person-badge',
        url: '/employees',
        match: '/employees',
        roles: [ROLES.OWNER, ROLES.MANAGER],
      },
      {
        label: 'Partners',
        icon: 'bi-people-fill',
        url: '/partners',
        match: '/partners',
        roles: [ROLES.OWNER, ROLES.MANAGER, ROLES.ACCOUNTANT],
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        label: 'Users',
        icon: 'bi-people',
        url: '/users',
        match: '/users',
        roles: [ROLES.OWNER],
      },
      {
        label: 'Company Settings',
        icon: 'bi-building-gear',
        url: '/settings',
        match: '/settings',
        roles: [ROLES.OWNER, ROLES.MANAGER],
      },
    ],
  },
];

module.exports = navigation;
