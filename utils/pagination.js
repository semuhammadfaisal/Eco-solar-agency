/**
 * Server-side pagination helpers used by every list page.
 * Keeps page/limit parsing, clamping and URL building in one place.
 */
'use strict';

const config = require('../config/app');

/**
 * @param {import('express').Request} req
 * @param {number} total Total matching documents
 * @param {number} [defaultLimit]
 * @returns {{
 *   page: number, limit: number, skip: number, total: number,
 *   totalPages: number, hasPrev: boolean, hasNext: boolean,
 *   from: number, to: number, pages: Array<number|string>
 * }}
 */
function getPagination(req, total, defaultLimit = config.defaultPageSize) {
  return createPagination(req.query.page, req.query.limit, total, defaultLimit);
}

/**
 * Same as getPagination but takes plain values (used by services that do not
 * receive the request object).
 *
 * @param {number|string} requestedPage
 * @param {number|string} requestedLimit
 * @param {number} total
 * @param {number} [defaultLimit]
 */
function createPagination(requestedPage, requestedLimit, total, defaultLimit = config.defaultPageSize) {
  const pageInput = Number.parseInt(requestedPage, 10) || 1;
  const limitInput = Number.parseInt(requestedLimit, 10) || defaultLimit;

  const limit = Math.min(config.maxPageSize, Math.max(1, limitInput));
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(1, pageInput), totalPages);
  const skip = (page - 1) * limit;

  return {
    page,
    limit,
    skip,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
    from: total === 0 ? 0 : skip + 1,
    to: Math.min(skip + limit, total),
    pages: pageList(page, totalPages),
  };
}

/**
 * Backwards-compatible pagination helper used by the newer feature modules.
 *
 * Numeric form:
 *   paginate(total, page, limit) -> pagination metadata
 *
 * Query form:
 *   paginate(mongooseQuery, { page, limit }) -> [items, total, metadata]
 */
async function paginate(source, pageOrOptions, requestedLimit) {
  if (typeof source === 'number') {
    return createPagination(pageOrOptions, requestedLimit, source);
  }

  if (!source || typeof source.exec !== 'function' || !source.model) {
    throw new TypeError('paginate expects a total number or a Mongoose query.');
  }

  const options = pageOrOptions || {};
  const total = await source.model.countDocuments(source.getFilter());
  const pagination = createPagination(options.page, options.limit, total);
  const items = await source.skip(pagination.skip).limit(pagination.limit).exec();
  return [items, total, pagination];
}

/**
 * Windowed page numbers: 1 … 4 5 [6] 7 8 … 20
 * @returns {Array<number|string>} ellipsis entries are the string '…'
 */
function pageList(current, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const pages = new Set([1, totalPages, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= totalPages - 2) {
    [totalPages - 3, totalPages - 2, totalPages - 1].forEach((p) => pages.add(p));
  }

  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const result = [];
  let previous = 0;

  for (const page of sorted) {
    if (previous && page - previous > 1) result.push('…');
    result.push(page);
    previous = page;
  }
  return result;
}

/**
 * Build a URL for a page while preserving the current filters.
 * @param {import('express').Request} req
 * @param {number} page
 */
function buildPageUrl(req, page) {
  const url = new URL(req.originalUrl, 'http://localhost');
  url.searchParams.set('page', String(page));
  return `${url.pathname}?${url.searchParams.toString()}`;
}

/**
 * Escape a string for safe use inside a RegExp (search inputs).
 * @param {string} value
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  getPagination,
  createPagination,
  paginate,
  pageList,
  buildPageUrl,
  escapeRegex,
};
