# Evolver Brain #btcbot

> [!note] Decommissioned 2026-07-10
> The nightly 03:30 Opus session is **gone** — launchd job removed, `brain/` deleted. George's call: Opus is a frozen model and can't learn; Jarvis learns. It never completed a single era-2 generation anyway (auth failure every night since 2026-07-08). Strategy invention is replaced by [[The Tree]] — Jarvis testing changes to *itself*, no LLM in the loop. This note stays as the record of what it was.

Era 2's evolver. Replaces the numeric breeder (which only nudged parameters and plateaued at "no challenger won"): each generation is now a real **Opus 4.8 reasoning session on George's Claude plan** that mines the recorded data for patterns, searches the web for mechanisms, and **writes a brand-new strategy family** — a new way of thinking, not a tweak.

How a generation works: read [[Evolver Brain#Memory|memory]] → study data fresh → design ONE family with a falsifiable hypothesis → implement in its sandbox file (`src/engine/strategies.gen.js`) → tune on the first 70% of the recording → verdict from the 30% holdout it never saw, judged by the same iron rules (green both regimes ≥30 trades/side, beats the random band, beats AlwaysUp/Down, side-mix ≤65%).

## Memory

`BotSim/brain/LESSONS.md` — seeded with everything era 1 taught (graveyard, friction kills naive strategies, directional = regime luck, sizing amplifies error). Every run appends verdict + lesson, so it never re-tries a known dead end. Fresh eyes, permanent memory.

## Safety rails

Brain may only write its sandbox file, LESSONS.md, and its gen results. A wrapper snapshots all protected code, validates + smoke-replays the brain's output, and **auto-reverts anything broken**. Frozen-champion logic means it can stand still but not devolve. Paper-only is constitutional.

## Operations

- Nightly at 03:30 via launchd (runs on wake if the Mac slept) · HUD EVOLVE button = one on-demand generation.
- Runs on the plan (shares usage limits — a capped night skips and logs it).
- **Setup pending:** one-time `/usr/local/bin/claude setup-token` in Terminal — until then every run logs "brain not logged in" and skips.
- Era 1 (gens 1–13) archived in `BotSim/results/era1/`; era 2 restarted at gen 1.

Part of [[BTC Bot Strategies]]. Senses it can draw on: [[Information Layer]].
