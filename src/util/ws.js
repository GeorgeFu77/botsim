// Reconnecting WebSocket wrapper around Node 22's built-in global WebSocket.
// Built for overnight runs: backoff, URL failover, and a liveness watchdog that
// ACTIVELY recycles a half-open/wedged socket instead of waiting for a 'close'
// event that may never arrive.
//
// A generation counter (`gen`) tags each connection. Every handler ignores
// events whose gen != the current one, so a dead socket that fires 'close' late
// can never trigger a second reconnect or corrupt state.

import { makeLogger } from './log.js';

export class ReconnectingWS {
  constructor({ urls, name, onOpen, onMessage, staleMs = 60_000 }) {
    this.urls = Array.isArray(urls) ? urls : [urls];
    this.name = name;
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.staleMs = staleMs;
    this.log = makeLogger(`ws:${name}`);
    this.urlIdx = 0;
    this.attempt = 0;
    this.gen = 0;
    this.ws = null;
    this.gotMessage = false;
    this.lastMsg = Date.now();
    this.closed = false;
    this.watchdog = setInterval(() => this._checkStale(), Math.min(staleMs, 15_000));
    this.watchdog.unref?.();
  }

  start() {
    this._connect();
    return this;
  }

  _connect() {
    if (this.closed) return;
    const gen = ++this.gen;
    const url = this.urls[this.urlIdx % this.urls.length];
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.log.error('construct failed', e.message);
      return this._scheduleReconnect(gen, true);
    }
    this.ws = ws;
    this.gotMessage = false;
    this.lastMsg = Date.now();

    ws.addEventListener('open', () => {
      if (gen !== this.gen) return;
      this.log.ok('connected', url);
      try {
        this.onOpen?.(ws);
      } catch (e) {
        this.log.error('onOpen threw', e.message);
      }
    });

    ws.addEventListener('message', (ev) => {
      if (gen !== this.gen) return;
      this.lastMsg = Date.now();
      if (!this.gotMessage) {
        // Reset backoff only once real data flows — defeats flapping endpoints
        // that 'open' then immediately die.
        this.gotMessage = true;
        this.attempt = 0;
      }
      try {
        this.onMessage?.(ev.data, ws);
      } catch (e) {
        this.log.error('onMessage threw', e.message);
      }
    });

    ws.addEventListener('error', (ev) => {
      if (gen !== this.gen) return;
      this.log.warn('socket error', ev?.message || ev?.error?.message || '');
    });

    ws.addEventListener('close', () => {
      if (gen !== this.gen) return; // late event from a recycled socket — ignore
      this.log.warn('closed; reconnecting');
      this._scheduleReconnect(gen, true);
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
      return true;
    }
    return false;
  }

  _checkStale() {
    if (this.closed || !this.ws) return;
    if (Date.now() - this.lastMsg > this.staleMs) {
      this.log.warn(`no data for ${this.staleMs}ms — forcing reconnect`);
      const dead = this.ws;
      // Schedule the reconnect FIRST (bumps gen so the dead socket is orphaned),
      // then best-effort close it. We do not depend on its 'close' firing.
      this._scheduleReconnect(this.gen, true);
      try {
        dead?.close();
      } catch {
        /* ignore — the orphaned socket can't affect us anymore */
      }
    }
  }

  _scheduleReconnect(gen, failover = false) {
    if (this.closed) return;
    if (gen !== this.gen) return; // a newer connection already owns the slot
    this.gen++; // orphan the current socket: its future events are now ignored
    this.ws = null;
    this.attempt += 1;
    if (failover && this.urls.length > 1) this.urlIdx += 1; // try the next endpoint
    const backoff = Math.min(30_000, 500 * 2 ** Math.min(this.attempt, 6));
    const t = setTimeout(() => this._connect(), backoff);
    t.unref?.();
  }

  close() {
    this.closed = true;
    clearInterval(this.watchdog);
    this.gen++; // ignore any trailing events
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
  }
}
