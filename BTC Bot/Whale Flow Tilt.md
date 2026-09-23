# Whale Flow Tilt #btcbot

Takes the favorite only when heavy on-chain flow ([[Information Layer]] whale signal) AGREES with the window's own BTC drift — flow is noisy, so it's a confirmation filter, never a lone trigger. Gates: flow ≤20min old, ≥10–20 polls, net ≥10–80 BTC, |drift| ≥ 0.0002–0.0005, ask ≤0.85.

**Hypothesis:** heavy on-chain movement plus confirming drift marks conviction moves that persist to window close. Dies if mempool flow is unrelated to 5-min direction (the flow proxy is weak — real exchange-flow data is paywalled).

**Status: UNTESTED** — signal recording started 2026-07-07; no verdict until parallel data exists. Part of [[BTC Bot Strategies]].
