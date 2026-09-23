// Saves results so you can review them in the morning.
//   results/snapshot.json   - latest full leaderboard + state (machine readable)
//   results/trades.jsonl    - append-only global log of every closed trade
//   results/report.md       - human-readable summary (top & bottom performers)
//   results/leaderboard.csv - full ranking as CSV

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { fmtSignedUSD, fmtPct, fmtUSD } from '../util/money.js';
import { ensureDir } from '../util/jsonl.js';

export class Store {
  constructor(resultsDir = config.resultsDir) {
    this.dir = resultsDir;
    ensureDir(this.dir);
    this.tradesFile = path.join(this.dir, 'trades.jsonl');
  }

  appendTrade(botName, trade) {
    fs.appendFile(this.tradesFile, JSON.stringify({ bot: botName, ...trade }) + '\n', () => {});
  }

  writeSnapshot(snapshot) {
    const tmp = path.join(this.dir, 'snapshot.json.tmp');
    const final = path.join(this.dir, 'snapshot.json');
    fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmp, final); // atomic-ish replace
  }

  writeReport(snapshot) {
    fs.writeFileSync(path.join(this.dir, 'report.md'), renderReport(snapshot));
    fs.writeFileSync(path.join(this.dir, 'leaderboard.csv'), renderCsv(snapshot));
  }
}

function renderReport(s) {
  const ts = new Date(s.generatedAt).toISOString();
  const runtime = Math.round(s.runtimeMs / 60000);
  const rows = s.rows;
  const winners = rows.slice(0, 25);
  const losers = rows.slice(-5).reverse();
  const line = (r) =>
    `| ${r.rank} | ${r.name} | ${fmtSignedUSD(r.totalPnL)} | ${r.trades} | ${r.trades ? fmtPct(r.winRate * 100) : '—'} | ${r.trades ? fmtSignedUSD(r.avgPerTrade) : '—'} |`;

  return `# BotSim Results — Polymarket BTC 5-min Up/Down (PAPER TRADING)

_Generated ${ts} · run time ~${runtime} min · ${s.totals.bots} bots · ${s.totals.trades} trades · ${s.totals.resolved} markets resolved_

**Combined P/L across all bots: ${fmtSignedUSD(s.totals.combinedPnL)}**

> Paper trading only. No real orders were ever placed. Markets settle on the
> official Binance 5-minute BTCUSDT candle (Up if close ≥ open).

## 🏆 Top 25

| # | Strategy | Total P/L | Trades | Win % | Avg / Trade |
|---|----------|-----------|--------|-------|-------------|
${winners.map(line).join('\n')}

## 🪦 Bottom 5

| # | Strategy | Total P/L | Trades | Win % | Avg / Trade |
|---|----------|-----------|--------|-------|-------------|
${losers.map(line).join('\n')}

_Full ranking in \`leaderboard.csv\`; every trade in \`trades.jsonl\`._
`;
}

function renderCsv(s) {
  const head = 'rank,name,family,total_pnl,realized_pnl,trades,wins,win_rate,avg_per_trade,equity';
  const lines = s.rows.map((r) =>
    [r.rank, `"${r.name}"`, r.family, r.totalPnL, r.realizedPnL, r.trades, r.wins, (r.winRate * 100).toFixed(2), r.avgPerTrade, r.equity].join(','),
  );
  return [head, ...lines].join('\n') + '\n';
}

// Reused by `npm run report` to print to the terminal.
export { fmtUSD };
