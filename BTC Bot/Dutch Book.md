# Dutch Book #btcbot

Buy both Up and Down when the two asks total ≤ $1 minus a margin (0–0.05). One of them pays $1 at settlement, so profit is locked in at entry — the only truly risk-free, direction-neutral edge.

**Profit: +$1,378.81** across 6 variants, and the best variant (margin 0.05) ran a **100% win rate** (+$292.72). Smaller totals than the bias-harvesters, but zero losing trades.

The purest expression of the gen-4 "structure not direction" mandate. [[Pair Relative Value]] is its one-legged sibling. Part of [[BTC Bot Strategies]].

Run 2026-06-15: median +$216, ↑+$611(371)/↓+$763(412), both legs — ROBUST (1 dataset)

Evo 2026-07-05 (realism on, 22d frozen): median +$13 (n/side 4, INSUFFICIENT) — 750ms latency kills most arbs in transit; champion margin≈0.06 crawled +$3 on holdout. Alive, barely.
