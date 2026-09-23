// Unified, delay-gated live view of the world that bots read from.
// Records are fed in only AFTER the delay queue releases them.

import { newsBundle, whaleBundle, fngBundle, flowBundle, pmFlowBundle } from '../signals/aggregate.js';

export class MarketState {
  constructor() {
    // Latest visible BTC prints per exchange.
    this.btc = { binance: null, coinbase: null, kraken: null };
    // Measured one-way latency (recvTs - exchTs) per source, for the dashboard.
    this.latency = {};
    // slug -> { slug, periodStart, periodEnd, tokens, outcomes, question }
    this.markets = new Map();
    // slug -> { Up: bookRec|null, Down: bookRec|null }
    this.books = new Map();
    // slug -> BTC price captured at/after that window opened (a strategy signal)
    this.openBtc = new Map();
    // slug -> { outcome, open, close } once resolved
    this.resolutions = new Map();
    this._newResolutions = []; // drained by the simulator to settle positions
    this._active = null; // cached active market (avoids rescanning every tick)
    // Information-feed buffers (news sentiment / on-chain flow / fear-greed). Bounded
    // so an overnight run can't grow them without limit; the reducers window them.
    this.newsBuf = []; // [{ net, recvTs }]
    this.whaleBuf = []; // [{ flowBtc, maxBtc, recvTs }]
    this.fngLast = null; // { value, classification, recvTs }
    // Trade-tape buffers (aggressor-stamped prints), bounded like the info buffers.
    this.spotTape = []; // binance spot: [{ usd, side (+1/-1), recvTs }]
    this.perpTape = []; // bybit+okx perps: same shape
    this.pmTape = []; // polymarket tape: [{ recvTs, slug, usd, upUsd (signed) }]
    this.perpPx = { bybit: null, okx: null }; // last perp prints for the perp-spot gap
    this.recentOutcomes = []; // last window results, +1 Up / -1 Down (streak signal)
    // The JUDGE: these markets settle on the Chainlink BTC/USD stream, not spot.
    this.cl = null; // { price, recvTs } — latest visible Chainlink print
    this.openCl = new Map(); // slug -> Chainlink price captured at window open
  }

  apply(source, rec) {
    if (rec.exchTs && rec.recvTs) {
      // Smoothed transport latency, rejecting stale-level timestamp outliers.
      const raw = rec.recvTs - rec.exchTs;
      if (raw > -5000 && raw < 30000) {
        const key = rec.src || source;
        const prev = this.latency[key];
        this.latency[key] = prev == null ? raw : prev * 0.8 + raw * 0.2;
      }
    }

    switch (rec.type) {
      case 'market':
        if (!this.markets.has(rec.slug)) {
          this.markets.set(rec.slug, {
            slug: rec.slug,
            periodStart: rec.periodStart,
            periodEnd: rec.periodEnd,
            tokens: rec.tokens,
            outcomes: rec.outcomes,
            question: rec.question,
          });
          this.books.set(rec.slug, { Up: null, Down: null });
          this._active = null; // invalidate cache; a new window may now be active
        }
        return;
      case 'book': {
        if (!this.books.has(rec.slug)) this.books.set(rec.slug, { Up: null, Down: null });
        // A slow REST poll can be released after a fresher WS snapshot; never let
        // an older book overwrite a newer one. Compare venue time (exchTs) — recvTs
        // is stamped at poll completion and is monotone, so it can't detect this.
        const cur = this.books.get(rec.slug)[rec.outcome];
        const curTs = cur ? (cur.exchTs ?? cur.recvTs ?? 0) : 0;
        if (cur && curTs > (rec.exchTs ?? rec.recvTs ?? 0)) return;
        this.books.get(rec.slug)[rec.outcome] = rec;
        return;
      }
      case 'resolution':
        if (!this.resolutions.has(rec.slug)) {
          const r = { outcome: rec.outcome, open: rec.open, close: rec.close, periodEnd: rec.periodEnd };
          this.resolutions.set(rec.slug, r);
          this._newResolutions.push({ slug: rec.slug, ...r });
          this.recentOutcomes.push(rec.outcome === 'Up' ? 1 : -1);
          if (this.recentOutcomes.length > 20) this.recentOutcomes.shift();
        }
        return;
      case 'pmtrade': {
        // Signed up-pressure: buying Up or selling Down pushes up; the mirror pushes down.
        const usd = Math.abs(rec.usd ?? 0);
        if (!usd || !rec.slug) return;
        const sign = (rec.outcome === 'Up' ? 1 : -1) * (rec.side === 'buy' ? 1 : -1);
        this.pmTape.push({ recvTs: rec.recvTs ?? rec.ts ?? Date.now(), slug: rec.slug, usd, upUsd: sign * usd });
        if (this.pmTape.length > 3000) this.pmTape.shift();
        return;
      }
      case 'news':
        this.newsBuf.push({ net: rec.sentiment?.net ?? 0, recvTs: rec.recvTs });
        if (this.newsBuf.length > 400) this.newsBuf.shift();
        return;
      case 'whale':
        this.whaleBuf.push({ flowBtc: rec.flowBtc ?? 0, maxBtc: rec.maxBtc ?? 0, recvTs: rec.recvTs });
        if (this.whaleBuf.length > 400) this.whaleBuf.shift();
        return;
      case 'fng':
        this.fngLast = { value: rec.value, classification: rec.classification, recvTs: rec.recvTs };
        return;
      default:
        // Price prints from Binance / Coinbase / Kraken, plus perp tapes.
        if (rec.src === 'binance') {
          this.btc.binance = { price: rec.price, recvTs: rec.recvTs };
          if (rec.side && rec.qty) { // aggressor-stamped spot print -> flow tape
            this.spotTape.push({ usd: rec.price * rec.qty, side: rec.side === 'buy' ? 1 : -1, recvTs: rec.recvTs });
            if (this.spotTape.length > 4000) this.spotTape.shift();
          }
        } else if (rec.src === 'coinbase') this.btc.coinbase = { price: rec.price, recvTs: rec.recvTs };
        else if (rec.src === 'kraken') this.btc.kraken = { price: rec.price, recvTs: rec.recvTs };
        else if (rec.src === 'chainlink') this.cl = { price: rec.price, recvTs: rec.recvTs };
        else if (rec.src === 'polybinance') this.btc.polybinance = { price: rec.price, recvTs: rec.recvTs };
        else if (rec.src === 'bybit' || rec.src === 'okx') {
          const ts = rec.recvTs ?? rec.ts ?? Date.now();
          if (rec.price != null) this.perpPx[rec.src] = { price: rec.price, recvTs: ts };
          if (rec.side && rec.size) {
            this.perpTape.push({ usd: rec.price * rec.size, side: rec.side === 'buy' ? 1 : -1, recvTs: ts });
            if (this.perpTape.length > 4000) this.perpTape.shift();
          }
        }
    }
  }

  // Blended BTC price visible to bots (avg of whichever exchanges are present).
  // polybinance = the Binance series mirrored on Polymarket's own feed — it fills
  // in for the direct Binance websocket, which is geo-blocked from this network.
  btcPrice() {
    const ps = [this.btc.binance?.price, this.btc.polybinance?.price, this.btc.coinbase?.price, this.btc.kraken?.price]
      .filter((x) => x != null);
    if (!ps.length) return null;
    return ps.reduce((a, x) => a + x, 0) / ps.length;
  }

  btcSpread() {
    const x = this.btc.binance?.price ?? this.btc.kraken?.price;
    const c = this.btc.coinbase?.price;
    if (x != null && c != null) return x - c;
    return null;
  }

  bookFor(slug, outcome) {
    return this.books.get(slug)?.[outcome] ?? null;
  }

  // Information signals a strategy reads off ctx (null when the feed is absent).
  // Forward-filled: the reducer holds the last-known value + stamps ageMs, so a
  // sparse feed never shows a hole — a strategy gates on ageMs itself.
  newsSignal(now) { return newsBundle(this.newsBuf, now); }
  whaleSignal(now) { return whaleBundle(this.whaleBuf, now); }
  fngSignal(now) { return fngBundle(this.fngLast, now); }

  // Trade-flow bundles: spot tape, perp tape, and the perp-spot gap in bps.
  flowSignal(now) {
    const spot = flowBundle(this.spotTape, now);
    const perp = flowBundle(this.perpTape, now);
    const spotPx = this.btc.binance?.price ?? this.btcPrice();
    const pps = [this.perpPx.bybit?.price, this.perpPx.okx?.price].filter((x) => x != null);
    const perpMid = pps.length ? pps.reduce((a, x) => a + x, 0) / pps.length : null;
    const gapBps = spotPx != null && perpMid != null ? ((perpMid - spotPx) / spotPx) * 1e4 : null;
    if (!spot && !perp && gapBps == null) return null;
    return { spot, perp, gapBps: gapBps != null ? Number(gapBps.toFixed(2)) : null };
  }

  pmFlowSignal(slug, now) { return pmFlowBundle(this.pmTape, slug, now); }

  // The judge's own price (Chainlink), plus its value at the given window's open.
  clSignal(slug, now) {
    if (!this.cl) return null;
    return {
      price: this.cl.price,
      openCl: this.openCl.get(slug) ?? null,
      ageMs: now - this.cl.recvTs,
    };
  }

  // Streak of the last 5 settled windows in [-1,1] (+1 = five Ups in a row).
  streakSignal() {
    const r = this.recentOutcomes.slice(-5);
    if (!r.length) return null;
    return { streak: Number((r.reduce((a, x) => a + x, 0) / 5).toFixed(2)), n: r.length };
  }

  // The window currently open for trading (periodStart <= now < periodEnd).
  activeMarket(nowSec) {
    const a = this._active;
    if (a && nowSec >= a.periodStart && nowSec < a.periodEnd) return a;
    let found = null;
    for (const m of this.markets.values()) {
      if (nowSec >= m.periodStart && nowSec < m.periodEnd) {
        found = m;
        break;
      }
    }
    this._active = found;
    return found;
  }

  // Drop state for windows that ended well in the past (bounds memory overnight).
  prune(nowSec, graceSec = 1800) {
    for (const [slug, m] of this.markets) {
      if (nowSec > m.periodEnd + graceSec) {
        this.markets.delete(slug);
        this.books.delete(slug);
        this.resolutions.delete(slug);
        this.openBtc.delete(slug);
        this.openCl.delete(slug);
        if (this._active && this._active.slug === slug) this._active = null;
      }
    }
  }

  takeNewResolutions() {
    const out = this._newResolutions;
    this._newResolutions = [];
    return out;
  }
}
