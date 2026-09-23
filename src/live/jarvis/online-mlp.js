// ============================================================================
// OnlineMLP — Jarvis's brain, upgraded from a flat linear model to a small
// online neural net (one hidden layer). The point: a linear model can only ever
// weigh each RAW signal on its own — any "this matters more when that is also
// true" combination has to be hand-picked and fed in as a separate feature. A
// hidden layer removes that: it can learn ANY combination of the raw signals
// itself, through training, including ones nobody hand-picked. So the feature
// extractor now feeds it ONLY raw signals — no pre-picked interaction terms.
//
// Still fully online (one sample at a time, no batches), still standardizes
// inputs itself (Welford), still learns every settled outcome. PAPER ONLY —
// this predicts + learns; it never places an order.
//
// "Why" (evidence) for a nonlinear model isn't a clean weight×value product
// anymore (the hidden layer mixes everything together), so this exposes an
// input-gradient attribution instead: ∂p/∂x_i at the current input — literally
// "if this signal nudged up right now, how much would the prediction move,
// holding everything else fixed." That's the honest equivalent of the old
// per-feature bars for a network with a hidden layer.
// ============================================================================

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const tanh = Math.tanh;

export class OnlineMLP {
  constructor(dim, { hidden = 12, lr = 0.05, l2 = 1e-4, margin = 0.0, warmup = 10 } = {}) {
    this.d = dim; this.h = hidden;
    this.lr = lr; this.l2 = l2; this.margin = margin; this.warmup = warmup;

    // Layer 1: d inputs -> h hidden (tanh). Small random init so hidden units
    // don't all start identical (symmetry breaking) — online L2 keeps unused
    // ones decaying toward 0 automatically.
    this.W1 = new Float64Array(dim * hidden);
    for (let i = 0; i < this.W1.length; i++) this.W1[i] = (Math.random() * 2 - 1) * 0.3;
    this.b1 = new Float64Array(hidden);
    // Layer 2: h hidden -> 1 output (sigmoid).
    this.W2 = new Float64Array(hidden);
    for (let i = 0; i < hidden; i++) this.W2[i] = (Math.random() * 2 - 1) * 0.3;
    this.b2 = 0;

    // Online input standardization (Welford), same as before.
    this.n = 0; this.mean = new Float64Array(dim); this.M2 = new Float64Array(dim); this.eps = 1e-8;
    this.seen = 0; this.acted = 0; this.wins = 0; this.brierSum = 0; this.logloss = 0;
    this.history = [];
  }

  _stdOf(i) {
    const v = this.n > 1 ? this.M2[i] / (this.n - 1) : 1;
    return Math.sqrt(v + this.eps);
  }

  _observe(x) {
    this.n++;
    const z = new Float64Array(this.d);
    for (let i = 0; i < this.d; i++) {
      const d1 = x[i] - this.mean[i];
      this.mean[i] += d1 / this.n;
      this.M2[i] += d1 * (x[i] - this.mean[i]);
      z[i] = (x[i] - this.mean[i]) / this._stdOf(i);
    }
    return z;
  }

  _z(x) {
    const z = new Float64Array(this.d);
    for (let i = 0; i < this.d; i++) z[i] = (x[i] - this.mean[i]) / this._stdOf(i);
    return z;
  }

  // Forward pass. Returns p, the hidden pre/post-activations (needed for both
  // backprop and the gradient-attribution "why"), and the standardized input.
  _forward(z) {
    const hPre = new Float64Array(this.h), hAct = new Float64Array(this.h);
    for (let j = 0; j < this.h; j++) {
      let s = this.b1[j];
      for (let i = 0; i < this.d; i++) s += this.W1[i * this.h + j] * z[i];
      hPre[j] = s; hAct[j] = tanh(s);
    }
    let o = this.b2;
    for (let j = 0; j < this.h; j++) o += this.W2[j] * hAct[j];
    const p = sigmoid(o);
    return { p, hAct, z };
  }

  // Input-gradient attribution: ∂p/∂x_i, decomposed back through the standardization
  // so it's expressed per RAW input, not per standardized one. This is the "why".
  _gradients(z, hAct, p) {
    // dp/do = p(1-p); do/dhAct_j = W2[j]; dhAct_j/dhPre_j = 1 - tanh(hPre_j)^2
    const dpdo = p * (1 - p);
    const dhPre = new Float64Array(this.h);
    for (let j = 0; j < this.h; j++) dhPre[j] = dpdo * this.W2[j] * (1 - hAct[j] * hAct[j]);
    const grad = new Float64Array(this.d);
    for (let i = 0; i < this.d; i++) {
      let s = 0;
      for (let j = 0; j < this.h; j++) s += dhPre[j] * this.W1[i * this.h + j];
      grad[i] = s / this._stdOf(i); // chain through z_i = (x_i - mean)/std_i -> dz_i/dx_i = 1/std_i
    }
    return grad;
  }

  predict(x) {
    const z = this._observe(x);
    const { p, hAct } = this._forward(z);
    const grad = this._gradients(z, hAct, p);
    const conf = Math.abs(p - 0.5);
    return { p, side: p >= 0.5 ? 'UP' : 'DOWN', conf, act: this.n >= this.warmup && conf >= this.margin, _grad: grad };
  }

  // Non-mutating: used every tick for the live "thinking" + to let it judge its
  // own moment, without touching the Welford stats (only the committed predict()
  // per window is allowed to move n).
  peek(x) {
    const z = this._z(x);
    const { p, hAct } = this._forward(z);
    const grad = this._gradients(z, hAct, p);
    return { p, side: p >= 0.5 ? 'UP' : 'DOWN', conf: Math.abs(p - 0.5), _grad: grad };
  }

  update(x, outcome) {
    const z = this._z(x);
    const { p, hAct } = this._forward(z);
    const g = outcome - p; // dL/do (for sigmoid + log-loss, this is exactly p - y)
    // Layer 2 grads
    const dW2 = new Float64Array(this.h);
    for (let j = 0; j < this.h; j++) dW2[j] = g * hAct[j];
    const db2 = g;
    // Backprop into hidden layer
    const dhAct = new Float64Array(this.h);
    for (let j = 0; j < this.h; j++) dhAct[j] = g * this.W2[j];
    const dhPre = new Float64Array(this.h);
    for (let j = 0; j < this.h; j++) dhPre[j] = dhAct[j] * (1 - hAct[j] * hAct[j]);
    // Apply updates (gradient ASCENT on log-likelihood = using +lr*grad, with L2 decay)
    for (let j = 0; j < this.h; j++) {
      this.W2[j] += this.lr * (dW2[j] - this.l2 * this.W2[j]);
      for (let i = 0; i < this.d; i++) {
        const idx = i * this.h + j;
        this.W1[idx] += this.lr * (dhPre[j] * z[i] - this.l2 * this.W1[idx]);
      }
      this.b1[j] += this.lr * dhPre[j];
    }
    this.b2 += this.lr * db2;

    this.seen++;
    this.brierSum += (p - outcome) ** 2;
    this.logloss += -(outcome * Math.log(p + 1e-12) + (1 - outcome) * Math.log(1 - p + 1e-12));
    return { p, g };
  }

  // Deep copy — a twin starts as an exact copy of its parent (weights, stats, all).
  clone() {
    return OnlineMLP.fromJSON(JSON.parse(JSON.stringify(this.toJSON())));
  }

  // Function-preserving hidden resize (net2net-style), for the tree's
  // hidden-size questions. Growing: new units get tiny random W1 (symmetry
  // breaking) but W2 = 0, so the model's OUTPUT is unchanged at the moment of
  // the split — the twin diverges only through learning. Shrinking: keep the
  // units the output actually uses (largest |W2|).
  resizeHidden(newH) {
    if (newH === this.h) return this;
    const keep = newH < this.h
      ? Array.from({ length: this.h }, (_, j) => j)
          .sort((a, b) => Math.abs(this.W2[b]) - Math.abs(this.W2[a]))
          .slice(0, newH)
          .sort((a, b) => a - b)
      : Array.from({ length: this.h }, (_, j) => j);
    const W1 = new Float64Array(this.d * newH);
    const b1 = new Float64Array(newH);
    const W2 = new Float64Array(newH);
    for (let jj = 0; jj < keep.length; jj++) {
      const j = keep[jj];
      for (let i = 0; i < this.d; i++) W1[i * newH + jj] = this.W1[i * this.h + j];
      b1[jj] = this.b1[j];
      W2[jj] = this.W2[j];
    }
    for (let jj = keep.length; jj < newH; jj++) {
      for (let i = 0; i < this.d; i++) W1[i * newH + jj] = (Math.random() * 2 - 1) * 0.05;
      b1[jj] = 0;
      W2[jj] = 0; // silent until it learns something worth saying
    }
    this.W1 = W1; this.b1 = b1; this.W2 = W2; this.h = newH;
    return this;
  }

  toJSON() {
    return {
      d: this.d, h: this.h, lr: this.lr, l2: this.l2, margin: this.margin, warmup: this.warmup,
      W1: Array.from(this.W1), b1: Array.from(this.b1), W2: Array.from(this.W2), b2: this.b2,
      n: this.n, mean: Array.from(this.mean), M2: Array.from(this.M2),
      seen: this.seen, acted: this.acted, wins: this.wins,
      brierSum: this.brierSum, logloss: this.logloss, history: this.history,
    };
  }

  static fromJSON(o) {
    const m = new OnlineMLP(o.d, { hidden: o.h, lr: o.lr, l2: o.l2, margin: o.margin, warmup: o.warmup });
    m.W1 = Float64Array.from(o.W1); m.b1 = Float64Array.from(o.b1);
    m.W2 = Float64Array.from(o.W2); m.b2 = o.b2;
    m.n = o.n; m.mean = Float64Array.from(o.mean); m.M2 = Float64Array.from(o.M2);
    m.seen = o.seen; m.acted = o.acted; m.wins = o.wins;
    m.brierSum = o.brierSum; m.logloss = o.logloss; m.history = o.history || [];
    return m;
  }

  // Graft a saved model onto a WIDER input vector without losing anything it
  // has learned. New senses append at the END of the feature vector: their W1
  // rows start at 0 (they contribute nothing until learned) and their Welford
  // stats get a unit-variance prior (mean 0, std 1) so standardization can't
  // blow up on the first real tick. Everything learned about the old senses —
  // weights, input statistics, accuracy history — carries over untouched.
  static migrate(o, newDim) {
    if (o.d >= newDim) return OnlineMLP.fromJSON(o);
    const m = new OnlineMLP(newDim, { hidden: o.h, lr: o.lr, l2: o.l2, margin: o.margin, warmup: o.warmup });
    m.W1.fill(0);
    for (let i = 0; i < o.d; i++) {
      for (let j = 0; j < o.h; j++) m.W1[i * o.h + j] = o.W1[i * o.h + j];
    }
    m.b1 = Float64Array.from(o.b1);
    m.W2 = Float64Array.from(o.W2);
    m.b2 = o.b2;
    m.n = o.n;
    m.mean.fill(0); m.M2.fill(Math.max(o.n - 1, 1)); // std=1 prior for new senses
    for (let i = 0; i < o.d; i++) { m.mean[i] = o.mean[i]; m.M2[i] = o.M2[i]; }
    m.seen = o.seen; m.acted = o.acted; m.wins = o.wins;
    m.brierSum = o.brierSum; m.logloss = o.logloss; m.history = o.history || [];
    return m;
  }
}
