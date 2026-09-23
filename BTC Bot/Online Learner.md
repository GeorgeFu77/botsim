# Online Learner #btcbot

> [!note] Retired 2026-07-10
> The confidence-gated bandit described below was **decommissioned** along with its nightly 04:30 refresh — George's call: no more shelf of strategies to pick among. The per-trade adaptive layer is now **Jarvis itself** — the trunk of [[The Tree]], one neural net shifting its weights on every settled window. This note stays as the record of what the bandit was.

The per-trade adaptive layer, built 2026-07-07. George's ask was "evolve every trade — reward when right, punish when wrong." The naive version (react to each single 5-min outcome) chases luck and bleeds, because one binary outcome is almost pure noise. So it was a **confidence-gated bandit**: Welford mean/variance of realized P/L per strategy, scored by a confidence lower bound, with the vault's iron rule (≥40 trades, green both regimes, positive lower bound) enforced continuously.

Its last pick before retirement: LateConvergeAdaptive [minFrac=0, edge=0.06] — LCB +$2.48/trade over 692 trades, in-sample only, never holdout-proven.
