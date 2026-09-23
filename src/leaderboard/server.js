// Tiny zero-dependency HTTP + Server-Sent-Events server for the live dashboard.
// SSE is one-way server->browser push, which is exactly what "refresh the
// leaderboard every time a bot finishes a trade" needs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogger } from '../util/log.js';

const log = makeLogger('server');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class DashboardServer {
  constructor(port) {
    this.port = port;
    this.clients = new Set();
    this.last = null; // last snapshot, for new clients and /api/state
    this.indexHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
    this.server = http.createServer((req, res) => this._handle(req, res));
  }

  start() {
    this.server.listen(this.port, () => log.ok(`dashboard http://localhost:${this.port}`));
    // Keep SSE connections alive through proxies / idle periods.
    this.keepAlive = setInterval(() => this._broadcastRaw(': ping\n\n'), 15_000);
    this.keepAlive.unref?.();
    return this;
  }

  // Push a named event with a JSON payload to every connected browser.
  push(event, data) {
    this.last = data;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    this._broadcastRaw(frame);
  }

  _broadcastRaw(frame) {
    for (const res of this.clients) {
      try {
        res.write(frame);
      } catch {
        this.clients.delete(res);
      }
    }
  }

  _handle(req, res) {
    const url = req.url.split('?')[0];
    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.indexHtml);
      return;
    }
    if (url === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(this.last || { rows: [] }));
      return;
    }
    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      if (this.last) res.write(`event: leaderboard\ndata: ${JSON.stringify(this.last)}\n\n`);
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  }

  stop() {
    clearInterval(this.keepAlive);
    for (const res of this.clients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    this.server.close();
  }
}
