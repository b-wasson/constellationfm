// Last.fm client shared by the Express server (local dev / self-hosting) and
// the Cloudflare Worker. Pure JS + fetch — no Node or Workers APIs — so both
// runtimes import it as-is.

const BASE = 'https://ws.audioscrobbler.com/2.0/';

export function createCache(ttlMs) {
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// last.fm codes worth retrying: 11 service offline, 16 temporarily
// unavailable, 29 rate limit exceeded
const RETRYABLE_CODES = new Set([11, 16, 29]);
const MAX_RETRIES = 5;

export function createLastfm(getKey) {
  const artistCache = createCache(24 * 60 * 60 * 1000); // info/similar barely changes
  const topCache = createCache(10 * 60 * 1000); // top artists shift often
  let throttleUntil = 0; // shared brake: when rate limited, all requests wait

  async function lastfm(params, attempt = 0) {
    const holdoff = throttleUntil - Date.now();
    if (holdoff > 0) await sleep(holdoff);

    const url = new URL(BASE);
    url.search = new URLSearchParams({ ...params, api_key: getKey(), format: 'json' });

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
        err.rateLimited = rateLimited;
        throw err;
      }
      const backoff = Math.min(1000 * 2 ** attempt, 15000);
      if (rateLimited) {
        // brake every in-flight request, not just this one
        throttleUntil = Math.max(throttleUntil, Date.now() + backoff);
      }
      await sleep(backoff);
      return lastfm(params, attempt + 1);
    }

    if (data.error) {
      const err = new Error(data.message || 'Last.fm error');
      err.lastfmCode = data.error;
      throw err;
    }
    return data;
  }

  // one page of a user's top artists, parsed down to what the client needs
  async function getTopArtists({ user, period, limit, page }) {
    const cacheKey = `${user.toLowerCase()}|${period}|${limit}|${page}`;
    const cached = topCache.get(cacheKey);
    if (cached) return cached;

    const top = await lastfm({ method: 'user.gettopartists', user, period, limit, page });
    const arr = top.topartists?.artist;
    const result = {
      user: top.topartists?.['@attr']?.user || user,
      totalPages: Number(top.topartists?.['@attr']?.totalPages) || 1,
      artists: (Array.isArray(arr) ? arr : arr ? [arr] : []).map((a) => ({
        name: a.name,
        userPlaycount: Number(a.playcount) || 0,
        url: a.url,
      })),
    };
    topCache.set(cacheKey, result);
    return result;
  }

  // global stats + tags + similar artists for one artist
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
      const err = new Error(`Couldn't load data for ${name}`);
      err.rateLimited = true;
      throw err;
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

  return { lastfm, getTopArtists, getArtistData };
}

// HTTP status for an error thrown by the client above
export function statusOf(err) {
  if (err.status) return err.status;
  if (err.lastfmCode === 6) return 404; // user not found
  if (err.rateLimited) return 429;
  return 502;
}
