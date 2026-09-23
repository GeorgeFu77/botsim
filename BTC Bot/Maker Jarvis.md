# Maker Jarvis #btcbot

**The saved idea (2026-07-10, from the oracle session; George asked to save it). Not built. Needs a full btcbot council before anyone touches it.**

The insight: Polymarket's fee system is a pump that moves money from **takers** (people who bet) to **makers** (people who quote prices). Fees are charged when you *take* liquidity; the venue redistributes collected fees to liquidity providers. The on-chain record (unverified but plausible) says the wallets that actually get rich there are automated market-makers — not predictors.

Today's Jarvis ([[The Tree]]) sits on the **paying** side of that pump: every bet it places pays the toll. Maker Jarvis would sit on the **earning** side:

- Quote both Up and Down around its own fair-value estimate (it already computes one — the gap/time/vol math)
- Earn the spread + fee rebates instead of paying them
- Its edge stops being "predict better" and becomes "price honestly and manage inventory" — getting stuck holding one side into a bad settlement is the risk that replaces being wrong

**Why it's not a tweak:** different order types (resting limits, cancels), different risk (inventory, adverse selection by faster bots), different sim (the paper engine only *takes* today — it would need a queue/fill model for resting orders). A different animal wearing the same name.

**Why it might be the real answer:** if the fee flow is structural, the maker seat has a tailwind where the taker seat has a headwind — before any intelligence is applied at all.

**When the day comes:** run the btcbot council on it first, stress execution risk hardest (can a 750ms quoter survive against sub-100ms competition, or does it just become the slow fish?).

Linked: [[The Tree]] · [[Live Switch]] (a maker going live is a very different arming question)
