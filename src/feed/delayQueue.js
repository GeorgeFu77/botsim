// Delay-gated feed buffer — the heart of the "delay of when the data comes in".
//
// Every record carries recvTs (when our collector got it). We hold it here until
// now >= recvTs + feedDelayMs[source], so bots act on data that is deliberately
// stale. Fills then execute against the freshest book, reproducing the adverse
// selection a slow participant actually experiences.

import { config } from '../../config.js';

function delayFor(rec) {
  const d = config.feedDelayMs;
  if (rec.type && d[rec.type] != null) return d[rec.type]; // market / resolution
  if (rec.src && d[rec.src] != null) return d[rec.src]; // binance / coinbase / polymarket
  return d.default;
}

export class DelayQueue {
  constructor() {
    this.pending = []; // [{ visibleAt, source, rec }]
  }

  push(source, rec) {
    const base = Number(rec.recvTs) || Date.now();
    this.pending.push({ visibleAt: base + delayFor(rec), source, rec });
  }

  // Return all records now visible (sorted oldest-first) and remove them.
  drainDue(now) {
    if (!this.pending.length) return [];
    const due = [];
    const keep = [];
    for (const item of this.pending) {
      if (item.visibleAt <= now) due.push(item);
      else keep.push(item);
    }
    this.pending = keep;
    due.sort((a, b) => a.visibleAt - b.visibleAt);
    return due;
  }

  get size() {
    return this.pending.length;
  }
}
