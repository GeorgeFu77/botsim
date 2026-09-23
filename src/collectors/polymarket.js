// Polymarket BTC 5-minute Up/Down collector.
// READ-ONLY public data only: Gamma market discovery, CLOB /book, CLOB market WS.
// NEVER authenticates, signs, or places an order.
//
// Writes three JSONL streams under data/polymarket/:
//   markets.jsonl      - one record per newly discovered 5-min window
//   books.jsonl        - normalized top-of-book snapshots (Up & Down tokens)
//   resolutions.jsonl  - official outcome once a window closes (from Binance 5m candle)

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { makeLogger } from '../util/log.js';
import { ReconnectingWS } from '../util/ws.js';
import { nowSec, periodStartFor, slugFor, windowLabel } from '../util/time.js';
import { clPriceAt } from './chainlink.js'; // the judge's recent prints (same process)

const log = makeLogger('polymarket');
const P = config.polymarket;

async function getJSON(url, ms = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Polymarket returns book sides as raw arrays; normalize to best-first top levels.
function normalizeBook(raw) {
  const bids = (raw.bids || []).map((l) => ({ price: Number(l.price), size: Number(l.size) }));
  const asks = (raw.asks || []).map((l) => ({ price: Number(l.price), size: Number(l.size) }));
  bids.sort((a, b) => b.price - a.price); // best (highest) bid first
  asks.sort((a, b) => a.price - b.price); // best (lowest) ask first
  const bestBid = bids.length ? bids[0].price : null;
  const bestAsk = asks.length ? asks[0].price : null;
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : (bestBid ?? bestAsk);
  return { bestBid, bestAsk, mid, bids: bids.slice(0, 10), asks: asks.slice(0, 10) };
}

export function startPolymarketCollector(dataDir = config.dataDir) {
  const marketsFile = path.join(dataDir, 'polymarket', 'markets.jsonl');
  const booksFile = path.join(dataDir, 'polymarket', 'books.jsonl');
  const resFile = path.join(dataDir, 'polymarket', 'resolutions.jsonl');

  // assetId -> { asset, outcome:'Up'|'Down', slug, periodStart, periodEnd }
  const assets = new Map();
  // slug -> { slug, periodStart, periodEnd, tokens:{Up,Down}, resolved:boolean }
  const windows = new Map();
  // assetId -> { bestBid, bestAsk } last written (dedupe) + lastWriteTs
  const lastWrite = new Map();

  let subscribedKey = '';

  // ---- CLOB market WebSocket (low-latency book snapshots) -------------------
  const ws = new ReconnectingWS({
    name: 'polymarket-clob',
    urls: [P.clobWs],
    staleMs: 45_000,
    onOpen: () => sendSubscribe(),
    onMessage: (data) => {
      let payload;
      try {
        payload = JSON.parse(data);
      } catch {
        return;
      }
      const events = Array.isArray(payload) ? payload : [payload];
      for (const ev of events) {
        const assetId = ev.asset_id || ev.assetId;
        if (!assetId || !assets.has(assetId)) continue;
        // A full snapshot carries bids/asks. price_change deltas are covered by
        // the REST backstop poll, so we only act on snapshots here.
        if (ev.bids || ev.asks) writeBook(assetId, normalizeBook(ev), ev.timestamp);
      }
    },
  });

  function sendSubscribe() {
    const ids = [...assets.keys()];
    if (ids.length) ws.send({ assets_ids: ids, type: 'market' });
  }

  function writeBook(assetId, nb, exchTsRaw) {
    const meta = assets.get(assetId);
    if (!meta) return;
    if (nb.bestBid == null && nb.bestAsk == null) return;
    const prev = lastWrite.get(assetId);
    const now = Date.now();
    const changed = !prev || prev.bestBid !== nb.bestBid || prev.bestAsk !== nb.bestAsk;
    if (prev && !changed && now - prev.ts < 2000) return; // dedupe identical, but heartbeat every 2s
    if (prev && now - prev.ts < P.bookWriteThrottleMs) return; // throttle bursts
    lastWrite.set(assetId, { bestBid: nb.bestBid, bestAsk: nb.bestAsk, ts: now });
    appendLine(booksFile, {
      src: 'polymarket',
      type: 'book',
      slug: meta.slug,
      asset: assetId,
      outcome: meta.outcome,
      periodStart: meta.periodStart,
      periodEnd: meta.periodEnd,
      bestBid: nb.bestBid,
      bestAsk: nb.bestAsk,
      mid: nb.mid,
      bids: nb.bids,
      asks: nb.asks,
      exchTs: exchTsRaw ? Number(exchTsRaw) : now,
      recvTs: now,
    });
  }

  // ---- Discovery: find the current + upcoming 5-min windows -----------------
  async function discoverWindow(periodStart) {
    const slug = slugFor(P.slugPrefix, periodStart);
    if (windows.has(slug)) return;
    let events;
    try {
      events = await getJSON(`${P.gammaBase}/events?slug=${slug}`);
    } catch (e) {
      return; // not published yet / transient — try again next cycle
    }
    const ev = Array.isArray(events) ? events[0] : events;
    const market = ev?.markets?.[0];
    if (!market?.clobTokenIds) return;

    let tokenIds;
    let outcomes;
    try {
      tokenIds = JSON.parse(market.clobTokenIds);
      outcomes = JSON.parse(market.outcomes); // expected ["Up","Down"]
    } catch {
      return;
    }
    const periodEnd = periodStart + P.periodSeconds;
    const tokens = {};
    outcomes.forEach((oc, i) => {
      const id = tokenIds[i];
      tokens[oc] = id;
      assets.set(id, { asset: id, outcome: oc, slug, periodStart, periodEnd });
    });
    windows.set(slug, { slug, periodStart, periodEnd, tokens, resolved: false });

    appendLine(marketsFile, {
      src: 'polymarket',
      type: 'market',
      slug,
      question: market.question,
      outcomes,
      tokens,
      periodStart,
      periodEnd,
      recvTs: Date.now(),
    });
    log.ok(`window ${windowLabel(periodStart, P.periodSeconds)}  ${slug}`);

    // New assets → refresh subscription and prime books immediately via REST.
    const key = [...assets.keys()].sort().join(',');
    if (key !== subscribedKey) {
      subscribedKey = key;
      sendSubscribe();
    }
    Object.values(tokens).forEach((id) => pollBook(id));
  }

  async function discover() {
    const start = periodStartFor(nowSec(), P.periodSeconds);
    const targets = [];
    for (let i = 0; i <= P.preloadWindows; i++) targets.push(start + i * P.periodSeconds);
    for (const t of targets) await discoverWindow(t);
  }

  // ---- REST backstop: keep books fresh even if the WS stalls ----------------
  async function pollBook(assetId) {
    const meta = assets.get(assetId);
    if (!meta) return;
    try {
      const raw = await getJSON(`${P.clobBase}/book?token_id=${assetId}`, 6000);
      writeBook(assetId, normalizeBook(raw), raw.timestamp);
    } catch {
      /* transient — next poll covers it */
    }
  }

  async function pollAllBooks() {
    const now = nowSec();
    // Only poll tokens for windows that are still tradeable (now < periodEnd + grace).
    for (const [id, meta] of assets) {
      if (now < meta.periodEnd + 30) await pollBook(id);
    }
  }

  // ---- Resolution: settle a window on the JUDGE — the Chainlink BTC/USD stream
  // these markets actually resolve on (verified from the live market description,
  // 2026-07-10). Tie goes to Up, per the venue's own rulebook ("greater than or
  // equal to"). Falls back to the old Binance 5m candle only when the Chainlink
  // feed has a gap, and says so in the record.
  async function resolveWindow(win) {
    const openCl = clPriceAt(win.periodStart * 1000);
    const closeCl = clPriceAt(win.periodEnd * 1000);
    if (openCl != null && closeCl != null) {
      const outcome = closeCl >= openCl ? 'Up' : 'Down';
      win.resolved = true;
      appendLine(resFile, {
        src: 'polymarket',
        type: 'resolution',
        slug: win.slug,
        periodStart: win.periodStart,
        periodEnd: win.periodEnd,
        open: openCl,
        close: closeCl,
        outcome,
        source: 'chainlink BTC/USD stream (poly ws mirror)',
        recvTs: Date.now(),
      });
      log.ok(`resolved ${win.slug} -> ${outcome}  (chainlink open ${openCl.toFixed(2)} / close ${closeCl.toFixed(2)})`);
      return;
    }
    log.warn(`${win.slug}: no chainlink prints for window edges — falling back to Binance candle`);
    const startMs = win.periodStart * 1000;
    const bases = [config.binance.restBase, config.binance.restBaseFallback];
    for (const base of bases) {
      try {
        const url = `${base}/api/v3/klines?symbol=${config.binance.klineSymbol}&interval=5m&startTime=${startMs}&limit=1`;
        const kl = await getJSON(url, 7000);
        const k = kl?.[0];
        if (!k || Number(k[0]) !== startMs) continue; // candle not finalized / misaligned
        const open = Number(k[1]);
        const close = Number(k[4]);
        const outcome = close >= open ? 'Up' : 'Down';
        win.resolved = true;
        appendLine(resFile, {
          src: 'polymarket',
          type: 'resolution',
          slug: win.slug,
          periodStart: win.periodStart,
          periodEnd: win.periodEnd,
          open,
          close,
          outcome,
          source: `${base} BTCUSDT 5m candle`,
          recvTs: Date.now(),
        });
        log.ok(`resolved ${win.slug} -> ${outcome}  (open ${open} / close ${close})`);
        return;
      } catch {
        /* try fallback base / retry next tick */
      }
    }
  }

  async function resolvePending() {
    const now = nowSec();
    for (const win of windows.values()) {
      if (!win.resolved && now >= win.periodEnd + 2) await resolveWindow(win);
    }
  }

  // Periodically forget assets for long-resolved windows to bound memory.
  function prune() {
    const now = nowSec();
    for (const [slug, win] of windows) {
      if (win.resolved && now > win.periodEnd + 1800) {
        for (const id of Object.values(win.tokens)) {
          assets.delete(id);
          lastWrite.delete(id);
        }
        windows.delete(slug);
      }
    }
  }

  ws.start();
  discover();
  const tDiscover = setInterval(discover, P.discoverIntervalMs);
  const tBooks = setInterval(pollAllBooks, P.bookPollMs);
  const tResolve = setInterval(resolvePending, 3000);
  const tPrune = setInterval(prune, 60_000);
  [tDiscover, tBooks, tResolve, tPrune].forEach((t) => t.unref?.());

  log.ok('collector started -> data/polymarket/{markets,books,resolutions}.jsonl');

  return {
    stop() {
      ws.close();
      [tDiscover, tBooks, tResolve, tPrune].forEach(clearInterval);
    },
  };
}
