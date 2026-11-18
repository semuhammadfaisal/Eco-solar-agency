/**
 * View locals shared by every page: branding, helpers, flash messages,
 * CSRF token, current user and pagination helpers.
 *
 * Runs after loadUser and csurf so `req.user` and `req.csrfToken()` exist.
 */
'use strict';

const config = require('../config/app');
const navigation = require('../config/navigation');
const crm = require('../config/crm');
const inventory = require('../config/inventory');
const surveys = require('../config/surveys');
const systems = require('../config/systems');
const quotations = require('../config/quotations');
const installments = require('../config/installments');
const installationsConfig = require('../config/installations');
const partnerConfig = require('../config/partners');
const { can } = require('../config/permissions');
const { hasRole } = require('../utils/roles');
const { getSettings } = require('../services/settingsService');
const { buildPageUrl } = require('../utils/pagination');
const AppNotification = require('../models/AppNotification');
const {
  formatDate,
  formatDateTime,
  formatPKR,
  formatRelative,
  formatQty,
  escapeHtml,
  initials,
  truncate,
  numberToWordsPKR,
} = require('../utils/format');

module.exports = async function locals(req, res, next) {
  try {
    // A shared branch login has no user id, no personal notifications and only
    // a small workspace in the sidebar.
    const isBranchSession = Boolean(req.user && req.user.isBranchLogin);
    const notificationFilter =
      req.user && !isBranchSession
        ? { isRead: false, $or: [{ forUser: req.user._id }, { forUser: null }] }
        : null;
    const [settings, notificationResult] = await Promise.all([
      getSettings(),
      notificationFilter
        ? AppNotification.aggregate([
            { $match: notificationFilter },
            {
              $facet: {
                recent: [
                  { $sort: { createdAt: -1 } },
                  { $limit: 5 },
                  { $project: { title: 1, message: 1, type: 1, link: 1, createdAt: 1 } },
                ],
                total: [{ $count: 'value' }],
              },
            },
          ])
        : Promise.resolve([]),
    ]);

    res.locals.currentUser = req.user || null;
    res.locals.branchSession = isBranchSession;
    res.locals.settings = settings;
    res.locals.appName = settings.companyName || config.appName;
    res.locals.appVersion = require('../package.json').version;
    res.locals.currentPath = req.path;
    res.locals.year = new Date().getFullYear();
    res.locals.navigation = isBranchSession
      ? navigation
          .map((group) => ({
            ...group,
            items: group.items.filter((item) => item.branchLogin),
          }))
          .filter((group) => group.items.length > 0)
      : navigation;
    res.locals.crm = crm;
    res.locals.inventory = inventory;
    res.locals.surveys = surveys;
    res.locals.systems = systems;
    res.locals.quotations = quotations;
    res.locals.installments = installments;
    res.locals.installationsConfig = installationsConfig;
    res.locals.partnerConfig = partnerConfig;

    // Per-page asset injection (controllers set these arrays).
    res.locals.pageStyles = [];
    res.locals.pageScripts = [];

    res.locals.breadcrumbs = [{ label: 'Dashboard', url: '/dashboard' }];

    // Flash messages (consumed once).
    res.locals.flash = {
      success: req.flash('success'),
      error: req.flash('error'),
      warning: req.flash('warning'),
      info: req.flash('info'),
    };
    res.locals.formErrors = req.flash('formErrors');
    res.locals.oldInput = req.flash('oldInput')[0] || {};

    // CSRF token for forms and the <meta> tag used by JS.
    res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : '';

    // Navbar Notifications
    const notificationFacet = notificationResult[0] || { recent: [], total: [] };
    const unreadNotifications = notificationFacet.recent || [];
    const unreadNotificationsCount = notificationFacet.total[0]
      ? notificationFacet.total[0].value
      : 0;
    res.locals.unreadNotifications = unreadNotifications;
    res.locals.unreadNotificationsCount = unreadNotificationsCount;

    // View helpers.
    res.locals.hasRole = (roles) => hasRole(req.user, roles);
    res.locals.can = (permission) => can(req.user, permission);
    res.locals.formatDate = formatDate;
    res.locals.formatDateTime = formatDateTime;
    res.locals.formatPKR = formatPKR;
    res.locals.formatRelative = formatRelative;
    res.locals.formatQty = formatQty;
    res.locals.escapeHtml = escapeHtml;
    res.locals.initials = initials;
    res.locals.truncate = truncate;
    res.locals.numberToWordsPKR = numberToWordsPKR;
    res.locals.pageUrl = (page) => buildPageUrl(req, page);
    res.locals.old = (field, fallback = '') => {
      const value = res.locals.oldInput[field];
      if (value === undefined || value === null || value === '') return fallback;
      return Array.isArray(value) ? value[0] : value;
    };

    next();
  } catch (err) {
    next(err);
  }
};
