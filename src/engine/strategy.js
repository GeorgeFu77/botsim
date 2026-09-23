// Strategy framework + shared math helpers.
//
// A "strategy" is just an object: { family, name, params, decide(ctx, bot) }.
// `decide` returns one of:
//   null                                   -> do nothing
//   { action: 'enter', side, dollars }     -> open a position ('Up' | 'Down')
//   { action: 'exit' }                     -> close the current position now
//
// The engine handles all risk clamping, fills, and accounting, so a strategy is
// pure decision logic. See strategies.js for the concrete families.

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Standard normal CDF (Abramowitz & Stegun 7.1.26 approximation of erf).
export function Phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-(z * z) / 2);
  let p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  p = 1 - p;
  return z >= 0 ? p : 1 - p;
}

// Model probability that the window closes "Up", given how far BTC has already
// moved and how much time (hence noise) remains.
//   final_return = current_return + Normal(0, sigma_remaining)
//   P(Up) = P(final_return >= 0) = Phi(current_return / sigma_remaining)
// `volPerPeriod` is the BTC return std-dev over a full 5-min window (e.g. 0.001).
export function modelProbUp(currentReturn, fracTimeLeft, volPerPeriod) {
  const sigma = volPerPeriod * Math.sqrt(Math.max(fracTimeLeft, 1e-4));
  if (sigma <= 1e-9) return currentReturn >= 0 ? 1 : 0;
  return clamp(Phi(currentReturn / sigma), 0.0001, 0.9999);
}

// Deterministic per-bot PRNG (mulberry32) so "random" bots are reproducible.
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
