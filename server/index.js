import 'dotenv/config';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLastfm, statusOf } from '../shared/lastfm.js';

const API_KEY = process.env.LASTFM_API_KEY;
const PORT = process.env.PORT || 3001;

if (!API_KEY) {
  console.error('Missing LASTFM_API_KEY — create server/.env with your key.');
  process.exit(1);
}

const lf = createLastfm(() => API_KEY);

const app = express();

const sendError = (res, err) => {
  const status = statusOf(err);
  // tell the client how long to hold off so it doesn't make things worse
  if (status === 429 && err.retryAfterSec) {
    res.set('Retry-After', String(err.retryAfterSec));
  }
  res.status(status).json({ error: err.message });
};

// The client orchestrates graph building itself (paging, concurrency,
// retries, link assembly) so the same thin proxy works here and on
// Cloudflare Workers, where one request may only make a few subrequests.

app.get('/api/top-artists', async (req, res) => {
  const user = String(req.query.user || '').trim();
  const period = String(req.query.period || 'overall');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 5), 1000);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  if (!user) return res.status(400).json({ error: 'Missing user parameter' });

  try {
    const data = await lf.getTopArtists({ user, period, limit, page });
    res.set('Cache-Control', 'public, max-age=600');
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

app.get('/api/artist-data', async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Missing name parameter' });

  try {
    const data = await lf.getArtistData(name);
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(data);
  } catch (err) {
    sendError(res, err);
  }
});

// serve the built client in production
const clientDist = path.join(path.dirname(fileURLToPath(import.meta.url)), '../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

app.listen(PORT, () => console.log(`API server listening on http://localhost:${PORT}`));
