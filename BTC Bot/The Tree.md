# The Tree #btcbot

Jarvis's evolution, live since **2026-07-10**. George's design, council-ratified: no Opus, no schedules commanding it — one AI that improves itself by trial and error on live data.

**How it works:**
- **One trunk (J0)** — THE Jarvis. An online neural net over **24 senses** that shifts its weights on every settled 5-min window. Grafted from the pre-tree Jarvis, so nothing it had learned was lost.
- **Twins having twins (since 2026-07-10)** — EVERY variant carries its own queue of questions (learn faster? bigger brain? ride bets to settlement? demand more edge?) and spawns twins: an exact clone of its brain with **one more** setting changed. So combinations compound down the branches (learn-faster AND bigger-brain). Each child races its own parent on the same live windows — a matched-pair experiment; shared luck cancels, the variable stands alone.
- **The climbing rule: beat your parent, take its place.** Verdicts are statistical, never scheduled — the paired difference must leave the luck band (|z| ≥ 2) on 3 consecutive daily checks. A loser gets a funeral (its children re-parent to the grandparent). A winner **supersedes** its parent — buries it and climbs a rung to face the grandparent. A winner whose parent is the trunk is **crowned**: the trunk adopts its brain and settings, generation +1. The trunk itself is immortal.
- **Dead ideas re-queue** at the back — re-tried when the market's mood has changed.
- No cap on the population (George's call) · one birth per 30 min · everything logged to `results/jarvis/lineage.jsonl` (births, verdicts, funerals, crowns — the whole saga).

**Shadow week:** until **2026-07-17** the reaper only *logs* what it would do. If the verdicts look like coin flips, the fitness window gets lengthened before anyone dies for luck.

**What's derived, not evolved:** bet size and the entry bar are arithmetic — enter when its own probability beats the real cost (ask + slippage + the venue's verified taker fee: 0.07·p(1−p) per share, charged on every fill, worst at 50/50, zero at settlement) by a margin, size = quarter-Kelly on that edge, compounding on its own cash. Math is not searched.

**Judge-aligned (2026-07-10):** windows settle on the **Chainlink** BTC/USD stream — the venue's actual referee, verified from the live market rules — with ties going Up. Jarvis has the judge's own senses (judge gap, spot-vs-judge basis), and a would-be crowned twin must **repeat its win on a fresh block** of windows before adoption (no lucky coronations).

**The two laws, unmoved:** paper only until George says otherwise · live data only (data files self-trim daily; no history, no replays).

Replaces the [[Evolver Brain]] and the old bandit ([[Online Learner]]). Senses: [[Information Layer]].
