// Crypto news collector — polls public RSS feeds, scores each headline with the
// pure lexicon, and appends one JSONL record per NEW headline to data/news/.
//
// READ-ONLY public feeds. No auth, no key, no orders. Zero external deps: a
// deliberately dumb regex RSS/Atom parse (a malformed item is silently skipped —
// acceptable for a sentiment aggregate, and it keeps the paper-only, no-dep posture).

import path from 'node:path';
import { config } from '../../config.js';
import { appendLine } from '../util/jsonl.js';
import { makeLogger } from '../util/log.js';
import { scoreHeadline } from '../signals/lexicon.js';

const log = makeLogger('news');

const stripCdata = (s = '') => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
const decode = (s = '') =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#0?39;/g, "'");
const first = (block, res) => {
  for (const re of res) { const m = block.match(re); if (m && m[1]) return m[1]; }
  return '';
};

// Split into <item> (RSS) or <entry> (Atom) blocks, extract title/link/date
// order-independently so both feed dialects work.
function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const title = decode(stripCdata(first(b, [/<title[^>]*>([\s\S]*?)<\/title>/i])));
    let link = decode(stripCdata(first(b, [/<link[^>]*>([\s\S]*?)<\/link>/i, /<guid[^>]*>([\s\S]*?)<\/guid>/i])));
    if (!link) { const a = b.match(/<link[^>]*href=["']([^"']+)["']/i); if (a) link = a[1]; } // Atom <link href=".."/>
    const date = first(b, [/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i, /<published[^>]*>([\s\S]*?)<\/published>/i, /<updated[^>]*>([\s\S]*?)<\/updated>/i, /<dc:date[^>]*>([\s\S]*?)<\/dc:date>/i]);
    if (title) out.push({ title, link: link || title, exchTs: Date.parse(stripCdata(date)) || null });
  }
  return out;
}

async function fetchText(url, ms) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { 'User-Agent': 'botsim-news/1.0' } });
    return r.ok ? await r.text() : null;
  } catch (e) {
    log.warn(`fetch ${url}: ${e.message}`);
    return null;
  }
}

export function startNewsCollector(dataDir = config.dataDir) {
  const file = path.join(dataDir, 'news', 'headlines.jsonl');
  const seen = new Set();
  let total = 0;

  async function poll() {
    for (const url of config.news.feeds) {
      const xml = await fetchText(url, config.news.timeoutMs);
      if (!xml) continue;
      for (const it of parseFeed(xml)) {
        if (seen.has(it.link)) continue;
        seen.add(it.link);
        const recvTs = Date.now();
        appendLine(file, {
          type: 'news', src: 'news',
          title: it.title, link: it.link,
          exchTs: it.exchTs || recvTs, recvTs,
          sentiment: scoreHeadline(it.title),
        });
        total++;
      }
    }
    if (seen.size > 8000) seen.clear(); // bound memory on a multi-day run
    if (total) log.info(`${total} headlines recorded`);
  }

  const t = setInterval(poll, config.news.pollIntervalMs);
  t.unref?.();
  poll();
  log.ok('collector started ->', file);
  return { stop() { clearInterval(t); }, close() { clearInterval(t); } };
}
