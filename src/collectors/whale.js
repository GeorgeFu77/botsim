// On-chain flow collector — polls mempool.space for the most-recent transactions
// and records a per-poll FLOW reading (total + largest BTC across the sample).
//
// HONEST LABEL: mempool.space `/recent` returns only the ~10 latest txs, so a fixed
// "50 BTC whale" filter would almost never fire. Instead we record on-chain movement
// pressure (sum + max of the sample) each poll — a dense, weak, noisy proxy for flow.
// It is NOT verified exchange in/out flow (that is paywalled). WhaleFlowTilt uses it
// only as a confirmation filter, never a lone trigger. READ-ONLY public API, no orders.

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { makeLogger } from '../util/log.js';

const log = makeLogger('whale');

async function fetchJSON(url, ms) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'botsim-whale/1.0' } });
    return r.ok ? await r.json() : null;
  } catch (e) {
    log.warn(`fetch: ${e.message}`);
    return null;
  }
}

export function startWhaleCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'whale', 'flow.jsonl');
  let polls = 0;

  async function poll() {
    const arr = await fetchJSON(config.whale.endpoint, config.whale.timeoutMs);
    if (!Array.isArray(arr) || !arr.length) return;
    const btc = arr.map((tx) => Number(tx.value) / 1e8).filter((v) => Number.isFinite(v));
    if (!btc.length) return;
    const flowBtc = btc.reduce((s, v) => s + v, 0);
    const maxBtc = Math.max(...btc);
    const recvTs = Date.now();
    appendLine(file, {
      type: 'whale', src: 'whale',
      flowBtc: Number(flowBtc.toFixed(4)),
      maxBtc: Number(maxBtc.toFixed(4)),
      txCount: btc.length,
      exchTs: recvTs, recvTs,
    });
    if (++polls % 20 === 0) log.info(`${polls} polls; last flow ${flowBtc.toFixed(2)} BTC (max tx ${maxBtc.toFixed(2)})`);
  }

  const t = setInterval(poll, config.whale.pollIntervalMs);
  t.unref?.();
  poll();
  log.ok('collector started ->', file);
  return { stop() { clearInterval(t); }, close() { clearInterval(t); } };
}
