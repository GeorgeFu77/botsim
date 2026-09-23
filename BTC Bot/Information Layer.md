# Information Layer #btcbot

**Grown 2026-07-10** — seven feeds now supply **24 senses** total. New beyond the three below: Polymarket's own trade tape (who's hitting Up vs Down this window, big bets, late crowd shifts, tape heat), Bybit + OKX perp flow (taker imbalance, perp-spot gap), Binance spot taker flow + big-print detector, volatility regime, the last-5-windows streak, and — deepest of all — the JUDGE's own eyes: the Chainlink BTC/USD stream these markets actually settle on, plus the spot-vs-judge basis. All read by Jarvis ([[The Tree]]); each sense reads 0 when its feed is down, so a dead collector mutes a sense, never blinds the bot.

The bot's senses beyond the order book, recording since **2026-07-07** (all public, free, read-only; a dead source degrades to "no data", never a crash):

- **News** — 4 crypto RSS feeds, each headline lexicon-scored bullish/bearish → `ctx.news {score, count, ageMs}`.
- **Whale flow** — mempool.space on-chain movement pressure (NOT real exchange flow; that's paywalled) → `ctx.whale {netBtc, maxBtc, ageMs}`.
- **Fear & Greed** — alternative.me daily index → `ctx.fng {value, z, ageMs}`.

Signals ride the same delay-queue/replay plumbing as prices and are forward-filled with an age stamp — strategies decide how stale is too stale. Wiring proven by injection test: signal families fired hundreds of trades with data present, zero without.

**Honest caveat:** on a 5-min horizon these are slow/priced-in signals — likely mostly noise. And history before 2026-07-07 has no signal coverage, so [[Fear Greed Fade]], [[News Momentum]] and [[Whale Flow Tilt]] can't be fairly judged until several days of parallel data exist — INSUFFICIENT until then, not dead.

Part of [[BTC Bot Strategies]]; read by the [[Evolver Brain]]. Live values show on the HUD "senses" panel.
