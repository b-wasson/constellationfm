// Client-side graph builder. The browser pages through the user's top
// artists and fetches each artist's details through the thin API proxy
// (Express locally, a Cloudflare Worker in production), then assembles
// nodes and similarity links itself. Keeping the orchestration here means
// each server/Worker request only makes a couple of Last.fm calls.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_RETRIES = 5;
// when rate limited, cool down hard and escalate — hammering a limited API
// is how keys get banned
const RATE_LIMIT_COOLDOWNS_MS = [5000, 10000, 20000, 40000, 60000];
let throttleUntil = 0; // shared brake across all in-flight requests

async function api(path, attempt = 0) {
  const holdoff = throttleUntil - Date.now();
  if (holdoff > 0) await sleep(holdoff);

  let res = null;
  try {
    // generous timeout: the proxy may legitimately take a while when it's
    // pacing or cooling down, but a request must never hang forever — that
    // strands one pool worker and the load sticks at "one away from done"
    res = await fetch(path, { signal: AbortSignal.timeout(90000) });
  } catch {
    // network hiccup or timeout — retryable
  }
  if (res?.ok) return res.json();

  const retryable = !res || res.status === 429 || res.status >= 500;
  if (retryable && attempt < MAX_RETRIES) {
    let backoff = Math.min(1000 * 2 ** attempt, 15000);
    if (res?.status === 429) {
      // honor the server's Retry-After, never wait less than the schedule,
      // and brake every in-flight request, not just this one
      const retryAfter = (Number(res.headers.get('retry-after')) || 0) * 1000;
      const cooldown =
        RATE_LIMIT_COOLDOWNS_MS[Math.min(attempt, RATE_LIMIT_COOLDOWNS_MS.length - 1)];
      backoff = Math.max(backoff, cooldown, retryAfter);
      throttleUntil = Math.max(throttleUntil, Date.now() + backoff);
    }
    await sleep(backoff);
    return api(path, attempt + 1);
  }

  let message = 'Something went wrong talking to the server.';
  try {
    message = (await res.json()).error || message;
  } catch {
    // no JSON body
  }
  const err = new Error(message);
  err.status = res?.status;
  throw err;
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

export async function loadGraph({ username, period, limit }, onProgress = () => {}) {
  const wantAll = limit === 'all';
  const perPage = wantAll ? 1000 : limit;

  // 1. top artists ('all' pages through the entire library)
  const artists = [];
  let userName = username;
  let page = 1;
  let totalPages = 1;
  do {
    const top = await api(
      `/api/top-artists?${new URLSearchParams({ user: username, period, limit: perPage, page })}`
    );
    artists.push(...top.artists);
    userName = top.user || username;
    totalPages = wantAll ? top.totalPages : 1;
    onProgress({ phase: 'top', page, totalPages, artists: artists.length });
    page++;
  } while (page <= totalPages);

  if (artists.length === 0) {
    throw new Error(`No listening data found for "${username}" in this period.`);
  }

  // 2. per-artist details, 8 at a time
  let done = 0;
  let failedArtists = 0;
  onProgress({ phase: 'details', done, total: artists.length });
  const details = await mapPool(artists, 8, async (a) => {
    let d;
    try {
      d = await api(`/api/artist-data?${new URLSearchParams({ name: a.name })}`);
    } catch {
      failedArtists++;
      d = { listeners: 0, globalPlaycount: 0, tags: [], similar: [] };
    }
    done++;
    onProgress({ phase: 'details', done, total: artists.length });
    return d;
  });

  // 3. nodes + similarity links between artists that are both in the set
  const nodes = artists.map((a, i) => ({
    id: a.name,
    url: a.url,
    userPlaycount: a.userPlaycount,
    listeners: details[i].listeners,
    globalPlaycount: details[i].globalPlaycount,
    tags: details[i].tags,
  }));

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
  }
  return payload;
}
