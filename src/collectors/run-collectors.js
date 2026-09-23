// Start all collectors as a standalone process (data collection only).
// `npm run collectors`  — useful if you want to record data without simulating.
// The full simulator (src/main.js) starts these automatically.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { ensureDir } from '../util/jsonl.js';
import { makeLogger } from '../util/log.js';
import { startKrakenCollector } from './kraken.js'; // binance.js kept for old recordings; endpoint unreachable from this network
import { startCoinbaseCollector } from './coinbase.js';
import { startBybitCollector } from './bybit.js';
import { startOkxCollector } from './okx.js';
import { startChainlinkCollector } from './chainlink.js';
import { startPolymarketCollector } from './polymarket.js';
import { startPolymarketTradesCollector } from './polymarket-trades.js';
import { startNewsCollector } from './news.js';
import { startWhaleCollector } from './whale.js';
import { startFngCollector } from './fng.js';

const log = makeLogger('collectors');

// Data self-trim: truncate every *.jsonl under dataDir to 0 bytes so multi-day
// runs don't eat the disk. The engine's Tailer explicitly survives truncation
// (see util/jsonl.js), so this is safe at startup and on the 24h timer.
function trimDataFiles(dataDir) {
  let n = 0;
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // dir missing — nothing to trim
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          fs.truncateSync(p, 0);
          n++;
        } catch {
          /* vanished mid-walk — skip */
        }
      }
    }
  })(dataDir);
  log.info(`data self-trim: truncated ${n} .jsonl file(s) under ${dataDir}`);
}

export function startAllCollectors(dataDir = config.dataDir) {
  ensureDir(dataDir);
  trimDataFiles(dataDir);
  const trimTimer = setInterval(() => trimDataFiles(dataDir), 24 * 60 * 60 * 1000);
  trimTimer.unref?.();
  const kraken = startKrakenCollector(dataDir);
  const coinbase = startCoinbaseCollector(dataDir);
  const bybit = startBybitCollector(dataDir);
  const okx = startOkxCollector(dataDir);
  const chainlink = startChainlinkCollector(dataDir); // the settlement oracle's price
  const polymarket = startPolymarketCollector(dataDir);
  const pmTape = startPolymarketTradesCollector(dataDir);
  // Information feeds (news / on-chain whale flow / fear-greed) — the bot's senses.
  const news = startNewsCollector(dataDir);
  const whale = startWhaleCollector(dataDir);
  const fng = startFngCollector(dataDir);
  return {
    stop() {
      clearInterval(trimTimer);
      kraken.close?.();
      coinbase.close?.();
      bybit.close?.();
      okx.close?.();
      chainlink.close?.();
      polymarket.stop?.();
      pmTape.stop?.();
      news.stop?.();
      whale.stop?.();
      fng.stop?.();
    },
  };
}

// Run directly?
if (import.meta.url === `file://${process.argv[1]}`) {
  log.ok('starting collectors (PAPER DATA ONLY — read-only feeds)');
  const c = startAllCollectors();
  process.on('SIGINT', () => {
    log.info('shutting down collectors');
    c.stop();
    process.exit(0);
  });
}
