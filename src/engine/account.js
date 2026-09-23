// Per-bot paper account: cash, open positions, closed-trade log, realized PnL.
// A "trade" is one completed round trip (entry -> exit or resolution).
//
// Binary market accounting: a share of an outcome token costs its price and pays
// $1 if that outcome wins, $0 otherwise. Max loss on a long position = cost basis,
// which is exactly what `maxRiskPerMarket` caps.

export class Account {
  constructor(startingCash) {
    this.startingCash = startingCash;
    this.cash = startingCash;
    this.positions = new Map(); // slug -> position
    this.trades = []; // closed trades
    this.realizedPnL = 0;
    this.feesPaid = 0;
    this.wins = 0; // running winning-trade count (avoids O(trades) rescans)
  }

  position(slug) {
    return this.positions.get(slug) || null;
  }

  hasPosition(slug) {
    return this.positions.has(slug);
  }

  // Open (or add to) a position. price is the avg fill price per share.
  enter(slug, side, shares, price, meta = {}) {
    const notional = shares * price;
    const fee = meta.feeUsd ?? (notional * (meta.feeBps || 0) / 10000);
    this.cash -= notional + fee;
    this.feesPaid += fee;
    const existing = this.positions.get(slug);
    if (existing && existing.side === side) {
      const totalShares = existing.shares + shares;
      existing.entry = (existing.shares * existing.entry + shares * price) / totalShares;
      existing.shares = totalShares;
      existing.costBasis += notional;
      existing.entryFee += fee; // accumulate so realized PnL captures entry fees too
    } else {
      this.positions.set(slug, {
        slug,
        side,
        shares,
        entry: price,
        costBasis: notional,
        entryFee: fee,
        openedAt: meta.openedAt || Date.now(),
        periodEnd: meta.periodEnd || null,
        lastMark: price,
      });
    }
    return this.positions.get(slug);
  }

  // Sell `shares` of an open position at `price` (early exit). Returns the closed
  // trade record if the position is fully closed, else null (partial reduction).
  exit(slug, shares, price, reason = 'exit', meta = {}) {
    const pos = this.positions.get(slug);
    if (!pos) return null;
    const qty = Math.min(shares, pos.shares);
    const proceeds = qty * price;
    const exitFee = meta.feeUsd ?? (proceeds * (meta.feeBps || 0) / 10000);
    this.cash += proceeds - exitFee;
    this.feesPaid += exitFee;
    // Amortize the entry fee across the shares being closed so that realized PnL
    // over a fully-closed position equals the actual cash delta.
    const entryFeePortion = pos.entryFee * (qty / pos.shares);
    const pnl = qty * (price - pos.entry) - exitFee - entryFeePortion;
    this.realizedPnL += pnl;
    pos.shares -= qty;
    pos.costBasis -= qty * pos.entry;
    pos.entryFee -= entryFeePortion;
    if (pos.shares <= 1e-9) {
      this.positions.delete(slug);
      return this._logTrade(pos, qty, price, pnl, reason);
    }
    return null;
  }

  // Settle a position at resolution: pays $1/share if side wins, else $0.
  settle(slug, outcome, meta = {}) {
    const pos = this.positions.get(slug);
    if (!pos) return null;
    // 'Both' = a dutch-book pair (one Up + one Down share); it always pays $1.
    const payoff = pos.side === 'Both' ? 1 : pos.side === outcome ? 1 : 0;
    const proceeds = pos.shares * payoff;
    // The vig: venues take a cut of settlement profit on winning positions.
    const profit = Math.max(0, proceeds - pos.costBasis);
    const winnerFee = profit * (meta.winnerFeeBps || 0) / 10000;
    this.cash += proceeds - winnerFee;
    this.feesPaid += winnerFee;
    const pnl = pos.shares * (payoff - pos.entry) - pos.entryFee - winnerFee;
    this.realizedPnL += pnl;
    this.positions.delete(slug);
    const { winnerFeeBps, ...tradeMeta } = meta;
    return this._logTrade(pos, pos.shares, payoff, pnl, `resolved:${outcome}`, tradeMeta);
  }

  _logTrade(pos, shares, exitPrice, pnl, reason, meta = {}) {
    const t = {
      slug: pos.slug,
      side: pos.side,
      shares: Number(shares.toFixed(4)),
      entry: Number(pos.entry.toFixed(4)),
      exit: Number(exitPrice.toFixed(4)),
      pnl: Number(pnl.toFixed(4)),
      win: pnl > 0,
      openedAt: pos.openedAt,
      closedAt: Date.now(),
      reason,
      ...meta,
    };
    this.trades.push(t);
    if (t.win) this.wins += 1;
    return t;
  }

  // Mark-to-market equity using each position's last computed mark.
  equity() {
    let mv = 0;
    for (const p of this.positions.values()) mv += p.shares * (p.lastMark ?? p.entry);
    return this.cash + mv;
  }

  totalPnL() {
    return this.equity() - this.startingCash;
  }

  // $ currently at stake (cost basis of all open positions).
  openExposure() {
    let x = 0;
    for (const p of this.positions.values()) x += p.costBasis;
    return x;
  }
}
