// Pure, zero-dependency headline sentiment scorer.
// Deterministic (no network, no clock) so it is fully replayable: the news
// collector scores each headline once at record time and the score is frozen
// into the JSONL, so a backtest sees exactly what the live run saw.
//
// This is a crude bag-of-words lexicon, NOT an NLP model — good enough to turn a
// stream of headlines into a rough bullish/bearish tilt, honest about being a
// blunt instrument (see the "HONEST STATUS" note the HUD surfaces).

const BULL = [
  'surge', 'surges', 'surged', 'rally', 'rallies', 'soar', 'soars', 'gains', 'gain',
  'bull', 'bullish', 'jump', 'jumps', 'rise', 'rises', 'climb', 'climbs', 'approval',
  'approved', 'adoption', 'breakout', 'partnership', 'inflow', 'inflows', 'record',
  'institutional', 'buy', 'buys', 'accumulate', 'upgrade', 'breakthrough', 'ath',
  'all-time high', 'green', 'moon', 'pump', 'etf approval', 'halving',
];
const BEAR = [
  'crash', 'crashes', 'plunge', 'plunges', 'dump', 'dumps', 'selloff', 'sell-off',
  'decline', 'declines', 'drop', 'drops', 'loss', 'losses', 'ban', 'bans', 'hack',
  'hacked', 'exploit', 'lawsuit', 'sue', 'sues', 'probe', 'outflow', 'outflows',
  'collapse', 'bankruptcy', 'liquidation', 'liquidated', 'warning', 'fear', 'bearish',
  'fraud', 'scam', 'delist', 'seize', 'seized', 'crackdown', 'sec charges', 'red',
];
// Hedging words that mean the claim is speculative — dampen the signal.
const DAMP = ['could', 'may', 'might', 'reportedly', 'alleged', 'allegedly', 'rumor', 'rumour', 'plan', 'plans', 'consider'];

const rx = (w) => new RegExp(`\\b${w.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
const BULL_RX = BULL.map(rx);
const BEAR_RX = BEAR.map(rx);
const DAMP_RX = DAMP.map(rx);

// Returns { net: [-1,1], bull, bear, conf: [0,1] }.
export function scoreHeadline(text = '') {
  const t = String(text).toLowerCase();
  const bull = BULL_RX.reduce((n, r) => n + (r.test(t) ? 1 : 0), 0);
  const bear = BEAR_RX.reduce((n, r) => n + (r.test(t) ? 1 : 0), 0);
  const damp = DAMP_RX.reduce((n, r) => n + (r.test(t) ? 1 : 0), 0);
  const hits = bull + bear;
  if (!hits) return { net: 0, bull: 0, bear: 0, conf: 0 };
  let net = (bull - bear) / hits; // [-1,1]
  net *= Math.max(0, 1 - 0.15 * damp); // uncertainty dampening
  return { net: Number(net.toFixed(3)), bull, bear, conf: Number(Math.min(1, hits / 4).toFixed(2)) };
}
