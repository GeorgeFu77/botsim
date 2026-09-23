// Paper fill model. Walks the live order book and applies slippage.
// PAPER ONLY — produces hypothetical fills; nothing is ever sent anywhere.

import { config } from '../../config.js';

const slip = () => config.slippageTicks * config.tickSize;

// Buy up to `dollars` worth of an outcome token by walking its asks (best-first).
// Returns { shares, avgPrice, spent } or null if the side is empty / unfillable.
export function buyForDollars(book, dollars) {
  if (!book || !book.asks || !book.asks.length || dollars <= 0) return null;
  let remaining = dollars;
  let shares = 0;
  let cost = 0;
  for (const lvl of book.asks) {
    const px = Math.min(0.999, lvl.price + slip());
    if (px <= 0) continue;
    const affordable = remaining / px;
    const take = Math.min(lvl.size, affordable);
    if (take <= 0) break;
    shares += take;
    cost += take * px;
    remaining -= take * px;
    if (remaining <= 1e-9) break;
  }
  if (shares <= 1e-9) return null;
  return { shares, avgPrice: cost / shares, spent: cost };
}

// Sell `shares` of an outcome token by walking its bids (best-first).
// Returns { shares, avgPrice, proceeds } or null if there's no bid to hit.
export function sellShares(book, shares) {
  if (!book || !book.bids || !book.bids.length || shares <= 0) return null;
  let remaining = shares;
  let sold = 0;
  let proceeds = 0;
  for (const lvl of book.bids) {
    const px = Math.max(0.001, lvl.price - slip());
    const take = Math.min(lvl.size, remaining);
    if (take <= 0) break;
    sold += take;
    proceeds += take * px;
    remaining -= take;
    if (remaining <= 1e-9) break;
  }
  if (sold <= 1e-9) return null;
  return { shares: sold, avgPrice: proceeds / sold, proceeds };
}
