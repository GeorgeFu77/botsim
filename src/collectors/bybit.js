// Bybit BTCUSDT linear-perp trade collector.
// Writes one JSONL record per trade to data/bybit/trades.jsonl.
// READ-ONLY public market data. No auth, no orders.

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { ReconnectingWS } from '../util/ws.js';
import { makeLogger } from '../util/log.js';

const log = makeLogger('bybit');

export function startBybitCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'bybit', 'trades.jsonl');
  let count = 0;

  const ws = new ReconnectingWS({
    name: 'bybit',
    urls: [config.bybit.wsUrl],
    staleMs: 30_000,
    onOpen: (sock) => {
      sock.send(JSON.stringify({ op: 'subscribe', args: [config.bybit.topic] }));
    },
    onMessage: (data) => {
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      // Trade payload: { topic:'publicTrade.BTCUSDT', data:[{ T:<tradeTimeMs>, p:<price>, v:<qty BTC>, S:'Buy'|'Sell' }] }
      if (m.topic !== config.bybit.topic || !Array.isArray(m.data)) return;
      for (const t of m.data) {
        if (t.p === undefined) continue;
        appendLine(file, {
          type: 'trade',
          ts: Number(t.T), // exchange trade time (ms)
          price: Number(t.p),
          size: Number(t.v), // linear BTCUSDT: v is already denominated in BTC
          side: t.S === 'Buy' ? 'buy' : 'sell', // taker (aggressor) side
          src: 'bybit', // feedDelayMs keys exchange trades by source, like binance/kraken
        });
        if (++count % 500 === 0) log.info(`${count} trades; last $${Number(t.p).toFixed(2)}`);
      }
    },
  });

  // Bybit recommends a heartbeat every ~20s or the server may drop the socket.
  const ping = setInterval(() => ws.send({ op: 'ping' }), 20_000);
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
