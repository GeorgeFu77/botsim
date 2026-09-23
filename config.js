// ============================================================================
// BotSim configuration — every tunable knob lives here.
// PAPER TRADING ONLY. Nothing in this project ever signs or sends a real order.
// ============================================================================

export const config = {
  // ---- Capital & risk (per bot, paper dollars) --------------------------------
  startingCash: 1000, // every bot starts with this much paper cash
  defaultPositionSize: 50, // $ a bot deploys per signal (a strategy may override)
  defaultMaxRiskPerMarket: 100, // hard cap on $ at stake per market, per bot
  // Polymarket taker fee — VERIFIED 2026-07-10 three ways (docs.polymarket.com/trading/fees,
  // live per-market fd API {r:0.07,e:1,to:true}, and decoded on-chain fills):
  //   fee = rate * (p*(1-p))^exp * shares, charged on EVERY taker fill — entry AND
  //   early exit, each at its own executed price. Peaks at p=0.5 (1.75c/share),
  //   vanishes toward the extremes. Makers pay zero; rebates ignored (tier 0 for a
  //   small account). NOTE: the CLOB's maker/taker_base_fee=1000 fields are the
  //   on-chain signed fee CAP, not the applied rate.
  takerFee: { rate: 0.07, exp: 1 },
  minOrderShares: 5, // venue minimum order size
  slippageTicks: 1, // extra adverse ticks applied to every paper fill
  tickSize: 0.01, // price granularity of the binary markets

  // ---- Realism (paper != real market) ------------------------------------------
  // Orders take time to reach the venue: a fill executes against the book as it
  // is AFTER this delay, not the book the strategy decided on. Set 0 to disable.
  orderLatencyMs: 750,
  // Settlement is fee-free on Polymarket: winners redeem exactly $1/share
  // (verified 2026-07-10 — the old 200bps here was a guess from before that).
  winnerFeeBps: 0,

  // ---- THE DELAY MODEL (a core feature) ---------------------------------------
  // Bots only "see" a data record this many ms AFTER our collector received it.
  // This models pipeline/reaction lag; fills then execute against a fresher book,
  // which reproduces the adverse selection a slow trader actually suffers.
  feedDelayMs: {
    binance: 250,
    coinbase: 300,
    bybit: 250, // matched by record `src`, like binance/kraken
    okx: 300, // matched by record `src`, like binance/kraken
    polymarket: 500,
    market: 0, // structural "new market" records apply promptly
    resolution: 0, // settlement must not be delayed
    // Information feeds are polled + inherently laggy; delayFor() matches on
    // record `type`, so these keys must equal the record `type` (news/whale/fng).
    news: 2000,
    whale: 1500,
    fng: 1000,
    pmtrade: 500, // Polymarket trade-tape records carry type 'pmtrade'
    chainlink: 300, // the settlement oracle's own price — matched by record `src`
    polybinance: 300, // Binance series carried on the same Polymarket feed — matched by record `src`
    default: 300,
  },

  // ---- Data sources -----------------------------------------------------------
  binance: {
    wsUrl: 'wss://stream.binance.com:9443/ws/btcusdt@trade',
    wsUrlFallback: 'wss://stream.binance.us:9443/ws/btcusdt@trade',
    restBase: 'https://api.binance.com',
    restBaseFallback: 'https://api.binance.us',
    klineSymbol: 'BTCUSDT',
  },
  coinbase: {
    wsUrl: 'wss://ws-feed.exchange.coinbase.com',
    product: 'BTC-USD',
  },
  kraken: {
    wsUrl: 'wss://ws.kraken.com/v2',
    symbol: 'BTC/USD',
  },
  bybit: {
    wsUrl: 'wss://stream.bybit.com/v5/public/linear',
    topic: 'publicTrade.BTCUSDT', // linear perp; sizes already in BTC
  },
  okx: {
    wsUrl: 'wss://ws.okx.com:8443/ws/v5/public',
    instId: 'BTC-USDT-SWAP',
    // SWAP trade sizes are in contracts; the collector converts to BTC using
    // ctVal from this public endpoint (fallback below if the fetch fails).
    instrumentsUrl: 'https://www.okx.com/api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP',
    contractSizeBtc: 0.01, // BTC per contract for BTC-USDT-SWAP
  },
  polymarket: {
    gammaBase: 'https://gamma-api.polymarket.com',
    clobBase: 'https://clob.polymarket.com',
    clobWs: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
    slugPrefix: 'btc-updown-5m-', // each 5-min window is `${prefix}${epochSeconds}`
    periodSeconds: 300, // 5 minutes
    discoverIntervalMs: 20_000, // how often to look for the current/next windows
    preloadWindows: 2, // also subscribe to this many upcoming windows
    bookPollMs: 1500, // REST /book backstop poll (keeps books fresh if WS stalls)
    bookWriteThrottleMs: 200, // min gap between book records per asset (file size guard)
  },
  // The Polymarket trade TAPE (who is hitting Up vs Down right now). Public
  // data-api, no auth; window discovery reuses the polymarket settings above.
  polymarketTape: {
    dataApiBase: 'https://data-api.polymarket.com',
    pollIntervalMs: 2000, // per-window tape poll cadence
    limit: 100, // trades fetched per poll (dedup handles overlap)
    timeoutMs: 6000,
  },
  // Chainlink BTC/USD — the data stream the 5-min Up/Down markets SETTLE on.
  // Streamed ~1/sec by Polymarket's own public live-data websocket (no auth).
  // The socket also carries a Binance BTC/USDT series; we record both.
  chainlink: {
    wsUrl: 'wss://ws-live-data.polymarket.com',
    chainlinkTopic: 'crypto_prices_chainlink', // records get src 'chainlink'
    chainlinkSymbol: 'btc/usd',
    binanceTopic: 'crypto_prices', // records get src 'polybinance'
    binanceSymbol: 'btcusdt',
  },

  // ---- Information feeds (public, read-only, no API key) -----------------------
  // The bot's "senses" beyond the order book. All are polled HTTP; every collector
  // fails soft (a dead source degrades to "no data", never a crash).
  news: {
    feeds: [
      'https://cointelegraph.com/rss',
      'https://decrypt.co/feed',
      'https://bitcoinmagazine.com/feed',
      'https://www.newsbtc.com/feed/',
    ],
    pollIntervalMs: 300_000, // 5 min — well under any feed's rate limit
    timeoutMs: 8000,
  },
  whale: {
    endpoint: 'https://mempool.space/api/mempool/recent',
    pollIntervalMs: 30_000, // conservative; mempool.space 429s abusive IPs
    timeoutMs: 8000,
  },
  fng: {
    endpoint: 'https://api.alternative.me/fng/',
    pollIntervalMs: 300_000, // index only updates ~daily
    timeoutMs: 5000,
  },

  // ---- LIVE TRADING (INERT SCAFFOLD) -------------------------------------------
  // enabled stays FALSE until George completes src/live/SETUP.md himself. Even
  // then, orders only mirror the armed evolution champion, and only while the
  // HUD LIVE button is armed (click again = instant kill). Caps are hard limits.
  live: {
    enabled: false,
    maxPerTradeUSD: 10, // per-order clamp (paper size is bigger; live is clamped)
    maxDailyUSD: 50, // resets at local midnight
    maxTotalUSD: 100, // lifetime; reaching it auto-kills the switch
  },

  // ---- Engine -----------------------------------------------------------------
  engineTickMs: 500, // how often every bot re-evaluates
  staleBookMs: 8000, // refuse to trade on a Polymarket book older than this

  // ---- Server / dashboard -----------------------------------------------------
  port: 8088,
  openChrome: !process.env.BOTSIM_NO_CHROME, // auto-open the leaderboard in Google Chrome on startup
  tickPushMs: 1000, // min gap between live "tick" snapshots pushed to the browser
  // (a closed trade ALWAYS pushes immediately, regardless of this throttle)

  // ---- Persistence ------------------------------------------------------------
  dataDir: 'data', // live JSONL the collectors append to
  resultsDir: 'results', // snapshots, trade logs, and the morning report
  snapshotIntervalMs: 5000, // how often to write results/snapshot.json
};

export default config;
