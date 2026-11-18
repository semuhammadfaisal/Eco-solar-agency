'use strict';

const asyncHandler = require('../utils/asyncHandler');
const { lookupBusinessNumber } = require('../services/businessLookupService');

exports.index = asyncHandler(async (req, res) => {
  const data = await lookupBusinessNumber(req.query.q, req.user);

  // Typing a complete unique reference should take the user straight to it.
  const exactMatches = data.results.filter((row) =>
    [row.number, ...(row.aliases || [])].some((number) => number.toUpperCase() === data.query.toUpperCase())
  );
  if (data.exact && exactMatches.length === 1) {
    return res.redirect(data.exact.url);
  }

  return res.render('lookup/index', {
    layout: 'layouts/admin',
    title: 'Find Business Record',
    breadcrumbs: [{ label: 'Dashboard', url: '/dashboard' }, { label: 'Find by number' }],
    ...data,
  });
});
