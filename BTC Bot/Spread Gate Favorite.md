# Spread Gate Favorite #btcbot

Buy the favorite (band ~0.55–0.85) only when the book is tight — bid/ask spread under 0.015–0.06. Idea: only trade when friction is low.

**Profit: +$1,221.60** across 12 variants. Best variant: max spread 0.025, band 0.55–0.8 → **+$418.56**, 62.2% win rate.

Profitable but middling — the spread gate helps less than [[Depth Imbalance]]'s bid-support read. Part of [[BTC Bot Strategies]].

Run 2026-06-15: median +$207, ↑−$5,871(1224)/↓+$7,483(1092), 43% Up — LUCK (failed regime split)

Evo 2026-07-05 (realism on, 22d frozen): ROBUST on tune (median +$518, ↑+$123/↓+$368, n/side 238) then champion busted -$1,000 on holdout — dropped. The overfitting lesson of this run: every in-sample gate passed, zero edge out of sample.
