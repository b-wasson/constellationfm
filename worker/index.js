// Cloudflare Worker: serves the built client (via the assets binding) and
// proxies the two Last.fm API endpoints. The browser orchestrates graph
// building, so each Worker invocation makes at most a couple of Last.fm
// subrequests — well inside Workers' per-request subrequest limits.
import { createLastfm, statusOf } from '../shared/lastfm.js';

let lf; // per-isolate; the in-memory caches in here are best-effort L1

const json = (data, status = 200, cacheControl = 'no-store', extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': cacheControl,
      ...extraHeaders,
    },
  });

// tell the client how long to hold off so it doesn't make things worse
const errorResponse = (err) => {
  const status = statusOf(err);
  const headers =
    status === 429 && err.retryAfterSec ? { 'retry-after': String(err.retryAfterSec) } : {};
  return json({ error: err.message }, status, 'no-store', headers);
};

// Serve from / store into Cloudflare's edge cache. Only successful responses
// carry a max-age, so failures are never cached. (On *.workers.dev domains
// the Cache API is a no-op — everything still works, just without the edge
// cache; custom domains get the full benefit.)
async function cached(request, ttlSeconds, ctx, produce) {
  const url = new URL(request.url);
  url.searchParams.sort();
  const cacheKey = new Request(url.toString());

  const hit = await caches.default.match(cacheKey);
  if (hit) return hit;

  const res = await produce(`public, max-age=${ttlSeconds}`);
  if (res.ok) ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

export default {
  async fetch(request, env, ctx) {
    if (!lf) lf = createLastfm(() => env.LASTFM_API_KEY);
    const url = new URL(request.url);
    const q = url.searchParams;

    if (url.pathname === '/api/top-artists') {
      const user = (q.get('user') || '').trim();
      const period = q.get('period') || 'overall';
      const limit = Math.min(Math.max(parseInt(q.get('limit'), 10) || 50, 5), 1000);
      const page = Math.max(parseInt(q.get('page'), 10) || 1, 1);
      if (!user) return json({ error: 'Missing user parameter' }, 400);

      return cached(request, 600, ctx, async (cc) => {
        try {
          return json(await lf.getTopArtists({ user, period, limit, page }), 200, cc);
        } catch (err) {
          return errorResponse(err);
        }
      });
    }

    if (url.pathname === '/api/artist-data') {
      const name = (q.get('name') || '').trim();
      if (!name) return json({ error: 'Missing name parameter' }, 400);

      // Edge cache → KV → Last.fm. Cloudflare's front-line HTTP cache does
      // serve these responses (they carry max-age) even on *.workers.dev,
      // but it's per-colo and capped at 24h; KV is global and holds entries
      // for 7 days. Artist info/similar barely changes, so the long TTL is
      // safe; only successes are written.
      return cached(request, 86400, ctx, async (cc) => {
        const kvKey = `artist:${name.toLowerCase()}`;
        try {
          const hit = await env.CACHE.get(kvKey, 'json');
          if (hit) return json(hit, 200, cc);
        } catch {
          // KV read failed — fall through to Last.fm rather than erroring
        }
        try {
          const data = await lf.getArtistData(name);
          ctx.waitUntil(
            env.CACHE.put(kvKey, JSON.stringify(data), {
              expirationTtl: 7 * 86400,
            }).catch(() => {})
          );
          return json(data, 200, cc);
        } catch (err) {
          return errorResponse(err);
        }
      });
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    // everything else is a static asset (the built client)
    return env.ASSETS.fetch(request);
  },
};
