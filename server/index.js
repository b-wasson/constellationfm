import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_KEY = process.env.LASTFM_API_KEY;
const PORT = process.env.PORT || 3001;
const BASE = 'https://ws.audioscrobbler.com/2.0/';

if (!API_KEY) {
  console.error('Missing LASTFM_API_KEY — create server/.env with your key.');
  process.exit(1);
}

// ---------- tiny TTL cache ----------
function createCache(ttlMs) {
  const map = new Map();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return undefined;
      if (Date.now() > entry.expires) {
        map.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      map.set(key, { value, expires: Date.now() + ttlMs });
    },
  };
}

const artistCache = createCache(24 * 60 * 60 * 1000); // artist info/similar barely changes
const graphCache = createCache(10 * 60 * 1000); // user's top artists shift often

// ---------- last.fm helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// last.fm codes worth retrying: 11 service offline, 16 temporarily
// unavailable, 29 rate limit exceeded
const RETRYABLE_CODES = new Set([11, 16, 29]);
const MAX_RETRIES = 5;
let throttleUntil = 0; // shared brake: when rate limited, all requests wait

async function lastfm(params, attempt = 0) {
  const holdoff = throttleUntil - Date.now();
  if (holdoff > 0) await sleep(holdoff);

  const url = new URL(BASE);
  url.search = new URLSearchParams({ ...params, api_key: API_KEY, format: 'json' });

  let status = 0;
  let data = null;
  try {
    const res = await fetch(url);
    status = res.status;
    data = await res.json();
  } catch {
    data = null; // network/parse hiccup — treat as retryable
  }

  const rateLimited = status === 429 || data?.error === 29;
  const retryable = !data || status >= 500 || RETRYABLE_CODES.has(data?.error);

  if (rateLimited || retryable) {
    if (attempt >= MAX_RETRIES) {
      const err = new Error(
        rateLimited
          ? 'Last.fm is rate limiting us — wait a minute and try again.'
          : data?.message || 'Last.fm is unavailable right now.'
      );
      err.lastfmCode = data?.error;
      throw err;
    }
    const backoff = Math.min(1000 * 2 ** attempt, 15000);
    if (rateLimited) {
      // brake every in-flight worker, not just this request
      throttleUntil = Math.max(throttleUntil, Date.now() + backoff);
      console.warn(`Last.fm rate limit hit — backing off ${backoff}ms`);
    } else {
      await sleep(backoff);
    }
    return lastfm(params, attempt + 1);
  }

  if (data.error) {
    const err = new Error(data.message || 'Last.fm error');
    err.lastfmCode = data.error;
    throw err;
  }
  return data;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getArtistData(name) {
  const key = name.toLowerCase();
  const cached = artistCache.get(key);
  if (cached) return cached;

  const [info, similar] = await Promise.all([
    lastfm({ method: 'artist.getinfo', artist: name, autocorrect: 1 }).catch(() => null),
    lastfm({ method: 'artist.getsimilar', artist: name, autocorrect: 1, limit: 250 }).catch(() => null),
  ]);

  // total failure (rate limiting, most likely) — don't cache the junk result
  if (!info && !similar) {
    throw new Error(`Couldn't load data for ${name}`);
  }

  const tagsRaw = info?.artist?.tags?.tag;
  const tags = (Array.isArray(tagsRaw) ? tagsRaw : tagsRaw ? [tagsRaw] : [])
    .map((t) => t.name.toLowerCase())
    .filter((t) => t !== 'seen live');

  const similarRaw = similar?.similarartists?.artist;
  const data = {
    listeners: Number(info?.artist?.stats?.listeners) || 0,
    globalPlaycount: Number(info?.artist?.stats?.playcount) || 0,
    tags,
    similar: (Array.isArray(similarRaw) ? similarRaw : [])
      .map((s) => ({ name: s.name, match: Number(s.match) || 0 })),
  };
  artistCache.set(key, data);
  return data;
}

// ---------- graph assembly ----------
async function buildGraph({ user, period, limit, wantAll, onProgress = () => {} }) {
  const cacheKey = `${user.toLowerCase()}|${period}|${limit}`;
  const cached = graphCache.get(cacheKey);
  if (cached) return cached;

  // 'all' pages through the entire library (last.fm caps pages at 1000 artists)
  const artistsRaw = [];
  let userName = user;
  let page = 1;
  let totalPages = 1;
  do {
    const top = await lastfm({
      method: 'user.gettopartists',
      user,
      period,
      limit: wantAll ? 1000 : limit,
      page,
    });
    const arr = top.topartists?.artist;
    artistsRaw.push(...(Array.isArray(arr) ? arr : arr ? [arr] : []));
    userName = top.topartists?.['@attr']?.user || user;
    totalPages = wantAll ? Number(top.topartists?.['@attr']?.totalPages) || 1 : 1;
    onProgress({ phase: 'top', page, totalPages, artists: artistsRaw.length });
    page++;
  } while (page <= totalPages);

  const artists = artistsRaw.map((a) => ({
    name: a.name,
    userPlaycount: Number(a.playcount) || 0,
    url: a.url,
  }));

  if (artists.length === 0) {
    const err = new Error(`No listening data found for "${user}" in this period.`);
    err.status = 404;
    throw err;
  }

  let done = 0;
  let failedArtists = 0;
  onProgress({ phase: 'details', done, total: artists.length });
  const details = await mapPool(artists, 8, async (a) => {
    let d;
    try {
      d = await getArtistData(a.name);
    } catch {
      failedArtists++;
      d = { listeners: 0, globalPlaycount: 0, tags: [], similar: [] };
    }
    done++;
    onProgress({ phase: 'details', done, total: artists.length });
    return d;
  });

  const nodes = artists.map((a, i) => ({
    id: a.name,
    url: a.url,
    userPlaycount: a.userPlaycount,
    listeners: details[i].listeners,
    globalPlaycount: details[i].globalPlaycount,
    tags: details[i].tags,
  }));

  // similarity links between artists that are both in the user's top set
  const idByLower = new Map(nodes.map((n) => [n.id.toLowerCase(), n.id]));
  const linkMap = new Map();
  artists.forEach((a, i) => {
    for (const s of details[i].similar) {
      const target = idByLower.get(s.name.toLowerCase());
      if (!target || target === a.name) continue;
      const pairKey = [a.name, target].sort().join(' ');
      const existing = linkMap.get(pairKey);
      if (!existing || s.match > existing.value) {
        linkMap.set(pairKey, { source: a.name, target, value: s.match });
      }
    }
  });

  const payload = {
    user: userName,
    period,
    nodes,
    links: [...linkMap.values()],
  };
  if (failedArtists > 0) {
    payload.warning =
      `${failedArtists} artist${failedArtists === 1 ? '' : 's'} couldn't be ` +
      'fully loaded — Last.fm may be rate limiting. Reload in a minute to fill the gaps.';
  } else {
    // only cache complete graphs; successful artists are cached individually
    // anyway, so a reload just retries the failures
    graphCache.set(cacheKey, payload);
  }
  return payload;
}

// ---------- routes ----------
const app = express();

app.get('/api/graph', async (req, res) => {
  const user = String(req.query.user || '').trim();
  const period = String(req.query.period || 'overall');
  const wantAll = req.query.limit === 'all';
  const limit = wantAll
    ? 'all'
    : Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 5), 1000);

  if (!user) return res.status(400).json({ error: 'Missing user parameter' });

  const statusOf = (err) => err.status || (err.lastfmCode === 6 ? 404 : 502);

  // SSE mode: stream progress events, then the full payload
  if (req.query.stream === '1') {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (event, data) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const payload = await buildGraph({
        user,
        period,
        limit,
        wantAll,
        onProgress: (p) => send('progress', p),
      });
      send('done', payload);
    } catch (err) {
      send('failed', { error: err.message, status: statusOf(err) });
    }
    res.end();
    return;
  }

  try {
    const payload = await buildGraph({ user, period, limit, wantAll });
    res.json(payload);
  } catch (err) {
    res.status(statusOf(err)).json({ error: err.message });
  }
});

// serve the built client in production
const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(PORT, () => console.log(`API server listening on http://localhost:${PORT}`));
