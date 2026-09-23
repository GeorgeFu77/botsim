// Leaderboard computation. Pure functions over the simulator's bots + state.

import { config } from '../../config.js';
import { nowSec, windowLabel } from '../util/time.js';

export function computeRows(bots) {
  const rows = bots.map((bot) => {
    const a = bot.account;
    const trades = a.trades.length;
    const wins = a.wins; // running counter — no O(trades) rescan per push
    const equity = a.equity();
    const totalPnL = equity - a.startingCash;

    let open = null;
    for (const p of a.positions.values()) {
      const mark = p.lastMark ?? p.entry;
      open = {
        slug: p.slug,
        side: p.side,
        shares: Number(p.shares.toFixed(2)),
        entry: Number(p.entry.toFixed(3)),
        mark: Number(mark.toFixed(3)),
        unrealized: Number((p.shares * (mark - p.entry)).toFixed(2)),
      };
      break; // at most one position per bot in this design
    }

    return {
      id: bot.id,
      name: bot.name,
      family: bot.family,
      totalPnL: Number(totalPnL.toFixed(2)),
      realizedPnL: Number(a.realizedPnL.toFixed(2)),
      equity: Number(equity.toFixed(2)),
      trades,
      wins,
      winRate: trades ? wins / trades : 0,
      avgPerTrade: trades ? Number((a.realizedPnL / trades).toFixed(2)) : 0,
      open,
    };
  });

  rows.sort((x, y) => y.totalPnL - x.totalPnL || y.trades - x.trades);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// Full snapshot pushed to the dashboard / written to disk.
export function buildSnapshot(sim) {
  const rows = computeRows(sim.bots);
  const ms = sim.ms;
  const nowS = nowSec();
  const active = ms.activeMarket(nowS);

  let market = null;
  if (active) {
    const up = ms.bookFor(active.slug, 'Up');
    const down = ms.bookFor(active.slug, 'Down');
    market = {
      slug: active.slug,
      label: windowLabel(active.periodStart, config.polymarket.periodSeconds),
      periodEnd: active.periodEnd,
      secondsLeft: active.periodEnd - nowS,
      openBtc: ms.openBtc.get(active.slug) ?? null,
      upMid: up?.mid ?? null,
      downMid: down?.mid ?? null,
      upAgeMs: up ? Date.now() - up.recvTs : null,
    };
  }

  const combinedPnL = rows.reduce((s, r) => s + r.totalPnL, 0);
  const openPositions = rows.reduce((s, r) => s + (r.open ? 1 : 0), 0);

  return {
    generatedAt: Date.now(),
    runtimeMs: Date.now() - sim.startedAt,
    paperTrading: true,
    btc: {
      price: ms.btcPrice(),
      binance: ms.btc.binance?.price ?? null,
      coinbase: ms.btc.coinbase?.price ?? null,
      spread: ms.btcSpread(),
    },
    latency: ms.latency, // measured ms (recvTs - exchTs) per source
    delays: config.feedDelayMs, // configured decision delay
    market,
    totals: {
      bots: rows.length,
      combinedPnL: Number(combinedPnL.toFixed(2)),
      trades: sim.tradeCount,
      resolved: sim.resolvedCount,
      openPositions,
    },
    rows,
  };
}
