// ============================================================================
// LIVE EXECUTOR — the ONLY file in BotSim allowed to even discuss real orders.
//
// STATUS: INERT SCAFFOLD. submitOrder() below is dry-run only: it logs and
// ledgers what it WOULD have done and performs NO network I/O. The real
// submission branch is intentionally absent until George completes the wallet
// setup in src/live/SETUP.md himself. No private key is read, stored, or
// expected anywhere in this file.
//
// Gate chain — every single one must pass, in order, per entry:
//   1. config.live.enabled        (stays false until setup is complete)
//   2. arm.json { armed: true }   (George's HUD button; click again = instant kill)
//   3. the entering bot IS the armed champion (family + exact params)
//   4. the champion hasn't changed since arming (else auto-disarm, re-arm required)
//   5. dollar caps: per-trade clamp, daily cap, total cap
// Anything failing = silent no-op for that entry. The kill click works within
// one engine tick: arm.json is re-read (cheap, cached 1s) on every entry.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { appendLine, ensureDir } from '../util/jsonl.js';
import { makeLogger } from '../util/log.js';
import { nameFor } from '../engine/strategies.js';

const log = makeLogger('live');

const LIVE_DIR = path.join(config.resultsDir, 'live');
const ARM = path.join(LIVE_DIR, 'arm.json');
const LEDGER = path.join(LIVE_DIR, 'ledger.jsonl');
const STATUS = path.join(LIVE_DIR, 'status.json');

export class LiveExecutor {
  constructor() {
    this.armCache = { t: 0, val: null };
    this.champCache = { t: 0, val: null };
    ensureDir(LIVE_DIR);
  }

  attach(sim) {
    sim.on('paperEntry', (e) => {
      try { this.onEntry(e); } catch (err) { log.error('entry handler', err.message); }
    });
    // Status heartbeat + champion-change watchdog even between entries.
    this.timer = setInterval(() => {
      try { this.checkChampion(); this.writeStatus(); } catch { /* keep running */ }
    }, 5000);
    this.timer.unref?.();
    this.writeStatus();
    log.ok(`live executor attached — SCAFFOLD (dry-run only), enabled=${!!config.live?.enabled}`);
    return this;
  }

  readArm() {
    if (Date.now() - this.armCache.t < 1000) return this.armCache.val;
    let val = null;
    try { val = JSON.parse(fs.readFileSync(ARM, 'utf8')); } catch { /* not armed yet */ }
    this.armCache = { t: Date.now(), val };
    return val;
  }

  disarm(note) {
    fs.writeFileSync(ARM, JSON.stringify({ armed: false, disarmedAt: Date.now(), note }, null, 2));
    this.armCache = { t: 0, val: null };
    log.warn(`DISARMED: ${note}`);
  }

  // The strategy the switch arms: the online bandit's confidence-gated pick if it
  // has one, else the newest evolution next-grid champion. (Same source the HUD
  // shows, so what you arm is what you see.)
  champion() {
    if (Date.now() - this.champCache.t < 5000) return this.champCache.val;
    let val = null;
    // 1. bandit pick (the learner's trusted strategy)
    try {
      const band = JSON.parse(fs.readFileSync(path.join(config.resultsDir, 'bandit', 'state.json'), 'utf8'));
      if (band?.pick?.family && band.pick.params && Object.keys(band.pick.params).length) {
        this.champCache = { t: Date.now(), val: { family: band.pick.family, params: band.pick.params } };
        return this.champCache.val;
      }
    } catch { /* no bandit state — fall back */ }
    // 2. evolution next-grid champion
    const evoDir = path.join(config.resultsDir, 'evolution');
    const gens = (() => {
      try { return fs.readdirSync(evoDir).filter((d) => /^gen\d+$/.test(d)).map((d) => Number(d.slice(3))).sort((a, b) => b - a); }
      catch { return []; }
    })();
    for (const g of gens) {
      try {
        const grid = JSON.parse(fs.readFileSync(path.join(evoDir, `gen${g}`, 'next-grid.json'), 'utf8'));
        if (Array.isArray(grid) && grid.length && grid[0].variants?.length) {
          val = { family: grid[0].family, params: grid[0].variants[0] };
          break;
        }
      } catch { /* try older gen */ }
    }
    this.champCache = { t: Date.now(), val };
    return val;
  }

  // Auto-disarm if the champion changed since arming — real money never silently
  // switches strategies; George must re-arm the new one himself.
  checkChampion() {
    const arm = this.readArm();
    if (!arm?.armed) return;
    const champ = this.champion();
    if (!champ || champ.family !== arm.family || JSON.stringify(champ.params) !== JSON.stringify(arm.params)) {
      this.disarm('champion changed since arming — click LIVE again to arm the new champion');
    }
  }

  spent() {
    let today = 0, total = 0, bad = 0;
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    try {
      for (const line of fs.readFileSync(LEDGER, 'utf8').trim().split('\n')) {
        if (!line) continue;
        let r; try { r = JSON.parse(line); } catch { bad++; continue; } // corrupt line = fail closed
        if (r.dryRun) continue; // only REAL submissions count against caps
        total += r.dollars || 0;
        if (r.ts >= dayStart.getTime()) today += r.dollars || 0;
      }
    } catch { /* no ledger yet */ }
    return { today, total, bad };
  }

  onEntry({ botName, family, slug, side, dollars }) {
    const live = config.live || {};
    const arm = this.readArm();
    if (!arm?.armed) return;                                   // gate 2 (checked first — cheapest)
    this.checkChampion();                                       // gate 4 (may disarm)
    if (!this.readArm()?.armed) return;
    const expected = nameFor(arm.family, arm.params);
    if (botName !== expected || family !== arm.family) return; // gate 3: only THE champion
    if (!live.enabled) {
      // Armed but setup incomplete: record the miss honestly so George sees what
      // the switch WOULD have done, then stop. Nothing leaves this machine.
      appendLine(LEDGER, { ts: Date.now(), dryRun: true, reason: 'inert: live.enabled=false', botName, slug, side, dollars: 0 });
      return;                                                   // gate 1
    }
    const caps = { per: live.maxPerTradeUSD ?? 10, daily: live.maxDailyUSD ?? 50, total: live.maxTotalUSD ?? 100 };
    const clamped = Math.min(dollars, caps.per);
    const { today, total, bad } = this.spent();
    if (bad) { this.disarm('ledger unreadable (corrupt line) — killed for safety'); return; } // fail closed
    if (today + clamped > caps.daily) { log.warn(`daily cap $${caps.daily} would be exceeded — skipping`); return; }
    if (total + clamped > caps.total) { this.disarm(`total cap $${caps.total} reached — killed`); return; }
    this.submitOrder({ ts: Date.now(), botName, slug, side, dollars: clamped });
  }

  // ---------------------------------------------------------------------------
  // SCAFFOLD SUBMIT — DRY-RUN ONLY. Performs no network I/O of any kind.
  // The real implementation (Polymarket CLOB client, order signing) is
  // deliberately NOT present. See src/live/SETUP.md for the exact steps George
  // must complete himself before this can ever place a real order.
  // ---------------------------------------------------------------------------
  submitOrder(order) {
    appendLine(LEDGER, { ...order, dryRun: true, reason: 'scaffold: real submission not implemented' });
    log.info(`[DRY-RUN] would place: ${order.side} $${order.dollars} on ${order.slug} (${order.botName})`);
  }

  writeStatus() {
    const arm = this.readArm();
    const champ = this.champion();
    const { today, total } = this.spent();
    const live = config.live || {};
    fs.writeFileSync(STATUS, JSON.stringify({
      scaffold: true, // flips only when a real submitOrder implementation exists
      configEnabled: !!live.enabled,
      armed: !!arm?.armed,
      armNote: arm?.note ?? null,
      family: arm?.family ?? null,
      champion: champ,
      caps: { perTrade: live.maxPerTradeUSD ?? 10, daily: live.maxDailyUSD ?? 50, total: live.maxTotalUSD ?? 100 },
      spent: { today, total },
      updatedAt: Date.now(),
    }, null, 2));
  }
}
