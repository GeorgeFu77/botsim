// Crypto Fear & Greed index collector — polls alternative.me and records a new
// row only when the value changes (the index updates ~daily). data/fng/.
//
// READ-ONLY public API, no key, no orders. This is the single strongest of the
// three sentiment feeds, but it moves DAILY — so on a 5-min market it behaves as a
// slow regime tilt, not a per-window signal. FearGreedFade gates on that honestly.

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { makeLogger } from '../util/log.js';

const log = makeLogger('fng');

async function fetchJSON(url, ms) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'botsim-fng/1.0' } });
    return r.ok ? await r.json() : null;
  } catch (e) {
    log.warn(`fetch: ${e.message}`);
    return null;
  }
}

export function startFngCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'fng', 'index.jsonl');
  let lastVal = null;

  async function poll() {
    const d = await fetchJSON(config.fng.endpoint, config.fng.timeoutMs);
    const cur = d?.data?.[0];
    if (!cur) return;
    const value = Number(cur.value);
    if (!Number.isFinite(value) || value === lastVal) return;
    lastVal = value;
    const recvTs = Date.now();
    appendLine(file, {
      type: 'fng', src: 'fng',
      value, classification: cur.value_classification,
      exchTs: cur.timestamp ? Number(cur.timestamp) * 1000 : recvTs, recvTs,
    });
    log.info(`FNG=${value} (${cur.value_classification})`);
  }

  const t = setInterval(poll, config.fng.pollIntervalMs);
  t.unref?.();
  poll();
  log.ok('collector started ->', file);
  return { stop() { clearInterval(t); }, close() { clearInterval(t); } };
}
