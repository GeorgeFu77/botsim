// Polymarket BTC 5-minute Up/Down TRADE TAPE collector.
// Who is buying Up vs Down right now, and at what size — one record per fill.
// READ-ONLY public data only: Gamma discovery + the public data-api trade
// history. NEVER authenticates, signs, or places an order.
//
// Writes data/polymarket/trades.jsonl:
//   {"type":"pmtrade","ts":<ms>,"slug":<window>,"outcome":"Up"|"Down","side":"buy"|"sell","price":<0..1>,"usd":<$>}
// `side` is the TAKER side; `usd` = price × size(shares).

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { makeLogger } from '../util/log.js';
import { nowSec, periodStartFor, slugFor, windowLabel } from '../util/time.js';

const log = makeLogger('pm-tape');
const P = config.polymarket;
const T = config.polymarketTape;

async function getJSON(url, ms = 8000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export function startPolymarketTradesCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'polymarket', 'trades.jsonl');

  // slug -> { slug, conditionId, periodStart, periodEnd, seen:Set<fillKey> }
  const windows = new Map();
  let count = 0;

  // ---- Discovery: same Gamma lookup as polymarket.js, current + upcoming ----
  async function discoverWindow(periodStart) {
    const slug = slugFor(P.slugPrefix, periodStart);
    if (windows.has(slug)) return;
    let events;
    try {
      events = await getJSON(`${P.gammaBase}/events?slug=${slug}`);
    } catch {
      return; // not published yet / transient — try again next cycle
    }
    const ev = Array.isArray(events) ? events[0] : events;
    const market = ev?.markets?.[0];
    if (!market?.conditionId) return;
    windows.set(slug, {
      slug,
      conditionId: market.conditionId,
      periodStart,
      periodEnd: periodStart + P.periodSeconds,
      seen: new Set(),
    });
    log.ok(`tape window ${windowLabel(periodStart, P.periodSeconds)}  ${slug}`);
  }

  async function discover() {
    const start = periodStartFor(nowSec(), P.periodSeconds);
    for (let i = 0; i <= P.preloadWindows; i++) await discoverWindow(start + i * P.periodSeconds);
  }

  // ---- Tape: poll the public data-api per active window, dedupe fills -------
  async function pollWindow(win) {
    let trades;
    try {
      trades = await getJSON(`${T.dataApiBase}/trades?market=${win.conditionId}&limit=${T.limit}`, T.timeoutMs);
    } catch {
      return; // transient — the next poll covers it
    }
    if (!Array.isArray(trades)) return;
    // data-api returns newest-first; reverse so the file stays chronological.
    for (const t of trades.reverse()) {
      if (t?.price === undefined || t.size === undefined) continue;
      // No stable trade id in the payload — a tx can carry several fills, so
      // dedupe on the full fill identity.
      const key = `${t.transactionHash}:${t.asset}:${t.side}:${t.price}:${t.size}:${t.timestamp}`;
      if (win.seen.has(key)) continue;
      win.seen.add(key);
      // The data-api sometimes returns float-noise prices (0.7199999958 for a
      // cent-tick market) — round to 6dp so the tape stays clean.
      const price = Number(Number(t.price).toFixed(6));
      const usd = Number((price * Number(t.size)).toFixed(6));
      appendLine(file, {
        type: 'pmtrade',
        ts: Number(t.timestamp) * 1000, // data-api timestamps are epoch seconds
        slug: win.slug,
        outcome: t.outcome, // 'Up' | 'Down' — which token traded
        side: String(t.side).toLowerCase(), // taker (aggressor) side
        price,
        usd,
      });
      if (++count % 50 === 0) log.info(`${count} tape trades; last ${t.outcome} ${String(t.side).toLowerCase()} $${usd.toFixed(2)}`);
    }
  }

  let polling = false; // never stack polls if the API turns slow
  async function pollAll() {
    if (polling) return;
    polling = true;
    try {
      const now = nowSec();
      for (const win of windows.values()) {
        if (now < win.periodEnd + 60) await pollWindow(win); // 60s grace for late prints
      }
    } finally {
      polling = false;
    }
  }

  // Forget long-closed windows (and their dedupe sets) to bound memory.
  function prune() {
    const now = nowSec();
    for (const [slug, win] of windows) {
      if (now > win.periodEnd + 600) windows.delete(slug);
    }
  }

  discover().then(pollAll);
  const tDiscover = setInterval(discover, P.discoverIntervalMs);
  const tPoll = setInterval(pollAll, T.pollIntervalMs);
  const tPrune = setInterval(prune, 60_000);
  [tDiscover, tPoll, tPrune].forEach((t) => t.unref?.());

  log.ok('collector started ->', file);
  return {
    stop() {
      [tDiscover, tPoll, tPrune].forEach(clearInterval);
    },
    close() {
      [tDiscover, tPoll, tPrune].forEach(clearInterval);
    },
  };
}
