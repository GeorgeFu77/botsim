// Pure reducers: turn the raw per-record streams MarketState accumulates into the
// compact numeric bundles a strategy reads off `ctx` (ctx.news / ctx.whale / ctx.fng).
//
// Kept separate + pure so the reducer is unit-testable and MarketState.apply stays
// tiny. Every bundle carries `ageMs` (how stale the newest record is) — strategies
// gate on it themselves, which is how a sparse, forward-filled feed stays honest:
// the value persists, but the strategy can refuse to act on ancient data.

// news: recency-weighted mean of per-headline net sentiment over a rolling window.
// buf entries: { net, recvTs }
export function newsBundle(buf, now, windowMs = 30 * 60_000) {
  if (!buf.length) return null;
  const recent = buf.filter((r) => now - r.recvTs <= windowMs);
  const last = buf[buf.length - 1];
  if (!recent.length) return { score: 0, count: 0, ageMs: now - last.recvTs };
  let wsum = 0, w = 0;
  for (const r of recent) {
    const k = Math.max(0.05, 1 - (now - r.recvTs) / windowMs); // linear recency weight
    wsum += r.net * k;
    w += k;
  }
  return {
    score: Number((w ? wsum / w : 0).toFixed(3)),
    count: recent.length,
    ageMs: now - last.recvTs,
  };
}

// whale: on-chain flow pressure over a rolling window — summed per-poll flow, plus
// the largest single tx seen (a genuine "whale event" spike). buf: { flowBtc, maxBtc, recvTs }
export function whaleBundle(buf, now, windowMs = 20 * 60_000) {
  if (!buf.length) return null;
  const recent = buf.filter((r) => now - r.recvTs <= windowMs);
  const last = buf[buf.length - 1];
  const netBtc = recent.reduce((s, r) => s + (r.flowBtc || 0), 0);
  const maxBtc = recent.reduce((m, r) => Math.max(m, r.maxBtc || 0), 0);
  return {
    netBtc: Number(netBtc.toFixed(2)),
    maxBtc: Number(maxBtc.toFixed(2)),
    count: recent.length,
    ageMs: now - last.recvTs,
  };
}

// fear & greed: last value plus a normalized z in [-1,1] (fear<0, greed>0).
// last: { value, classification, recvTs } | null
export function fngBundle(last, now) {
  if (!last) return null;
  return {
    value: last.value,
    z: Number(((last.value - 50) / 50).toFixed(3)),
    classification: last.classification,
    ageMs: now - last.recvTs,
  };
}

// trade flow: taker buy/sell pressure over a rolling window, from a tape of
// aggressor-stamped prints. buf entries: { usd, side (+1 buy / -1 sell), recvTs }.
// `imb` is (buy$-sell$)/(buy$+sell$) in [-1,1]; `bigUsd` is the signed net of
// prints at/above bigMin (the "someone large is acting" component on its own).
export function flowBundle(buf, now, windowMs = 60_000, bigMin = 100_000) {
  if (!buf.length) return null;
  let buy = 0, sell = 0, big = 0;
  for (let i = buf.length - 1; i >= 0; i--) {
    const r = buf[i];
    if (now - r.recvTs > windowMs) break; // buffers are append-ordered
    if (r.side > 0) buy += r.usd; else sell += r.usd;
    if (r.usd >= bigMin) big += r.side * r.usd;
  }
  const tot = buy + sell;
  return {
    imb: tot > 0 ? Number(((buy - sell) / tot).toFixed(3)) : 0,
    bigUsd: Number(big.toFixed(0)),
    totalUsd: Number(tot.toFixed(0)),
    ageMs: now - buf[buf.length - 1].recvTs,
  };
}

// Polymarket tape for ONE window: who is hitting Up vs Down right now, in dollars.
// buf entries: { recvTs, slug, usd, upUsd } where upUsd is +usd for up-pressure
// (buy Up / sell Down) and -usd for down-pressure. All values window-scoped by slug.
export function pmFlowBundle(buf, slug, now, lateMs = 45_000) {
  if (!buf.length) return null;
  let up = 0, down = 0, lateUp = 0, lateDown = 0, big = 0;
  for (let i = buf.length - 1; i >= 0; i--) {
    const r = buf[i];
    if (r.slug !== slug) continue;
    if (r.upUsd >= 0) up += r.upUsd; else down -= r.upUsd;
    if (Math.abs(r.upUsd) > Math.abs(big)) big = r.upUsd;
    if (now - r.recvTs <= lateMs) {
      if (r.upUsd >= 0) lateUp += r.upUsd; else lateDown -= r.upUsd;
    }
  }
  const tot = up + down, lateTot = lateUp + lateDown;
  if (tot <= 0) return null;
  const imb = (up - down) / tot;
  const lateImb = lateTot > 0 ? (lateUp - lateDown) / lateTot : imb;
  return {
    imb: Number(imb.toFixed(3)),
    lateShift: Number((lateImb - imb).toFixed(3)),
    bigBet: Number(big.toFixed(0)), // signed usd of the single largest print
    totalUsd: Number(tot.toFixed(0)),
  };
}
