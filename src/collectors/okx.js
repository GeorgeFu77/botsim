// OKX BTC-USDT-SWAP perp trade collector.
// Writes one JSONL record per trade to data/okx/trades.jsonl.
// READ-ONLY public market data. No auth, no orders.
//
// OKX SWAP trade sizes (`sz`) are in CONTRACTS, not BTC. For BTC-USDT-SWAP one
// contract is 0.01 BTC (ctVal). We confirm ctVal from the public instruments
// endpoint at startup and fall back to the configured value if that fails.

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { ReconnectingWS } from '../util/ws.js';
import { makeLogger } from '../util/log.js';

const log = makeLogger('okx');

export function startOkxCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'okx', 'trades.jsonl');
  let count = 0;
  let ctVal = config.okx.contractSizeBtc; // BTC per contract (verified async below)

  async function confirmContractSize() {
    try {
      const res = await fetch(config.okx.instrumentsUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const inst = j?.data?.[0];
      const v = Number(inst?.ctVal);
      if (inst?.ctValCcy === 'BTC' && Number.isFinite(v) && v > 0) {
        if (v !== ctVal) log.warn(`instruments ctVal ${v} != configured ${ctVal} — using ${v}`);
        ctVal = v;
        log.info(`contract size confirmed: 1 contract = ${ctVal} BTC`);
      }
    } catch (e) {
      log.warn(`instruments fetch failed (${e.message}); using configured ${ctVal} BTC/contract`);
    }
  }
  confirmContractSize();

  const ws = new ReconnectingWS({
    name: 'okx',
    urls: [config.okx.wsUrl],
    staleMs: 30_000,
    onOpen: (sock) => {
      sock.send(JSON.stringify({ op: 'subscribe', args: [{ channel: 'trades', instId: config.okx.instId }] }));
    },
    onMessage: (data) => {
      let m;
      try {
        m = JSON.parse(data); // literal 'pong' replies fail parse and are skipped
      } catch {
        return;
      }
      // Trade payload: { arg:{channel:'trades',instId}, data:[{ px, sz, side:'buy'|'sell', ts }] }
      if (m.arg?.channel !== 'trades' || m.arg?.instId !== config.okx.instId || !Array.isArray(m.data)) return;
      for (const t of m.data) {
        if (t.px === undefined) continue;
        appendLine(file, {
          type: 'trade',
          ts: Number(t.ts), // exchange trade time (ms)
          price: Number(t.px),
          size: Number((Number(t.sz) * ctVal).toFixed(8)), // contracts -> BTC
          side: t.side === 'buy' ? 'buy' : 'sell', // taker (aggressor) side
          src: 'okx', // feedDelayMs keys exchange trades by source, like binance/kraken
        });
        if (++count % 500 === 0) log.info(`${count} trades; last $${Number(t.px).toFixed(2)}`);
      }
    },
  });

  // OKX closes sockets idle >30s on either side; a 20s ping keeps it alive.
  // OKX expects the literal string 'ping' (not JSON) and replies 'pong'.
  const ping = setInterval(() => ws.send('ping'), 20_000);
  ping.unref?.();

  ws.start();
  log.ok('collector started ->', file);
  return {
    close() {
      clearInterval(ping);
      ws.close();
    },
  };
}
