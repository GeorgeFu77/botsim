// Coinbase BTC-USD ticker collector.
// Writes one JSONL record per ticker update to data/coinbase/ticker.jsonl.
// READ-ONLY public market data. No auth, no orders.

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { ReconnectingWS } from '../util/ws.js';
import { makeLogger } from '../util/log.js';

const log = makeLogger('coinbase');

export function startCoinbaseCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'coinbase', 'ticker.jsonl');
  let count = 0;

  const ws = new ReconnectingWS({
    name: 'coinbase',
    urls: [config.coinbase.wsUrl],
    staleMs: 30_000,
    onOpen: (sock) => {
      sock.send(
        JSON.stringify({
          type: 'subscribe',
          product_ids: [config.coinbase.product],
          channels: ['ticker'],
        }),
      );
    },
    onMessage: (data) => {
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      if (m.type !== 'ticker' || m.price === undefined) return;
      const recvTs = Date.now();
      appendLine(file, {
        src: 'coinbase',
        sym: 'BTC-USD',
        price: Number(m.price),
        bid: Number(m.best_bid),
        ask: Number(m.best_ask),
        exchTs: m.time ? Date.parse(m.time) : recvTs,
        recvTs,
      });
      if (++count % 500 === 0) log.info(`${count} ticks; last $${Number(m.price).toFixed(2)}`);
    },
  });

  ws.start();
  log.ok('collector started ->', file);
  return ws;
}
