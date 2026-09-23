// ============================================================================
// Strategy families + bot generator — GENERATION 4 (clean slate, ~100 bots).
//
// Mandate (btcbot council, REVISE verdict): make money REGARDLESS of which way
// BTC leans. Three generations proved that any DIRECTIONAL bet is just regime
// luck — the leaderboard winners flip with the trend every time. So gen-4 bets
// on STRUCTURE, not direction:
//   - dutch-book arbitrage (Up+Down < $1) — the only truly risk-free, neutral edge
//   - favorite-longshot harvest in the measured 0.55-0.82 "sweet spot"
//   - pair relative-value, depth imbalance, spread/time/vol-gated favorites
//   - calibration & longshot probes (measure the bias instead of guessing)
// Every family picks "the favorite" or "the cheap leg" — never a fixed Up/Down.
//
// Judge on the REGIME SPLIT: a strategy is only real if it's green in BOTH
// up-closing and down-closing windows (see the replay's regime report).
// ============================================================================

import { modelProbUp, makeRng } from './strategy.js';
import { GEN_FAMILIES, GEN_GRID, GEN_DESC, GEN_DISABLED } from './strategies.gen.js';

// Favorite-longshot guard: never buy a side priced below this (the bias is ruin
// under ~0.2). Probes deliberately ignore it to MEASURE the effect.
const FLOOR = 0.2;

const favSide = (m) => (m.up.mid >= m.down.mid ? 'Up' : 'Down');
const bookOf = (ctx, side) => ctx.market[side.toLowerCase()];
const depth = (book) => (book?.bids || []).reduce((s, l) => s + l.size, 0);

// ---- 1. Dutch-book arbitrage (truly direction-neutral, risk-free) -----------
function DutchBook(p) {
  return {
    family: 'DutchBook',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      if (m.up.bestAsk + m.down.bestAsk <= 1 - p.margin) return { action: 'enter', side: 'Both' };
      return null;
    },
  };
}

// ---- 2. Pair relative-value: buy whichever leg is cheap vs its synthetic -----
function PairRelativeValue(p) {
  return {
    family: 'PairRelativeValue',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      const fairUp = 1 - m.down.mid; // what Up "should" cost given Down's price
      const fairDown = 1 - m.up.mid;
      if (m.up.bestAsk >= FLOOR && m.up.bestAsk < fairUp - p.thresh) return { action: 'enter', side: 'Up' };
      if (m.down.bestAsk >= FLOOR && m.down.bestAsk < fairDown - p.thresh) return { action: 'enter', side: 'Down' };
      return null;
    },
  };
}

// ---- 3. Favorite-longshot harvest in the calibrated sweet spot --------------
function FavoriteSweetSpot(p) {
  return {
    family: 'FavoriteSweetSpot',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      const side = favSide(m);
      const book = bookOf(ctx, side);
      if (book.mid < p.lo || book.mid > p.hi || book.bestAsk < FLOOR) return null;
      const model = modelProbUp(m.btcRet, m.fracLeft, 0.001);
      const prob = side === 'Up' ? model : 1 - model;
      if (prob - book.bestAsk < p.reqEdge) return null;
      return { action: 'enter', side };
    },
  };
}

// ---- 4. Calibration buckets (measure realized hit-rate vs implied price) -----
function CalibrationBucket(p) {
  return {
    family: 'CalibrationBucket',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      const side = favSide(m);
      const mid = bookOf(ctx, side).mid;
      if (mid >= p.lo && mid < p.hi) return { action: 'enter', side };
      return null;
    },
  };
}

// ---- 5. Longshot probe (buys the cheap side; confirms the tax) ---------------
function LongshotProbe(p) {
  return {
    family: 'LongshotProbe',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      const side = m.up.mid <= m.down.mid ? 'Up' : 'Down';
      const ask = bookOf(ctx, side).bestAsk;
      if (ask >= p.lo && ask < p.hi) return { action: 'enter', side };
      return null;
    },
  };
}

// ---- 6. Late convergence, adaptive: buy whichever side is leading, late ------
function LateConvergeAdaptive(p) {
  return {
    family: 'LateConvergeAdaptive',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      if (m.fracElapsed < p.minFrac) return null;
      const side = favSide(m);
      const book = bookOf(ctx, side);
      if (book.bestAsk < FLOOR) return null;
      const model = modelProbUp(m.btcRet, m.fracLeft, 0.001);
      const prob = side === 'Up' ? model : 1 - model;
      if (prob - book.bestAsk < p.edge) return null;
      return { action: 'enter', side };
    },
  };
}

// ---- 7. Spread-gated favorite: only when the book is tight (low friction) ----
function SpreadGateFavorite(p) {
  return {
    family: 'SpreadGateFavorite',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      const side = favSide(m);
      const book = bookOf(ctx, side);
      if (book.bestBid == null || book.bestAsk - book.bestBid > p.maxSpread) return null;
      if (book.mid < p.lo || book.mid > p.hi || book.bestAsk < FLOOR) return null;
      return { action: 'enter', side };
    },
  };
}

// ---- 8. Depth imbalance: buy the side with much heavier bid support ----------
function DepthImbalance(p) {
  return {
    family: 'DepthImbalance',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      const du = depth(m.up);
      const dd = depth(m.down);
      if (du > dd * p.ratio && m.up.bestAsk >= FLOOR && m.up.bestAsk < 0.85) return { action: 'enter', side: 'Up' };
      if (dd > du * p.ratio && m.down.bestAsk >= FLOOR && m.down.bestAsk < 0.85) return { action: 'enter', side: 'Down' };
      return null;
    },
  };
}

// ---- 9. Time-of-day favorite (measures hour-of-day structure) ----------------
function TimeBucketFavorite(p) {
  return {
    family: 'TimeBucketFavorite',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      const hr = Math.floor((ctx.nowSec % 86400) / 3600); // UTC hour
      if (hr < p.h0 || hr >= p.h1) return null;
      const side = favSide(m);
      const book = bookOf(ctx, side);
      if (book.mid < 0.55 || book.mid > 0.85 || book.bestAsk < FLOOR) return null;
      return { action: 'enter', side };
    },
  };
}

// ---- 10. Vol-bucket favorite (does the bias concentrate by realized move?) ---
function VolBucketFavorite(p) {
  return {
    family: 'VolBucketFavorite',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      const r = Math.abs(m.btcRet);
      if (r < p.vlo || r >= p.vhi) return null;
      const side = favSide(m);
      const book = bookOf(ctx, side);
      if (book.mid < p.lo || book.mid > p.hi || book.bestAsk < FLOOR) return null;
      return { action: 'enter', side };
    },
  };
}

// ---- 11. Overreaction fade: early, fade an extreme price BTC hasn't earned ---
function OverreactionFadePair(p) {
  return {
    family: 'OverreactionFadePair',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      if (m.fracElapsed > p.maxFrac || Math.abs(m.btcRet) > 0.0003) return null; // BTC barely moved
      if (m.up.mid >= p.extreme && m.down.bestAsk >= FLOOR) return { action: 'enter', side: 'Down' };
      if (m.down.mid >= p.extreme && m.up.bestAsk >= FLOOR) return { action: 'enter', side: 'Up' };
      return null;
    },
  };
}

// ============================================================================
// INFORMATION-LAYER families — read the bot's new "senses" (ctx.fng / ctx.news /
// ctx.whale) instead of only the order book. Each gates on the signal's ageMs so a
// sparse/stale feed just means "no trade", and each still chooses a side by market
// structure (favorite / model edge / drift) — never a fixed Up/Down. Honest caveat:
// on a 5-min horizon these signals are mostly slow/priced-in; the evolver's regime
// split is what decides whether any of them is real edge or just regime luck.
// ============================================================================

// ---- 12. Fear/Greed fade: at sentiment extremes, fade the crowd --------------
// Extreme Fear -> back the favorite (the panic is likely overdone); Extreme Greed
// -> back the underdog. Direction comes from the FNG signal + book, never fixed.
function FearGreedFade(p) {
  return {
    family: 'FearGreedFade',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market, f = ctx.fng;
      if (bot.position(m.slug) || !m.fresh) return null;
      if (!f || f.ageMs > p.maxAgeMs || Math.abs(f.z) < p.z) return null; // only at extremes, fresh enough
      const fav = favSide(m);
      const side = f.z <= -p.z ? fav : fav === 'Up' ? 'Down' : 'Up'; // fear->favorite, greed->underdog
      const book = bookOf(ctx, side);
      if (book.bestAsk < FLOOR || book.mid < p.lo || book.mid > p.hi) return null;
      return { action: 'enter', side };
    },
  };
}

// ---- 13. News momentum: lean toward the side recent headlines favor ----------
// Bullish tape -> Up, bearish -> Down, but ONLY when the BTC model also shows an
// edge vs the book price (so it's not just reacting to a stale, priced-in vibe).
function NewsMomentum(p) {
  return {
    family: 'NewsMomentum',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market, n = ctx.news;
      if (bot.position(m.slug) || !m.fresh) return null;
      if (!n || n.ageMs > p.maxAgeMs || n.count < p.minCount || Math.abs(n.score) < p.thresh) return null;
      const side = n.score > 0 ? 'Up' : 'Down';
      const book = bookOf(ctx, side);
      if (book.bestAsk < FLOOR) return null;
      const model = modelProbUp(m.btcRet, m.fracLeft, 0.001);
      const prob = side === 'Up' ? model : 1 - model;
      if (prob - book.bestAsk < p.reqEdge) return null; // require model edge, not just a headline
      return { action: 'enter', side };
    },
  };
}

// ---- 14. Whale-flow tilt: heavy on-chain flow that CONFIRMS the drift ---------
// On-chain flow is noisy, so it never triggers alone: require agreement with the
// window's own BTC drift before taking that side. A pure confirmation filter.
function WhaleFlowTilt(p) {
  return {
    family: 'WhaleFlowTilt',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market, w = ctx.whale;
      if (bot.position(m.slug) || !m.fresh) return null;
      if (!w || w.ageMs > p.maxAgeMs || w.count < p.minCount || w.netBtc < p.minBtc) return null;
      if (Math.abs(m.btcRet) < p.minRet) return null; // need a real intraperiod drift to confirm
      const side = m.btcRet > 0 ? 'Up' : 'Down';
      const book = bookOf(ctx, side);
      if (book.bestAsk < FLOOR || book.bestAsk > 0.85) return null;
      return { action: 'enter', side };
    },
  };
}

// ---- Benchmarks / controls (to judge regime-robustness against) --------------
function AlwaysSide(p) {
  return {
    family: 'AlwaysSide',
    state: {},
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || !m.fresh) return null;
      if (bookOf(ctx, p.side).bestAsk < 0.97) return { action: 'enter', side: p.side };
      return null;
    },
  };
}

function RandomBaseline(p) {
  return {
    family: 'RandomBaseline',
    state: { rng: makeRng(p.seed), decidedSlug: null, side: null },
    decide(ctx, bot) {
      const m = ctx.market;
      if (bot.position(m.slug) || bot.lastEnteredSlug === m.slug || !m.fresh) return null;
      if (this.state.decidedSlug !== m.slug) {
        this.state.decidedSlug = m.slug;
        this.state.side = this.state.rng() < p.p ? (this.state.rng() < 0.5 ? 'Up' : 'Down') : null;
      }
      return this.state.side ? { action: 'enter', side: this.state.side } : null;
    },
  };
}

const FAMILIES = {
  DutchBook,
  PairRelativeValue,
  FavoriteSweetSpot,
  CalibrationBucket,
  LongshotProbe,
  LateConvergeAdaptive,
  SpreadGateFavorite,
  DepthImbalance,
  TimeBucketFavorite,
  VolBucketFavorite,
  OverreactionFadePair,
  FearGreedFade,
  NewsMomentum,
  WhaleFlowTilt,
  AlwaysSide,
  RandomBaseline,
  // Brain-written families (see strategies.gen.js) join the same roster.
  ...GEN_FAMILIES,
};

// One-line, human-readable purpose per family — the single source of truth the
// HUD's "current strategy" panel shows. Add a line here when a new family is born.
export const FAMILY_DESC = {
  DutchBook: 'Buys Up+Down together when they sum under $1 — risk-free arbitrage, direction-neutral.',
  PairRelativeValue: 'Buys whichever leg is cheap versus its synthetic price (1 − the other leg).',
  FavoriteSweetSpot: 'Harvests the favorite-longshot bias in the calibrated 0.55–0.82 price band.',
  CalibrationBucket: 'Measures realized hit-rate vs implied price, bucket by bucket (a probe).',
  LongshotProbe: 'Buys the cheap longshot side to measure the longshot tax (a probe).',
  LateConvergeAdaptive: 'Late in the window, backs the leading side when the BTC model still shows edge.',
  SpreadGateFavorite: 'Backs the favorite only when the book is tight (low-friction entries).',
  DepthImbalance: 'Backs the side whose bid book is much deeper — following the heavier support.',
  TimeBucketFavorite: 'Backs the favorite only in specific hours of day (measures time-of-day structure).',
  VolBucketFavorite: 'Backs the favorite only at specific realized-volatility levels.',
  OverreactionFadePair: 'Early in a window, fades an extreme price BTC has not actually earned yet.',
  FearGreedFade: 'At Fear/Greed extremes, fades the crowd — favorite in fear, underdog in greed.',
  NewsMomentum: 'Leans toward the side recent headline sentiment favors, but only with a model edge.',
  WhaleFlowTilt: 'Takes the favorite only when heavy on-chain flow confirms the window’s BTC drift.',
  AlwaysSide: 'Control: always buys one fixed side — the yardstick for regime luck.',
  RandomBaseline: 'Control: enters random sides — the pure-noise band every real edge must beat.',
  ...GEN_DESC,
};

const CONTROLS = [
  { family: 'AlwaysSide', params: { side: 'Up' } },
  { family: 'AlwaysSide', params: { side: 'Down' } },
  { family: 'RandomBaseline', params: { seed: 1, p: 0.5 } },
  { family: 'RandomBaseline', params: { seed: 2, p: 0.5 } },
];

const GRID = [
  { family: 'DutchBook', params: { margin: [0.0, 0.005, 0.01, 0.02, 0.03, 0.05] } },
  { family: 'PairRelativeValue', params: { thresh: [0.0, 0.005, 0.01, 0.02, 0.03, 0.05] } },
  {
    family: 'FavoriteSweetSpot',
    params: { _band: [[0.55, 0.7], [0.6, 0.78], [0.65, 0.82], [0.55, 0.82], [0.7, 0.85]], reqEdge: [0, 0.02, 0.04, 0.06, 0.08] },
    expand: (c) => ({ lo: c._band[0], hi: c._band[1], reqEdge: c.reqEdge }),
  },
  { family: 'CalibrationBucket', params: { _b: [[0.5, 0.58], [0.58, 0.66], [0.66, 0.74], [0.74, 0.82], [0.82, 0.9], [0.9, 0.97]] }, expand: (c) => ({ lo: c._b[0], hi: c._b[1], size: 30 }) },
  { family: 'LongshotProbe', params: { _b: [[0.05, 0.15], [0.15, 0.25], [0.25, 0.35]] }, expand: (c) => ({ lo: c._b[0], hi: c._b[1], size: 20 }) },
  { family: 'LateConvergeAdaptive', params: { minFrac: [0.0, 0.6, 0.75, 0.85, 0.92], edge: [0.02, 0.04, 0.06] } },
  { family: 'SpreadGateFavorite', params: { maxSpread: [0.015, 0.025, 0.04, 0.06], _band: [[0.55, 0.8], [0.6, 0.85], [0.65, 0.85]] }, expand: (c) => ({ maxSpread: c.maxSpread, lo: c._band[0], hi: c._band[1] }) },
  { family: 'DepthImbalance', params: { ratio: [1.5, 2, 2.5, 3, 4] } },
  { family: 'TimeBucketFavorite', params: { _hr: [[0, 4], [4, 8], [8, 12], [12, 16], [16, 20], [20, 24]] }, expand: (c) => ({ h0: c._hr[0], h1: c._hr[1] }) },
  { family: 'VolBucketFavorite', params: { _vb: [[0, 0.0005], [0.0005, 0.0012], [0.0012, 9]], _band: [[0.55, 0.8], [0.6, 0.85]] }, expand: (c) => ({ vlo: c._vb[0], vhi: c._vb[1], lo: c._band[0], hi: c._band[1] }) },
  { family: 'OverreactionFadePair', params: { extreme: [0.6, 0.68, 0.75], maxFrac: [0.35, 0.5] } },
  // ---- Information-layer families (read ctx.fng / ctx.news / ctx.whale) --------
  {
    family: 'FearGreedFade',
    params: { z: [0.4, 0.6, 0.8], _band: [[0.55, 0.82], [0.6, 0.85]], maxAgeMs: [21600000] }, // FNG stale after 6h
    expand: (c) => ({ z: c.z, lo: c._band[0], hi: c._band[1], maxAgeMs: c.maxAgeMs }),
  },
  { family: 'NewsMomentum', params: { thresh: [0.2, 0.4, 0.6], minCount: [2, 4], reqEdge: [0, 0.03, 0.06], maxAgeMs: [1800000] } }, // news stale after 30m
  { family: 'WhaleFlowTilt', params: { minBtc: [10, 30, 80], minCount: [10, 20], minRet: [0.0002, 0.0005], maxAgeMs: [1200000] } }, // flow stale after 20m
  // Brain-written grids ride along; brain-disabled hand families drop out.
  ...GEN_GRID,
].filter((row) => !GEN_DISABLED.includes(row.family));

function product(spec) {
  let combos = [{}];
  for (const [key, values] of Object.entries(spec)) {
    const next = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [key]: v });
    combos = next;
  }
  return combos;
}

const shortVal = (v) => (Array.isArray(v) ? v.join('/') : v);
// Exported: the live executor derives the armed champion's exact bot name from
// (family, params) with this same function, so the two can never drift apart.
export function nameFor(family, params) {
  const parts = Object.entries(params)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `${k}=${shortVal(v)}`);
  return `${family}[${parts.join(',')}]`;
}

// gridOverride: an evolver-generated roster — rows of { family, variants: [finalParams] }
// with params already in their expanded (final) shape. Controls always ride along.
export function buildBotSpecs(gridOverride = null) {
  const specs = [];
  let id = 0;
  for (const c of CONTROLS) {
    specs.push({ id: id++, family: c.family, params: c.params, name: nameFor(c.family, c.params), makeStrategy: () => FAMILIES[c.family](c.params) });
  }
  for (const row of gridOverride ?? GRID) {
    const make = FAMILIES[row.family];
    if (!make) continue; // unknown family in an override file — skip, don't crash
    if (row.variants) {
      for (const params of row.variants) {
        specs.push({ id: id++, family: row.family, params, name: nameFor(row.family, params), makeStrategy: () => make(params) });
      }
      continue;
    }
    for (const combo of product(row.params)) {
      const params = row.expand ? row.expand(combo) : combo;
      specs.push({ id: id++, family: row.family, params, name: nameFor(row.family, params), makeStrategy: () => make(params) });
    }
  }
  const seen = new Set();
  return specs.filter((s) => (seen.has(s.name) ? false : seen.add(s.name)));
}
