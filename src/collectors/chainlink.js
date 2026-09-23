// Chainlink BTC/USD price collector (via Polymarket's public live-data feed).
// The 5-min Up/Down markets SETTLE on the Chainlink BTC/USD data stream, so
// this is the judge's own price. Polymarket streams it (about once a second)
// over an unauthenticated websocket; the same socket also carries a
// Binance-sourced BTC/USDT series, which we record too under src 'polybinance'.
// Writes one JSONL record per price update to data/chainlink/prices.jsonl.
// READ-ONLY public market data. No auth, no orders.

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { ReconnectingWS } from '../util/ws.js';
import { makeLogger } from '../util/log.js';

const log = makeLogger('chainlink');

// In-process memory of the judge's recent prints, so the resolution logic in
// polymarket.js can settle windows on the SAME stream the venue settles on.
// ~20 min of 1/sec prints, pruned on push.
const clHistory = []; // [{ ts, price }] — ts = feed source timestamp (ms)
const CL_KEEP_MS = 20 * 60_000;

// Latest Chainlink print at or before tsMs (within tolMs). Null if we have no
// usable print — callers must fall back to something honest and say so.
export function clPriceAt(tsMs, tolMs = 90_000) {
  for (let i = clHistory.length - 1; i >= 0; i--) {
    const r = clHistory[i];
    if (r.ts <= tsMs) return tsMs - r.ts <= tolMs ? r.price : null;
  }
  return null;
}

export function startChainlinkCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'chainlink', 'prices.jsonl');
  const c = config.chainlink;
  let count = 0;

  const ws = new ReconnectingWS({
    name: 'chainlink',
    urls: [c.wsUrl],
    staleMs: 30_000, // both series tick ~1/sec, so silence means a dead socket
    onOpen: (sock) => {
      sock.send(
        JSON.stringify({
          action: 'subscribe',
          subscriptions: [
            { topic: c.chainlinkTopic, type: 'update' },
            { topic: c.binanceTopic, type: 'update' },
          ],
        }),
      );
    },
    onMessage: (data) => {
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return; // server sends an empty keepalive frame right after connect
      }
      // Update payload: { topic, type:'update', payload:{ symbol, value:<price>,
      //   full_accuracy_value:<string>, timestamp:<sourceTimeMs> }, timestamp:<serverSendMs> }
      const p = m?.payload;
      if (m?.type !== 'update' || !p || p.value === undefined) return;
      let src;
      if (m.topic === c.chainlinkTopic && p.symbol === c.chainlinkSymbol) src = 'chainlink';
      else if (m.topic === c.binanceTopic && p.symbol === c.binanceSymbol) src = 'polybinance';
      else return; // the firehose carries every listed coin (eth/sol/...) — not ours
      appendLine(file, {
        src, // 'chainlink' = the oracle these markets settle on; 'polybinance' = Binance series on the same feed
        price: Number(p.value),
        exchTs: Number(p.timestamp), // source timestamp (ms) as stamped by the feed
        recvTs: Date.now(), // when WE received it — the engine's Tailer requires this
      });
      if (src === 'chainlink') {
        clHistory.push({ ts: Number(p.timestamp) || Date.now(), price: Number(p.value) });
        while (clHistory.length && clHistory[0].ts < Date.now() - CL_KEEP_MS) clHistory.shift();
      }
      if (++count % 500 === 0) log.info(`${count} updates; last ${src} $${Number(p.value).toFixed(2)}`);
    },
  });

  ws.start();
  log.ok('collector started ->', file);
  return {
    close() {
      ws.close();
    },
  };
}
