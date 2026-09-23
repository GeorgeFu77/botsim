// The simulation engine.
// Flow each tick: release delayed data -> settle resolutions -> mark positions ->
// run every bot against the active market -> emit events for the leaderboard.
//
// PAPER ONLY. The engine never contacts any exchange — it only reads the local
// market state the collectors built, and books hypothetical fills.

import { EventEmitter } from 'node:events';
import { config } from '../../config.js';
import { clamp } from './strategy.js';
import { DelayQueue } from '../feed/delayQueue.js';
import { buyForDollars, sellShares } from './fillModel.js';
import { makeLogger } from '../util/log.js';

// Polymarket taker fee (verified 2026-07-10): rate * (p*(1-p))^exp * shares,
// on every taker fill. The venue floors at 5 decimals; we ceil, so the paper
// sim is never kinder than the real thing.
export function takerFeeUsd(price, shares) {
  const f = config.takerFee;
  if (!f?.rate || shares <= 0) return 0;
  const raw = f.rate * Math.pow(price * (1 - price), f.exp ?? 1) * shares;
  return Math.ceil(raw * 1e5) / 1e5;
}
// Worst-case fee headroom multiplier (p=0.5): keeps cash clamps from overdrafting.
const FEE_HEADROOM = 1 + (0.07 * 0.25) / 0.5;

export class Simulator extends EventEmitter {
  // `clock` returns "now" in ms. Live mode uses the wall clock; replay injects a
  // virtual clock so a recorded dataset can be driven through at any speed.
  constructor({ bots, marketState, clock }) {
    super();
    this.bots = bots;
    this.ms = marketState;
    this.clock = clock || (() => Date.now());
    this.dq = new DelayQueue();
    this.log = makeLogger('engine');
    this.startedAt = this.clock();
    this.resolvedCount = 0;
    this.tradeCount = 0;
    this.timer = null;
    // Orders in transit: submitted by a bot, not yet at the venue. They fill
    // against the book as it is on ARRIVAL (now + orderLatencyMs), or cancel if
    // the window closed in flight. This is the gap between paper and real.
    this.pending = [];
  }

  // Called by the tailer for every newly-appended data row.
  ingest(source, rec) {
    this.dq.push(source, rec);
  }

  start() {
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch (e) {
        this.log.error('tick failed', e.message);
      }
    }, config.engineTickMs);
    // Bound memory overnight: drop state for long-finished windows.
    this.pruneTimer = setInterval(() => this.ms.prune(Math.floor(this.clock() / 1000)), 60_000);
    this.pruneTimer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
  }

  tick() {
    const now = this.clock();
    const nowS = Math.floor(now / 1000);

    // 1) Release delay-gated data into the visible market state.
    for (const item of this.dq.drainDue(now)) this.ms.apply(item.source, item.rec);

    // 2) Settle any newly-resolved windows.
    for (const res of this.ms.takeNewResolutions()) this._settle(res);

    // 2.5) Orders whose transit latency elapsed reach the venue and fill now.
    if (this.pending.length) {
      const due = [];
      const rest = [];
      for (const o of this.pending) (o.dueAt <= now ? due : rest).push(o);
      this.pending = rest;
      for (const o of due) this._fillOrder(o, now);
    }

    // 3) Active window + capture its opening BTC reference (a strategy signal).
    const market = this.ms.activeMarket(nowS);
    const btc = this.ms.btcPrice();
    if (market && btc != null && !this.ms.openBtc.has(market.slug)) {
      this.ms.openBtc.set(market.slug, btc);
    }
    // Capture the JUDGE's price at window open too (Chainlink settles these markets).
    if (market && this.ms.cl?.price != null && !this.ms.openCl.has(market.slug)) {
      this.ms.openCl.set(market.slug, this.ms.cl.price);
    }

    // 4) Mark every open position to the current best bid.
    this._markPositions();

    // 5) Run all bots against the active market.
    if (market) {
      const ctx = this._buildContext(market, btc, now, nowS);
      for (const bot of this.bots) this._runBot(bot, ctx);
    }

    // 6) Heartbeat for the live dashboard.
    this.emit('tick');
  }

  _markPositions() {
    // Mark to MID (fair value). Realized PnL still uses the bid via the fill
    // model, so the spread cost is captured when a trade actually closes — we
    // just don't charge the full spread against every open position on entry.
    for (const bot of this.bots) {
      for (const pos of bot.account.positions.values()) {
        if (pos.side === 'Both') {
          pos.lastMark = 1; // dutch-book pair: locked $1 payoff
          continue;
        }
        const book = this.ms.bookFor(pos.slug, pos.side);
        if (book) pos.lastMark = book.mid ?? book.bestBid ?? pos.entry;
      }
    }
  }

  _buildContext(market, btc, now, nowS) {
    const openBtc = this.ms.openBtc.get(market.slug) ?? btc;
    const period = config.polymarket.periodSeconds;
    const secondsLeft = market.periodEnd - nowS;
    const secondsElapsed = nowS - market.periodStart;
    const up = this._normBook(market.slug, 'Up', now);
    const down = this._normBook(market.slug, 'Down', now);
    const fresh =
      !!up && !!down &&
      up.bestAsk != null && down.bestAsk != null &&
      up.ageMs <= config.staleBookMs && down.ageMs <= config.staleBookMs;
    const btcMove = btc != null && openBtc != null ? btc - openBtc : 0;
    return {
      nowMs: now,
      nowSec: nowS,
      btc: {
        price: btc,
        binance: this.ms.btc.binance?.price ?? null,
        coinbase: this.ms.btc.coinbase?.price ?? null,
        spread: this.ms.btcSpread(),
      },
      market: {
        slug: market.slug,
        periodStart: market.periodStart,
        periodEnd: market.periodEnd,
        secondsLeft,
        secondsElapsed,
        fracElapsed: clamp(secondsElapsed / period, 0, 1),
        fracLeft: clamp(secondsLeft / period, 0, 1),
        openBtc,
        btcMove,
        btcRet: openBtc ? btcMove / openBtc : 0,
        up,
        down,
        fresh,
      },
      // Information signals (null when the feed is absent). Forward-filled with an
      // ageMs stamp; strategies that ignore these behave identically to before.
      news: this.ms.newsSignal(now),
      whale: this.ms.whaleSignal(now),
      fng: this.ms.fngSignal(now),
      // Trade-tape senses (null when a feed is absent — extractors treat null as 0).
      flow: this.ms.flowSignal(now),
      pmflow: this.ms.pmFlowSignal(market.slug, now),
      streak: this.ms.streakSignal(),
      cl: this.ms.clSignal(market.slug, now), // the judge's price (Chainlink)
    };
  }

  _normBook(slug, outcome, now) {
    const b = this.ms.bookFor(slug, outcome);
    if (!b) return null;
    return { bestBid: b.bestBid, bestAsk: b.bestAsk, mid: b.mid, bids: b.bids, asks: b.asks, ageMs: now - b.recvTs };
  }

  _runBot(bot, ctx) {
    let intent;
    try {
      intent = bot.decide(ctx);
    } catch {
      return; // a misbehaving strategy must never crash the engine
    }
    if (!intent) return;
    const slug = ctx.market.slug;
    const now = ctx.nowMs;
    const latency = config.orderLatencyMs || 0;

    if (intent.action === 'exit') {
      if (!bot.position(slug)) return;
      const order = { kind: 'exit', bot, slug, reason: intent.reason, periodEnd: ctx.market.periodEnd };
      if (!latency) return this._fillOrder(order, now);
      // One in-flight exit per position — strategies re-emit intent every tick.
      if (this.pending.some((o) => o.kind === 'exit' && o.bot === bot && o.slug === slug)) return;
      this.pending.push({ ...order, dueAt: now + latency });
      return;
    }

    if (intent.action === 'enter') {
      if (bot.position(slug)) return; // already holding in this market
      if (bot.lastEnteredSlug === slug) return; // one entry per window — no spread churn
      const side = intent.side;
      if (side !== 'Up' && side !== 'Down' && side !== 'Both') return;
      // The window is spent at SUBMIT time: a canceled in-flight order still
      // consumed the bot's one shot, like a real missed fill.
      bot.lastEnteredSlug = slug;
      const order = {
        kind: 'enter', bot, slug, side,
        dollars: intent.dollars ?? bot.positionSize,
        periodEnd: ctx.market.periodEnd,
      };
      if (!latency) return this._fillOrder(order, now);
      this.pending.push({ ...order, dueAt: now + latency });
    }
  }

  // Execute an order against the book as it exists NOW. Under latency, "now" is
  // arrival time — the market may have moved, closed, or resolved in transit.
  _fillOrder(o, now) {
    const { bot, slug } = o;
    if (this.ms.resolutions.has(slug)) return; // resolved in flight — order dies
    if (o.periodEnd && Math.floor(now / 1000) >= o.periodEnd) return; // window closed

    if (o.kind === 'exit') {
      const pos = bot.position(slug);
      if (!pos) return; // already settled/closed
      const book = this.ms.bookFor(slug, pos.side);
      // Symmetry with entries: never fill an exit against a stale book (would
      // book a phantom price). Hold to resolution instead.
      if (!book || book.bestBid == null) return;
      if (now - book.recvTs > config.staleBookMs) return;
      const fill = sellShares(book, pos.shares);
      if (!fill) return; // no bid to hit — hold to resolution
      // Early exits are taker fills too: the fee is paid AGAIN, at this price.
      const trade = bot.account.exit(slug, fill.shares, fill.avgPrice, o.reason || 'exit', {
        feeUsd: takerFeeUsd(fill.avgPrice, fill.shares),
      });
      if (trade) this._onTradeClosed(bot, trade);
      return;
    }

    // Entries.
    if (bot.position(slug)) return;

    // Dutch-book arb: buy one Up + one Down share when their asks sum < $1, for
    // a locked $1/pair payoff regardless of outcome. Direction-neutral. The arb
    // is re-checked on arrival — it can evaporate while the order is in transit.
    if (o.side === 'Both') {
      const up = this.ms.bookFor(slug, 'Up');
      const down = this.ms.bookFor(slug, 'Down');
      if (!up?.asks?.length || !down?.asks?.length) return;
      const slip = config.slippageTicks * config.tickSize;
      const upPx = Math.min(0.999, up.asks[0].price + slip);
      const downPx = Math.min(0.999, down.asks[0].price + slip);
      const pairPx = upPx + downPx;
      // Both legs are taker fills — the pair only locks profit if it clears BOTH fees.
      const pairFeePerShare = takerFeeUsd(upPx, 1) + takerFeeUsd(downPx, 1);
      if (pairPx + pairFeePerShare >= 1) return; // no locked profit once slippage + fees are paid
      // Cash clamp leaves headroom for the taker fees so entries can't overdraft.
      const budget = Math.min(o.dollars, bot.maxRiskPerMarket, bot.account.cash / FEE_HEADROOM);
      const shares = Math.min(up.asks[0].size, down.asks[0].size, budget / pairPx);
      if (shares < (config.minOrderShares || 1)) return;
      bot.account.enter(slug, 'Both', shares, pairPx, {
        feeUsd: takerFeeUsd(upPx, shares) + takerFeeUsd(downPx, shares),
        periodEnd: o.periodEnd,
        openedAt: now,
      });
      this.emit('paperEntry', { botName: bot.name, family: bot.family, slug, side: 'Both', dollars: shares * pairPx });
      return;
    }

    // Clamp size by max risk per market (= cost basis cap) and available cash,
    // with headroom for the taker fee so entries can't overdraft.
    const dollars = Math.min(o.dollars, bot.maxRiskPerMarket, bot.account.cash / FEE_HEADROOM);
    if (dollars < 1) return;
    const book = this.ms.bookFor(slug, o.side);
    if (!book || now - book.recvTs > config.staleBookMs) return;
    const fill = buyForDollars(book, dollars);
    if (!fill || fill.shares <= 0) return;
    if (fill.shares < (config.minOrderShares || 1)) return; // venue minimum order size
    bot.account.enter(slug, o.side, fill.shares, fill.avgPrice, {
      feeUsd: takerFeeUsd(fill.avgPrice, fill.shares),
      periodEnd: o.periodEnd,
      openedAt: now,
    });
    // Announce every booked paper entry; the live executor (attached only by
    // main.js, never by replay) mirrors the armed champion's entries.
    this.emit('paperEntry', { botName: bot.name, family: bot.family, slug, side: o.side, dollars: fill.shares * fill.avgPrice });
  }

  _settle(res) {
    let settled = 0;
    for (const bot of this.bots) {
      if (!bot.position(res.slug)) continue;
      const trade = bot.account.settle(res.slug, res.outcome, {
        open: res.open,
        close: res.close,
        winnerFeeBps: config.winnerFeeBps,
      });
      if (trade) {
        this._onTradeClosed(bot, trade);
        settled++;
      }
    }
    this.resolvedCount++;
    this.ms.openBtc.delete(res.slug);
    this.log.info(`settled ${res.slug} -> ${res.outcome}: ${settled} position(s) closed`);
    this.emit('resolved', res);
  }

  _onTradeClosed(bot, trade) {
    this.tradeCount++;
    // Fires the leaderboard refresh: server pushes immediately on this event.
    this.emit('tradeClosed', { bot, trade });
  }
}
