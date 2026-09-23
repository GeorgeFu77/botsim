# Paper-Trading 107 Strategy Bots on Polymarket BTC 5-Minute Up/Down Markets

**A controlled simulation of naive systematic strategies under realistic
order-book friction and data delay.**

*BotSim experiment log · Generation 1 → Generation 2*

> **Paper trading only.** No real orders were placed at any point. All
> Polymarket interaction was read-only (public market discovery, order books,
> market WebSocket). Price feeds (Binance, Coinbase) were read-only.

---

## Abstract

We built a live simulator that runs many systematic trading bots in parallel
against **real** Polymarket "Bitcoin Up or Down" 5-minute markets, using **real**
Binance and Coinbase BTC price feeds, and settling each market on the **official
Binance 5-minute candle** (Up if close ≥ open). Each bot trades only on
simulated fills walked against the live order book, with an explicit,
configurable **data delay** so that bots react to slightly stale information —
reproducing the adverse selection a slow participant suffers.

In Generation 1 we ran **107 bots across 11 strategy families** for **48
consecutive 5-minute windows** (~4 hours, **4,563 simulated trades**). The
aggregate result was a **net loss of ≈\$26,700** of paper money. Crucially, the
two "always one side" benchmarks lost only **≈\$2 per trade** — exactly the
round-trip order-book friction — which confirms the accounting is sound and
locates the rest of the losses in genuinely poor strategy decisions and in
delay-induced adverse selection. A minority of configurations (23 of 107 by
realized P/L) finished positive, concentrated in **momentum/edge strategies that
held to resolution with a low entry-edge threshold**. We retain those winners,
keep the naive baselines as controls, retire the losing families, and introduce
**8 new families** for Generation 2.

---

## 1. System

```
collectors ──append──▶ data/*.jsonl ──tail──▶ engine ──SSE──▶ live leaderboard
(Binance + Coinbase                  (delay-     (N bots,          (refreshes on
 + Polymarket, read-only)             gated)      paper PnL)         every trade)
                                                      └──▶ results/ (this paper's data)
```

**Markets.** Each Polymarket window is its own binary market
(`btc-updown-5m-<epoch>`), with two outcome tokens (`Up`, `Down`) that pay \$1
if correct and \$0 otherwise. We discover the active and upcoming windows from
the Gamma API and stream their order books over the CLOB WebSocket (with a REST
backstop). Settlement uses the official Binance BTCUSDT 5-minute candle.

**Accounting.** A bot buys outcome shares at the walked ask + slippage; a long
binary's maximum loss equals its cost basis, which is exactly what
`maxRiskPerMarket` caps. Positions are marked to mid for unrealized P/L;
**realized** P/L is booked on early exit (sold into the bid) or at resolution
(\$1 / \$0). Realized P/L reconciles to the cash delta to the cent (verified,
including fees).

**The delay model** (a deliberate feature). Three layers:
1. measured transport latency per record (`recvTs − exchTs`);
2. a configurable **decision delay** per feed (gen-1: Binance 250 ms, Coinbase
   300 ms, Polymarket 500 ms) — bots only *see* data that late;
3. fills land on a fresher book than the bot saw → realistic adverse selection.

**Parameters (gen-1).** \$1,000 starting paper cash per bot; \$50 stake per
signal; \$100 max risk per market; 1-tick (\$0.01) slippage; 0 bps taker fee;
one entry per bot per window (no spread churn).

---

## 2. Method

107 bots were generated as the Cartesian product of 11 families over parameter
grids. Families: `MomentumEdge`, `ImpliedVsModel`, `MeanRevert`, `LastMinute`,
`CrossExchangeSpread`, `FavoriteLongshot`, `ScalpSpread`, `TrendFollowEMA`,
`ContrarianClose`, `RandomBaseline` (control), `AlwaysSide` (control). Each bot
ran the identical event stream; the only differences were its decision rule and
parameters. We recorded every trade and a full leaderboard snapshot.

The core signal available to most families is the gap between a **momentum-implied
model probability** — `P(Up) = Φ(currentReturn / σ√fracTimeLeft)` — and the
market's implied price (best ask). Strategies differ in their edge threshold,
volatility assumption, exit rule, timing, and sizing.

---

## 3. Results (Generation 1)

**48 windows · 107 bots · 4,563 trades · aggregate realized P/L ≈ −\$26,694.**

### 3.1 The accounting is sound: the friction floor

The `AlwaysSide` benchmarks simply buy one side every window and hold. They lost
**≈\$2 per trade** (≈−\$104/bot over ~48 trades) — the round-trip cost of
crossing the spread plus one tick of slippage. This is the friction floor and it
confirms there is no accounting leak: everything below this line is *strategy*
loss, not a bug.

### 3.2 Family aggregates (by realized P/L)

| Family | n | Σ realized | avg/bot | avg win% |
|---|--:|--:|--:|--:|
| RandomBaseline *(control)* | 4 | **+\$83** | +\$21 | 51.3% |
| LastMinute | 12 | +\$1 | +\$0 | 59.8% |
| AlwaysSide *(control)* | 2 | −\$207 | −\$104 | 50.0% |
| FavoriteLongshot | 6 | −\$617 | −\$103 | 49.4% |
| CrossExchangeSpread | 4 | −\$921 | −\$230 | 46.8% |
| TrendFollowEMA | 4 | −\$1,062 | −\$265 | 44.3% |
| ScalpSpread | 9 | −\$1,914 | −\$213 | 53.5% |
| ContrarianClose | 3 | −\$2,890 | −\$963 | 17.9% |
| ImpliedVsModel | 15 | −\$3,926 | −\$262 | 36.7% |
| MomentumEdge | 30 | −\$4,910 | −\$164 | 48.4% |
| MeanRevert | 18 | −\$10,332 | −\$574 | 49.7% |

Every family is net-negative except the random control — but this hides
wide *within-family* spread: the best `MomentumEdge` and `ImpliedVsModel`
configurations were strongly positive while their siblings bled. Selection must
therefore happen at the **individual-bot** level, not the family level.

### 3.3 The survivors (realized P/L > 0, top configurations)

| Strategy | realized | trades | win% |
|---|--:|--:|--:|
| MomentumEdge[edge=0.04, vol=0.0006, hold] | +\$572 | 49 | 46.9% |
| MomentumEdge[edge=0.02, vol=0.0006, hold] | +\$550 | 49 | 44.9% |
| ImpliedVsModel[edge=0.03, vol=0.0007] | +\$543 | 48 | 58.3% |
| MomentumEdge[edge=0.02, vol=0.001, hold] | +\$352 | 49 | 38.8% |
| ImpliedVsModel[edge=0.05, vol=0.0007] | +\$274 | 48 | 52.1% |
| MomentumEdge[edge=0.06, vol=0.0006, hold] | +\$210 | 48 | 39.6% |
| FavoriteLongshot[longshot] | +\$178 | 48 | 52.1% |

23 of 107 bots finished with positive realized P/L; 80 lost; 4 never traded.

### 3.4 The worst: fighting efficient pricing

`ContrarianClose` (−\$963/bot, **17.9%** win rate) bets *against* the move in the
final seconds — when the 5-minute outcome is nearly decided. It systematically
buys the losing side cheap and loses most of its stake. Aggressive `MeanRevert`
(−\$574/bot) fades strong moves that simply continue. These are the clearest
"do-not-do-this" results in the dataset.

---

## 4. Findings

1. **Hold to resolution; don't take small profits.** Every winning `MomentumEdge`
   held to settlement (`tp=null`). The take-profit variants locked in tiny gains
   while still eating full-size losses, and paid the spread twice — uniformly
   negative.
2. **Low edge thresholds beat high ones.** A *high* required edge means the bot
   only fires when it thinks the market is badly wrong — which, on an efficient
   market, is usually when the *bot* is wrong. `ImpliedVsModel[edge=0.03]` made
   money; `edge=0.10` was near the bottom.
3. **Don't fight near-decided outcomes.** Contrarian and late mean-reversion were
   catastrophic. Reversion, if it has any value, must act *early* in the window.
4. **The cheap "longshot" side carried small positive value** — a known
   favorite-longshot tilt.
5. **Delay is a real tax.** With a 250–500 ms decision delay, momentum chasers
   buy *after* the move is priced in; only low-edge, hold-to-resolution momentum
   overcame it, and only in a trending sample.
6. **Most "100 bots" were not 100 independent bets.** Several parameter sweeps
   were degenerate clones (e.g. `CrossExchangeSpread[thresh=2/4/7/12]` identical,
   because BTC's cross-exchange spread almost always exceeded every threshold).

---

## 5. Generation 2 (this roster)

**Kept (gen-1 survivors — PROVISIONAL, not proven; see Appendix B):** the 7
`MomentumEdge` hold-to-resolution / low-edge bots, 5 low-edge `ImpliedVsModel`
bots, the `FavoriteLongshot[longshot]` bot, and 3 `LastMinute` bots. **Gen-2
later falsified most of these:** over 169 windows `FavoriteLongshot[longshot]`
and every longshot buyer went fully **bust** (the favorite-longshot bias,
exactly as the literature predicts), the winning `MomentumEdge` *parameter*
flipped, and a random bot finished top-10. Treat every "survivor" as regime-fit
until it clears the noise band across generations — the full per-strategy record
is in **Appendix B — Complete Strategy Ledger**. **Retained as controls:** `AlwaysSide[Up/Down]`
and `RandomBaseline[seed=1/2]` — reference lines to test whether gen-2 actually
beats naive play. **Retired:** `MeanRevert`, `ContrarianClose`, `ScalpSpread`,
`TrendFollowEMA`, `CrossExchangeSpread`, and the losing configs of the kept
families.

**8 new families (88 bots), each motivated by a finding above:**

| New family | Idea | Targets finding |
|---|---|---|
| `KellyEdge` | edge entry **sized by fractional Kelly** instead of flat stake | sizing confidence (2) |
| `VolGatedMomentum` | only bet windows with a real move, then take it with edge | delay tax / conviction (5) |
| `EarlyValue` | buy the leading side **early** while still cheap, hold | beat the delay (5), get in before pricing |
| `ConsensusMomentum` | require **Binance *and* Coinbase** to agree on direction | use both feeds, filter noise |
| `LongshotValue` | buy the cheap side **only when the model says it's underpriced** | longshot value, done right (4) |
| `DriftHold` | buy the mildly-favored side (mid in a band), hold | avoid extremes & coin-flips |
| `AdaptiveTime` | longshot early, favorite late, hold | timing structure (3) |
| `MeanRevertEarly` | mean-revert **only early** in the window, never at the close | fix what killed MeanRevert (3) |

All new strategies **hold to resolution** (no take-profit churn), per finding (1).
Total gen-2 roster: **108 bots**.

---

## 6. Limitations (read before trusting any number)

- **Sample size & regime.** 48 windows in a single, mildly *up-trending* stretch.
  Survivors that held "Up" are flattered by the regime; survival here is
  **provisional, not proven skill**. This is exactly why the controls are kept.
- **Realized vs. unrealized.** The live leaderboard mixes settled P/L with
  open-position mark-to-mid; selection here used **realized** only.
- **Correlated bots.** Many bots hold the same side in the same window, so the
  aggregate P/L is far noisier than "108 independent agents" implies.
- **Friction modeling.** Crossing the spread *and* adding a 1-tick slippage may
  slightly over-tax entries; gen-2 leaves this unchanged for comparability but it
  is a single `config.js` knob.
- **Resolution proxy.** We settle on Binance spot BTCUSDT 5-minute candles;
  Polymarket's exact reference source/venue may differ marginally.
- **No transaction-cost edge case** (Polymarket taker fee modeled at 0 bps, the
  current default; the engine supports nonzero fees and books them correctly).

---

## 7. Conclusion

On efficient 5-minute binary markets, **naive systematic strategies lose to
friction and latency** — the always-one-side benchmark pins that cost at ≈\$2 per
round trip, and most families do worse by making genuinely poor directional
bets. The few configurations that made money shared a clear profile: **low
entry-edge, modest volatility assumption, and holding to resolution.** Generation
2 keeps those winners, retires the losers, and tests 8 new ideas built directly
on these findings — while keeping naive controls so that any gen-2 "edge" must
prove itself against both random play and a single-side hold, across more windows
and more market regimes than this first run observed.

---

## Appendix: reproducibility

- **Code:** strategy roster in [`src/engine/strategies.js`](src/engine/strategies.js);
  all parameters in [`config.js`](config.js).
- **Raw gen-1 data:** archived under [`results/gen1/`](results/gen1/) —
  `snapshot.json` (full final leaderboard), `trades.jsonl` (every trade),
  `leaderboard.csv`, `report.md`, `state.json`.
- **Re-run:** `npm start` (the engine rebuilds the roster from
  `buildBotSpecs()`); `npm run report` prints the current standings.
- **Figures in this paper** were computed directly from the gen-1 snapshot at
  48 resolved windows.

<!-- LEDGER:START -->
## Appendix B — Complete Strategy Ledger (all generations)

_Auto-generated by `npm run ledger`. Every strategy ever run, with its locked-in stats. This is the evidence base for designing future bots — hand it to the btcbot Statistician._

> **How to read it.** Judge on **Realized** P/L (settled), not Total (which includes open mark-to-mid). The **noise band** is the gap between the luckiest and unluckiest *identical* random bots in that run; any strategy inside it is statistically indistinguishable from luck. `vs?` flags whether a bot beat (↑), tied (≈), or lost to (↓) that band. A real edge must clear the band **and** repeat across regimes (compare the same family between generations).

### Generation 1 — 107 bots · 48 windows · down-leaning sample

- **Combined realized P/L:** -$26,693.55
- **Noise band** (luck floor↔ceiling, from identical random bots): [-$139.81, +$170.49] — anything inside ≈ random
- **Direction controls:** AlwaysUp -$228.69 · AlwaysDown +$21.28
- **Busts** (lost ≥ 99.5% of bankroll): 4

| # | Strategy | Realized | Total | Trades | Win% | Avg/Tr | vs? |
|--:|---|--:|--:|--:|--:|--:|:-:|
| 1 | MomentumEdge[edge=0.04,vol=0.0006,tp=null] | +$572.05 | +$572.05 | 49 | 47% | +$11.67 | ↑ |
| 2 | MomentumEdge[edge=0.02,vol=0.0006,tp=null] | +$549.52 | +$549.52 | 49 | 45% | +$11.21 | ↑ |
| 3 | ImpliedVsModel[edge=0.03,vol=0.0007] | +$543.11 | +$500.03 | 48 | 58% | +$11.31 | ↑ |
| 4 | MomentumEdge[edge=0.02,vol=0.001,tp=null] | +$351.76 | +$351.76 | 49 | 39% | +$7.18 | ↑ |
| 5 | ImpliedVsModel[edge=0.05,vol=0.0007] | +$273.60 | +$231.16 | 48 | 52% | +$5.70 | ↑ |
| 6 | MomentumEdge[edge=0.02,vol=0.0016,tp=null] | +$270.63 | +$270.63 | 49 | 37% | +$5.52 | ↑ |
| 7 | MomentumEdge[edge=0.06,vol=0.0006,tp=null] | +$210.41 | +$210.41 | 48 | 40% | +$4.38 | ↑ |
| 8 | ImpliedVsModel[edge=0.14,vol=0.0007] | +$189.97 | +$149.82 | 38 | 39% | +$5.00 | ↑ |
| 9 | FavoriteLongshot[mode=longshot,cap=0.65] | +$178.29 | +$217.92 | 48 | 52% | +$3.71 | ↑ |
| 10 | FavoriteLongshot[mode=longshot,cap=0.78] | +$178.29 | +$217.92 | 48 | 52% | +$3.71 | ↑ |
| 11 | FavoriteLongshot[mode=longshot,cap=0.9] | +$178.29 | +$217.92 | 48 | 52% | +$3.71 | ↑ |
| 12 | RandomBaseline[seed=2,p=0.5] | +$170.49 | +$170.49 | 24 | 58% | +$7.10 | ≈ |
| 13 | MomentumEdge[edge=0.12,vol=0.0006,tp=null] | +$101.62 | +$101.62 | 41 | 29% | +$2.48 | ≈ |
| 14 | ImpliedVsModel[edge=0.03,vol=0.0018] | +$95.69 | +$52.61 | 48 | 48% | +$1.99 | ≈ |
| 15 | ImpliedVsModel[edge=0.03,vol=0.0012] | +$92.88 | +$49.79 | 48 | 48% | +$1.93 | ≈ |
| 16 | RandomBaseline[seed=1,p=0.5] | +$74.20 | +$74.20 | 24 | 54% | +$3.09 | ≈ |
| 17 | MomentumEdge[edge=0.04,vol=0.001,tp=null] | +$54.96 | +$54.96 | 49 | 33% | +$1.12 | ≈ |
| 18 | LastMinute[window=135,moveThresh=0.0006] | +$44.36 | +$44.36 | 10 | 100% | +$4.44 | ≈ |
| 19 | LastMinute[window=105,moveThresh=0.0006] | +$33.37 | +$33.37 | 7 | 100% | +$4.77 | ≈ |
| 20 | AlwaysSide[side=Down] | +$21.28 | +$60.91 | 48 | 52% | +$0.44 | ≈ |
| 21 | LastMinute[window=135,moveThresh=0.0003] | +$19.17 | +$19.17 | 34 | 82% | +$0.56 | ≈ |
| 22 | LastMinute[window=135,moveThresh=0.001] | +$3.76 | +$3.76 | 1 | 100% | +$3.76 | ≈ |
| 23 | LastMinute[window=75,moveThresh=0.0006] | +$3.24 | +$3.24 | 1 | 100% | +$3.24 | ≈ |
| 24 | LastMinute[window=45,moveThresh=0.0006] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 25 | LastMinute[window=45,moveThresh=0.001] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 26 | LastMinute[window=75,moveThresh=0.001] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 27 | LastMinute[window=105,moveThresh=0.001] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 28 | MomentumEdge[edge=0.06,vol=0.0006,tp=0.06] | -$3.91 | -$3.91 | 48 | 81% | -$0.08 | ≈ |
| 29 | MomentumEdge[edge=0.04,vol=0.0006,tp=0.06] | -$9.90 | -$9.90 | 49 | 80% | -$0.20 | ≈ |
| 30 | LastMinute[window=105,moveThresh=0.0003] | -$13.42 | -$13.42 | 29 | 83% | -$0.46 | ≈ |
| 31 | RandomBaseline[seed=4,p=0.5] | -$21.56 | -$21.56 | 20 | 50% | -$1.08 | ≈ |
| 32 | LastMinute[window=75,moveThresh=0.0003] | -$37.29 | -$37.29 | 21 | 76% | -$1.78 | ≈ |
| 33 | MomentumEdge[edge=0.09,vol=0.0006,tp=0.06] | -$41.26 | -$41.26 | 47 | 77% | -$0.88 | ≈ |
| 34 | LastMinute[window=45,moveThresh=0.0003] | -$52.30 | -$52.30 | 17 | 76% | -$3.08 | ≈ |
| 35 | ImpliedVsModel[edge=0.07,vol=0.0007] | -$83.81 | -$125.26 | 46 | 43% | -$1.82 | ≈ |
| 36 | MomentumEdge[edge=0.09,vol=0.0006,tp=null] | -$104.89 | -$104.89 | 47 | 30% | -$2.23 | ≈ |
| 37 | MomentumEdge[edge=0.04,vol=0.001,tp=0.06] | -$120.39 | -$120.39 | 49 | 71% | -$2.46 | ≈ |
| 38 | MomentumEdge[edge=0.12,vol=0.0006,tp=0.06] | -$121.60 | -$121.60 | 41 | 63% | -$2.97 | ≈ |
| 39 | ScalpSpread[maxAsk=0.35,target=0.05,sl=0.1] | -$124.24 | -$124.24 | 49 | 59% | -$2.54 | ≈ |
| 40 | ScalpSpread[maxAsk=0.35,target=0.03,sl=0.1] | -$137.73 | -$137.73 | 49 | 67% | -$2.81 | ≈ |
| 41 | MomentumEdge[edge=0.02,vol=0.0006,tp=0.06] | -$139.30 | -$139.30 | 49 | 69% | -$2.84 | ≈ |
| 42 | RandomBaseline[seed=3,p=0.5] | -$139.81 | -$183.88 | 21 | 43% | -$6.66 | ≈ |
| 43 | MomentumEdge[edge=0.12,vol=0.0016,tp=0.06] | -$140.71 | -$140.71 | 49 | 67% | -$2.87 | ↓ |
| 44 | MomentumEdge[edge=0.06,vol=0.001,tp=0.06] | -$144.93 | -$144.93 | 49 | 71% | -$2.96 | ↓ |
| 45 | ScalpSpread[maxAsk=0.35,target=0.08,sl=0.1] | -$145.71 | -$145.71 | 49 | 51% | -$2.97 | ↓ |
| 46 | MomentumEdge[edge=0.06,vol=0.0016,tp=0.06] | -$146.38 | -$146.38 | 49 | 69% | -$2.99 | ↓ |
| 47 | MomentumEdge[edge=0.09,vol=0.001,tp=0.06] | -$148.19 | -$148.19 | 47 | 70% | -$3.15 | ↓ |
| 48 | TrendFollowEMA[fast=5,slow=20] | -$181.39 | -$141.76 | 48 | 46% | -$3.78 | ↓ |
| 49 | MomentumEdge[edge=0.02,vol=0.001,tp=0.06] | -$182.65 | -$182.65 | 49 | 65% | -$3.73 | ↓ |
| 50 | MomentumEdge[edge=0.02,vol=0.0016,tp=0.06] | -$186.54 | -$186.54 | 49 | 65% | -$3.81 | ↓ |
| 51 | ScalpSpread[maxAsk=0.42,target=0.03,sl=0.1] | -$213.65 | -$213.65 | 49 | 61% | -$4.36 | ↓ |
| 52 | AlwaysSide[side=Up] | -$228.69 | -$272.76 | 48 | 48% | -$4.76 | ↓ |
| 53 | ImpliedVsModel[edge=0.1,vol=0.0007] | -$228.73 | -$270.48 | 44 | 34% | -$5.20 | ↓ |
| 54 | CrossExchangeSpread[thresh=2] | -$230.24 | -$274.31 | 47 | 47% | -$4.90 | ↓ |
| 55 | CrossExchangeSpread[thresh=4] | -$230.24 | -$274.31 | 47 | 47% | -$4.90 | ↓ |
| 56 | CrossExchangeSpread[thresh=7] | -$230.24 | -$274.31 | 47 | 47% | -$4.90 | ↓ |
| 57 | CrossExchangeSpread[thresh=12] | -$230.24 | -$274.31 | 47 | 47% | -$4.90 | ↓ |
| 58 | ScalpSpread[maxAsk=0.42,target=0.05,sl=0.1] | -$231.56 | -$231.56 | 49 | 53% | -$4.73 | ↓ |
| 59 | TrendFollowEMA[fast=3,slow=12] | -$236.52 | -$196.89 | 48 | 46% | -$4.93 | ↓ |
| 60 | ScalpSpread[maxAsk=0.48,target=0.08,sl=0.1] | -$239.66 | -$239.66 | 49 | 45% | -$4.89 | ↓ |
| 61 | MomentumEdge[edge=0.04,vol=0.0016,tp=null] | -$242.87 | -$242.87 | 49 | 24% | -$4.96 | ↓ |
| 62 | ScalpSpread[maxAsk=0.48,target=0.05,sl=0.1] | -$250.59 | -$250.59 | 49 | 51% | -$5.11 | ↓ |
| 63 | MomentumEdge[edge=0.04,vol=0.0016,tp=0.06] | -$252.41 | -$252.41 | 49 | 63% | -$5.15 | ↓ |
| 64 | ScalpSpread[maxAsk=0.48,target=0.03,sl=0.1] | -$261.48 | -$261.48 | 49 | 53% | -$5.34 | ↓ |
| 65 | MeanRevert[low=0.2,high=0.65,tp=0.06] | -$269.04 | -$303.56 | 48 | 63% | -$5.60 | ↓ |
| 66 | TrendFollowEMA[fast=8,slow=30] | -$269.38 | -$229.75 | 48 | 44% | -$5.61 | ↓ |
| 67 | ImpliedVsModel[edge=0.05,vol=0.0012] | -$282.80 | -$325.24 | 48 | 38% | -$5.89 | ↓ |
| 68 | MeanRevert[low=0.28,high=0.65,tp=0.06] | -$298.36 | -$298.36 | 49 | 63% | -$6.09 | ↓ |
| 69 | MomentumEdge[edge=0.09,vol=0.0016,tp=0.06] | -$299.84 | -$299.84 | 49 | 61% | -$6.12 | ↓ |
| 70 | ScalpSpread[maxAsk=0.42,target=0.08,sl=0.1] | -$308.98 | -$308.98 | 49 | 41% | -$6.31 | ↓ |
| 71 | MomentumEdge[edge=0.12,vol=0.001,tp=0.06] | -$310.54 | -$310.54 | 46 | 63% | -$6.75 | ↓ |
| 72 | ImpliedVsModel[edge=0.05,vol=0.0018] | -$311.42 | -$353.86 | 48 | 38% | -$6.49 | ↓ |
| 73 | MeanRevert[low=0.2,high=0.65,tp=0.1] | -$358.21 | -$392.73 | 48 | 56% | -$7.46 | ↓ |
| 74 | TrendFollowEMA[fast=10,slow=40] | -$374.37 | -$334.74 | 48 | 42% | -$7.80 | ↓ |
| 75 | FavoriteLongshot[mode=favorite,cap=0.65] | -$377.33 | -$421.40 | 47 | 47% | -$8.03 | ↓ |
| 76 | MeanRevert[low=0.35,high=0.65,tp=0.06] | -$381.38 | -$381.38 | 49 | 57% | -$7.78 | ↓ |
| 77 | FavoriteLongshot[mode=favorite,cap=0.78] | -$387.25 | -$431.32 | 47 | 47% | -$8.24 | ↓ |
| 78 | FavoriteLongshot[mode=favorite,cap=0.9] | -$387.25 | -$431.32 | 47 | 47% | -$8.24 | ↓ |
| 79 | MeanRevert[low=0.28,high=0.65,tp=0.1] | -$436.97 | -$436.97 | 49 | 51% | -$8.92 | ↓ |
| 80 | MeanRevert[low=0.2,high=0.72,tp=0.06] | -$446.91 | -$481.44 | 48 | 56% | -$9.31 | ↓ |
| 81 | MomentumEdge[edge=0.06,vol=0.001,tp=null] | -$450.41 | -$450.41 | 49 | 20% | -$9.19 | ↓ |
| 82 | ImpliedVsModel[edge=0.07,vol=0.0012] | -$453.69 | -$496.13 | 48 | 33% | -$9.45 | ↓ |
| 83 | MeanRevert[low=0.35,high=0.65,tp=0.1] | -$456.00 | -$456.00 | 49 | 49% | -$9.31 | ↓ |
| 84 | ImpliedVsModel[edge=0.14,vol=0.0012] | -$458.54 | -$499.65 | 45 | 24% | -$10.19 | ↓ |
| 85 | MomentumEdge[edge=0.06,vol=0.0016,tp=null] | -$486.46 | -$486.46 | 49 | 18% | -$9.93 | ↓ |
| 86 | MeanRevert[low=0.35,high=0.72,tp=0.06] | -$494.40 | -$494.40 | 49 | 53% | -$10.09 | ↓ |
| 87 | MeanRevert[low=0.28,high=0.72,tp=0.06] | -$537.71 | -$537.71 | 49 | 55% | -$10.97 | ↓ |
| 88 | ImpliedVsModel[edge=0.07,vol=0.0018] | -$553.49 | -$595.93 | 48 | 31% | -$11.53 | ↓ |
| 89 | MeanRevert[low=0.35,high=0.72,tp=0.1] | -$577.92 | -$577.92 | 49 | 45% | -$11.79 | ↓ |
| 90 | MeanRevert[low=0.2,high=0.72,tp=0.1] | -$619.76 | -$654.28 | 48 | 48% | -$12.91 | ↓ |
| 91 | MomentumEdge[edge=0.12,vol=0.001,tp=null] | -$649.85 | -$649.85 | 46 | 17% | -$14.13 | ↓ |
| 92 | MeanRevert[low=0.28,high=0.72,tp=0.1] | -$674.98 | -$674.98 | 49 | 43% | -$13.78 | ↓ |
| 93 | MeanRevert[low=0.2,high=0.8,tp=0.06] | -$700.94 | -$735.46 | 48 | 48% | -$14.60 | ↓ |
| 94 | MeanRevert[low=0.28,high=0.8,tp=0.06] | -$712.19 | -$712.19 | 49 | 49% | -$14.53 | ↓ |
| 95 | MeanRevert[low=0.35,high=0.8,tp=0.06] | -$769.43 | -$769.43 | 49 | 45% | -$15.70 | ↓ |
| 96 | ImpliedVsModel[edge=0.14,vol=0.0018] | -$783.79 | -$824.90 | 48 | 21% | -$16.33 | ↓ |
| 97 | MeanRevert[low=0.35,high=0.8,tp=0.1] | -$851.54 | -$851.54 | 49 | 37% | -$17.38 | ↓ |
| 98 | MomentumEdge[edge=0.09,vol=0.0016,tp=null] | -$857.63 | -$857.63 | 49 | 12% | -$17.50 | ↓ |
| 99 | MeanRevert[low=0.28,high=0.8,tp=0.1] | -$864.61 | -$864.61 | 49 | 37% | -$17.65 | ↓ |
| 100 | MeanRevert[low=0.2,high=0.8,tp=0.1] | -$881.96 | -$916.49 | 48 | 40% | -$18.37 | ↓ |
| 101 | ContrarianClose[window=150] | -$889.55 | -$857.54 | 48 | 23% | -$18.53 | ↓ |
| 102 | ImpliedVsModel[edge=0.1,vol=0.0018] | -$964.57 | -$993.94 | 48 | 23% | -$20.10 | ↓ |
| 103 | MomentumEdge[edge=0.12,vol=0.0016,tp=null] | -$983.28 | -$983.28 | 49 | 10% | -$20.07 | ↓ |
| 104 | MomentumEdge[edge=0.09,vol=0.001,tp=null] | -$996.73 | -$996.73 | 47 | 11% | -$21.21 | ↓ |
| 105 | ImpliedVsModel[edge=0.1,vol=0.0012] | -$1,000.00 | -$1,000.00 | 46 | 20% | -$21.74 | ↓ |
| 106 | ContrarianClose[window=90] | -$1,000.00 | -$1,000.00 | 46 | 17% | -$21.74 | ↓ |
| 107 | ContrarianClose[window=45] | -$1,000.00 | -$1,000.00 | 45 | 13% | -$22.22 | ↓ |

---

### Generation 2 — 108 bots · 169 windows · down-leaning sample

- **Combined realized P/L:** -$44,384.32
- **Noise band** (luck floor↔ceiling, from identical random bots): [-$514.39, +$356.79] — anything inside ≈ random
- **Direction controls:** AlwaysUp -$999.29 · AlwaysDown +$142.42
- **Busts** (lost ≥ 99.5% of bankroll): 16

| # | Strategy | Realized | Total | Trades | Win% | Avg/Tr | vs? |
|--:|---|--:|--:|--:|--:|--:|:-:|
| 1 | MomentumEdge[edge=0.12,vol=0.0006,tp=null] | +$858.31 | +$858.31 | 143 | 38% | +$6.00 | ↑ |
| 2 | DriftHold[lo=0.52,hi=0.68] | +$529.31 | +$560.04 | 169 | 64% | +$3.13 | ↑ |
| 3 | EarlyValue[maxFrac=0.5,minRet=0.0002] | +$518.79 | +$518.79 | 76 | 62% | +$6.83 | ↑ |
| 4 | EarlyValue[maxFrac=0.3,minRet=0.0002] | +$493.21 | +$493.21 | 62 | 63% | +$7.96 | ↑ |
| 5 | ConsensusMomentum[minRet=0.0003,edge=0.03] | +$441.75 | +$441.75 | 77 | 69% | +$5.74 | ↑ |
| 6 | MomentumEdge[edge=0.06,vol=0.0006,tp=null] | +$440.49 | +$440.49 | 170 | 32% | +$2.59 | ↑ |
| 7 | RandomBaseline[seed=1,p=0.5] | +$356.79 | +$356.79 | 87 | 57% | +$4.10 | ≈ |
| 8 | MomentumEdge[edge=0.04,vol=0.0006,tp=null] | +$253.77 | +$253.77 | 170 | 32% | +$1.49 | ≈ |
| 9 | VolGatedMomentum[gate=0.0008,edge=0.02] | +$234.54 | +$234.54 | 24 | 96% | +$9.77 | ≈ |
| 10 | ImpliedVsModel[edge=0.03,vol=0.0007] | +$223.79 | +$175.55 | 169 | 47% | +$1.32 | ≈ |
| 11 | ConsensusMomentum[minRet=0.0006,edge=0.03] | +$221.56 | +$221.56 | 30 | 83% | +$7.39 | ≈ |
| 12 | VolGatedMomentum[gate=0.0008,edge=0.04] | +$212.26 | +$212.26 | 17 | 94% | +$12.49 | ≈ |
| 13 | VolGatedMomentum[gate=0.0008,edge=0.06] | +$195.58 | +$195.58 | 15 | 93% | +$13.04 | ≈ |
| 14 | VolGatedMomentum[gate=0.0004,edge=0.02] | +$179.93 | +$179.93 | 65 | 74% | +$2.77 | ≈ |
| 15 | ConsensusMomentum[minRet=0.0006,edge=0.06] | +$178.62 | +$178.62 | 24 | 79% | +$7.44 | ≈ |
| 16 | AlwaysSide[side=Down] | +$142.42 | +$94.18 | 169 | 53% | +$0.84 | ≈ |
| 17 | DriftHold[lo=0.58,hi=0.75] | +$142.05 | +$172.78 | 169 | 65% | +$0.84 | ≈ |
| 18 | DriftHold[lo=0.5,hi=0.62] | +$129.95 | +$160.69 | 167 | 59% | +$0.78 | ≈ |
| 19 | ConsensusMomentum[minRet=0.001,edge=0.03] | +$121.76 | +$121.76 | 12 | 100% | +$10.15 | ≈ |
| 20 | EarlyValue[maxFrac=0.3,minRet=0.0004] | +$111.75 | +$111.75 | 8 | 63% | +$13.97 | ≈ |
| 21 | ConsensusMomentum[minRet=0.001,edge=0.06] | +$111.41 | +$111.41 | 9 | 100% | +$12.38 | ≈ |
| 22 | EarlyValue[maxFrac=0.5,minRet=0.0004] | +$109.50 | +$109.50 | 10 | 60% | +$10.95 | ≈ |
| 23 | VolGatedMomentum[gate=0.0004,edge=0.04] | +$107.24 | +$107.24 | 54 | 69% | +$1.99 | ≈ |
| 24 | EarlyValue[maxFrac=0.5,minRet=0.0007] | +$105.25 | +$105.25 | 3 | 100% | +$35.08 | ≈ |
| 25 | ConsensusMomentum[minRet=0.0003,edge=0.06] | +$97.93 | +$97.93 | 68 | 63% | +$1.44 | ≈ |
| 26 | VolGatedMomentum[gate=0.0004,edge=0.06] | +$91.94 | +$91.94 | 49 | 67% | +$1.88 | ≈ |
| 27 | LastMinute[window=105,moveThresh=0.0006] | +$75.18 | +$75.18 | 28 | 93% | +$2.68 | ≈ |
| 28 | EarlyValue[maxFrac=0.3,minRet=0.0007] | +$71.91 | +$71.91 | 2 | 100% | +$35.96 | ≈ |
| 29 | VolGatedMomentum[gate=0.0012,edge=0.02] | +$71.62 | +$71.62 | 9 | 100% | +$7.96 | ≈ |
| 30 | VolGatedMomentum[gate=0.0012,edge=0.04] | +$63.58 | +$63.58 | 6 | 100% | +$10.60 | ≈ |
| 31 | LastMinute[window=135,moveThresh=0.0006] | +$62.73 | +$65.69 | 44 | 91% | +$1.43 | ≈ |
| 32 | VolGatedMomentum[gate=0.0012,edge=0.06] | +$51.14 | +$51.14 | 4 | 100% | +$12.78 | ≈ |
| 33 | LastMinute[window=135,moveThresh=0.0003] | +$40.49 | +$43.45 | 128 | 83% | +$0.32 | ≈ |
| 34 | ImpliedVsModel[edge=0.14,vol=0.0007] | +$22.16 | +$22.16 | 137 | 43% | +$0.16 | ≈ |
| 35 | VolGatedMomentum[gate=0.0016,edge=0.02] | +$3.65 | +$3.65 | 2 | 100% | +$1.83 | ≈ |
| 36 | VolGatedMomentum[gate=0.0016,edge=0.04] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 37 | VolGatedMomentum[gate=0.0016,edge=0.06] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 38 | EarlyValue[maxFrac=0.3,minRet=0.001] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 39 | EarlyValue[maxFrac=0.5,minRet=0.001] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 40 | ImpliedVsModel[edge=0.05,vol=0.0007] | -$31.08 | -$79.32 | 169 | 44% | -$0.18 | ≈ |
| 41 | MomentumEdge[edge=0.04,vol=0.001,tp=null] | -$95.38 | -$95.38 | 170 | 29% | -$0.56 | ≈ |
| 42 | KellyEdge[vol=0.0007,kelly=0.25,minEdge=0.04] | -$144.65 | -$176.11 | 169 | 47% | -$0.86 | ≈ |
| 43 | DriftHold[lo=0.55,hi=0.72] | -$190.83 | -$160.09 | 169 | 61% | -$1.13 | ≈ |
| 44 | MomentumEdge[edge=0.02,vol=0.0006,tp=null] | -$217.86 | -$217.86 | 170 | 28% | -$1.28 | ≈ |
| 45 | KellyEdge[vol=0.0007,kelly=0.25,minEdge=0.06] | -$265.62 | -$292.63 | 169 | 43% | -$1.57 | ≈ |
| 46 | KellyEdge[vol=0.0007,kelly=0.25,minEdge=0.02] | -$321.02 | -$345.99 | 169 | 46% | -$1.90 | ≈ |
| 47 | ImpliedVsModel[edge=0.03,vol=0.0012] | -$388.99 | -$437.23 | 169 | 43% | -$2.30 | ≈ |
| 48 | KellyEdge[vol=0.0007,kelly=0.25,minEdge=0.1] | -$394.17 | -$394.17 | 163 | 42% | -$2.42 | ≈ |
| 49 | KellyEdge[vol=0.0012,kelly=0.25,minEdge=0.04] | -$399.37 | -$421.46 | 169 | 41% | -$2.36 | ≈ |
| 50 | KellyEdge[vol=0.0007,kelly=0.5,minEdge=0.04] | -$400.21 | -$444.34 | 169 | 47% | -$2.37 | ≈ |
| 51 | MomentumEdge[edge=0.02,vol=0.001,tp=null] | -$419.72 | -$419.72 | 170 | 26% | -$2.47 | ≈ |
| 52 | KellyEdge[vol=0.0012,kelly=0.25,minEdge=0.02] | -$445.30 | -$465.70 | 169 | 41% | -$2.63 | ≈ |
| 53 | KellyEdge[vol=0.0018,kelly=0.25,minEdge=0.04] | -$483.27 | -$502.28 | 169 | 39% | -$2.86 | ≈ |
| 54 | KellyEdge[vol=0.0012,kelly=0.25,minEdge=0.06] | -$485.85 | -$504.76 | 169 | 37% | -$2.87 | ≈ |
| 55 | KellyEdge[vol=0.0007,kelly=0.25,minEdge=0.08] | -$493.02 | -$511.67 | 167 | 43% | -$2.95 | ≈ |
| 56 | RandomBaseline[seed=2,p=0.5] | -$514.39 | -$562.63 | 87 | 47% | -$5.91 | ≈ |
| 57 | KellyEdge[vol=0.0018,kelly=0.25,minEdge=0.06] | -$514.95 | -$532.78 | 169 | 38% | -$3.05 | ↓ |
| 58 | KellyEdge[vol=0.0018,kelly=0.25,minEdge=0.02] | -$522.79 | -$540.34 | 169 | 38% | -$3.09 | ↓ |
| 59 | KellyEdge[vol=0.0007,kelly=0.5,minEdge=0.06] | -$565.20 | -$597.19 | 169 | 43% | -$3.34 | ↓ |
| 60 | KellyEdge[vol=0.0007,kelly=0.5,minEdge=0.02] | -$593.35 | -$623.27 | 169 | 46% | -$3.51 | ↓ |
| 61 | KellyEdge[vol=0.0012,kelly=0.25,minEdge=0.08] | -$644.65 | -$657.72 | 168 | 36% | -$3.84 | ↓ |
| 62 | KellyEdge[vol=0.0018,kelly=0.25,minEdge=0.08] | -$676.72 | -$688.61 | 169 | 34% | -$4.00 | ↓ |
| 63 | KellyEdge[vol=0.0012,kelly=0.25,minEdge=0.1] | -$681.64 | -$693.29 | 166 | 34% | -$4.11 | ↓ |
| 64 | KellyEdge[vol=0.0018,kelly=0.25,minEdge=0.1] | -$702.40 | -$714.27 | 169 | 33% | -$4.16 | ↓ |
| 65 | KellyEdge[vol=0.0012,kelly=0.5,minEdge=0.04] | -$718.42 | -$739.13 | 169 | 41% | -$4.25 | ↓ |
| 66 | MomentumEdge[edge=0.02,vol=0.0016,tp=null] | -$738.62 | -$738.62 | 170 | 24% | -$4.34 | ↓ |
| 67 | KellyEdge[vol=0.0012,kelly=0.5,minEdge=0.02] | -$755.41 | -$773.40 | 169 | 41% | -$4.47 | ↓ |
| 68 | KellyEdge[vol=0.0007,kelly=1,minEdge=0.1] | -$763.47 | -$763.47 | 163 | 42% | -$4.68 | ↓ |
| 69 | KellyEdge[vol=0.0018,kelly=0.5,minEdge=0.04] | -$793.66 | -$808.84 | 169 | 39% | -$4.70 | ↓ |
| 70 | KellyEdge[vol=0.0012,kelly=0.5,minEdge=0.06] | -$807.12 | -$821.31 | 169 | 37% | -$4.78 | ↓ |
| 71 | KellyEdge[vol=0.0007,kelly=0.5,minEdge=0.1] | -$808.70 | -$808.70 | 163 | 42% | -$4.96 | ↓ |
| 72 | LongshotValue[maxPrice=0.4,vol=0.0008] | -$814.84 | -$863.09 | 167 | 34% | -$4.88 | ↓ |
| 73 | KellyEdge[vol=0.0018,kelly=0.5,minEdge=0.02] | -$820.31 | -$833.53 | 169 | 38% | -$4.85 | ↓ |
| 74 | KellyEdge[vol=0.0018,kelly=0.5,minEdge=0.06] | -$829.99 | -$842.49 | 169 | 38% | -$4.91 | ↓ |
| 75 | KellyEdge[vol=0.0007,kelly=1,minEdge=0.04] | -$834.52 | -$858.86 | 169 | 47% | -$4.94 | ↓ |
| 76 | KellyEdge[vol=0.0007,kelly=0.5,minEdge=0.08] | -$835.11 | -$847.24 | 167 | 43% | -$5.00 | ↓ |
| 77 | KellyEdge[vol=0.0007,kelly=1,minEdge=0.02] | -$838.44 | -$862.21 | 169 | 46% | -$4.96 | ↓ |
| 78 | KellyEdge[vol=0.0012,kelly=0.5,minEdge=0.08] | -$917.31 | -$923.39 | 168 | 36% | -$5.46 | ↓ |
| 79 | KellyEdge[vol=0.0018,kelly=0.5,minEdge=0.08] | -$929.53 | -$934.71 | 169 | 34% | -$5.50 | ↓ |
| 80 | KellyEdge[vol=0.0007,kelly=1,minEdge=0.06] | -$938.91 | -$947.89 | 169 | 43% | -$5.56 | ↓ |
| 81 | KellyEdge[vol=0.0012,kelly=0.5,minEdge=0.1] | -$941.40 | -$945.69 | 166 | 34% | -$5.67 | ↓ |
| 82 | KellyEdge[vol=0.0018,kelly=0.5,minEdge=0.1] | -$948.56 | -$952.66 | 169 | 33% | -$5.61 | ↓ |
| 83 | KellyEdge[vol=0.0012,kelly=1,minEdge=0.02] | -$962.89 | -$968.35 | 169 | 41% | -$5.70 | ↓ |
| 84 | KellyEdge[vol=0.0012,kelly=1,minEdge=0.04] | -$965.58 | -$970.64 | 169 | 41% | -$5.71 | ↓ |
| 85 | KellyEdge[vol=0.0018,kelly=1,minEdge=0.02] | -$976.54 | -$979.99 | 169 | 40% | -$5.78 | ↓ |
| 86 | KellyEdge[vol=0.0018,kelly=1,minEdge=0.04] | -$977.39 | -$980.72 | 169 | 40% | -$5.78 | ↓ |
| 87 | KellyEdge[vol=0.0012,kelly=1,minEdge=0.08] | -$985.84 | -$987.92 | 168 | 37% | -$5.87 | ↓ |
| 88 | KellyEdge[vol=0.0018,kelly=1,minEdge=0.06] | -$991.11 | -$992.42 | 166 | 36% | -$5.97 | ↓ |
| 89 | KellyEdge[vol=0.0012,kelly=1,minEdge=0.06] | -$992.29 | -$993.42 | 167 | 37% | -$5.94 | ↓ |
| 90 | KellyEdge[vol=0.0018,kelly=1,minEdge=0.08] | -$992.29 | -$993.42 | 167 | 34% | -$5.94 | ↓ |
| 91 | KellyEdge[vol=0.0007,kelly=1,minEdge=0.08] | -$993.00 | -$994.03 | 167 | 43% | -$5.95 | ↓ |
| 92 | KellyEdge[vol=0.0018,kelly=1,minEdge=0.1] | -$993.78 | -$994.77 | 166 | 33% | -$5.99 | ↓ |
| 93 | AlwaysSide[side=Up] | -$999.29 | -$999.29 | 150 | 47% | -$6.66 | ↓ |
| 94 | KellyEdge[vol=0.0012,kelly=1,minEdge=0.1] | -$999.93 | -$999.93 | 113 | 31% | -$8.85 | ↓ |
| 95 | LongshotValue[maxPrice=0.4,vol=0.0014] | -$1,000.00 | -$1,000.00 | 139 | 34% | -$7.19 | ↓ |
| 96 | ImpliedVsModel[edge=0.03,vol=0.0018] | -$1,000.00 | -$1,000.00 | 127 | 38% | -$7.87 | ↓ |
| 97 | LongshotValue[maxPrice=0.48,vol=0.0008] | -$1,000.00 | -$1,000.00 | 107 | 36% | -$9.35 | ↓ |
| 98 | LongshotValue[maxPrice=0.48,vol=0.0014] | -$1,000.00 | -$1,000.00 | 107 | 36% | -$9.35 | ↓ |
| 99 | MeanRevertEarly[band=0.38,maxFrac=0.5] | -$1,000.00 | -$1,000.00 | 93 | 29% | -$10.75 | ↓ |
| 100 | FavoriteLongshot[mode=longshot,cap=0.9] | -$1,000.00 | -$1,000.00 | 88 | 35% | -$11.36 | ↓ |
| 101 | AdaptiveTime[switchFrac=0.35] | -$1,000.00 | -$1,000.00 | 88 | 35% | -$11.36 | ↓ |
| 102 | AdaptiveTime[switchFrac=0.5] | -$1,000.00 | -$1,000.00 | 88 | 35% | -$11.36 | ↓ |
| 103 | AdaptiveTime[switchFrac=0.65] | -$1,000.00 | -$1,000.00 | 88 | 35% | -$11.36 | ↓ |
| 104 | MeanRevertEarly[band=0.38,maxFrac=0.35] | -$1,000.00 | -$1,000.00 | 88 | 30% | -$11.36 | ↓ |
| 105 | LongshotValue[maxPrice=0.3,vol=0.0008] | -$1,000.00 | -$1,000.00 | 87 | 22% | -$11.49 | ↓ |
| 106 | MeanRevertEarly[band=0.3,maxFrac=0.5] | -$1,000.00 | -$1,000.00 | 79 | 23% | -$12.66 | ↓ |
| 107 | LongshotValue[maxPrice=0.3,vol=0.0014] | -$1,000.00 | -$1,000.00 | 70 | 21% | -$14.29 | ↓ |
| 108 | MeanRevertEarly[band=0.3,maxFrac=0.35] | -$1,000.00 | -$1,000.00 | 50 | 18% | -$20.00 | ↓ |

---

### Generation 3 — 100 bots · 49 windows · up-leaning sample

- **Combined realized P/L:** +$11,358.10
- **Noise band** (luck floor↔ceiling, from identical random bots): [-$328.69, -$119.27] — anything inside ≈ random
- **Direction controls:** AlwaysUp +$825.33 · AlwaysDown -$956.50
- **Busts** (lost ≥ 99.5% of bankroll): 0

| # | Strategy | Realized | Total | Trades | Win% | Avg/Tr | vs? |
|--:|---|--:|--:|--:|--:|--:|:-:|
| 1 | EdgeConverge[edge=0.03,vol=0.0006,minFrac=0] | +$929.44 | +$975.72 | 48 | 67% | +$19.36 | ↑ |
| 2 | KellyConverge[vol=0.0007,kelly=0.25,edge=0.08,minFrac=0] | +$915.92 | +$1,004.57 | 48 | 63% | +$19.08 | ↑ |
| 3 | EdgeConverge[edge=0.03,vol=0.001,minFrac=0] | +$836.77 | +$881.38 | 48 | 65% | +$17.43 | ↑ |
| 4 | AlwaysSide[side=Up] | +$825.33 | +$872.61 | 48 | 67% | +$17.19 | ↑ |
| 5 | EdgeConverge[edge=0.1,vol=0.0006,minFrac=0] | +$706.07 | +$750.68 | 48 | 63% | +$14.71 | ↑ |
| 6 | EdgeConverge[edge=0.05,vol=0.0016,minFrac=0] | +$698.63 | +$653.23 | 48 | 60% | +$14.55 | ↑ |
| 7 | EdgeConverge[edge=0.03,vol=0.0016,minFrac=0] | +$647.99 | +$692.60 | 48 | 60% | +$13.50 | ↑ |
| 8 | KellyConverge[vol=0.0012,kelly=0.25,edge=0.06,minFrac=0] | +$642.30 | +$686.96 | 48 | 60% | +$13.38 | ↑ |
| 9 | EdgeConverge[edge=0.05,vol=0.0006,minFrac=0] | +$618.22 | +$662.83 | 48 | 60% | +$12.88 | ↑ |
| 10 | EdgeConverge[edge=0.07,vol=0.001,minFrac=0] | +$596.14 | +$640.75 | 48 | 58% | +$12.42 | ↑ |
| 11 | EdgeConverge[edge=0.07,vol=0.0016,minFrac=0] | +$568.56 | +$568.56 | 47 | 55% | +$12.10 | ↑ |
| 12 | EdgeConverge[edge=0.1,vol=0.0016,minFrac=0.85] | +$514.78 | +$514.78 | 21 | 62% | +$24.51 | ↑ |
| 13 | KellyConverge[vol=0.0007,kelly=0.25,edge=0.06,minFrac=0] | +$497.62 | +$566.92 | 48 | 56% | +$10.37 | ↑ |
| 14 | EdgeConverge[edge=0.07,vol=0.0006,minFrac=0] | +$489.45 | +$534.06 | 48 | 58% | +$10.20 | ↑ |
| 15 | KellyConverge[vol=0.0012,kelly=0.25,edge=0.08,minFrac=0.85] | +$425.53 | +$425.53 | 24 | 71% | +$17.73 | ↑ |
| 16 | KellyConverge[vol=0.0007,kelly=0.25,edge=0.08,minFrac=0.85] | +$404.30 | +$404.30 | 26 | 73% | +$15.55 | ↑ |
| 17 | KellyConverge[vol=0.0007,kelly=0.1,edge=0.08,minFrac=0] | +$399.38 | +$425.29 | 48 | 63% | +$8.32 | ↑ |
| 18 | EdgeConverge[edge=0.1,vol=0.001,minFrac=0.85] | +$394.44 | +$394.44 | 22 | 73% | +$17.93 | ↑ |
| 19 | KellyConverge[vol=0.0007,kelly=0.25,edge=0.04,minFrac=0] | +$384.73 | +$448.81 | 48 | 60% | +$8.02 | ↑ |
| 20 | EdgeConverge[edge=0.05,vol=0.001,minFrac=0] | +$369.17 | +$413.77 | 48 | 54% | +$7.69 | ↑ |
| 21 | LongshotProbe[lo=0.03,hi=0.1,size=20] | +$356.19 | +$343.19 | 48 | 15% | +$7.42 | ↑ |
| 22 | KellyConverge[vol=0.0012,kelly=0.25,edge=0.08,minFrac=0] | +$333.75 | +$365.52 | 48 | 54% | +$6.95 | ↑ |
| 23 | EdgeConverge[edge=0.1,vol=0.001,minFrac=0] | +$267.94 | +$284.03 | 48 | 54% | +$5.58 | ↑ |
| 24 | KellyConverge[vol=0.0012,kelly=0.1,edge=0.06,minFrac=0] | +$258.88 | +$272.57 | 48 | 60% | +$5.39 | ↑ |
| 25 | KellyConverge[vol=0.0007,kelly=0.1,edge=0.06,minFrac=0] | +$237.74 | +$260.65 | 48 | 56% | +$4.95 | ↑ |
| 26 | KellyConverge[vol=0.0007,kelly=0.1,edge=0.08,minFrac=0.85] | +$232.39 | +$232.39 | 26 | 73% | +$8.94 | ↑ |
| 27 | KellyConverge[vol=0.0007,kelly=0.25,edge=0.06,minFrac=0.85] | +$216.91 | +$216.91 | 27 | 74% | +$8.03 | ↑ |
| 28 | LongshotProbe[lo=0.1,hi=0.2,size=20] | +$211.34 | +$194.84 | 48 | 23% | +$4.40 | ↑ |
| 29 | KellyConverge[vol=0.0012,kelly=0.1,edge=0.08,minFrac=0.85] | +$194.96 | +$194.96 | 24 | 71% | +$8.12 | ↑ |
| 30 | EdgeConverge[edge=0.07,vol=0.0016,minFrac=0.85] | +$181.25 | +$181.25 | 22 | 59% | +$8.24 | ↑ |
| 31 | ConsensusEdge[minRet=0.0003,edge=0.07] | +$179.67 | +$211.45 | 29 | 59% | +$6.20 | ↑ |
| 32 | KellyConverge[vol=0.0012,kelly=0.25,edge=0.04,minFrac=0] | +$179.42 | +$211.50 | 48 | 54% | +$3.74 | ↑ |
| 33 | FavoriteValue[lo=0.55,hi=0.85,reqEdge=0.08] | +$178.63 | +$192.11 | 32 | 69% | +$5.58 | ↑ |
| 34 | KellyConverge[vol=0.0007,kelly=0.25,edge=0.04,minFrac=0.85] | +$165.14 | +$165.14 | 29 | 76% | +$5.69 | ↑ |
| 35 | KellyConverge[vol=0.0012,kelly=0.1,edge=0.08,minFrac=0] | +$163.81 | +$175.99 | 48 | 54% | +$3.41 | ↑ |
| 36 | EdgeConverge[edge=0.07,vol=0.001,minFrac=0.85] | +$147.88 | +$147.88 | 26 | 73% | +$5.69 | ↑ |
| 37 | EdgeConverge[edge=0.1,vol=0.0006,minFrac=0.85] | +$147.26 | +$147.26 | 25 | 72% | +$5.89 | ↑ |
| 38 | EdgeConverge[edge=0.07,vol=0.0006,minFrac=0.85] | +$137.04 | +$137.04 | 27 | 74% | +$5.08 | ↑ |
| 39 | EdgeConverge[edge=0.1,vol=0.0006,minFrac=0.6] | +$136.26 | +$141.72 | 34 | 65% | +$4.01 | ↑ |
| 40 | KellyConverge[vol=0.0007,kelly=0.1,edge=0.06,minFrac=0.85] | +$133.81 | +$133.81 | 27 | 74% | +$4.96 | ↑ |
| 41 | ConsensusEdge[minRet=0.0006,edge=0.07] | +$132.88 | +$145.54 | 27 | 67% | +$4.92 | ↑ |
| 42 | KellyConverge[vol=0.0007,kelly=0.1,edge=0.04,minFrac=0] | +$123.51 | +$144.30 | 48 | 60% | +$2.57 | ↑ |
| 43 | EdgeConverge[edge=0.05,vol=0.001,minFrac=0.85] | +$93.31 | +$93.31 | 27 | 70% | +$3.46 | ↑ |
| 44 | FavoriteValue[lo=0.55,hi=0.85,reqEdge=0] | +$90.56 | +$121.34 | 41 | 63% | +$2.21 | ↑ |
| 45 | KellyConverge[vol=0.0012,kelly=0.1,edge=0.04,minFrac=0] | +$77.89 | +$89.62 | 48 | 54% | +$1.62 | ↑ |
| 46 | EdgeConverge[edge=0.05,vol=0.0016,minFrac=0.85] | +$75.82 | +$75.82 | 24 | 58% | +$3.16 | ↑ |
| 47 | EdgeConverge[edge=0.07,vol=0.0006,minFrac=0.6] | +$74.62 | +$77.06 | 38 | 63% | +$1.96 | ↑ |
| 48 | KellyConverge[vol=0.0007,kelly=0.1,edge=0.04,minFrac=0.85] | +$72.26 | +$72.26 | 29 | 76% | +$2.49 | ↑ |
| 49 | ConsensusEdge[minRet=0.0006,edge=0.04] | +$69.73 | +$87.69 | 27 | 63% | +$2.58 | ↑ |
| 50 | VolGateEdge[gate=0.0008,edge=0.04] | +$54.55 | +$66.97 | 27 | 67% | +$2.02 | ↑ |
| 51 | VolGateEdge[gate=0.0008,edge=0.07] | +$51.36 | +$64.02 | 26 | 65% | +$1.98 | ↑ |
| 52 | ConsensusEdge[minRet=0.001,edge=0.04] | +$26.61 | +$36.17 | 26 | 69% | +$1.02 | ↑ |
| 53 | EdgeConverge[edge=0.05,vol=0.0006,minFrac=0.6] | +$24.30 | +$26.75 | 42 | 62% | +$0.58 | ↑ |
| 54 | ConsensusEdge[minRet=0.001,edge=0.07] | +$22.87 | +$32.43 | 25 | 68% | +$0.91 | ↑ |
| 55 | VolGateEdge[gate=0.0016,edge=0.04] | +$18.61 | +$20.49 | 16 | 75% | +$1.16 | ↑ |
| 56 | VolGateEdge[gate=0.0016,edge=0.07] | +$15.86 | +$15.86 | 15 | 73% | +$1.06 | ↑ |
| 57 | KellyConverge[vol=0.0012,kelly=0.25,edge=0.06,minFrac=0.85] | +$7.98 | +$7.98 | 26 | 62% | +$0.31 | ↑ |
| 58 | ConsensusEdge[minRet=0.0003,edge=0.04] | +$7.83 | +$39.61 | 29 | 52% | +$0.27 | ↑ |
| 59 | FavoriteValue[lo=0.6,hi=0.9,reqEdge=0] | +$7.31 | +$31.72 | 37 | 68% | +$0.20 | ↑ |
| 60 | EdgeConverge[edge=0.07,vol=0.001,minFrac=0.6] | -$3.04 | -$0.02 | 39 | 54% | -$0.08 | ↑ |
| 61 | KellyConverge[vol=0.0012,kelly=0.1,edge=0.06,minFrac=0.85] | -$6.01 | -$6.01 | 26 | 62% | -$0.23 | ↑ |
| 62 | VolGateEdge[gate=0.0012,edge=0.07] | -$13.19 | -$7.09 | 20 | 65% | -$0.66 | ↑ |
| 63 | EdgeConverge[edge=0.03,vol=0.001,minFrac=0.85] | -$21.80 | -$21.80 | 31 | 71% | -$0.70 | ↑ |
| 64 | EdgeConverge[edge=0.03,vol=0.0006,minFrac=0.85] | -$21.82 | -$21.82 | 31 | 74% | -$0.70 | ↑ |
| 65 | VolGateEdge[gate=0.0004,edge=0.07] | -$22.88 | +$3.55 | 34 | 56% | -$0.67 | ↑ |
| 66 | KellyConverge[vol=0.0012,kelly=0.25,edge=0.04,minFrac=0.85] | -$27.97 | -$27.97 | 28 | 68% | -$1.00 | ↑ |
| 67 | EdgeConverge[edge=0.03,vol=0.0006,minFrac=0.6] | -$32.05 | -$29.60 | 44 | 64% | -$0.73 | ↑ |
| 68 | KellyConverge[vol=0.0012,kelly=0.1,edge=0.04,minFrac=0.85] | -$33.00 | -$33.00 | 28 | 68% | -$1.18 | ↑ |
| 69 | ConsensusEdge[minRet=0.0015,edge=0.04] | -$44.61 | -$41.61 | 20 | 70% | -$2.23 | ↑ |
| 70 | FavoriteValue[lo=0.6,hi=0.9,reqEdge=0.08] | -$48.48 | -$34.99 | 30 | 67% | -$1.62 | ↑ |
| 71 | ConsensusEdge[minRet=0.0015,edge=0.07] | -$50.29 | -$47.29 | 18 | 67% | -$2.79 | ↑ |
| 72 | FavoriteValue[lo=0.6,hi=0.9,reqEdge=0.05] | -$51.05 | -$24.62 | 31 | 65% | -$1.65 | ↑ |
| 73 | VolGateEdge[gate=0.0012,edge=0.04] | -$52.43 | -$46.32 | 24 | 67% | -$2.18 | ↑ |
| 74 | VolGateEdge[gate=0.0004,edge=0.04] | -$59.96 | -$32.14 | 35 | 54% | -$1.71 | ↑ |
| 75 | FavoriteValue[lo=0.55,hi=0.85,reqEdge=0.03] | -$68.29 | -$36.51 | 35 | 60% | -$1.95 | ↑ |
| 76 | FavoriteValue[lo=0.65,hi=0.95,reqEdge=0.03] | -$69.36 | -$47.34 | 32 | 69% | -$2.17 | ↑ |
| 77 | PriceBucketProbe[lo=0.7,hi=0.8,size=30] | -$69.94 | -$61.28 | 48 | 71% | -$1.46 | ↑ |
| 78 | FavoriteValue[lo=0.65,hi=0.95,reqEdge=0] | -$77.82 | -$55.81 | 35 | 69% | -$2.22 | ↑ |
| 79 | FavoriteValue[lo=0.55,hi=0.85,reqEdge=0.05] | -$79.40 | -$47.62 | 33 | 58% | -$2.41 | ↑ |
| 80 | EdgeConverge[edge=0.03,vol=0.0016,minFrac=0.85] | -$87.60 | -$87.60 | 27 | 59% | -$3.24 | ↑ |
| 81 | LongshotProbe[lo=0.2,hi=0.35,size=20] | -$91.76 | -$109.76 | 48 | 29% | -$1.91 | ↑ |
| 82 | FavoriteValue[lo=0.6,hi=0.9,reqEdge=0.03] | -$102.76 | -$78.35 | 33 | 64% | -$3.11 | ↑ |
| 83 | FavoriteValue[lo=0.65,hi=0.95,reqEdge=0.08] | -$115.81 | -$102.32 | 27 | 67% | -$4.29 | ↑ |
| 84 | EdgeConverge[edge=0.05,vol=0.0006,minFrac=0.85] | -$118.10 | -$118.10 | 28 | 68% | -$4.22 | ↑ |
| 85 | EdgeConverge[edge=0.1,vol=0.001,minFrac=0.6] | -$118.55 | -$113.09 | 39 | 51% | -$3.04 | ↑ |
| 86 | RandomBaseline[seed=1,p=0.5] | -$119.27 | -$119.27 | 24 | 46% | -$4.97 | ≈ |
| 87 | FavoriteValue[lo=0.65,hi=0.95,reqEdge=0.05] | -$129.07 | -$111.12 | 29 | 66% | -$4.45 | ≈ |
| 88 | PriceBucketProbe[lo=0.6,hi=0.7,size=30] | -$132.82 | -$118.10 | 48 | 58% | -$2.77 | ≈ |
| 89 | EdgeConverge[edge=0.07,vol=0.0016,minFrac=0.6] | -$136.48 | -$136.48 | 36 | 42% | -$3.79 | ≈ |
| 90 | EdgeConverge[edge=0.1,vol=0.0016,minFrac=0.6] | -$142.56 | -$142.56 | 35 | 40% | -$4.07 | ≈ |
| 91 | EdgeConverge[edge=0.1,vol=0.0016,minFrac=0] | -$143.03 | -$143.03 | 44 | 41% | -$3.25 | ≈ |
| 92 | EdgeConverge[edge=0.03,vol=0.0016,minFrac=0.6] | -$144.69 | -$139.23 | 41 | 46% | -$3.53 | ≈ |
| 93 | PriceBucketProbe[lo=0.9,hi=0.97,size=30] | -$152.24 | -$151.11 | 48 | 83% | -$3.17 | ≈ |
| 94 | PriceBucketProbe[lo=0.8,hi=0.9,size=30] | -$160.81 | -$155.81 | 48 | 75% | -$3.35 | ≈ |
| 95 | EdgeConverge[edge=0.05,vol=0.0016,minFrac=0.6] | -$270.15 | -$270.15 | 40 | 45% | -$6.75 | ≈ |
| 96 | RandomBaseline[seed=2,p=0.5] | -$328.69 | -$328.69 | 24 | 38% | -$13.70 | ≈ |
| 97 | EdgeConverge[edge=0.05,vol=0.001,minFrac=0.6] | -$335.59 | -$333.14 | 41 | 49% | -$8.19 | ↓ |
| 98 | EdgeConverge[edge=0.03,vol=0.001,minFrac=0.6] | -$411.18 | -$408.74 | 43 | 49% | -$9.56 | ↓ |
| 99 | PriceBucketProbe[lo=0.5,hi=0.6,size=30] | -$563.75 | -$591.80 | 48 | 33% | -$11.74 | ↓ |
| 100 | AlwaysSide[side=Down] | -$956.50 | -$997.07 | 48 | 33% | -$19.93 | ↓ |

---

### Generation 4 — 100 bots · 194 windows · up-leaning sample

- **Combined realized P/L:** +$30,524.19
- **Noise band** (luck floor↔ceiling, from identical random bots): [-$582.56, -$581.17] — anything inside ≈ random
- **Direction controls:** AlwaysUp +$495.76 · AlwaysDown -$1,000.00
- **Busts** (lost ≥ 99.5% of bankroll): 2

| # | Strategy | Realized | Total | Trades | Win% | Avg/Tr | vs? |
|--:|---|--:|--:|--:|--:|--:|:-:|
| 1 | LateConvergeAdaptive[minFrac=0,edge=0.06] | +$2,391.37 | +$2,362.62 | 167 | 74% | +$14.32 | ↑ |
| 2 | FavoriteSweetSpot[lo=0.55,hi=0.82,reqEdge=0.06] | +$1,610.29 | +$1,578.73 | 151 | 75% | +$10.66 | ↑ |
| 3 | DepthImbalance[ratio=4] | +$1,610.12 | +$1,575.98 | 168 | 62% | +$9.58 | ↑ |
| 4 | FavoriteSweetSpot[lo=0.55,hi=0.82,reqEdge=0.08] | +$1,545.95 | +$1,514.39 | 137 | 77% | +$11.28 | ↑ |
| 5 | FavoriteSweetSpot[lo=0.55,hi=0.7,reqEdge=0.06] | +$1,528.92 | +$1,497.36 | 142 | 75% | +$10.77 | ↑ |
| 6 | FavoriteSweetSpot[lo=0.55,hi=0.7,reqEdge=0.08] | +$1,522.17 | +$1,490.61 | 126 | 77% | +$12.08 | ↑ |
| 7 | DepthImbalance[ratio=3] | +$1,347.14 | +$1,373.12 | 186 | 60% | +$7.24 | ↑ |
| 8 | FavoriteSweetSpot[lo=0.6,hi=0.78,reqEdge=0.06] | +$924.38 | +$891.46 | 138 | 75% | +$6.70 | ↑ |
| 9 | FavoriteSweetSpot[lo=0.55,hi=0.82,reqEdge=0.04] | +$923.91 | +$892.35 | 167 | 68% | +$5.53 | ↑ |
| 10 | FavoriteSweetSpot[lo=0.55,hi=0.7,reqEdge=0.04] | +$921.89 | +$890.33 | 161 | 68% | +$5.73 | ↑ |
| 11 | OverreactionFadePair[extreme=0.68,maxFrac=0.5] | +$824.67 | +$824.67 | 99 | 37% | +$8.33 | ↑ |
| 12 | FavoriteSweetSpot[lo=0.6,hi=0.78,reqEdge=0.08] | +$758.55 | +$725.63 | 122 | 75% | +$6.22 | ↑ |
| 13 | LateConvergeAdaptive[minFrac=0,edge=0.02] | +$743.43 | +$714.70 | 188 | 60% | +$3.95 | ↑ |
| 14 | PairRelativeValue[thresh=0.03] | +$709.02 | +$691.38 | 144 | 53% | +$4.92 | ↑ |
| 15 | FavoriteSweetSpot[lo=0.6,hi=0.78,reqEdge=0.04] | +$697.46 | +$664.54 | 154 | 72% | +$4.53 | ↑ |
| 16 | LateConvergeAdaptive[minFrac=0,edge=0.04] | +$674.51 | +$645.79 | 179 | 61% | +$3.77 | ↑ |
| 17 | OverreactionFadePair[extreme=0.68,maxFrac=0.35] | +$624.47 | +$624.47 | 73 | 38% | +$8.55 | ↑ |
| 18 | FavoriteSweetSpot[lo=0.65,hi=0.82,reqEdge=0.04] | +$565.89 | +$532.20 | 141 | 77% | +$4.01 | ↑ |
| 19 | FavoriteSweetSpot[lo=0.65,hi=0.82,reqEdge=0.02] | +$549.79 | +$516.09 | 155 | 75% | +$3.55 | ↑ |
| 20 | PairRelativeValue[thresh=0.01] | +$536.71 | +$514.81 | 168 | 53% | +$3.19 | ↑ |
| 21 | LateConvergeAdaptive[minFrac=0.85,edge=0.06] | +$524.35 | +$524.35 | 62 | 77% | +$8.46 | ↑ |
| 22 | FavoriteSweetSpot[lo=0.65,hi=0.82,reqEdge=0.06] | +$510.32 | +$476.62 | 127 | 77% | +$4.02 | ↑ |
| 23 | VolBucketFavorite[vlo=0.0005,vhi=0.0012,lo=0.55,hi=0.8] | +$504.95 | +$473.39 | 146 | 73% | +$3.46 | ↑ |
| 24 | FavoriteSweetSpot[lo=0.55,hi=0.82,reqEdge=0.02] | +$499.49 | +$467.73 | 178 | 65% | +$2.81 | ↑ |
| 25 | AlwaysSide[side=Up] | +$495.76 | +$467.02 | 193 | 53% | +$2.57 | ↑ |
| 26 | FavoriteSweetSpot[lo=0.65,hi=0.82,reqEdge=0] | +$493.29 | +$459.59 | 169 | 75% | +$2.92 | ↑ |
| 27 | FavoriteSweetSpot[lo=0.6,hi=0.78,reqEdge=0.02] | +$459.75 | +$426.83 | 167 | 69% | +$2.75 | ↑ |
| 28 | SpreadGateFavorite[maxSpread=0.025,lo=0.55,hi=0.8] | +$448.85 | +$418.56 | 193 | 62% | +$2.33 | ↑ |
| 29 | LateConvergeAdaptive[minFrac=0.75,edge=0.04] | +$432.84 | +$432.84 | 104 | 79% | +$4.16 | ↑ |
| 30 | LateConvergeAdaptive[minFrac=0.75,edge=0.06] | +$415.77 | +$415.77 | 86 | 76% | +$4.83 | ↑ |
| 31 | FavoriteSweetSpot[lo=0.65,hi=0.82,reqEdge=0.08] | +$413.17 | +$421.00 | 114 | 77% | +$3.62 | ↑ |
| 32 | FavoriteSweetSpot[lo=0.55,hi=0.7,reqEdge=0.02] | +$409.73 | +$377.96 | 171 | 63% | +$2.40 | ↑ |
| 33 | FavoriteSweetSpot[lo=0.7,hi=0.85,reqEdge=0.02] | +$393.04 | +$358.66 | 145 | 79% | +$2.71 | ↑ |
| 34 | VolBucketFavorite[vlo=0,vhi=0.0005,lo=0.55,hi=0.8] | +$379.39 | +$349.10 | 193 | 62% | +$1.97 | ↑ |
| 35 | SpreadGateFavorite[maxSpread=0.04,lo=0.55,hi=0.8] | +$377.46 | +$347.17 | 193 | 62% | +$1.96 | ↑ |
| 36 | SpreadGateFavorite[maxSpread=0.06,lo=0.55,hi=0.8] | +$377.46 | +$347.17 | 193 | 62% | +$1.96 | ↑ |
| 37 | TimeBucketFavorite[h0=4,h1=8] | +$365.20 | +$365.20 | 48 | 69% | +$7.61 | ↑ |
| 38 | LateConvergeAdaptive[minFrac=0.75,edge=0.02] | +$358.45 | +$358.45 | 122 | 80% | +$2.94 | ↑ |
| 39 | PairRelativeValue[thresh=0.05] | +$356.08 | +$338.45 | 113 | 49% | +$3.15 | ↑ |
| 40 | FavoriteSweetSpot[lo=0.6,hi=0.78,reqEdge=0] | +$354.89 | +$321.97 | 179 | 68% | +$1.98 | ↑ |
| 41 | FavoriteSweetSpot[lo=0.7,hi=0.85,reqEdge=0.06] | +$330.52 | +$333.61 | 116 | 80% | +$2.85 | ↑ |
| 42 | LateConvergeAdaptive[minFrac=0.6,edge=0.06] | +$327.78 | +$327.78 | 110 | 75% | +$2.98 | ↑ |
| 43 | VolBucketFavorite[vlo=0.0005,vhi=0.0012,lo=0.6,hi=0.85] | +$326.95 | +$294.03 | 153 | 74% | +$2.14 | ↑ |
| 44 | LateConvergeAdaptive[minFrac=0.85,edge=0.04] | +$318.51 | +$318.51 | 75 | 76% | +$4.25 | ↑ |
| 45 | FavoriteSweetSpot[lo=0.7,hi=0.85,reqEdge=0.04] | +$317.35 | +$319.71 | 130 | 79% | +$2.44 | ↑ |
| 46 | FavoriteSweetSpot[lo=0.7,hi=0.85,reqEdge=0.08] | +$308.95 | +$308.95 | 102 | 80% | +$3.03 | ↑ |
| 47 | LateConvergeAdaptive[minFrac=0.6,edge=0.02] | +$298.56 | +$298.56 | 146 | 76% | +$2.04 | ↑ |
| 48 | SpreadGateFavorite[maxSpread=0.06,lo=0.6,hi=0.85] | +$296.65 | +$263.01 | 193 | 67% | +$1.54 | ↑ |
| 49 | LateConvergeAdaptive[minFrac=0.85,edge=0.02] | +$296.07 | +$296.07 | 91 | 79% | +$3.25 | ↑ |
| 50 | DutchBook[margin=0.05] | +$291.85 | +$292.72 | 104 | 100% | +$2.81 | ↑ |
| 51 | FavoriteSweetSpot[lo=0.7,hi=0.85,reqEdge=0] | +$288.82 | +$253.62 | 161 | 78% | +$1.79 | ↑ |
| 52 | SpreadGateFavorite[maxSpread=0.04,lo=0.6,hi=0.85] | +$272.00 | +$238.37 | 193 | 67% | +$1.41 | ↑ |
| 53 | OverreactionFadePair[extreme=0.75,maxFrac=0.35] | +$270.53 | +$270.53 | 15 | 33% | +$18.04 | ↑ |
| 54 | VolBucketFavorite[vlo=0.0012,vhi=9,lo=0.6,hi=0.85] | +$263.60 | +$263.60 | 28 | 93% | +$9.41 | ↑ |
| 55 | LateConvergeAdaptive[minFrac=0.6,edge=0.04] | +$244.47 | +$244.47 | 127 | 76% | +$1.92 | ↑ |
| 56 | SpreadGateFavorite[maxSpread=0.015,lo=0.55,hi=0.8] | +$241.20 | +$210.90 | 193 | 61% | +$1.25 | ↑ |
| 57 | DepthImbalance[ratio=2.5] | +$240.96 | +$266.94 | 193 | 56% | +$1.25 | ↑ |
| 58 | DutchBook[margin=0] | +$216.38 | +$217.26 | 136 | 100% | +$1.59 | ↑ |
| 59 | DutchBook[margin=0.005] | +$216.38 | +$217.26 | 136 | 100% | +$1.59 | ↑ |
| 60 | DutchBook[margin=0.01] | +$216.38 | +$217.26 | 136 | 100% | +$1.59 | ↑ |
| 61 | DutchBook[margin=0.02] | +$216.38 | +$217.26 | 136 | 100% | +$1.59 | ↑ |
| 62 | DutchBook[margin=0.03] | +$216.17 | +$217.05 | 135 | 100% | +$1.60 | ↑ |
| 63 | LateConvergeAdaptive[minFrac=0.92,edge=0.06] | +$212.84 | +$212.84 | 42 | 76% | +$5.07 | ↑ |
| 64 | LateConvergeAdaptive[minFrac=0.92,edge=0.02] | +$193.45 | +$193.45 | 63 | 81% | +$3.07 | ↑ |
| 65 | LateConvergeAdaptive[minFrac=0.92,edge=0.04] | +$173.75 | +$173.75 | 51 | 76% | +$3.41 | ↑ |
| 66 | SpreadGateFavorite[maxSpread=0.025,lo=0.6,hi=0.85] | +$171.83 | +$138.20 | 193 | 66% | +$0.89 | ↑ |
| 67 | VolBucketFavorite[vlo=0,vhi=0.0005,lo=0.6,hi=0.85] | +$148.73 | +$115.10 | 191 | 66% | +$0.78 | ↑ |
| 68 | TimeBucketFavorite[h0=8,h1=12] | +$119.87 | +$119.87 | 48 | 63% | +$2.50 | ↑ |
| 69 | PairRelativeValue[thresh=0] | +$117.43 | +$95.53 | 189 | 52% | +$0.62 | ↑ |
| 70 | TimeBucketFavorite[h0=0,h1=4] | +$110.15 | +$110.15 | 40 | 63% | +$2.75 | ↑ |
| 71 | FavoriteSweetSpot[lo=0.55,hi=0.82,reqEdge=0] | +$110.03 | +$79.74 | 189 | 61% | +$0.58 | ↑ |
| 72 | CalibrationBucket[lo=0.58,hi=0.66,size=30] | +$106.69 | +$87.67 | 193 | 63% | +$0.55 | ↑ |
| 73 | VolBucketFavorite[vlo=0.0012,vhi=9,lo=0.55,hi=0.8] | +$104.96 | +$104.96 | 17 | 82% | +$6.17 | ↑ |
| 74 | PairRelativeValue[thresh=0.02] | +$97.03 | +$75.13 | 160 | 50% | +$0.61 | ↑ |
| 75 | SpreadGateFavorite[maxSpread=0.015,lo=0.6,hi=0.85] | +$85.53 | +$51.89 | 193 | 66% | +$0.44 | ↑ |
| 76 | FavoriteSweetSpot[lo=0.55,hi=0.7,reqEdge=0] | +$52.57 | +$22.27 | 185 | 60% | +$0.28 | ↑ |
| 77 | OverreactionFadePair[extreme=0.75,maxFrac=0.5] | +$40.11 | +$40.11 | 28 | 25% | +$1.43 | ↑ |
| 78 | CalibrationBucket[lo=0.82,hi=0.9,size=30] | +$4.05 | +$4.05 | 190 | 86% | +$0.02 | ↑ |
| 79 | TimeBucketFavorite[h0=20,h1=24] | $0.00 | $0.00 | 0 | — | — | ↑ |
| 80 | TimeBucketFavorite[h0=16,h1=20] | -$32.89 | -$63.18 | 9 | 56% | -$3.65 | ↑ |
| 81 | CalibrationBucket[lo=0.9,hi=0.97,size=30] | -$33.38 | -$33.38 | 189 | 93% | -$0.18 | ↑ |
| 82 | OverreactionFadePair[extreme=0.6,maxFrac=0.35] | -$48.09 | +$12.63 | 160 | 39% | -$0.30 | ↑ |
| 83 | CalibrationBucket[lo=0.74,hi=0.82,size=30] | -$58.76 | -$79.88 | 192 | 77% | -$0.31 | ↑ |
| 84 | CalibrationBucket[lo=0.5,hi=0.58,size=30] | -$61.98 | -$79.22 | 192 | 53% | -$0.32 | ↑ |
| 85 | PairRelativeValue[thresh=0.005] | -$102.78 | -$124.68 | 177 | 49% | -$0.58 | ↑ |
| 86 | CalibrationBucket[lo=0.66,hi=0.74,size=30] | -$116.66 | -$136.82 | 192 | 69% | -$0.61 | ↑ |
| 87 | SpreadGateFavorite[maxSpread=0.025,lo=0.65,hi=0.85] | -$136.87 | -$170.51 | 193 | 69% | -$0.71 | ↑ |
| 88 | SpreadGateFavorite[maxSpread=0.015,lo=0.65,hi=0.85] | -$144.16 | -$177.79 | 193 | 69% | -$0.75 | ↑ |
| 89 | TimeBucketFavorite[h0=12,h1=16] | -$182.94 | -$182.94 | 48 | 54% | -$3.81 | ↑ |
| 90 | SpreadGateFavorite[maxSpread=0.06,lo=0.65,hi=0.85] | -$186.74 | -$220.37 | 193 | 68% | -$0.97 | ↑ |
| 91 | SpreadGateFavorite[maxSpread=0.04,lo=0.65,hi=0.85] | -$191.37 | -$225.00 | 193 | 68% | -$0.99 | ↑ |
| 92 | OverreactionFadePair[extreme=0.6,maxFrac=0.5] | -$348.09 | -$287.37 | 166 | 38% | -$2.10 | ↑ |
| 93 | DepthImbalance[ratio=2] | -$362.55 | -$336.57 | 193 | 52% | -$1.88 | ↑ |
| 94 | LongshotProbe[lo=0.25,hi=0.35,size=20] | -$393.26 | -$368.98 | 193 | 30% | -$2.04 | ↑ |
| 95 | RandomBaseline[seed=2,p=0.5] | -$581.17 | -$581.17 | 101 | 47% | -$5.75 | ≈ |
| 96 | RandomBaseline[seed=1,p=0.5] | -$582.56 | -$582.56 | 99 | 45% | -$5.88 | ≈ |
| 97 | DepthImbalance[ratio=1.5] | -$592.02 | -$566.04 | 193 | 50% | -$3.07 | ↓ |
| 98 | LongshotProbe[lo=0.15,hi=0.25,size=20] | -$765.90 | -$767.90 | 193 | 19% | -$3.97 | ↓ |
| 99 | LongshotProbe[lo=0.05,hi=0.15,size=20] | -$1,000.00 | -$1,000.00 | 164 | 10% | -$6.10 | ↓ |
| 100 | AlwaysSide[side=Down] | -$1,000.00 | -$1,000.00 | 153 | 47% | -$6.54 | ↓ |

---

### Generation 5 · evolver holdout · realism friction — 16 bots · 114 windows · up-leaning sample

- **Combined realized P/L:** -$6,205.85
- **Noise band** (luck floor↔ceiling, from identical random bots): [-$244.76, +$906.19] — anything inside ≈ random
- **Direction controls:** AlwaysUp +$886.35 · AlwaysDown -$1,000.00
- **Busts** (lost ≥ 99.5% of bankroll): 9

| # | Strategy | Realized | Total | Trades | Win% | Avg/Tr | vs? |
|--:|---|--:|--:|--:|--:|--:|:-:|
| 1 | OverreactionFadePair[extreme=0.68,maxFrac=0.5] | +$1,449.20 | +$1,400.72 | 86 | 43% | +$16.85 | ↑ |
| 2 | RandomBaseline[seed=2,p=0.5] | +$906.19 | +$945.37 | 56 | 68% | +$16.18 | ≈ |
| 3 | AlwaysSide[side=Up] | +$886.35 | +$835.69 | 114 | 60% | +$7.77 | ≈ |
| 4 | DepthImbalance[ratio=4] | +$339.53 | +$291.86 | 91 | 51% | +$3.73 | ≈ |
| 5 | DutchBook[margin=0.05] | +$3.32 | +$3.32 | 2 | 100% | +$1.66 | ≈ |
| 6 | RandomBaseline[seed=1,p=0.5] | -$244.76 | -$244.76 | 61 | 48% | -$4.01 | ≈ |
| 7 | CalibrationBucket[lo=0.66,hi=0.74,size=30] | -$545.68 | -$527.77 | 113 | 59% | -$4.83 | ↓ |
| 8 | AlwaysSide[side=Down] | -$1,000.00 | -$1,000.00 | 95 | 40% | -$10.53 | ↓ |
| 9 | SpreadGateFavorite[maxSpread=0.04,lo=0.51,hi=0.85] | -$1,000.00 | -$1,000.00 | 92 | 45% | -$10.87 | ↓ |
| 10 | SpreadGateFavorite[maxSpread=0.04,lo=0.69,hi=0.85] | -$1,000.00 | -$1,000.00 | 80 | 55% | -$12.50 | ↓ |
| 11 | VolBucketFavorite[vlo=0,vhi=0.0005,lo=0.6,hi=0.85] | -$1,000.00 | -$1,000.00 | 74 | 49% | -$13.51 | ↓ |
| 12 | SpreadGateFavorite[maxSpread=0.04,lo=0.6,hi=0.85] | -$1,000.00 | -$1,000.00 | 69 | 46% | -$14.49 | ↓ |
| 13 | SpreadGateFavorite[maxSpread=0.034,lo=0.6,hi=0.85] | -$1,000.00 | -$1,000.00 | 69 | 46% | -$14.49 | ↓ |
| 14 | SpreadGateFavorite[maxSpread=0.046,lo=0.6,hi=0.85] | -$1,000.00 | -$1,000.00 | 69 | 46% | -$14.49 | ↓ |
| 15 | SpreadGateFavorite[maxSpread=0.04,lo=0.6,hi=0.7225] | -$1,000.00 | -$1,000.00 | 69 | 46% | -$14.49 | ↓ |
| 16 | SpreadGateFavorite[maxSpread=0.04,lo=0.6,hi=0.9775] | -$1,000.00 | -$1,000.00 | 69 | 46% | -$14.49 | ↓ |

---

### Generation 6 · evolver holdout · realism friction — 7 bots · 114 windows · up-leaning sample

- **Combined realized P/L:** +$2,439.75
- **Noise band** (luck floor↔ceiling, from identical random bots): [-$244.76, +$906.19] — anything inside ≈ random
- **Direction controls:** AlwaysUp +$886.35 · AlwaysDown -$1,000.00
- **Busts** (lost ≥ 99.5% of bankroll): 1

| # | Strategy | Realized | Total | Trades | Win% | Avg/Tr | vs? |
|--:|---|--:|--:|--:|--:|--:|:-:|
| 1 | DepthImbalance[ratio=5] | +$1,165.46 | +$1,117.80 | 79 | 61% | +$14.75 | ↑ |
| 2 | RandomBaseline[seed=2,p=0.5] | +$906.19 | +$945.37 | 56 | 68% | +$16.18 | ≈ |
| 3 | AlwaysSide[side=Up] | +$886.35 | +$835.69 | 114 | 60% | +$7.77 | ≈ |
| 4 | OverreactionFadePair[extreme=0.782,maxFrac=0.5] | +$723.38 | +$723.38 | 41 | 32% | +$17.64 | ≈ |
| 5 | DutchBook[margin=0.0575] | +$3.13 | +$3.13 | 1 | 100% | +$3.13 | ≈ |
| 6 | RandomBaseline[seed=1,p=0.5] | -$244.76 | -$244.76 | 61 | 48% | -$4.01 | ≈ |
| 7 | AlwaysSide[side=Down] | -$1,000.00 | -$1,000.00 | 95 | 40% | -$10.53 | ↓ |

---

### Generation 7 · evolver holdout · realism friction — 7 bots · 115 windows · up-leaning sample

- **Combined realized P/L:** +$2,380.86
- **Noise band** (luck floor↔ceiling, from identical random bots): [-$244.76, +$947.30] — anything inside ≈ random
- **Direction controls:** AlwaysUp +$836.35 · AlwaysDown -$1,000.00
- **Busts** (lost ≥ 99.5% of bankroll): 1

| # | Strategy | Realized | Total | Trades | Win% | Avg/Tr | vs? |
|--:|---|--:|--:|--:|--:|--:|:-:|
| 1 | DepthImbalance[ratio=5] | +$1,115.46 | +$1,096.43 | 80 | 60% | +$13.94 | ↑ |
| 2 | RandomBaseline[seed=2,p=0.5] | +$947.30 | +$948.43 | 57 | 68% | +$16.62 | ≈ |
| 3 | AlwaysSide[side=Up] | +$836.35 | +$831.88 | 115 | 59% | +$7.27 | ≈ |
| 4 | OverreactionFadePair[extreme=0.782,maxFrac=0.5] | +$723.38 | +$788.75 | 41 | 32% | +$17.64 | ≈ |
| 5 | DutchBook[margin=0.0575] | +$3.13 | +$3.13 | 1 | 100% | +$3.13 | ≈ |
| 6 | RandomBaseline[seed=1,p=0.5] | -$244.76 | -$244.76 | 61 | 48% | -$4.01 | ≈ |
| 7 | AlwaysSide[side=Down] | -$1,000.00 | -$1,000.00 | 95 | 40% | -$10.53 | ↓ |

---

### Generation 8 · evolver holdout · realism friction — 7 bots · 265 windows · up-leaning sample

- **Combined realized P/L:** +$3,481.13
- **Noise band** (luck floor↔ceiling, from identical random bots): [-$32.51, +$594.65] — anything inside ≈ random
- **Direction controls:** AlwaysUp +$1,806.90 · AlwaysDown -$1,000.00
- **Busts** (lost ≥ 99.5% of bankroll): 1

| # | Strategy | Realized | Total | Trades | Win% | Avg/Tr | vs? |
|--:|---|--:|--:|--:|--:|--:|:-:|
| 1 | AlwaysSide[side=Up] | +$1,806.90 | +$1,844.37 | 265 | 60% | +$6.82 | ↑ |
| 2 | OverreactionFadePair[extreme=0.782,maxFrac=0.5] | +$1,202.34 | +$1,267.72 | 65 | 32% | +$18.50 | ↑ |
| 3 | DepthImbalance[ratio=6] | +$909.75 | +$925.59 | 143 | 55% | +$6.36 | ↑ |
| 4 | RandomBaseline[seed=2,p=0.5] | +$594.65 | +$543.91 | 144 | 56% | +$4.13 | ≈ |
| 5 | DutchBook[margin=0.0776] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 6 | RandomBaseline[seed=1,p=0.5] | -$32.51 | -$34.82 | 136 | 51% | -$0.24 | ≈ |
| 7 | AlwaysSide[side=Down] | -$1,000.00 | -$1,000.00 | 95 | 40% | -$10.53 | ↓ |

---

### Generation 9 · evolver holdout · realism friction — 6 bots · 335 windows · up-leaning sample

- **Combined realized P/L:** +$2,014.88
- **Noise band** (luck floor↔ceiling, from identical random bots): [-$23.17, +$602.13] — anything inside ≈ random
- **Direction controls:** AlwaysUp +$1,946.56 · AlwaysDown -$1,000.00
- **Busts** (lost ≥ 99.5% of bankroll): 1

| # | Strategy | Realized | Total | Trades | Win% | Avg/Tr | vs? |
|--:|---|--:|--:|--:|--:|--:|:-:|
| 1 | AlwaysSide[side=Up] | +$1,946.56 | +$1,978.66 | 335 | 58% | +$5.81 | ↑ |
| 2 | RandomBaseline[seed=2,p=0.5] | +$602.13 | +$553.00 | 177 | 55% | +$3.40 | ≈ |
| 3 | DepthImbalance[ratio=6] | +$489.36 | +$506.08 | 189 | 52% | +$2.59 | ≈ |
| 4 | OverreactionFadePair[extreme=0.8993,maxFrac=0.5] | $0.00 | $0.00 | 0 | — | — | ≈ |
| 5 | RandomBaseline[seed=1,p=0.5] | -$23.17 | -$24.49 | 173 | 51% | -$0.13 | ≈ |
| 6 | AlwaysSide[side=Down] | -$1,000.00 | -$1,000.00 | 95 | 40% | -$10.53 | ↓ |
<!-- LEDGER:END -->
