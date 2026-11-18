/**
 * Closing-time reminder popup.
 *
 * Runs on authenticated HTML GET pages after the configured business-day end
 * time while the branch drawer is still open. The modal is rendered by the
 * admin layout, so this middleware only injects `res.locals.closingReminder`.
 *
 * Snoozing is stored in the session for 30 minutes, which prevents the popup
 * from blocking the shopkeeper on every page while they finish a task.
 */
'use strict';

const dailyClosingService = require('../services/dailyClosingService');
const { getSettings } = require('../services/settingsService');

const SKIP_PREFIXES = [
  '/accounting/daily-closing',
  '/api',
  '/uploads',
  '/css',
  '/js',
  '/vendor',
  '/favicon',
];

module.exports = async function closingReminder(req, res, next) {
  try {
    if (!req.user) return next();
    if (req.method !== 'GET') return next();
    if (SKIP_PREFIXES.some((prefix) => req.path.startsWith(prefix))) return next();
    if (typeof req.accepts === 'function' && !req.accepts('html')) return next();
    if (!res.locals || typeof res.locals.can !== 'function' || !res.locals.can('closing.view')) {
      return next();
    }

    const settings = await getSettings();
    if (!settings.dailyClosingReminderEnabled) return next();

    const snooze = req.session && req.session.closingSnooze;
    if (snooze && Number(snooze.until) > Date.now()) return next();

    const reminder = await dailyClosingService.getReminder({ actor: req.user });
    if (reminder) res.locals.closingReminder = reminder;
    return next();
  } catch (err) {
    // A reminder must never break a page request.
    console.error('[closing-reminder]', err.message);
    return next();
  }
};
