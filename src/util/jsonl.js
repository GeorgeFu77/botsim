// Append-only JSONL helpers + a robust directory tailer.
// Collectors are the ONLY writers; the engine tails what they write.

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Append one object as a JSON line. Creates the parent dir if needed.
export function appendLine(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFile(file, JSON.stringify(obj) + '\n', (err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('[jsonl] append failed', file, err.message);
    }
  });
}

// Tailer: watches a set of JSONL files and emits each newly-appended line.
// Emits: 'line' -> (source, parsedObject), 'error' -> (err)
//
// It tracks a byte offset per file, reads only the appended bytes, buffers any
// trailing partial line, and survives truncation/rotation. fs.watch is backed up
// by a poll so we never miss an append even when watch events are coalesced.
export class Tailer extends EventEmitter {
  constructor(pollMs = 250) {
    super();
    this.files = new Map(); // file -> { source, offset, buffer }
    this.pollMs = pollMs;
    this.timer = null;
  }

  // `fromStart`: replay existing lines (false = only new lines from now on).
  add(file, source, fromStart = false) {
    ensureDir(path.dirname(file));
    if (!fs.existsSync(file)) fs.writeFileSync(file, '');
    const size = fromStart ? 0 : fs.statSync(file).size;
    this.files.set(file, { source, offset: size, buffer: '' });
    try {
      fs.watch(file, () => this._read(file));
    } catch {
      /* poll covers us if watch is unavailable */
    }
    this._read(file);
    return this;
  }

  start() {
    if (this.timer) return this;
    this.timer = setInterval(() => {
      for (const file of this.files.keys()) this._read(file);
    }, this.pollMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  _read(file) {
    const st = this.files.get(file);
    if (!st) return;
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return;
    }
    if (size < st.offset) {
      // file was truncated/rotated — restart from the top.
      st.offset = 0;
      st.buffer = '';
    }
    if (size === st.offset) return;

    let fd;
    try {
      fd = fs.openSync(file, 'r');
      const len = size - st.offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.offset);
      st.offset = size;
      st.buffer += buf.toString('utf8');
    } catch (e) {
      this.emit('error', e);
      return;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }

    const lines = st.buffer.split('\n');
    st.buffer = lines.pop() ?? ''; // keep the trailing partial line
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.emit('line', st.source, JSON.parse(trimmed));
      } catch {
        /* skip malformed line, keep tailing */
      }
    }
  }
}
