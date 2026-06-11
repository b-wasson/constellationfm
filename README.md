# Constellation.fm

An Obsidian-graph-view-style map of your Last.fm listening history. Type a
username and your library becomes an interactive force-directed universe:
every node is an artist you've listened to, sized by how much you play them,
linked to the artists Last.fm considers similar, and colored by genre.

![A full library rendered as a graph — thousands of artists clustered by genre](docs/screenshot.png)

## Features

### The graph

- **Nodes are artists** from your Last.fm listening history — anywhere from
  your top 20 to your entire library (thousands of artists).
- **Node size** is configurable:
  - *Your scrobbles* — how many times you've played the artist (default)
  - *Global listeners* — worldwide Last.fm listener count (mainstream vs. niche)
  - *Connection count* — how many links the artist has in your graph (finds
    the "hub" artists that tie your taste together)
  - *Global playcount* — worldwide total plays
- **Links are configurable** too:
  - *Artist similarity* — Last.fm's similarity score between the two artists;
    stronger matches draw thicker, brighter lines. A **min similarity** slider
    hides weak links to declutter dense graphs.
  - *Shared genre tags* — artists link when they share top tags (e.g. both
    tagged "shoegaze"), with a min-shared-tags slider.
- **Node color = dominant genre tag** (rock, electronic, hip-hop, ambient…),
  so genre neighborhoods are visible at a glance. A legend in the corner
  counts the top genres in view.

### Interactions

- **Hover** an artist to spotlight it and its direct connections, dimming
  everything else — just like Obsidian's graph view.
- **Click** an artist for a details panel: your scrobbles, global listeners
  and plays, connection count, genre tags, and a link to their Last.fm page.
- **Search** the graph by artist name and the camera flies to the match.
- **Hide unconnected artists** with one button to trim isolated nodes (it
  respects your current link settings, and toggling back restores them in
  place).
- **Drag, pan, and zoom** freely. Dragging is disabled above 1,000 artists,
  where it would bog down the physics.
- **Share your graph** as an image: the Share button screenshots the current
  view (stamped with your username and Constellation.fm), then lets you
  download it, copy it to the clipboard, send it through your device's share
  sheet, or open a pre-written post on X, Bluesky, Reddit, or Facebook to
  attach it to.
- **Export a looping GIF** of the grow animation: the recorder plays one
  full cycle for real — the link threshold sweeps down and back while the
  graph turns exactly 360°, with the live physics reacting throughout — and
  captures it straight off the canvas. A few extra frames are crossfaded
  over the start so the leftover physics drift morphs smoothly instead of
  jumping, making the GIF loop seamlessly.

### Data controls

- **Time period**: last 7 days, 1/3/6/12 months, or all time.
- **Artist count**: 20 up to your entire library ("All"). Counts above 200
  show a heads-up that the first load takes a while.
- **Live progress bar** while loading — the app streams progress from the
  server so you can watch it page through your library and fetch artist
  details in real time.

### Performance

Large graphs are aggressively optimized, so even an entire library stays
navigable:

- Off-screen nodes and links are skipped entirely each frame; you only pay
  for what's inside the viewport.
- Level-of-detail rendering: zoomed out, only the strongest links draw and
  sub-pixel nodes are dropped; zooming in progressively reveals more links
  and fades in artist labels.
- Tiny far-away nodes are batched into a handful of canvas fills per genre
  color instead of thousands of individual draws.
- Link colors/widths are quantized so the renderer can batch strokes.
- Physics tuning scales with graph size: limited repulsion range, faster
  settling, heavier damping, and an early stop once motion is no longer
  visible.
- Server-side caching: artist data is cached for 24 hours and assembled
  graphs for 10 minutes, so repeat loads are near-instant and popular
  artists are only ever fetched once.

## Getting started

### Prerequisites

- Node.js 18+ (uses the built-in `fetch`)
- A free [Last.fm API key](https://www.last.fm/api/account/create)

### Setup

```bash
git clone <this repo>
cd lastfm-graph
npm install
```

Create `server/.env`:

```ini
LASTFM_API_KEY=your_api_key_here
PORT=3001
```

### Development

```bash
npm run dev
```

Open <http://localhost:5173>, enter a Last.fm username, and hit **Build
graph**. The Vite dev server (port 5173) proxies `/api` requests to the
Express server (port 3001).

### Production

```bash
npm run build   # bundles the client into client/dist
npm start       # Express serves both the API and the built client on :3001
```

## How it works

```
┌──────────────┐     /api/graph?user=…&stream=1      ┌──────────────┐
│ React client │ ──────────────────────────────────► │ Express API  │
│ force-graph  │ ◄────────── SSE progress ────────── │  + caching   │
└──────────────┘            then full graph          └──────┬───────┘
                                                            │ user.gettopartists
                                                            │ artist.getinfo
                                                            │ artist.getsimilar
                                                            ▼
                                                      Last.fm API
```

1. The server fetches the user's top artists for the chosen period
   (paginating 1,000 at a time for "All").
2. For each artist it fetches `artist.getinfo` (global stats + genre tags)
   and `artist.getsimilar` (similarity scores), 8 requests in parallel,
   streaming progress back to the client as Server-Sent Events.
3. Links are built between every pair of artists that are both in your
   library and appear in each other's similar-artists lists.
4. The client renders the graph with
   [force-graph](https://github.com/vasturiano/force-graph) (canvas) and
   computes everything display-related — link filtering, shared-tag links,
   node sizing, genre coloring — locally. Changing display settings never
   refetches data or resets the layout.

### Project layout

```
lastfm-graph/
├── server/            # Express API
│   ├── index.js       # /api/graph endpoint, Last.fm client, TTL caches, SSE
│   └── .env           # LASTFM_API_KEY (not committed)
├── client/            # Vite + React frontend
│   └── src/
│       ├── App.jsx               # graph rendering, LOD, culling, state
│       ├── colors.js             # genre → color mapping
│       └── components/
│           ├── Controls.jsx      # username, sliders, dropdowns, search
│           ├── DetailsPanel.jsx  # artist info on click
│           └── Legend.jsx        # genre color legend
└── package.json       # npm workspaces + dev/build/start scripts
```

## Notes & limitations

- **API key stays server-side.** The browser never talks to Last.fm
  directly, so your key isn't exposed — but it also means all traffic shares
  one key. Last.fm allows roughly 5 requests/second, so many *simultaneous*
  first-time loads will queue. The artist cache absorbs most of this in
  practice.
- **First loads are the slow part.** A 50-artist graph takes a few seconds;
  an entire large library can take several minutes (about 2 Last.fm calls
  per artist). The progress bar keeps you posted, and repeat loads hit the
  cache.
- **"Unknown" genre** means Last.fm has no usable tags for that artist —
  common for small or obscure artists.
- **WSL2 tip:** if the project lives on the Windows drive (`/mnt/c/…`), file
  watching doesn't get change events; the Vite config already enables
  polling for hot reload, but the API server needs a manual restart after
  backend changes.

## Tech stack

| Layer     | Choice                                          |
| --------- | ----------------------------------------------- |
| Frontend  | React 18 + Vite                                 |
| Graph     | force-graph / react-force-graph-2d (canvas)     |
| Backend   | Node.js + Express                               |
| Data      | Last.fm API (top artists, artist info, similar) |
| Streaming | Server-Sent Events for load progress            |
