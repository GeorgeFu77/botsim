// Kraken BTC/USD trade collector (replaces Binance, which is unreachable from
// this network: binance.com geo-blocks US IPs with HTTP 451 and binance.us no
// longer accepts connections).
// Writes one JSONL record per trade to data/kraken/trades.jsonl.
// READ-ONLY public market data. No auth, no orders.

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { ReconnectingWS } from '../util/ws.js';
import { makeLogger } from '../util/log.js';

const log = makeLogger('kraken');

export function startKrakenCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'kraken', 'trades.jsonl');
  let count = 0;

  const ws = new ReconnectingWS({
    name: 'kraken',
    urls: [config.kraken.wsUrl],
    staleMs: 30_000,
    onOpen: (sock) => {
      sock.send(JSON.stringify({ method: 'subscribe', params: { channel: 'trade', symbol: [config.kraken.symbol] } }));
    },
    onMessage: (data) => {
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      // Trade payload: { channel:'trade', data:[{ price, qty, timestamp, ... }] }
      if (m.channel !== 'trade' || !Array.isArray(m.data)) return;
      const recvTs = Date.now();
      for (const t of m.data) {
        if (t.price === undefined) continue;
        appendLine(file, {
          src: 'kraken',
          sym: 'BTCUSD',
          price: Number(t.price),
          qty: Number(t.qty),
          exchTs: Date.parse(t.timestamp), // exchange trade time (ms)
          recvTs, // when WE received it (ms) — delay = recvTs - exchTs
        });
        if (++count % 500 === 0) log.info(`${count} trades; last $${Number(t.price).toFixed(2)}`);
      }
    },
  });

  ws.start();
  log.ok('collector started ->', file);
  return ws;
}
