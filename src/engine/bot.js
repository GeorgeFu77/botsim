// A Bot bundles a strategy instance with its own paper account and risk limits.
// This is the unit that competes on the leaderboard.

import { config } from '../../config.js';
import { Account } from './account.js';

export class Bot {
  constructor(spec) {
    this.id = spec.id;
    this.name = spec.name;
    this.family = spec.family;
    this.params = spec.params;
    this.strategy = spec.makeStrategy(); // fresh instance (its own internal state)
    this.account = new Account(config.startingCash);
    this.positionSize = spec.params.size ?? config.defaultPositionSize;
    this.maxRiskPerMarket = spec.params.maxRisk ?? config.defaultMaxRiskPerMarket;
    this.lastEnteredSlug = null; // one entry per market window (no spread churn)
  }

  position(slug) {
    return this.account.position(slug);
  }

  decide(ctx) {
    return this.strategy.decide(ctx, this);
  }
}
