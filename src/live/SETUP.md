# Going live — what George must do himself (nobody else, no assistant)

The LIVE button and executor are an INERT SCAFFOLD: armed or not, `submitOrder()`
only writes dry-run ledger lines. It performs no network I/O and reads no keys.
To make it real, ALL of the following steps are required — each one is deliberate
friction. Do them yourself; never paste a private key into any chat or file an
assistant can read.

## Before anything: the honest gate

The vault's own verdict is that no strategy has yet proven edge over a dumb
always-up bet. Going live before a champion clears the controls on holdout data
is donating money to faster traders. Read `brain/LESSONS.md` first, every time.

## Steps

1. **Dedicated wallet.** Create a NEW Polygon wallet used for nothing else.
   Fund it only with USDC you are fully prepared to lose (think: the
   `maxTotalUSD` cap, not more). Never your main wallet.
2. **Key storage.** Put the private key in a file OUTSIDE this repo, e.g.
   `~/.polymarket/key` with `chmod 600`. Point to it with an env var:
   `export POLYMARKET_KEY_FILE=~/.polymarket/key` (in the shell/launchd env that
   starts `npm start`). The executor must READ the path from env — never
   hardcode the key or path in the repo.
3. **Client.** `npm install @polymarket/clob-client` and implement the real
   branch inside `submitOrder()` in `src/live/executor.js`, following
   https://docs.polymarket.com/ (CLOB REST API + order signing). Keep the
   dry-run path as the fallback whenever `POLYMARKET_KEY_FILE` is unset.
   When the real branch exists, set `scaffold: false` in `writeStatus()`.
   **REQUIRED for the real branch (from the safety review):** write the ledger
   line SYNCHRONOUSLY (or reserve the spend in memory) BEFORE returning from
   submitOrder — the current async `appendLine` leaves a TOCTOU window where two
   fast entries could each pass the total cap. `spent()` already fails closed on a
   corrupt ledger line (disarms); keep that behavior.
4. **Caps.** Set `live.maxPerTradeUSD / maxDailyUSD / maxTotalUSD` in
   `config.js` to numbers you actually accept losing. They are hard limits:
   daily-cap entries are skipped, total-cap reach auto-kills the switch.
5. **Flip the gate.** Set `live.enabled: true` in `config.js`, restart the sim
   (`npm start`).
6. **Arm.** Click LIVE on the HUD. It arms for the CURRENT evolution champion
   only. Clicking again kills it instantly. If the brain crowns a different
   champion, the switch auto-kills and waits for you to re-arm.

## What the executor will never do, even fully set up

- Trade any strategy other than the armed champion (family + exact params).
- Exceed the caps. - Run during replays/backtests. - Be edited by the brain
  (src/live/ is outside its sandbox and restored by the wrapper if touched).
