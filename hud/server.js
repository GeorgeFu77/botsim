// ESM: the HUD now lives inside BotSim, whose package.json sets "type": "module".
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = 4777;
const HOME = process.env.HOME;
// the HUD lives inside the BotSim repo now — derive everything from its own location
const BOTSIM_ROOT = path.resolve(__dirname, '..');
const BOTSIM = path.join(BOTSIM_ROOT, 'results');
const LEADS_FILE = path.join(HOME, 'projects', 'money', 'leadfinder', 'leads.json');
const SKILLS_DIR = path.join(HOME, '.claude', 'skills');

const KEPANO = ['defuddle', 'json-canvas', 'obsidian-bases', 'obsidian-cli', 'obsidian-markdown'];
// bot command deck only — the other installed skills stay on disk, just off this display
const BRANCHES = [
  { name: 'bot', skills: ['botsim', 'council'] },
];

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

function parseLeaderboard() {
  const raw = fs.readFileSync(path.join(BOTSIM, 'leaderboard.csv'), 'utf8');
  return raw.split('\n').slice(1).filter(Boolean).slice(0, 5).map(line => {
    const m = line.match(/^(\d+),"([^"]*)",([^,]*),([-\d.]+),([-\d.]+),(\d+),(\d+),([\d.]+)/);
    if (!m) return null;
    return { rank: +m[1], name: m[2], pnl: +m[4], trades: +m[6], winRate: +m[8] };
  }).filter(Boolean);
}

function lastTrades(n) {
  const raw = fs.readFileSync(path.join(BOTSIM, 'trades.jsonl'), 'utf8');
  return raw.trim().split('\n').slice(-n).reverse().map(l => {
    const t = JSON.parse(l);
    return { bot: t.bot.replace(/\[.*/, ''), side: t.side, pnl: t.pnl, win: t.win, closedAt: t.closedAt };
  });
}

function tradeStats() {
  const raw = fs.readFileSync(path.join(BOTSIM, 'trades.jsonl'), 'utf8');
  const all = raw.trim().split('\n').map(l => JSON.parse(l));
  let cum = 0;
  const series = all.slice(-150).map(t => (cum += t.pnl).toFixed(2) * 1);
  const wins = all.filter(t => t.win).length;
  const total = all.reduce((s, t) => s + t.pnl, 0);
  return { series, totalPnl: total, totalTrades: all.length, winRate: all.length ? (wins / all.length) * 100 : 0 };
}

function allGens() {
  const gens = [];
  for (const dir of [BOTSIM, path.join(BOTSIM, 'evolution')]) {
    for (const d of safe(() => fs.readdirSync(dir), [])) {
      if (/^gen\d+$/.test(d)) gens.push(+d.slice(3));
    }
  }
  return gens;
}

function trading() {
  const snap = safe(() => JSON.parse(fs.readFileSync(path.join(BOTSIM, 'snapshot.json'), 'utf8')), null);
  const gens = allGens();
  return {
    leaderboard: safe(parseLeaderboard, []),
    trades: safe(() => lastTrades(5), []),
    btc: snap && snap.btc ? snap.btc.price : null,
    snapshotAt: snap ? snap.generatedAt : null,
    paper: snap ? snap.paperTrading : null,
    gen: gens.length ? Math.max(...gens) : null,
  };
}

// Live BTC spot from Coinbase's public endpoint — real price, no key needed.
// Refreshed once a second server-side so every open dashboard reads one shared,
// always-fresh price (one upstream call per second no matter how many tabs).
let btcCache = { t: 0, price: null };
function refreshBtc() {
  const req = https.get('https://api.coinbase.com/v2/prices/BTC-USD/spot', { timeout: 4000 }, res => {
    let body = '';
    res.on('data', c => (body += c));
    res.on('end', () => {
      const p = safe(() => +JSON.parse(body).data.amount, null);
      if (p) btcCache = { t: Date.now(), price: p };
    });
  });
  // node's timeout option only emits the event; destroying is on us
  req.on('timeout', () => req.destroy(new Error('btc fetch timeout')));
  req.on('error', () => { /* keep last good price */ });
}
setInterval(refreshBtc, 1000).unref?.();
refreshBtc();

function money(cb) {
  const leads = safe(() => JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8')), []);
  const counts = {};
  for (const l of leads) counts[l.status] = (counts[l.status] || 0) + 1;
  const fresh = leads.filter(l => l.status === 'new')
    .map(l => ({ name: l.name, rating: l.rating, reviews: l.reviews, phone: l.phone, niche: l.niche }));
  const req = http.get({ host: 'localhost', port: 3777, path: '/api/leads', timeout: 800 }, res => {
    res.resume();
    cb({ counts, fresh, total: leads.length, serverUp: res.statusCode === 200 });
  });
  req.on('error', () => cb({ counts, fresh, total: leads.length, serverUp: false }));
  req.on('timeout', () => { req.destroy(); cb({ counts, fresh, total: leads.length, serverUp: false }); });
}

function skills() {
  const installed = new Set(safe(() => fs.readdirSync(SKILLS_DIR).filter(d => !d.startsWith('.')), []));
  installed.add('council'); // plugin skill, lives outside ~/.claude/skills
  const branches = BRANCHES.map(b => ({
    name: b.name,
    skills: b.skills.map(s => ({ name: s, installed: installed.has(s) })),
  }));
  const brain = KEPANO.map(s => ({ name: s, installed: installed.has(s), kepano: true }));
  return { branches, brain };
}

function simAlive(cb) {
  // npm start -> src/main.js, npm run replay -> src/replay.js; both count as simulating
  execFile('pgrep', ['-f', 'src/(main|replay)\\.js'], err => cb(!err));
}

function lineTs(str) {
  const m = String(str).match(/"(?:recvTs|exchTs)":(\d{10,})/) || String(str).match(/"periodStart":(\d{9,})/);
  if (!m) return null;
  const v = +m[1];
  return v < 1e12 ? v * 1000 : v;
}

// first and last timestamp across a feed's jsonl files, read from the file edges only
function feedSpan(dir) {
  let lo = Infinity, hi = -Infinity;
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl'))) {
    const p = path.join(dir, f);
    const size = fs.statSync(p).size;
    if (!size) continue;
    const fd = fs.openSync(p, 'r');
    const head = Buffer.alloc(Math.min(4096, size));
    fs.readSync(fd, head, 0, head.length, 0);
    const tail = Buffer.alloc(Math.min(8192, size));
    fs.readSync(fd, tail, 0, tail.length, size - tail.length);
    fs.closeSync(fd);
    const t1 = lineTs(head);
    const lines = String(tail).trim().split('\n');
    const t2 = lineTs(lines[lines.length - 1]) || lineTs(lines[lines.length - 2] || '');
    if (t1) lo = Math.min(lo, t1);
    if (t2) hi = Math.max(hi, t2);
  }
  return lo < hi ? { lo, hi } : null;
}

let dataCache = { t: 0, feeds: [], hours: 0 };
function collectedData() {
  if (Date.now() - dataCache.t < 60e3) return dataCache;
  const dir = path.join(BOTSIM_ROOT, 'data');
  const feeds = [];
  let lo = Infinity, hi = -Infinity;
  for (const f of safe(() => fs.readdirSync(dir), [])) {
    const p = path.join(dir, f);
    if (!safe(() => fs.statSync(p).isDirectory(), false)) continue;
    let bytes = 0;
    for (const file of safe(() => fs.readdirSync(p), [])) {
      bytes += safe(() => fs.statSync(path.join(p, file)).size, 0);
    }
    const span = safe(() => feedSpan(p), null);
    if (span) { lo = Math.min(lo, span.lo); hi = Math.max(hi, span.hi); }
    feeds.push({ name: f, bytes, hours: span ? (span.hi - span.lo) / 3600e3 : 0 });
  }
  feeds.sort((a, b) => b.hours - a.hours);
  dataCache = { t: Date.now(), feeds, hours: lo < hi ? (hi - lo) / 3600e3 : 0 };
  return dataCache;
}

// One-line purpose per family — mirrors FAMILY_DESC in src/engine/strategies.js.
// (Kept as a local copy so the HUD never loads engine code; keep the two in sync
// when a new family is born.)
const FAMILY_DESC = {
  DutchBook: 'Buys Up+Down together when they sum under $1 — risk-free arbitrage, direction-neutral.',
  PairRelativeValue: 'Buys whichever leg is cheap versus its synthetic price (1 − the other leg).',
  FavoriteSweetSpot: 'Harvests the favorite-longshot bias in the calibrated 0.55–0.82 price band.',
  CalibrationBucket: 'Measures realized hit-rate vs implied price, bucket by bucket (a probe).',
  LongshotProbe: 'Buys the cheap longshot side to measure the longshot tax (a probe).',
  LateConvergeAdaptive: 'Late in the window, backs the leading side when the BTC model still shows edge.',
  SpreadGateFavorite: 'Backs the favorite only when the book is tight (low-friction entries).',
  DepthImbalance: 'Backs the side whose bid book is much deeper — following the heavier support.',
  TimeBucketFavorite: 'Backs the favorite only in specific hours of day.',
  VolBucketFavorite: 'Backs the favorite only at specific realized-volatility levels.',
  OverreactionFadePair: 'Early in a window, fades an extreme price BTC has not actually earned yet.',
  FearGreedFade: 'At Fear/Greed extremes, fades the crowd — favorite in fear, underdog in greed.',
  NewsMomentum: 'Leans toward the side recent headline sentiment favors, but only with a model edge.',
  WhaleFlowTilt: 'Takes the favorite only when heavy on-chain flow confirms the window’s BTC drift.',
  AlwaysSide: 'Control: always buys one fixed side — the yardstick for regime luck.',
  RandomBaseline: 'Control: enters random sides — the pure-noise band every real edge must beat.',
};

// The online bandit's snapshot: the strategy it has learned to trust (updated on
// every settled trade, confidence-gated + regime-gated), plus the ranked field.
function readBandit() {
  return safe(() => JSON.parse(fs.readFileSync(path.join(BOTSIM, 'bandit', 'state.json'), 'utf8')), null);
}

// The strategy the bot is ACTUALLY running now. Preference:
//   1. the bandit's confidence-gated pick (learns every trade) — the live strategy,
//   2. else the nightly brain's evolution survivor,
//   3. else null (nothing crowned yet).
// Cached ~4s.
let _stratCache = { t: 0, val: null };
function currentStrategy() {
  if (Date.now() - _stratCache.t < 4000) return _stratCache.val;
  const evoDir = path.join(BOTSIM, 'evolution');
  const st = safe(() => JSON.parse(fs.readFileSync(path.join(evoDir, 'status.json'), 'utf8')), null);
  let val = null;

  const band = readBandit();
  if (band?.pick) {
    const p = band.pick;
    val = {
      family: p.family, params: p.params || null, desc: FAMILY_DESC[p.family] || '',
      source: 'learner',
      note: `learned live · +$${p.lcb}/trade (lower bound) over ${p.n} trades · ${band.eligibleCount} strategies clear the bar`,
      gen: st?.gen ?? null, phase: st?.phase ?? null,
    };
  } else {
    const gens = safe(() => fs.readdirSync(evoDir), []).filter(d => /^gen\d+$/.test(d)).map(d => +d.slice(3)).sort((a, b) => b - a);
    for (const g of gens) {
      const grid = safe(() => JSON.parse(fs.readFileSync(path.join(evoDir, `gen${g}`, 'next-grid.json'), 'utf8')), null);
      if (!Array.isArray(grid) || !grid.length) continue;
      const fam = grid[0].family;
      val = {
        family: fam, params: (grid[0].variants && grid[0].variants[0]) || null,
        desc: FAMILY_DESC[fam] || '', source: 'brain', lineage: grid.map(r => r.family),
        gen: st?.gen ?? g, phase: st?.phase ?? null, note: st?.note ?? null,
      };
      break;
    }
  }
  _stratCache = { t: Date.now(), val };
  return val;
}

// Read the last <=maxBytes of a jsonl file and return parsed records (bounded work
// even when a feed file grows to megabytes over days).
function tailJsonl(file, maxBytes = 200_000) {
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift(); // drop the partial first line
    const out = [];
    for (const l of lines) { const t = l.trim(); if (!t) continue; try { out.push(JSON.parse(t)); } catch { /* skip */ } }
    return out;
  } catch { return []; }
}

// The bot's live "senses": current fear/greed, recent news tilt, recent on-chain flow.
// Read straight from the collector files so it works even when the sim isn't running.
function readSignals() {
  const now = Date.now();
  const dataDir = path.join(BOTSIM_ROOT, 'data');
  const fngRecs = tailJsonl(path.join(dataDir, 'fng', 'index.jsonl'), 20_000);
  const fLast = fngRecs[fngRecs.length - 1] || null;
  const fng = fLast ? { value: fLast.value, classification: fLast.classification, ageMs: now - fLast.recvTs } : null;

  const newsRecs = tailJsonl(path.join(dataDir, 'news', 'headlines.jsonl')).filter(r => now - r.recvTs <= 30 * 60_000);
  let news = null;
  if (newsRecs.length) {
    let wsum = 0, w = 0;
    for (const r of newsRecs) { const k = Math.max(0.05, 1 - (now - r.recvTs) / (30 * 60_000)); wsum += (r.sentiment?.net || 0) * k; w += k; }
    news = { score: +(w ? wsum / w : 0).toFixed(3), count: newsRecs.length, ageMs: now - newsRecs[newsRecs.length - 1].recvTs };
  }

  const whaleRecs = tailJsonl(path.join(dataDir, 'whale', 'flow.jsonl')).filter(r => now - r.recvTs <= 20 * 60_000);
  let whale = null;
  if (whaleRecs.length) {
    const netBtc = whaleRecs.reduce((s, r) => s + (r.flowBtc || 0), 0);
    whale = { netBtc: +netBtc.toFixed(1), count: whaleRecs.length, ageMs: now - whaleRecs[whaleRecs.length - 1].recvTs };
  }
  return { fng, news, whale };
}

// The Jarvis AI's live readout: hit-rate on acted bets (with the null-model band),
// Brier, the divergence weight (its thesis), the learning curve, and the live call.
function jarvisReadout() {
  const st = safe(() => JSON.parse(fs.readFileSync(path.join(BOTSIM, 'jarvis', 'state.json'), 'utf8')), null);
  if (!st) return null;
  const acted = st.acted || 0, wins = st.wins || 0;
  const p = acted ? wins / acted : null;
  const se = acted ? Math.sqrt(0.25 / acted) : 0; // coin-flip standard error
  const cur = safe(() => JSON.parse(fs.readFileSync(path.join(BOTSIM, 'jarvis', 'current.json'), 'utf8')), null);
  // 24h P&L from Jarvis's own trade log
  const now = Date.now();
  const trades = tailJsonl(path.join(BOTSIM, 'jarvis', 'trades.jsonl')).filter(t => now - (t.closedAt || 0) <= 86400_000);
  const pnl24h = trades.reduce((s, t) => s + (t.pnl || 0), 0);
  const wins24h = trades.filter(t => t.pnl > 0).length;
  return {
    n: st.n, seen: st.seen, acted, wins,
    warmup: st.warmup, warming: st.n < (st.warmup || 0),
    pnl24h: +pnl24h.toFixed(2), trades24h: trades.length,
    winRate24h: trades.length ? +((wins24h / trades.length) * 100).toFixed(0) : null,
    hitRate: p != null ? +(p * 100).toFixed(1) : null,
    beatsCoin: acted >= 100 && (p - 1.96 * se) > 0.5,
    brier: st.brierSum && st.seen ? +(st.brierSum / st.seen).toFixed(4) : null,
    curve: (st.history || []).slice(-120),
    current: cur, // includes the live call + evidence (per-feature contributions)
  };
}

const LIVE_DIR = path.join(BOTSIM_ROOT, 'results', 'live');
const ARM_FILE = path.join(LIVE_DIR, 'arm.json');

// Live-trading switch state for the HUD: arm file + executor status + config gate.
function liveState() {
  const arm = safe(() => JSON.parse(fs.readFileSync(ARM_FILE, 'utf8')), null);
  const st = safe(() => JSON.parse(fs.readFileSync(path.join(LIVE_DIR, 'status.json'), 'utf8')), null);
  const cfg = safe(() => fs.readFileSync(path.join(BOTSIM_ROOT, 'config.js'), 'utf8'), '');
  const m = cfg.match(/live:\s*{[^}]*enabled:\s*(true|false)/);
  return {
    armed: !!arm?.armed,
    family: arm?.family ?? null,
    note: arm?.note ?? null,
    scaffold: st ? !!st.scaffold : true,
    configEnabled: m ? m[1] === 'true' : false,
    spent: st?.spent ?? { today: 0, total: 0 },
    caps: st?.caps ?? null,
  };
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
  }
  if (req.method === 'POST' && req.url === '/api/live/toggle') {
    // George's switch: click arms the CURRENT champion, click again kills — no
    // other transitions exist. Arming requires a crowned champion to lock onto.
    fs.mkdirSync(LIVE_DIR, { recursive: true });
    const cur = safe(() => JSON.parse(fs.readFileSync(ARM_FILE, 'utf8')), null);
    if (cur && cur.armed) {
      fs.writeFileSync(ARM_FILE, JSON.stringify({ armed: false, disarmedAt: Date.now(), note: 'killed by button' }, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ armed: false }));
    }
    const champ = currentStrategy();
    if (!champ || !champ.family || !champ.params) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'no champion to arm — the brain has not crowned a survivor yet' }));
    }
    fs.writeFileSync(ARM_FILE, JSON.stringify({
      armed: true, family: champ.family, params: champ.params, armedAt: Date.now(),
    }, null, 2));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ armed: true, family: champ.family }));
  }
  if (req.url === '/api/btc') {
    // live coinbase spot, refreshed server-side every second; `at` lets the
    // client dim the readout if the upstream feed ever goes stale.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ price: btcCache.price, at: btcCache.t }));
  }
  if (req.url === '/api/hud') {
    simAlive(sim => {
      const t = safe(trading, {});
      t.btcLive = btcCache.price;
      const stats = safe(tradeStats, { series: [], totalPnl: 0, totalTrades: 0, winRate: 0 });
      const directives = [];
      if (sim) directives.push('simulating right now');
      const lastFill = t.trades && t.trades[0] ? t.trades[0].closedAt : null;
      if (!sim && lastFill && Date.now() - lastFill > 6 * 3600e3) {
        directives.push(`sim quiet ${Math.round((Date.now() - lastFill) / 3600e3)}h, start a run or replay`);
      }
      if (t.gen) directives.push(`harvest gen ${t.gen}, then propose the gen ${t.gen + 1} grid`);
      const dataObj = { ...safe(collectedData, { feeds: [], hours: 0 }), simRunning: sim };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        now: Date.now(),
        trading: t,
        stats,
        directives: directives.slice(0, 3),
        data: dataObj,
        strategy: safe(currentStrategy, null),
        signals: safe(readSignals, null),
        learner: safe(readBandit, null),
        jarvis: safe(jarvisReadout, null),
        live: safe(liveState, { armed: false, scaffold: true, configEnabled: false }),
        skills: safe(skills, { branches: [], brain: [] }),
      }));
    });
    return;
  }
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => console.log(`jarvis hud at http://localhost:${PORT}`));
