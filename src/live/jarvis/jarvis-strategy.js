// ============================================================================
// The Jarvis decider — a Bot-shaped strategy whose decide() calls the online
// model. It watches every tick of the window, and strikes at ITS moment: the
// tick where its own calibrated probability beats the ACTUAL cost of acting
// (ask price + slippage + the venue's winner-fee) by a real margin. Sizing is
// DERIVED, not guessed: fractional Kelly on that same edge, compounding on the
// variant's own cash. (Council ruling 2026-07-09: the confidence bar and bet
// size are arithmetic, not genes — evolution searches only what math can't
// derive.)
//
// One strategy instance per tree variant. `v` is the variant record from
// lineage.js — model is read through it on every call so a succession (trunk
// adopting a winner's brain) takes effect without rebuilding the bot.
//
// PAPER ONLY. Returns intents; the engine books hypothetical fills. It never
// imports the live executor and its family is never a champion candidate.
// ============================================================================

import { config } from '../../../config.js';
import { FEATURE_LABELS } from './features.js';

// v: { model, pending: Map<slug,{x,p,acted,side,entryMid}>, genome }
// io: { isCurrentWriter: () => boolean, current: { write(obj) } }
export function makeJarvis(v, io = {}) {
  const writeCurrent = (obj) => {
    if (io.current && (!io.isCurrentWriter || io.isCurrentWriter())) io.current.write(obj);
  };

  // Expected profit per $ staked buying side at executed price c, given P(win)=p.
  // The REAL bill (verified 2026-07-10): a taker fee of rate*(c*(1-c))^exp per
  // share on the fill itself — peaks at 50/50, vanishes at the extremes — and
  // NOTHING at settlement (winners redeem exactly $1). So the all-in cost per
  // share is c + fee(c), and the fee makes coin-flip entries the most expensive
  // real estate in the market.
  const slip = config.slippageTicks * config.tickSize;
  const feeCfg = config.takerFee || { rate: 0, exp: 1 };
  const feePerShare = (c) => feeCfg.rate * Math.pow(c * (1 - c), feeCfg.exp ?? 1);
  const edgePerDollar = (p, c) => {
    const unit = c + feePerShare(c); // all-in cost per share
    const b = (1 - unit) / unit; // net odds: profit per $ staked on a win
    return { ev: p * b - (1 - p), b, unit };
  };

  return {
    decide(ctx, bot) {
      const m = ctx.market;
      if (!m) return null;
      const slug = m.slug;
      const g = v.genome;

      // ---- exit management first (we already hold a position) ----
      const pos = bot.position(slug);
      if (pos && pos.side !== 'Both') {
        if (!g.exits) return null; // 'ride' genome: hold to resolution, always
        const curMid = pos.side === 'Up' ? m.up?.mid : m.down?.mid;
        if (curMid != null) {
          const entry = pos.entry ?? v.pending.get(slug)?.entryMid ?? curMid;
          if (curMid >= entry + g.tp) return { action: 'exit', reason: 'jarvis:tp' };
          if (curMid <= entry - g.stop) return { action: 'exit', reason: 'jarvis:stop' };
        }
        return null; // otherwise ride to resolution
      }
      if (pos) return null;

      // ---- entry: it watches EVERY tick and strikes when edge > friction ----
      if (bot.lastEnteredSlug === slug) return null; // engine burns the entry at submit
      if (v.pending.has(slug)) return null;          // already committed this window
      if (!m.fresh) return null;                     // never decide/learn on a stale book

      const x = v.fx.toVector(ctx);
      if (!x) return null;
      const pk = v.model.peek(x); // non-mutating: drives the live thinking + the timing choice

      // WHY: input-gradient attribution (∂p/∂x_i) — how much nudging this ONE
      // signal up would move the prediction right now, holding everything else
      // fixed. Honest for a nonlinear model: the hidden layer can combine
      // signals in ways no single number fully captures, but this is the
      // standard, real measure of "what's this input doing to the output".
      const evidence = [];
      for (let i = 0; i < x.length; i++) {
        evidence.push({ label: FEATURE_LABELS[i], c: Number(pk._grad[i].toFixed(3)), v: Number(x[i].toFixed(4)) });
      }
      evidence.sort((a, b) => Math.abs(b.c) - Math.abs(a.c));

      // Cost of acting RIGHT NOW on its favored side (ask + slippage), and the
      // real edge that cost leaves. This replaces the old fixed confidence bar.
      const sideUp = pk.p >= 0.5;
      const book = sideUp ? m.up : m.down;
      const ask = book?.bestAsk;
      if (ask == null) return null;
      const c = Math.min(0.999, ask + slip);
      const pSide = sideUp ? pk.p : 1 - pk.p;
      const { ev } = edgePerDollar(pSide, c);

      // ITS moment: strike when the edge clears its cushion, or commit a
      // prediction at the deadline (last ~9s) so it still learns every window.
      const itsMoment = ev >= g.minEdge || m.fracLeft <= g.deadlineFrac;
      if (!itsMoment) {
        writeCurrent({ slug, p: pk.p, side: pk.side, act: false, committed: false, conf: pk.conf, edge: Number(ev.toFixed(4)), fracLeft: m.fracLeft, at: ctx.nowMs, evidence: evidence.slice(0, 6) });
        return null; // not yet — it keeps watching
      }

      // commit: THE one official prediction for this window (mutates Welford once, stored for learning).
      const r = v.model.predict(x);
      const commitUp = r.side === 'UP';
      const cBook = commitUp ? m.up : m.down;
      const cAsk = cBook?.bestAsk != null ? Math.min(0.999, cBook.bestAsk + slip) : null;
      const pCommit = commitUp ? r.p : 1 - r.p;
      const side = commitUp ? 'Up' : 'Down';
      const mid = commitUp ? m.up.mid : 1 - m.up.mid;

      // DERIVED size: fractional Kelly on the committed edge, on ITS OWN cash.
      // f* = ev/b; we stake g.kelly of that, hard-capped at half the bankroll
      // so no single window can one-shot it. Negative edge => predict, don't bet.
      let dollars = 0;
      let minDollars = 1;
      if (cAsk != null) {
        const { ev: evC, b, unit } = edgePerDollar(pCommit, cAsk);
        if (evC > 0 && b > 0) {
          const cash = bot.account?.cash ?? config.startingCash;
          dollars = Math.min(g.kelly * (evC / b) * cash, 0.5 * cash);
          minDollars = (config.minOrderShares || 1) * unit; // venue minimum: 5 shares
        }
      }
      const willBet = v.model.n >= v.model.warmup && dollars >= minDollars; // warmup gates BETTING only; it learns every window
      v.pending.set(slug, { x, p: r.p, acted: willBet, side, entryMid: mid });
      writeCurrent({ slug, p: r.p, side: r.side, act: willBet, committed: true, conf: r.conf, edge: cAsk != null ? Number(edgePerDollar(pCommit, cAsk).ev.toFixed(4)) : null, fracLeft: m.fracLeft, at: ctx.nowMs, evidence: evidence.slice(0, 6), size: willBet ? Math.round(dollars) : 0 });
      return willBet ? { action: 'enter', side, dollars } : null;
    },
  };
}
