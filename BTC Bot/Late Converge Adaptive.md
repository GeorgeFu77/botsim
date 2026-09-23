# Late Converge Adaptive #btcbot

Buy whichever side is leading, but only after a minimum fraction of the 5-min window has elapsed (0–0.92) and only if the model probability beats the ask by a required edge (0.02–0.06).

**Profit: +$7,519.95** across 15 variants. Best variant: no time gate, edge ≥ 0.06 → **+$2,362.62**, 73.7% win rate — the single most profitable bot in the whole run.

Interesting twist: the "late" gate wasn't needed — the best variant fires any time. Cousin of [[Favorite Sweet Spot]]; part of [[BTC Bot Strategies]].

Run 2026-06-15: median +$328, ↑+$2,341(828)/↓+$5,265(785), 48% Up — ROBUST (1 dataset)

Evo 2026-07-05 (realism on, 22d frozen): median -$236, ↑-$279/↓+$50 (n/side 107) — DEAD by median even though its best variant topped the tune board (+$1,688). Median-not-max caught it.
