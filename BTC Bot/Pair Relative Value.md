# Pair Relative Value #btcbot

Since Up + Down must settle to $1, each leg has a synthetic fair price (1 − other leg's mid). Buy whichever leg trades below its fair price by a threshold (0–0.05).

**Profit: +$1,590.62** across 6 variants — but **exposed by the gen-4 regime split (2026-07-05)**: 90% of its trades were Up-side, +$21,036 in up-windows vs −$19,323 in down-windows. The "cheap leg" in a trending market is systematically the trend side, so this is a directional bet in disguise. **LUCK, not edge.**

Run 2026-06-15: median +$237, ↑+$21,036(489)/↓−$19,323(462), 90% Up — LUCK (side-mix fail)

The one-legged sibling of [[Dutch Book]] (that one buys *both* legs). Part of [[BTC Bot Strategies]].

Evo 2026-07-05 (realism on, 22d frozen): median -$820, ↑+$3,030/↓-$3,413 (n/side 96) — DEAD: a directional bet in disguise; the regime split exposed it.
