// ============================================================================
// Lineage — Jarvis's tree of self-experiments (the evolution George designed,
// council-ratified 2026-07-09; deep branching added 2026-07-10).
//
// One trunk (THE Jarvis). EVERY variant carries its own queue of questions
// about itself and may spawn TWINS: an exact clone of its brain — weights,
// memories, statistics — with exactly ONE more setting changed. Twins having
// twins means combinations get tested (learn-faster AND bigger-brain), and
// each child is a matched-pair experiment against its own parent: both live
// the same live windows, shared luck cancels, the variable stands alone.
//
// THE CLIMBING RULE: beat your parent, take its place.
// - A child that loses to its parent beyond the luck band (|z| >= Z on
//   STRIKES_TO_ACT consecutive daily checks) gets a funeral; its children are
//   re-parented to the fallen one's parent and restart their measurement.
// - A child that WINS that same test SUPERSEDES its parent: the parent is
//   buried, the child (and its siblings) climb one rung and now measure
//   against the grandparent. A child of the TRUNK that wins is CROWNED: the
//   trunk adopts its brain and settings (gen +1) — the trunk itself is
//   immortal, so no verdict can destroy accumulated knowledge.
// - Buried questions re-queue on the survivor, so old ideas get re-tried when
//   the market's mood has changed.
//
// No population cap (George's call): no split is ever stopped for a slot.
// Births are paced (one per SPAWN_EVERY_MS, rotating fairly through the tree)
// so every newborn gets clean windows to differentiate.
//
// First SHADOW_DAYS the reaper runs in shadow: verdicts are logged to
// lineage.jsonl but never executed — so we can see whether the fitness signal
// ranks skill or luck before anyone dies for a coin flip.
//
// PAPER ONLY. Variants are paper deciders; nothing here can reach the executor.
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { OnlineMLP } from './online-mlp.js';
import { FeatureExtractor, DIM } from './features.js';
import { makeLogger } from '../../util/log.js';

// Tunables live here (not config.js) so the tree is self-contained.
export const LINEAGE_CFG = {
  MAX_POP: Infinity,     // no cap — George's call 2026-07-10: never stop a split for a slot
  SPAWN_EVERY_MS: 30 * 60_000,   // one birth per half hour, rotating through the tree
  CHECK_EVERY_MS: 24 * 3600_000, // the reaper's daily visit
  MIN_SAMPLE: 30,        // paired windows required before any verdict counts
  Z: 2,                  // the luck band: |z| must clear this
  STRIKES_TO_ACT: 3,     // consecutive out-of-band daily checks to bury/crown
  SHADOW_DAYS: 7,        // reaper logs but does not execute for the first week
  DIFFS_CAP: 5000,
};

// The question set — each entry changes exactly ONE thing about the parent it
// is asked of, so a deep branch accumulates combinations one step at a time.
// Sizing and the entry bar are NOT here: those are derived arithmetic
// (see jarvis-strategy.js), and math is not searched.
export const QUESTIONS = [
  { key: 'lr*2', desc: 'learn twice as fast', mut: (g) => ({ ...g, lr: g.lr * 2 }) },
  { key: 'lr/2', desc: 'learn half as fast', mut: (g) => ({ ...g, lr: g.lr / 2 }) },
  { key: 'hidden24', desc: 'a bigger brain (24 hidden units)', mut: (g) => ({ ...g, hidden: 24 }) },
  { key: 'hidden8', desc: 'a smaller brain (8 hidden units)', mut: (g) => ({ ...g, hidden: 8 }) },
  { key: 'l2*5', desc: 'forget faster (stronger decay)', mut: (g) => ({ ...g, l2: g.l2 * 5 }) },
  { key: 'l2/5', desc: 'remember longer (weaker decay)', mut: (g) => ({ ...g, l2: g.l2 / 5 }) },
  { key: 'ride', desc: 'never take profits early — ride every bet to settlement', mut: (g) => ({ ...g, exits: false }) },
  { key: 'wideExits', desc: 'wider take-profit/stop (0.20 / 0.15)', mut: (g) => ({ ...g, exits: true, tp: 0.20, stop: 0.15 }) },
  { key: 'picky', desc: 'demand twice the edge before betting', mut: (g) => ({ ...g, minEdge: g.minEdge * 2 }) },
  { key: 'loose', desc: 'accept half the edge cushion', mut: (g) => ({ ...g, minEdge: g.minEdge / 2 }) },
];
const QUESTION_KEYS = QUESTIONS.map((q) => q.key);

const FOUNDER_GENOME = {
  lr: 0.05, hidden: 12, l2: 1e-4, warmup: 10,
  tp: 0.10, stop: 0.08, exits: true,
  minEdge: 0.015, kelly: 0.25, deadlineFrac: 0.03,
};

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a, m) => Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1));
const genomesEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class Lineage {
  constructor({ dir }) {
    this.dir = dir; // results/jarvis
    this.log = makeLogger('lineage');
    this.popFile = path.join(dir, 'population.json');
    this.stateFile = path.join(dir, 'state.json'); // trunk mirror — the HUD's contract
    this.lineageFile = path.join(dir, 'lineage.jsonl');
    this.variants = [];
    this.byBotId = new Map();
    this.trunkId = 0;
    this.nextId = 1;
    this.gen = 1;
    this.shadowUntil = 0;
    this.lastCheckAt = 0;
    this.spawnCursor = 0; // rotates fairly through the tree; in-memory only
    this.sim = null;
    this.makeBot = null;
  }

  get trunk() { return this.variants.find((v) => v.id === this.trunkId); }
  byId(id) { return this.variants.find((v) => v.id === id); }
  childrenOf(id) { return this.variants.filter((v) => v.parentId === id); }

  event(obj) {
    const line = { ts: Date.now(), ...obj };
    try { fs.appendFileSync(this.lineageFile, JSON.stringify(line) + '\n'); } catch { /* best effort */ }
    this.log.info(`${obj.ev}: ${obj.name ?? ''} ${obj.note ?? ''}`);
  }

  _variant({ id, name, question, parentId, genome, model, bornAt, diffs, loseStrikes, winStrikes, queue, confirming }) {
    return {
      id, name, question: question ?? null, parentId: parentId ?? null,
      genome, model,
      queue: queue ?? [...QUESTION_KEYS], // every variant may have children of its own
      pending: new Map(), // slug -> committed prediction, consumed on settle
      windowPnl: new Map(), // slug -> realized P&L this window (paired-diff input)
      fx: new FeatureExtractor(),
      bornAt: bornAt ?? Date.now(),
      diffs: diffs ?? [], loseStrikes: loseStrikes ?? 0, winStrikes: winStrikes ?? 0,
      confirming: confirming ?? false, // won its 3 checks; must repeat on a FRESH block
      condemned: null, // 'funeral' | 'succession' | 'supersede', executed once flat
    };
  }

  // ---- boot -----------------------------------------------------------------
  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    const pop = this._readJson(this.popFile);
    if (pop && Array.isArray(pop.variants) && pop.variants.length) {
      this.trunkId = pop.trunkId; this.nextId = pop.nextId; this.gen = pop.gen ?? 1;
      this.shadowUntil = pop.shadowUntil ?? 0;
      this.lastCheckAt = pop.lastCheckAt ?? 0;
      this.variants = pop.variants.map((s) => this._variant({
        ...s,
        model: s.model.d < DIM ? OnlineMLP.migrate(s.model, DIM) : OnlineMLP.fromJSON(s.model),
      }));
      // v1 saves had one global queue (it was the trunk's) — hand it back to the trunk.
      if (Array.isArray(pop.queue) && this.trunk) this.trunk.queue = pop.queue;
      this.event({ ev: 'boot', note: `resumed tree: pop=${this.variants.length} gen=${this.gen} trunk=${this.trunk?.name}` });
      return;
    }

    // Legacy single-Jarvis state (pre-tree) — graft it: the founder keeps
    // everything it has learned, widened to the new senses.
    const legacy = this._readJson(this.stateFile);
    let model;
    if (legacy && legacy.W1) {
      try { fs.copyFileSync(this.stateFile, path.join(this.dir, 'state.pre-tree.json')); } catch { /* keep going */ }
      model = OnlineMLP.migrate(legacy, DIM);
      this.event({ ev: 'boot', note: `grafted legacy Jarvis (d=${legacy.d}->${DIM}, n=${legacy.n}, seen=${legacy.seen}) as trunk J0` });
    } else {
      model = new OnlineMLP(DIM, { hidden: FOUNDER_GENOME.hidden, lr: FOUNDER_GENOME.lr, l2: FOUNDER_GENOME.l2, warmup: FOUNDER_GENOME.warmup });
      this.event({ ev: 'boot', note: 'fresh tree: founder J0 born with a blank brain' });
    }
    this.trunkId = 0; this.nextId = 1;
    this.variants = [this._variant({ id: 0, name: 'J0', genome: { ...FOUNDER_GENOME }, model })];
    this.shadowUntil = Date.now() + LINEAGE_CFG.SHADOW_DAYS * 86400_000;
    this.event({ ev: 'shadow', note: `reaper in shadow mode until ${new Date(this.shadowUntil).toISOString()}` });
    this.persist();
  }

  _readJson(f) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
  }

  // main.js hands us the live sim + the bot factory once, at boot.
  init(sim, makeBot) {
    this.sim = sim;
    this.makeBot = makeBot;
    for (const bot of sim.bots) this.byBotId.set(bot.id, this.variants.find((v) => v.id === bot.id));
  }

  startTimers() {
    const spawn = setInterval(() => this.spawnNext(), LINEAGE_CFG.SPAWN_EVERY_MS);
    spawn.unref?.();
    const check = setInterval(() => this.dailyCheck(), LINEAGE_CFG.CHECK_EVERY_MS);
    check.unref?.();
    // A restart must not skip the reaper's visit forever.
    if (Date.now() - this.lastCheckAt > LINEAGE_CFG.CHECK_EVERY_MS) {
      setTimeout(() => this.dailyCheck(), 5 * 60_000).unref?.();
    }
    // First birth doesn't wait half an hour.
    setTimeout(() => this.spawnNext(), 60_000).unref?.();
  }

  // ---- births ----------------------------------------------------------------
  // One birth per call, rotating fairly through the tree: every variant with an
  // open question gets its turn — twins having twins, combinations compounding.
  spawnNext() {
    if (!this.sim || this.variants.length >= LINEAGE_CFG.MAX_POP) return;
    const n = this.variants.length;
    for (let step = 0; step < n; step++) {
      const idx = (this.spawnCursor + step) % n;
      const parent = this.variants[idx];
      if (parent.condemned) continue;
      // Skip questions that would change nothing about THIS parent (e.g. asking
      // 'hidden24' of a parent already running 24 hidden units).
      while (parent.queue.length) {
        const key = parent.queue.shift();
        const q = QUESTIONS.find((x) => x.key === key);
        if (!q) continue;
        const genome = q.mut(parent.genome);
        if (genomesEqual(genome, parent.genome)) continue; // no-op question for this parent — drop it
        const model = parent.model.clone();
        if (genome.hidden !== parent.model.h) model.resizeHidden(genome.hidden);
        model.lr = genome.lr; model.l2 = genome.l2; // the model carries its own lr/l2
        const id = this.nextId++;
        const v = this._variant({ id, name: `J${id}:${key}`, question: key, parentId: parent.id, genome, model });
        this.variants.push(v);
        const bot = this.makeBot(v);
        this.sim.bots.push(bot);
        this.byBotId.set(bot.id, v);
        // Round-robin over the population as it was BEFORE this birth: everyone
        // alive gets a turn per lap; newborns join the rotation on the next lap.
        this.spawnCursor = (idx + 1) % n;
        this.event({ ev: 'birth', name: v.name, note: `testing "${q.desc}" vs ${parent.name} · pop=${this.variants.length}` });
        this.persist(true);
        return;
      }
    }
  }

  // ---- the paired experiment bookkeeping --------------------------------------
  onTradeClosed(bot, trade) {
    const v = this.byBotId.get(bot.id);
    if (!v) return;
    v.windowPnl.set(trade.slug, (v.windowPnl.get(trade.slug) ?? 0) + trade.pnl);
    if (v.id === this.trunkId) { // dedicated small log for the HUD's 24h P&L
      try {
        fs.appendFileSync(path.join(this.dir, 'trades.jsonl'),
          JSON.stringify({ pnl: trade.pnl, closedAt: trade.closedAt || Date.now(), reason: trade.reason, side: trade.side }) + '\n');
      } catch { /* best effort */ }
    }
  }

  onResolved(res) {
    const y = res.outcome === 'Up' ? 1 : 0;

    // 1) EVERY variant learns from the settled window it committed on — even
    //    the ones that chose not to bet (the label is free).
    for (const v of this.variants) {
      const rec = v.pending.get(res.slug);
      if (!rec) continue;
      v.model.update(rec.x, y);
      if (rec.acted) {
        v.model.acted++;
        if ((rec.side === 'Up' ? 1 : 0) === y) v.model.wins++;
        v.model.history.push(Number((v.model.wins / v.model.acted).toFixed(4)));
        if (v.model.history.length > 500) v.model.history.shift();
      }
      if (v.id === this.trunkId) {
        try {
          fs.appendFileSync(path.join(this.dir, 'training.jsonl'), JSON.stringify({
            slug: res.slug, outcome: res.outcome, y, p: rec.p, acted: rec.acted,
            side: rec.side, x: Array.from(rec.x), ts: Date.now(),
          }) + '\n');
        } catch { /* audit tape best-effort */ }
      }
      v.pending.delete(res.slug);
    }

    // 2) Matched-pair diffs: each child's window P&L minus ITS PARENT's, same
    //    window. Compute all diffs first (parents' numbers must survive until
    //    every child has read them), then clear. Windows where neither of a
    //    pair played carry no information and are skipped for that pair.
    for (const v of this.variants) {
      if (v.id === this.trunkId) continue;
      const control = this.byId(v.parentId);
      if (!control) continue;
      const mine = v.windowPnl.get(res.slug) ?? 0;
      const theirs = control.windowPnl.get(res.slug) ?? 0;
      if (mine !== 0 || theirs !== 0) {
        v.diffs.push(Number((mine - theirs).toFixed(4)));
        if (v.diffs.length > LINEAGE_CFG.DIFFS_CAP) v.diffs.shift();
      }
    }
    for (const v of this.variants) v.windowPnl.delete(res.slug);

    // 3) Execute any verdicts that were waiting for the bots involved to go flat.
    this._executeCondemned();

    // 4) Model + tree survive restarts.
    this.persist();
  }

  // ---- the reaper --------------------------------------------------------------
  dailyCheck() {
    this.lastCheckAt = Date.now();
    const shadow = Date.now() < this.shadowUntil;
    for (const v of this.variants) {
      if (v.id === this.trunkId || v.condemned) continue;
      const n = v.diffs.length;
      if (n < LINEAGE_CFG.MIN_SAMPLE) {
        this.event({ ev: 'verdict', name: v.name, note: `insufficient sample (${n}/${LINEAGE_CFG.MIN_SAMPLE})`, n, shadow });
        continue;
      }
      const m = mean(v.diffs);
      const s = sd(v.diffs, m) || 1e-9;
      const z = m / (s / Math.sqrt(n));

      // Confirmation stage: it already won 3 straight checks, then had its
      // evidence wiped — this fresh, out-of-sample block is the one that counts.
      // Guards against crowning a twin that got lucky across many experiments.
      if (v.confirming) {
        const pass = z >= LINEAGE_CFG.Z;
        this.event({ ev: pass ? 'confirm-pass' : 'confirm-failed', name: v.name, z: Number(z.toFixed(2)), n, shadow });
        if (pass) {
          const crown = v.parentId === this.trunkId;
          if (shadow) this.event({ ev: crown ? 'would-crown' : 'would-supersede', name: v.name, note: 'confirmed on fresh block — shadow mode, not executed' });
          else { v.condemned = crown ? 'succession' : 'supersede'; this.event({ ev: 'condemned', name: v.name, note: `${v.condemned} once flat (confirmed on fresh block)` }); }
        }
        v.confirming = false; v.loseStrikes = 0; v.winStrikes = 0;
        continue;
      }

      if (z <= -LINEAGE_CFG.Z) { v.loseStrikes++; v.winStrikes = 0; }
      else if (z >= LINEAGE_CFG.Z) { v.winStrikes++; v.loseStrikes = 0; }
      else { v.loseStrikes = 0; v.winStrikes = 0; }
      this.event({
        ev: 'verdict', name: v.name, vs: this.byId(v.parentId)?.name, z: Number(z.toFixed(2)), n,
        meanDiff: Number(m.toFixed(4)), strikes: { lose: v.loseStrikes, win: v.winStrikes }, shadow,
      });
      if (v.loseStrikes >= LINEAGE_CFG.STRIKES_TO_ACT) {
        if (shadow) this.event({ ev: 'would-kill', name: v.name, note: 'shadow mode — no funeral executed' });
        else { v.condemned = 'funeral'; this.event({ ev: 'condemned', name: v.name, note: 'funeral once flat' }); }
      } else if (v.winStrikes >= LINEAGE_CFG.STRIKES_TO_ACT) {
        // Winning 3 checks doesn't crown you — it earns a retrial on fresh evidence.
        v.confirming = true; v.diffs = []; v.winStrikes = 0;
        this.event({ ev: 'confirm-start', name: v.name, note: 'won 3 checks — must repeat on a fresh block before adoption' });
      }
    }
    this._executeCondemned();
    this.persist(true);
  }

  _botFor(v) { return this.sim?.bots.find((b) => b.id === v.id) ?? null; }
  _isFlat(v) {
    const bot = this._botFor(v);
    return !bot || bot.account.positions.size === 0;
  }

  _executeCondemned() {
    for (const v of [...this.variants]) {
      if (!v.condemned || !this.byId(v.id)) continue; // may have been removed this pass
      if (!this._isFlat(v)) continue;
      if (v.condemned === 'funeral') { this._funeral(v); continue; }
      // succession/supersede also bury the parent — it must be flat too.
      const parent = this.byId(v.parentId);
      if (!parent) { v.condemned = null; continue; } // tree changed under the verdict — stale, drop it
      if (v.condemned === 'supersede' && !this._isFlat(parent)) continue;
      if (v.condemned === 'succession') this._succession(v);
      else this._supersede(v);
    }
  }

  _removeVariant(v) {
    const i = this.sim.bots.findIndex((b) => b.id === v.id);
    if (i >= 0) this.sim.bots.splice(i, 1);
    this.byBotId.delete(v.id);
    this.variants = this.variants.filter((x) => x.id !== v.id);
  }

  // Re-point a variant at a new control arm and restart its measurement — any
  // verdict-in-progress against the old parent is stale evidence.
  _reparent(v, newParentId, why) {
    v.parentId = newParentId;
    v.diffs = []; v.loseStrikes = 0; v.winStrikes = 0; v.condemned = null; v.confirming = false;
    this.event({ ev: 'reparent', name: v.name, note: `now measured vs ${this.byId(newParentId)?.name} (${why})` });
  }

  _funeral(v) {
    const parent = this.byId(v.parentId);
    for (const child of this.childrenOf(v.id)) this._reparent(child, v.parentId, `parent ${v.name} buried`);
    this._removeVariant(v);
    (parent ?? this.trunk).queue.push(v.question); // dead ideas get re-tried when the mood changes
    this.event({ ev: 'funeral', name: v.name, note: `"${v.question}" lost to ${parent?.name} · re-queued · pop=${this.variants.length}` });
  }

  // A child of the trunk proved better: the trunk adopts its brain and settings.
  _succession(v) {
    const trunk = this.trunk;
    trunk.model = v.model; // the trunk adopts the winner's brain, memories and all
    trunk.genome = { ...v.genome };
    this.gen++;
    // The winner's own children lose their control arm — but the trunk now IS
    // their parent's brain, continuing live. Measure them against it.
    for (const child of this.childrenOf(v.id)) this._reparent(child, this.trunkId, `parent ${v.name} crowned into trunk`);
    this._removeVariant(v);
    trunk.queue.push(v.question);
    // The trunk changed, so every experiment measured AGAINST the trunk restarts.
    for (const o of this.childrenOf(this.trunkId)) {
      o.diffs = []; o.loseStrikes = 0; o.winStrikes = 0; o.condemned = null; o.confirming = false;
    }
    this.event({ ev: 'succession', name: v.name, note: `"${v.question}" PROVEN vs trunk — trunk is now gen ${this.gen}; its experiments reset` });
  }

  // A deep child proved better than its (non-trunk) parent: bury the parent,
  // the child and its siblings climb one rung toward the trunk.
  _supersede(v) {
    const parent = this.byId(v.parentId);
    const grandId = parent.parentId ?? this.trunkId;
    for (const sibling of this.childrenOf(parent.id)) {
      if (sibling.id === v.id) continue;
      this._reparent(sibling, grandId, `parent ${parent.name} superseded by ${v.name}`);
    }
    this._removeVariant(parent);
    this._reparent(v, grandId, `climbed past ${parent.name}`);
    // The fallen parent's open questions go to the survivor that beat it; its
    // own question returns to the grandparent for a later re-test.
    v.queue.push(...parent.queue.filter((k) => !v.queue.includes(k)));
    (this.byId(grandId) ?? this.trunk).queue.push(parent.question);
    this.event({ ev: 'supersede', name: v.name, note: `beat ${parent.name} — climbs to face ${this.byId(grandId)?.name} · pop=${this.variants.length}` });
  }

  // ---- persistence ---------------------------------------------------------------
  // The full population snapshot is heavy once the tree is big (every variant's
  // whole brain). Throttle it as the population grows — pop<40 persists every
  // settle exactly as before; bigger trees persist proportionally less often.
  // Structural events (births/funerals/crowns) always force a full write, and
  // the trunk's state.json mirror stays fresh on every call for the HUD.
  persist(force = false) {
    this._skip = (this._skip ?? 0) + 1;
    const every = Math.max(1, Math.floor(this.variants.length / 40));
    if (!force && this._skip < every) {
      try {
        const tmp = this.stateFile + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.trunk.model.toJSON()));
        fs.renameSync(tmp, this.stateFile);
      } catch (e) { this.log.warn('persist state', e.message); }
      return;
    }
    this._skip = 0;
    this._persistFull();
  }

  _persistFull() {
    const state = {
      v: 2, savedAt: Date.now(), gen: this.gen, nextId: this.nextId,
      trunkId: this.trunkId,
      shadowUntil: this.shadowUntil, lastCheckAt: this.lastCheckAt,
      variants: this.variants.map((v) => ({
        id: v.id, name: v.name, question: v.question, parentId: v.parentId,
        genome: v.genome, bornAt: v.bornAt, diffs: v.diffs, queue: v.queue,
        loseStrikes: v.loseStrikes, winStrikes: v.winStrikes, confirming: v.confirming,
        model: v.model.toJSON(),
      })),
    };
    try {
      const tmp = this.popFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, this.popFile);
    } catch (e) { this.log.warn('persist population', e.message); }
    try {
      // The HUD's contract: state.json is always the trunk's brain.
      const tmp = this.stateFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.trunk.model.toJSON()));
      fs.renameSync(tmp, this.stateFile);
    } catch (e) { this.log.warn('persist state', e.message); }
  }
}
