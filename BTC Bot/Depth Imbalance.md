# Depth Imbalance #btcbot

Buy the side whose order book has much heavier bid support — total bids ≥ 1.5–4× the other side's (price capped at 0.85).

**Profit: +$2,313.43** across 5 variants. Best variant: ratio 4 → **+$1,575.98**, 61.9% win rate over 168 trades. The stricter the imbalance requirement, the better it did.

Reads the crowd's resting money instead of price. Part of [[BTC Bot Strategies]]; [[Spread Gate Favorite]] is the other book-microstructure play.

Run 2026-06-15: median +$241, ↑+$574(488)/↓+$1,670(445), 46% Up — ROBUST (1 dataset)

Evo 2026-07-05 (realism on, 22d frozen): median +$219, ↑-$786/↓+$499 (n/side 212) — LUCK by median, but champion ratio=4 held +$340 on holdout; bred ratio=5 won gen 6 and confirmed +$1,165 on holdout. Best survivor under realism.

Evo gens 7-9 (2026-07-06, fixed machinery): ratio kept climbing 4→5→6 across gens, +$489 on ~7d holdout (189 trades) — green but below the AlwaysUp control in an up-trending week. Real survivor, unproven vs trend.
