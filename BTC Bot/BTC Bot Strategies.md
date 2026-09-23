# BTC Bot Strategies #btcbot

> [!note] Families retired from the live sim 2026-07-10
> The sim is **Jarvis-only** now — the strategy families below no longer trade. The [[Evolver Brain]] and the bandit ([[Online Learner]]) are decommissioned; evolution happens inside Jarvis itself: [[The Tree]]. Everything below is the historical record of eras 1–2.

Gen-4 strategy families from BotSim (paper trading, Polymarket BTC 5-min Up/Down). Run of 2026-06-15: 100 bots, 194 markets, ~16.5 hrs, combined **+$29,209.51**. Gen-4 mandate: bet on **structure, not direction** — every family picks "the favorite" or "the cheap leg", never a fixed Up/Down. A strategy only counts as real if it's green in both up- and down-closing regimes.

Ranked by family profit (all variants summed):

1. [[Favorite Sweet Spot]] — +$15,822
2. [[Late Converge Adaptive]] — +$7,520
3. [[Depth Imbalance]] — +$2,313
4. [[Vol Bucket Favorite]] — +$1,600
5. [[Pair Relative Value]] — +$1,591
6. [[Overreaction Fade]] — +$1,485
7. [[Dutch Book]] — +$1,379
8. [[Spread Gate Favorite]] — +$1,222
9. [[Time Bucket Favorite]] — +$349
10. [[Calibration Bucket]] — −$238
11. [[Longshot Probe]] — −$2,137 (measurement probe, loss expected)

Controls for comparison (not strategies): AlwaysUp +$467, AlwaysDown −$1,000, Random ~−$582 each.

## Run history

- **gen 1** — 2026-06-14, ~4h, 49 markets, 107 bots: combined **−$27,875**. Down-leaning window (AlwaysDown +$86, AlwaysUp −$301). Every family negative in total; best Random seed (+$148) sat among the "winners". Lesson: friction and adverse fills eat naive strategies; one short window proves nothing.
- **gen 2** — 2026-06-14, ~14h, 169 markets: combined **−$45,125**, mostly KellyEdge losing $33.6k across 45 bots. Momentum-flavored families finished mildly green but barely cleared the best Random (+$357). FavoriteLongshot went bust. Lessons: sizing kills faster than signal; the longshot tax is real; leaderboard tops ≈ luck.
- **gen 3** — 2026-06-14→15, ~4h, 49 markets: combined **+$12,602** in an up-trending window where **AlwaysUp finished #4 (+$873)**. EdgeConverge/KellyConverge "won" by leaning with the trend. Lesson: any directional bet is regime luck → the gen-4 structure-not-direction mandate.
- **gen 4** — 2026-06-15, ~16.5h, 193 settled markets (102 Up/91 Down), friction: 1-tick slippage + 250–500ms feed delay: combined **+$29,210**. Regime split computed 2026-07-05: **4 families ROBUST** (green both regimes, balanced sides, ≥30 trades/side) — [[Favorite Sweet Spot]], [[Late Converge Adaptive]], [[Depth Imbalance]], [[Dutch Book]]. [[Pair Relative Value]] exposed as directional-in-disguise (90% Up trades). Noise yardstick weak (2 Random seeds, both ≈ −$582). All verdicts single-recording — unconfirmed until replayed on a fresh day's data.

**In progress**: fresh recording started 2026-07-05 ~14:48 UTC, collectors-only (no live sim), running detached (`Projects/BotSim/collectors.log`). Second exchange is now **Kraken** (Binance unreachable from this network — geo-block/dead). Next step: `npm run replay` against this recording = out-of-sample test for the four ROBUST families, then propose gen 5.

## Graveyard

Dead ideas stay visibly dead. Check here before proposing "new" families.

- **MeanRevert / MeanRevertEarly** — died gens 1–2: fought the candle; gen 1's biggest loser (−$10.7k).
- **MomentumEdge, TrendFollowEMA, ConsensusMomentum, VolGatedMomentum, EarlyValue, DriftHold** — died gens 1–3: green only when the trend agreed; flipped with the regime.
- **KellyEdge** — died gen 2: Kelly sizing on a noisy model, −$33.6k. Sizing amplifies model error.
- **EdgeConverge / KellyConverge / ConsensusEdge / VolGateEdge** — died gen 3: converge-on-the-leader is a directional bet in disguise; outdone by AlwaysUp in their own best window.
- **ScalpSpread, CrossExchangeSpread, ContrarianClose, LastMinute** — died gen 1: friction and adverse selection ate every variant.
- **ImpliedVsModel, FavoriteValue, PriceBucketProbe, LongshotValue** — died gens 1–3: model edge never cleared the noise band. Ancestors of gen 4's [[Calibration Bucket]] and [[Favorite Sweet Spot]].
- **FavoriteLongshot** — died gen 2: buying longshots = paying the tax; reborn inverted as gen 4's favorite-side harvest (and measured by [[Longshot Probe]]).

## Evolution run 2026-07-05 — first run under realism

Config change: **realism frictions on** — 750ms order latency (fills hit the book on arrival, not the book the bot saw), 2% winner vig, book-walk fills. P/L below is NOT comparable to the gen 1-4 numbers above.

Frozen 22-day dataset (2026-06-14 to 2026-07-05); auto-evolver tuned on the first 15.4d, confirmed on a 6.6d holdout the grid never saw. Tune noise band: [-$88, +$164].

- Full gen-4 roster on the tune window: **-$23,147 combined**. The old paper profits were mostly missing friction — mom was right.
- Survivors (green on tune AND holdout, 2 gens): [[Depth Imbalance]] (ratio 4 bred to 5, +$1,165 holdout) and [[Overreaction Fade]] (extreme 0.68 bred to 0.782, +$723 holdout). [[Dutch Book]] technically alive (+$3): latency kills arbs in transit.
- Belief revised: [[Spread Gate Favorite]] passed every in-sample gate (ROBUST, median +$518) and busted -$1,000 on holdout. In-sample robustness is not edge.
- The evolver stopped itself after 2 gens without progress: **no edge beyond the two champions under realism.**


**Gens 7-9 addendum (2026-07-06):** evolver machinery hardened after an adversarial agent sweep (8 confirmed bugs fixed — stake-size mutation, unviable variants, blind holdout edge-windows, run races). Gen 9 on fixed machinery: [[Depth Imbalance]] bred ratio 5→6, +$489 on a longer holdout but under the AlwaysUp control (+$1,947) in a strongly up-trending week — not yet edge over trend. [[Overreaction Fade]] died of over-narrowing: bred extreme to 0.899, zero trades, dropped. Current lineage: DepthImbalance alone, strike 1/2.

**Gens 10-13 coda (2026-07-07):** numeric breeder ran out of road — four more "no challenger won" gens; [[Depth Imbalance]] ratio-tweaking is exhausted. Era 1 closed and archived to `BotSim/results/era1/`.

## Era 2 (2026-07-07) — senses + a thinking evolver, restart at gen 1

- **[[Information Layer]]**: the bot now records news sentiment, on-chain whale flow, and fear/greed alongside prices; strategies read them off ctx. Three untested signal families born: [[Fear Greed Fade]], [[News Momentum]], [[Whale Flow Tilt]] — no verdict possible until several days of parallel market+signal data.
- **[[Evolver Brain]]**: each generation is now an Opus 4.8 session (on George's plan) that mines data for patterns and writes NEW strategy families, with persistent memory (`brain/LESSONS.md`), sandboxed code, auto-revert, and the same holdout/regime iron rules. Nightly 03:30 + HUD EVOLVE button.
- **Setup pending**: brain CLI needs a one-time `/usr/local/bin/claude setup-token` login — until then nightly runs skip with an honest HUD note.
- **[[Online Learner]]** (2026-07-07): a confidence-gated bandit that learns from every settled trade (reward = P/L won, punish = P/L lost) but only trusts a strategy once it has enough trades and is green in both regimes. Warm-started on 42,906 trades; pick = LateConvergeAdaptive (+$2.48/trade lower bound, in-sample). It's now the HUD "current strategy" and the live-switch arm target. Refreshes nightly 04:30.
- **[[Live Switch]]** (2026-07-07): HUD LIVE button built as an inert scaffold — arms the current pick only ([[Online Learner]] pick, else brain champion), click-again instant kill, hard dollar caps. Cannot place a real order until George completes `src/live/SETUP.md` himself.

Machinery: HUD EVOLVE button or `node brain/run-brain.mjs` · brain log in `BotSim/results/evolution/brain.log` · era-1 tables in `BotSim/results/era1/evolution/evolution.md`.

Source: `Projects/BotSim/src/engine/strategies.js` (+ brain sandbox `strategies.gen.js`) · results in `Projects/BotSim/results/`
