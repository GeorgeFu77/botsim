// `npm run report` — print the saved leaderboard to the terminal with colors.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config.js';
import { colorUSD, fmtPct } from '../util/money.js';

const file = path.join(config.resultsDir, 'snapshot.json');
if (!fs.existsSync(file)) {
  console.log('No results yet. Run `npm start` first.');
  process.exit(0);
}
const s = JSON.parse(fs.readFileSync(file, 'utf8'));

console.log('');
console.log(`BotSim leaderboard — ${s.totals.bots} bots · ${s.totals.trades} trades · ${s.totals.resolved} resolved`);
console.log(`Combined P/L: ${colorUSD(s.totals.combinedPnL)}   (paper trading only)\n`);
console.log('  #  ' + 'Strategy'.padEnd(40) + '   Total P/L     Trades   Win%    Avg/Trade');
console.log('  ' + '─'.repeat(92));
for (const r of s.rows.slice(0, 30)) {
  console.log(
    '  ' +
      String(r.rank).padStart(3) +
      '  ' +
      r.name.padEnd(40).slice(0, 40) +
      '  ' +
      colorUSD(r.totalPnL).padStart(20) +
      '  ' +
      String(r.trades).padStart(5) +
      '   ' +
      (r.trades ? fmtPct(r.winRate * 100) : '—').padStart(6) +
      '  ' +
      colorUSD(r.avgPerTrade).padStart(18),
  );
}
console.log('');
