/**
 * Partner profit-allocation helpers.
 *
 * Profit is always split from an integer paisa amount. The largest-remainder
 * method is used so the partner shares add up to the profit exactly, with no
 * paisa lost to rounding:
 *
 *   PKR 100.00 split 50/50  ->  5000 + 5000 paisa
 *   PKR 100.01 split 50/50  ->  5001 + 5000 paisa
 *
 * Equity is stored in basis points (10000 bps = 100%). Any equity that is not
 * assigned to an active partner stays unallocated.
 */
'use strict';

const FULL_EQUITY_BPS = 10000;

function clampEquityBps(value) {
  const bps = Math.round(Number(value) || 0);
  if (bps < 0) return 0;
  return bps > FULL_EQUITY_BPS ? FULL_EQUITY_BPS : bps;
}

/** 3333 -> 33.33 */
function equityPercent(equityBps) {
  return Number((clampEquityBps(equityBps) / 100).toFixed(2));
}

/**
 * Split a profit (or loss) across partners by equity.
 *
 * @param {number} netProfitPaisa Integer paisa. Negative values are losses.
 * @param {Array<{_id?: any, equityBps?: number, isActive?: boolean}>} partners
 * @returns {Array<{partner: object, equityBps: number, equityPercent: number, sharePaisa: number}>}
 */
function allocateProfit(netProfitPaisa, partners = []) {
  const total = Math.round(Number(netProfitPaisa) || 0);

  const rows = (Array.isArray(partners) ? partners : [])
    .filter((partner) => partner && partner.isActive !== false)
    .map((partner, index) => {
      const equityBps = clampEquityBps(partner.equityBps);
      return { partner, index, equityBps };
    });

  if (!rows.length) return [];

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);

  const working = rows.map((row) => {
    const exact = (abs * row.equityBps) / FULL_EQUITY_BPS;
    const sharePaisa = Math.floor(exact);
    return { ...row, sharePaisa, remainder: exact - sharePaisa };
  });

  const assignedBps = working.reduce((sum, row) => sum + row.equityBps, 0);
  const distributable = Math.min(
    abs,
    Math.round((abs * Math.min(assignedBps, FULL_EQUITY_BPS)) / FULL_EQUITY_BPS)
  );
  const alreadyAllocated = working.reduce((sum, row) => sum + row.sharePaisa, 0);
  let leftover = Math.max(0, distributable - alreadyAllocated);

  // Hand out the remaining paisa to the largest fractional shares first.
  const order = working
    .slice()
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  let cursor = 0;
  while (leftover > 0 && order.length) {
    order[cursor % order.length].sharePaisa += 1;
    leftover -= 1;
    cursor += 1;
  }

  return working
    .sort((a, b) => a.index - b.index)
    .map((row) => ({
      partner: row.partner,
      equityBps: row.equityBps,
      equityPercent: equityPercent(row.equityBps),
      sharePaisa: row.sharePaisa * sign,
    }));
}

module.exports = {
  FULL_EQUITY_BPS,
  clampEquityBps,
  equityPercent,
  allocateProfit,
};
