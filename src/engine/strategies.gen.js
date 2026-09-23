// ============================================================================
// BRAIN-WRITTEN STRATEGIES — the ONLY code file the nightly evolver brain may edit.
//
// Contract (mirrors hand-written families in strategies.js):
//   factory(p) => { family: 'Name', state: {}, decide(ctx, bot) => null | {action:'enter', side:'Up'|'Down'|'Both'} | {action:'exit', reason} }
//   ctx.market: { slug, up/down books {bestBid,bestAsk,mid,bids,asks,ageMs}, fresh,
//                 fracElapsed, fracLeft, btcRet, openBtc, btcMove, secondsLeft }
//   ctx.news  : { score[-1..1], count, ageMs } | null      (headline sentiment)
//   ctx.whale : { netBtc, maxBtc, count, ageMs } | null    (on-chain flow)
//   ctx.fng   : { value 0-100, z[-1..1], classification, ageMs } | null
//
// Rules enforced on the brain (see brain/BRAIN.md): paper-only, no I/O, no
// Date.now()/Math.random() inside decide (use ctx + seeded state), every family
// needs a falsifiable hypothesis in a comment, and a GEN_DESC one-liner.
// ============================================================================

// name -> factory
export const GEN_FAMILIES = {};

// grid rows: { family, params: {k: [values]}, expand? } — same shape as GRID.
export const GEN_GRID = [];

// name -> one-line human description (shown on George's HUD).
export const GEN_DESC = {};

// Hand-written family names the brain has judged DEAD on holdout — removed from
// the default roster. Controls (AlwaysSide, RandomBaseline) can never be disabled.
export const GEN_DISABLED = [];
