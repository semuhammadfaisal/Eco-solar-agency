/** URL helpers. */
'use strict';

/**
 * Return a same-origin path from the Referer header, or the fallback.
 * Prevents open-redirect abuse when redirecting back after a form error.
 *
 * @param {import('express').Request} req
 * @param {string} [fallback]
 */
function safeReferrer(req, fallback = '/') {
  const referrer = req.get('Referrer') || req.get('Referer');
  if (!referrer) return fallback;

  try {
    const url = new URL(referrer);
    const ownHost = req.get('host');
    if (url.host !== ownHost) return fallback;
    if (url.pathname.startsWith('//')) return fallback;
    return `${url.pathname}${url.search}`;
  } catch (_err) {
    return fallback;
  }
}

module.exports = { safeReferrer };
