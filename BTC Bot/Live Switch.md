# Live Switch #btcbot

> [!note] Update 2026-07-10
> With the strategy families, bandit, and [[Evolver Brain]] retired, the switch has **no champion to arm** — it refuses to arm at all, which is exactly the safe state. The scaffold and its money rails stay in place untouched. If Jarvis ([[The Tree]]) is ever to become the armed trader, that's a deliberate future decision of George's, not a side effect.

The HUD LIVE button, built 2026-07-07 as an **inert scaffold** — every part of the
switch exists and is tested, but it cannot place a real order until George
completes the wallet setup himself (`BotSim/src/live/SETUP.md`).

George's conditions, as built:
- **Always off until clicked.** Arming asks one confirm; there is no other way to arm.
- **One strategy.** It arms the *current evolution champion only* (the family +
  exact params on the [[BTC Bot Strategies|hub]]'s current-strategy panel). If the
  [[Evolver Brain]] crowns a different champion, the switch **auto-kills** and
  waits to be re-armed. Right now era 2 has no champion yet, so it refuses to arm.
- **Kill = click again.** Instant, no confirm; takes effect within ~1.5s.

Money rails (hard limits in `config.js` → `live`): $10/trade clamp, $50/day
(cap hit = entries skipped), $100 lifetime (cap hit = auto-kill). Real spend only
counts real submissions; the scaffold only ever writes dry-run ledger lines.

What stays true even fully set up: mirrors only the armed pick, never runs in
replays, and the brain is barred from `src/live/`. Gate-chain unit tests passed
2026-07-07 (not-armed, wrong-variant, kill, champion-change, caps).

**Adversarial safety review (2026-07-07, 5 skeptics on Opus):** 4 invariants held
at high confidence — off-when-disarmed, no-network/no-keys, kill ≤1.5s, cap logic.
One REAL hole found + fixed: the brain's writable file `strategies.gen.js` is
imported by the live sim but was excluded from the wrapper's protected-file
snapshot, so a rogue/injected brain could `import LiveExecutor`, flip
`config.live.enabled`, or monkeypatch the sim to attach it — surviving validation.
Fix: a deny-list guard (`screenGenFile` in `run-brain.mjs`) rejects any gen file
that references LiveExecutor, mutates config, patches a prototype, touches
process/fs/network/credentials, or imports anything but `./strategy.js` — the whole
file reverts on a single match. Verified: all 5 demonstrated attacks rejected,
legit strategies still accepted. Latent cap-hardening (fail-closed on corrupt
ledger, sync ledger write) noted in `src/live/SETUP.md` for the real submit branch.

**Honest gate, in George's own vault's words: nothing has yet proven edge over a
dumb always-up bet. The button existing is not a reason to press it.**
