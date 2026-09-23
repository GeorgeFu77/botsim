// Binance BTCUSDT trade collector.
// Writes one JSONL record per trade to data/binance/trades.jsonl.
// READ-ONLY public market data. No auth, no orders.

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { ReconnectingWS } from '../util/ws.js';
import { makeLogger } from '../util/log.js';

const log = makeLogger('binance');

export function startBinanceCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'binance', 'trades.jsonl');
  let count = 0;

  const ws = new ReconnectingWS({
    name: 'binance',
    urls: [config.binance.wsUrl, config.binance.wsUrlFallback],
    staleMs: 30_000,
    onMessage: (data) => {
      let m;
      try {
        m = JSON.parse(data);
      } catch {
        return;
      }
      // Trade stream payload: { e:'trade', T:<tradeTimeMs>, p:<price>, q:<qty>, ... }
      if (m.e !== 'trade' || m.p === undefined) return;
      const recvTs = Date.now();
      appendLine(file, {
        src: 'binance',
        sym: 'BTCUSDT',
        price: Number(m.p),
        qty: Number(m.q),
        side: m.m ? 'sell' : 'buy', // m = buyer-is-maker, so the AGGRESSOR sold
        exchTs: Number(m.T), // exchange trade time (ms)
        recvTs, // when WE received it (ms) — delay = recvTs - exchTs
      });
      if (++count % 500 === 0) log.info(`${count} trades; last $${Number(m.p).toFixed(2)}`);
    },
  });

  ws.start();
  log.ok('collector started ->', file);
  return ws;
}
