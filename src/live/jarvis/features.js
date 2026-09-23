// ============================================================================
// FeatureExtractor — turns the sim's ctx (from simulator._buildContext) into the
// 22-D vector the model reads. RAW signals only — no hand-picked interaction
// terms. The model (OnlineMLP) has a hidden layer that can learn any combination
// of these on its own; picking combinations here would just be a human deciding
// again what to look for. Index 0 is the divergence between BTC's own implied
// P(up) and Polymarket's mid — the one genuinely-real edge candidate (the tape
// leading the odds), still just handed over raw. Keeps a short spot buffer +
// fast/slow EWMA vol internally.
//
// Senses 12-21 were grafted on 2026-07-09 (trade tapes, Polymarket tape, vol
// regime, streak). They are null-safe: a missing feed reads as 0, so a dead
// collector can never blind the whole model — it just mutes that sense.
//
// PAPER ONLY — pure math over already-collected public data.
// ============================================================================

const erf = (x) => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const sum = (a) => (Array.isArray(a) ? a.reduce((s, l) => s + (l.size ?? l[1] ?? 0), 0) : 0);
// Signed log squash for dollar figures: keeps sign, tames whales.
const squash = (usd, scale) => Math.sign(usd) * Math.log1p(Math.abs(usd) / scale);
const clampN = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export const DIM = 24;

// Human-readable label per feature index — used to explain the AI's reasoning.
// ORDER MATTERS: senses only ever APPEND (the graft machinery relies on it).
// 0-11 original · 12-21 tape senses (2026-07-10) · 22-23 the JUDGE's senses
// (same day, after verifying these markets settle on Chainlink, not spot).
export const FEATURE_LABELS = [
  'BTC vs Poly gap', 'BTC move', 'momentum (30s)', 'time left', 'book imbalance',
  'spread', 'favorite price', 'news tilt', 'whale flow', 'fear / greed',
  'time of day', 'time of day',
  'spot flow', 'perp flow', 'big prints', 'perp-spot gap',
  'PM flow', 'PM big bet', 'PM late shift', 'PM tape heat',
  'vol regime', 'streak',
  'judge gap', 'judge basis',
];

export class FeatureExtractor {
  constructor() {
    this.volEwma = 1e-4; // fast |ret|/sec EWMA (~1 min memory at 1 tick/sec)
    this.volEwmaSlow = 1e-4; // slow baseline (~30 min memory) for the regime ratio
    this.lastPx = null; this.lastT = null; this.buf = [];
  }

  // Returns Float64Array(DIM), or null if the market isn't cleanly readable.
  toVector(ctx) {
    const m = ctx.market, up = m.up, down = m.down;
    if (!m.fresh || !up || !down || up.mid == null || down.mid == null) return null;
    const spot = ctx.btc?.price;
    if (spot == null || !m.openBtc) return null;
    const now = ctx.nowSec ?? Math.floor(ctx.nowMs / 1000);

    // running per-second |ret| EWMAs (fast + slow) + ~30s momentum
    if (this.lastPx != null && now > this.lastT) {
      const r = Math.abs((spot - this.lastPx) / this.lastPx) / (now - this.lastT);
      this.volEwma = 0.98 * this.volEwma + 0.02 * r;
      this.volEwmaSlow = 0.999 * this.volEwmaSlow + 0.001 * r;
    }
    this.lastPx = spot; this.lastT = now;
    this.buf.push({ t: now, px: spot });
    while (this.buf.length && now - this.buf[0].t > 30) this.buf.shift();
    const p30 = this.buf[0]?.px ?? spot;
    const btcMom = (spot - p30) / p30;

    const secsLeft = Math.max(1, m.secondsLeft ?? m.fracLeft * 300);
    const sigma = Math.max(this.volEwma, 1e-6) * spot; // $ vol/sec
    const pBtcUp = Phi((spot - m.openBtc) / (sigma * Math.sqrt(secsLeft))); // model-free P(close>open)
    const polyMidUp = up.mid;
    const divergence = pBtcUp - polyMidUp; // FEATURE 0 — the thesis
    const btcRet = m.btcRet ?? (m.btcMove / m.openBtc);
    const fracLeft = m.fracLeft;
    const bidD = sum(up.bids), askD = sum(up.asks);
    const depthImb = (bidD - askD) / Math.max(1e-9, bidD + askD);
    const spread = (up.bestAsk != null && up.bestBid != null) ? up.bestAsk - up.bestBid : 0;
    const favMid = Math.max(polyMidUp, 1 - polyMidUp);
    const news = ctx.news ? ctx.news.score : 0;
    const whale = ctx.whale ? Math.sign(ctx.whale.netBtc) * Math.log1p(Math.abs(ctx.whale.netBtc)) : 0;
    const fngZ = ctx.fng ? (ctx.fng.z ?? 0) : 0;
    const h = new Date(ctx.nowMs || Date.now()).getUTCHours();
    const hourSin = Math.sin(2 * Math.PI * h / 24), hourCos = Math.cos(2 * Math.PI * h / 24);

    // --- grafted senses (2026-07-09): every one reads 0 when its feed is silent ---
    const flow = ctx.flow;
    const spotFlow = flow?.spot ? flow.spot.imb : 0; // binance taker imbalance, 60s
    const perpFlow = flow?.perp ? flow.perp.imb : 0; // bybit+okx taker imbalance, 60s
    const bigPrints = flow // signed net of >=$100k prints across both tapes, squashed
      ? squash((flow.spot?.bigUsd ?? 0) + (flow.perp?.bigUsd ?? 0), 250_000)
      : 0;
    const perpGap = flow?.gapBps != null ? clampN(flow.gapBps / 10, -3, 3) : 0; // perp premium, ~bps/10

    const pm = ctx.pmflow;
    const pmFlow = pm ? pm.imb : 0; // who's smashing Up vs Down this window
    const pmBigBet = pm ? squash(pm.bigBet, 200) : 0; // the single largest bet, signed
    const pmLateShift = pm ? pm.lateShift : 0; // last-45s crowd vs whole window
    const pmHeat = pm ? Math.log1p(pm.totalUsd / 500) : 0; // dead vs busy window

    const volRegime = clampN(Math.log(Math.max(this.volEwma, 1e-9) / Math.max(this.volEwmaSlow, 1e-9)), -2, 2);
    const streak = ctx.streak ? ctx.streak.streak : 0; // last 5 windows, [-1,1]

    // THE JUDGE'S SENSES: these markets settle on Chainlink BTC/USD, not spot.
    // judgeGap = the judge's own move since ITS window-open print (the real bet);
    // judgeBasis = how far spot has run ahead of the judge (bps/10, clamped) —
    // late in a window, spot leading the judge is information the crowd priced
    // off the wrong finish line.
    const cl = ctx.cl;
    const judgeGap = cl?.price != null && cl.openCl != null ? (cl.price - cl.openCl) / cl.openCl : 0;
    const judgeBasis = cl?.price != null ? clampN(((spot - cl.price) / cl.price) * 1e4 / 10, -3, 3) : 0;

    // Raw signals only — no hand-picked combinations. The model's hidden layer
    // finds any useful interaction between these on its own.
    return Float64Array.of(
      divergence, btcRet, btcMom, fracLeft, depthImb, spread, favMid,
      news, whale, fngZ, hourSin, hourCos,
      spotFlow, perpFlow, bigPrints, perpGap,
      pmFlow, pmBigBet, pmLateShift, pmHeat,
      volRegime, streak,
      judgeGap, judgeBasis,
    );
  }
}
