// ============================================================================
// BotSim — live paper-trading simulator for Polymarket BTC 5-minute Up/Down.
//
//   collectors  ->  data/*.jsonl  ->  tailer  ->  engine  ->  SSE  ->  Chrome
//
// PAPER TRADING ONLY. This process reads public market data and books
// hypothetical fills. It never authenticates, signs, or sends an order anywhere.
// ============================================================================

import { exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { makeJarvis } from './live/jarvis/jarvis-strategy.js';
import { Lineage } from './live/jarvis/lineage.js';
import { makeLogger } from './util/log.js';
import { Tailer, ensureDir } from './util/jsonl.js';
import { startAllCollectors } from './collectors/run-collectors.js';
import { MarketState } from './feed/marketState.js';
import { Bot } from './engine/bot.js';
import { Simulator } from './engine/simulator.js';
import { buildSnapshot } from './leaderboard/leaderboard.js';
import { DashboardServer } from './leaderboard/server.js';
import { Store } from './persistence/store.js';
import { LiveExecutor } from './live/executor.js';
import { colorUSD } from './util/money.js';

const log = makeLogger('botsim');

function main() {
  log.ok('╭───────────────────────────────────────────────────────────╮');
  log.ok('│  BotSim — PAPER TRADING ONLY. No real orders are placed.   │');
  log.ok('╰───────────────────────────────────────────────────────────╯');

  // --- directories ---
  ensureDir(config.dataDir);
  ensureDir(config.resultsDir);

  // --- Jarvis: the tree — one trunk + twin self-experiments (PAPER deciders only) ---
  // The old strategy-family roster is gone (2026-07-09): the sim is Jarvis-only.
  // NOTE: JarvisAI bots exist ONLY in this live process and are never LiveExecutor
  // champion candidates. They are paper deciders, structurally incapable of
  // placing an order.
  const JARVIS_DIR = path.join(config.resultsDir, 'jarvis');
  const CURRENT_FILE = path.join(JARVIS_DIR, 'current.json');
  ensureDir(JARVIS_DIR);
  const lineage = new Lineage({ dir: JARVIS_DIR });
  lineage.load();
  const jarvisCurrent = { write: (o) => { try { fs.writeFileSync(CURRENT_FILE, JSON.stringify(o)); } catch { /* ignore */ } } };
  const makeBot = (v) => new Bot({
    id: v.id, family: 'JarvisAI', params: { maxRisk: 1e9 }, name: `JarvisAI[${v.name}]`,
    makeStrategy: () => makeJarvis(v, { current: jarvisCurrent, isCurrentWriter: () => v.id === lineage.trunkId }),
  });
  const bots = lineage.variants.map(makeBot);
  log.ok(`Jarvis tree: pop=${bots.length} · trunk=${lineage.trunk.name} (n=${lineage.trunk.model.n}, seen=${lineage.trunk.model.seen}) · gen=${lineage.gen}`);

  // --- engine + state ---
  const marketState = new MarketState();
  const sim = new Simulator({ bots, marketState });
  const store = new Store(config.resultsDir);
  const server = new DashboardServer(config.port);

  // Decoupled mode: don't run our own collectors, just READ data that a separate
  // recorder process (npm run collectors) is writing. Lets the recording survive
  // competition restarts. In this mode we replay markets.jsonl from the start so
  // we still learn the currently-active window (no in-process collector to re-emit it).
  const noCollectors = !!process.env.BOTSIM_NO_COLLECTORS;

  // --- tail the live data folders (started BEFORE collectors so nothing is missed) ---
  const dataFiles = [
    [path.join(config.dataDir, 'binance', 'trades.jsonl'), 'binance', false],
    [path.join(config.dataDir, 'kraken', 'trades.jsonl'), 'kraken', false],
    [path.join(config.dataDir, 'coinbase', 'ticker.jsonl'), 'coinbase', false],
    // Perp tapes + the Polymarket tape (grafted senses, 2026-07-09).
    [path.join(config.dataDir, 'bybit', 'trades.jsonl'), 'bybit', false],
    [path.join(config.dataDir, 'okx', 'trades.jsonl'), 'okx', false],
    [path.join(config.dataDir, 'polymarket', 'trades.jsonl'), 'polymarket', false],
    // The JUDGE: the Chainlink stream these markets actually settle on.
    [path.join(config.dataDir, 'chainlink', 'prices.jsonl'), 'chainlink', false],
    [path.join(config.dataDir, 'polymarket', 'markets.jsonl'), 'polymarket', noCollectors],
    [path.join(config.dataDir, 'polymarket', 'books.jsonl'), 'polymarket', false],
    [path.join(config.dataDir, 'polymarket', 'resolutions.jsonl'), 'polymarket', false],
    // Information feeds — the tailer creates missing files, so this is safe even
    // before any collector has written to them.
    [path.join(config.dataDir, 'news', 'headlines.jsonl'), 'news', false],
    [path.join(config.dataDir, 'whale', 'flow.jsonl'), 'whale', false],
    [path.join(config.dataDir, 'fng', 'index.jsonl'), 'fng', false],
  ];
  const tailer = new Tailer();
  // Register the listener BEFORE add(): add()'s initial read can emit lines
  // synchronously (fromStart=true replays existing rows), and those must not be
  // dropped for lack of a listener.
  tailer.on('line', (src, rec) => sim.ingest(src, rec));
  for (const [file, src, fromStart] of dataFiles) tailer.add(file, src, fromStart);
  tailer.start();
  log.info(noCollectors ? 'reading data folders written by a separate recorder…' : 'tailing live data folders for new ticks…');

  // --- start the collectors (they append to the folders we just tailed) ---
  const collectors = noCollectors ? null : startAllCollectors(config.dataDir);

  // --- start engine + server ---
  sim.start();
  server.start();

  // --- the tree runs itself: births every 30min (capped), the reaper daily ---
  lineage.init(sim, makeBot);
  lineage.startTimers();
  lineage.persist(); // write once at boot so the HUD shows Jarvis immediately

  // --- live executor (INERT SCAFFOLD: dry-run only; self-gates on config.live,
  // the HUD arm switch, champion identity, and dollar caps) ---
  new LiveExecutor().attach(sim);

  // --- the tree learns on EVERY settled window: every variant updates its
  // weights on the true label (even for windows it chose to skip), the paired
  // twin-vs-trunk diffs are recorded, and the whole population persists ---
  sim.on('resolved', (res) => lineage.onResolved(res));

  // --- push leaderboard on EVERY closed trade (coalesced per tick) ---
  let pushScheduled = false;
  const scheduleLeaderboardPush = () => {
    if (pushScheduled) return;
    pushScheduled = true;
    setImmediate(() => {
      pushScheduled = false;
      server.push('leaderboard', buildSnapshot(sim));
    });
  };
  sim.on('tradeClosed', ({ bot, trade }) => {
    store.appendTrade(bot.name, trade);
    lineage.onTradeClosed(bot, trade); // paired-experiment bookkeeping + the HUD's 24h P&L log (trunk only)
    scheduleLeaderboardPush(); // <-- the live refresh the user asked for
  });

  // --- live heartbeat snapshots (throttled) so open PnL updates between trades ---
  let lastTickPush = 0;
  sim.on('tick', () => {
    const now = Date.now();
    if (now - lastTickPush < config.tickPushMs) return;
    lastTickPush = now;
    server.push('tick', buildSnapshot(sim));
  });

  // --- persist results regularly (review them in the morning) ---
  const persistTimer = setInterval(() => {
    const snap = buildSnapshot(sim);
    store.writeSnapshot(snap);
    store.writeReport(snap);
  }, config.snapshotIntervalMs);
  persistTimer.unref?.();

  // --- terminal heartbeat ---
  const hbTimer = setInterval(() => {
    const snap = buildSnapshot(sim);
    const top = snap.rows[0];
    log.info(
      `combined ${colorUSD(snap.totals.combinedPnL)} · ${snap.totals.trades} trades · ` +
        `${snap.totals.resolved} resolved · leader: ${top ? top.name + ' ' + colorUSD(top.totalPnL) : '—'}`,
    );
  }, 30_000);
  hbTimer.unref?.();

  // --- open the dashboard in Chrome ---
  const url = `http://localhost:${config.port}`;
  if (config.openChrome) {
    exec(`open -a "Google Chrome" "${url}"`, (err) => {
      if (err) exec(`open "${url}"`); // fall back to default browser
    });
  }
  log.ok(`leaderboard → ${url}`);

  // --- resilience: never let one bad event kill an overnight run ---
  process.on('uncaughtException', (e) => log.error('uncaught', e.message));
  process.on('unhandledRejection', (e) => log.error('unhandledRejection', String(e?.message || e)));

  // --- graceful shutdown: write final results ---
  const shutdown = () => {
    log.info('shutting down — writing final results…');
    try {
      const snap = buildSnapshot(sim);
      store.writeSnapshot(snap);
      store.writeReport(snap);
      log.ok(`final results saved to ${config.resultsDir}/report.md`);
    } catch (e) {
      log.error('final save failed', e.message);
    }
    collectors?.stop?.();
    sim.stop();
    server.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
