# Fear Greed Fade #btcbot

At Fear/Greed extremes, fade the crowd: extreme fear → buy the favorite (panic likely overdone), extreme greed → buy the underdog. Side comes from the [[Information Layer]] FNG signal + book, never fixed. Gates: |z| ≥ 0.4–0.8, signal ≤6h old, favorite band 0.55–0.85.

**Hypothesis:** daily sentiment extremes mark regime overshoot that mean-reverts within the window's favorite pricing. Dies if FNG extremes carry no 5-min information (very possible — the index moves daily).

**Status: UNTESTED** — signal recording started 2026-07-07; no verdict until several days of parallel market+signal data. Part of [[BTC Bot Strategies]].
