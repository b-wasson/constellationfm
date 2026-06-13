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

// Last.fm allows roughly 5 requests/second; keys that keep exceeding it get
// suspended. Space outgoing calls to stay under that instead of finding out.
const MIN_INTERVAL_MS = 210; // ~4.7 req/s

// once actually rate limited, cool down hard and escalate — being slow is
// recoverable, a banned key is not
const RATE_LIMIT_COOLDOWNS_MS = [5000, 10000, 20000, 40000, 60000];

export function createLastfm(getKey) {
  const artistCache = createCache(24 * 60 * 60 * 1000); // info/similar barely changes
  const topCache = createCache(10 * 60 * 1000); // top artists shift often
  let throttleUntil = 0; // shared brake: when rate limited, all requests wait
  let nextSlot = 0; // outgoing-call pacing: next moment a request may leave

  // Wait until both the rate-limit brake has lifted and our pacing slot is
  // free, then claim the next slot. Serializes all Last.fm traffic to
  // ~MIN_INTERVAL_MS apart no matter how many callers run concurrently.
  async function pace() {
    for (;;) {
      const wait = Math.max(throttleUntil, nextSlot) - Date.now();
      if (wait <= 0) break;
      await sleep(wait);
    }
    nextSlot = Math.max(Date.now(), nextSlot) + MIN_INTERVAL_MS;
  }

  async function lastfm(params, attempt = 0, maxRetries = MAX_RETRIES) {
    // if we're already mid-cooldown from a previous rate limit, don't let
    // this invocation block in pace() for up to a minute — Cloudflare's
    // gateway times that out into an uncontrolled 504, and the client
    // retries straight into the same overloaded backend. Fail fast with the
    // same rate-limited error instead, so the client's 429 handling (which
    // brakes all in-flight requests) kicks in immediately.
    const cooldown = throttleUntil - Date.now();
    if (cooldown > 3000) {
      const err = new Error('Last.fm is rate limiting us — wait a minute and try again.');
      err.rateLimited = true;
      err.retryAfterSec = Math.max(30, Math.ceil(cooldown / 1000));
      throw err;
    }

    await pace();

    const url = new URL(BASE);
    url.search = new URLSearchParams({ ...params, api_key: getKey(), format: 'json' });

    let status = 0;
    let data = null;
    let retryAfterSec = 0;
    try {
      // without a timeout, one stalled connection hangs its caller forever
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      status = res.status;
      retryAfterSec = Number(res.headers.get('retry-after')) || 0;
      data = await res.json();
    } catch {
      data = null; // network hiccup, timeout, or bad JSON — treat as retryable
    }

    const rateLimited = status === 429 || data?.error === 29;
    const retryable = !data || status >= 500 || RETRYABLE_CODES.has(data?.error);

    if (rateLimited || retryable) {
      if (attempt >= maxRetries) {
        const err = new Error(
          rateLimited
            ? 'Last.fm is rate limiting us — wait a minute and try again.'
            : data?.message || 'Last.fm is unavailable right now.'
        );
        err.lastfmCode = data?.error;
        err.rateLimited = rateLimited;
        if (rateLimited) {
          err.retryAfterSec = Math.max(
            30,
            retryAfterSec,
            Math.ceil((throttleUntil - Date.now()) / 1000)
          );
        }
        throw err;
      }
      let backoff = Math.min(1000 * 2 ** attempt, 15000);
      if (rateLimited) {
        // honor Retry-After when Last.fm sends one (capped — a bogus header
        // must not put a worker to sleep for hours), never cool down less
        // than the escalating schedule, and brake every in-flight request
        const cooldown =
          RATE_LIMIT_COOLDOWNS_MS[Math.min(attempt, RATE_LIMIT_COOLDOWNS_MS.length - 1)];
        backoff = Math.max(backoff, cooldown, Math.min(retryAfterSec * 1000, 60000));
        throttleUntil = Math.max(throttleUntil, Date.now() + backoff);
      }
      await sleep(backoff);
      return lastfm(params, attempt + 1, maxRetries);
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

  // Per-artist calls get a small retry budget: the client retries the whole
  // request anyway, so deep ladders here only multiply (client retries ×
  // server retries kept a load wedged on one bad artist for ~10 minutes).
  const ARTIST_MAX_RETRIES = 1;

  // global stats + tags + similar artists for one artist
  async function getArtistData(name) {
    const key = name.toLowerCase();
    const cached = artistCache.get(key);
    if (cached) return cached;

    const grab = (p) => p.then((value) => [value, null], (err) => [null, err]);
    const [[info, infoErr], [similar, similarErr]] = await Promise.all([
      grab(lastfm({ method: 'artist.getinfo', artist: name, autocorrect: 1 }, 0, ARTIST_MAX_RETRIES)),
      grab(lastfm({ method: 'artist.getsimilar', artist: name, autocorrect: 1, limit: 250 }, 0, ARTIST_MAX_RETRIES)),
    ]);

    // total failure — don't cache the junk result. Only call it a rate limit
    // when it actually was one: a 429 makes the client cool down hard and
    // brake all in-flight requests, which is wrong for a merely broken artist.
    if (!info && !similar) {
      const rateLimited = Boolean(infoErr?.rateLimited || similarErr?.rateLimited);
      const err = new Error(
        rateLimited
          ? 'Last.fm is rate limiting us — wait a minute and try again.'
          : `Couldn't load data for ${name}`
      );
      err.rateLimited = rateLimited;
      if (rateLimited) {
        err.retryAfterSec = Math.max(30, Math.ceil((throttleUntil - Date.now()) / 1000));
      }
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
