import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import Controls from './components/Controls';
import StartScreen from './components/StartScreen';
import { MAX_LIMIT } from './components/GraphForm';
import SearchPanel from './components/SearchPanel';
import ShareMenu from './components/ShareMenu';
import DetailsPanel from './components/DetailsPanel';
import Legend from './components/Legend';
import { genreOf } from './colors';
import { loadGraph } from './lib/loadGraph';
import demoData from './demoData.json';

const idOf = (end) => (typeof end === 'object' ? end.id : end);

function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
}

export default function App() {
  const fgRef = useRef();
  const { w, h } = useWindowSize();

  const [raw, setRaw] = useState(null);
  const [form, setForm] = useState({ username: '', period: 'overall', limit: 50 });
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [settings, setSettings] = useState({
    sizeMetric: 'userPlaycount',
    linkMetric: 'similarity',
    simThreshold: 0.25,
    minSharedTags: 2,
    hideUnconnected: false,
  });
  const [hoverNode, setHoverNode] = useState(null);
  const [selected, setSelected] = useState(null);
  const [growing, setGrowing] = useState(false);
  const [frozen, setFrozen] = useState(false);
  // phones: start with the panels tucked away so the graph gets the screen
  const [uiHidden, setUiHidden] = useState(() => window.innerWidth < 640);
  const [searchHidden, setSearchHidden] = useState(false);

  // "Grow" mode: glide the active link threshold down and back up in fine
  // 0.01 steps, so connections sprout and recede fluidly. Starts from the
  // slider's current value. Bigger graphs tick slower.
  useEffect(() => {
    if (!growing || !raw) return;
    const scale = Math.max(1, Math.min(raw.nodes.length / 600, 2));
    let dir = -1; // -1 = loosening the threshold (links growing)
    let ticks = 0;
    const id = setInterval(() => {
      ticks++;
      setSettings((s) => {
        if (s.linkMetric === 'similarity') {
          let v = +(s.simThreshold + dir * 0.01).toFixed(2);
          if (v <= 0) v = 0;
          if (v >= 0.9) v = 0.9;
          if (v === 0) dir = 1;
          else if (v === 0.9) dir = -1;
          return v === s.simThreshold ? s : { ...s, simThreshold: v };
        }
        // tags mode only has 4 levels — step once every ~20 ticks
        if (ticks % 20 !== 0) return s;
        let v = s.minSharedTags + dir;
        if (v <= 1) v = 1;
        if (v >= 4) v = 4;
        if (v === 1) dir = 1;
        else if (v === 4) dir = -1;
        return v === s.minSharedTags ? s : { ...s, minSharedTags: v };
      });
    }, 60 * scale);
    return () => clearInterval(id);
  }, [growing, raw]);

  const load = useCallback(async (username, period, limit) => {
    setLoading(true);
    setProgress(null);
    setError(null);
    setNotice(null);
    setSelected(null);
    setHoverNode(null);
    setGrowing(false);
    setFrozen(false);

    try {
      const payload = await loadGraph({ username, period, limit }, setProgress);
      setRaw(payload);
      if (payload.warning) setNotice(payload.warning);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }, []);

  const submitLoad = useCallback(() => {
    const limit = form.limit === MAX_LIMIT ? 'all' : form.limit;
    load(form.username.trim(), form.period, limit);
  }, [form, load]);

  // No-account demo: drop a pre-built real graph straight in, no network or
  // Last.fm rate limits. The form mirrors the demo so "Reload graph" rebuilds
  // it live, and a fresh deep-copy is used so each load starts from clean
  // node objects (the force layout mutates them in place).
  const loadDemo = useCallback(() => {
    setLoading(false);
    setProgress(null);
    setError(null);
    setNotice(null);
    setSelected(null);
    setHoverNode(null);
    setGrowing(false);
    setFrozen(false);
    setForm({ username: demoData.user, period: demoData.period, limit: demoData.nodes.length });
    setRaw(JSON.parse(JSON.stringify(demoData)));
  }, []);

  // Nodes only depend on the fetched data so the force layout
  // survives display-setting changes without resetting positions.
  const nodes = useMemo(
    () => (raw ? raw.nodes.map((n) => ({ ...n, ...genreOf(n.tags) })) : []),
    [raw]
  );

  // While growing, slowly spin the whole graph: a rigid rotation of node
  // positions (and velocities) around the centroid, one small step per frame.
  useEffect(() => {
    if (!growing || nodes.length === 0) return;
    // one revolution per minute, stretching up to four for the biggest graphs
    const ROTATION_PERIOD = 60000 * Math.max(1, Math.min(nodes.length / 600, 4));
    let raf;
    let last = performance.now();
    const tick = (now) => {
      const theta = ((now - last) / ROTATION_PERIOD) * 2 * Math.PI;
      last = now;
      let cx = 0;
      let cy = 0;
      let count = 0;
      for (const n of nodes) {
        if (n.x != null) {
          cx += n.x;
          cy += n.y;
          count++;
        }
      }
      if (count > 0) {
        cx /= count;
        cy /= count;
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        for (const n of nodes) {
          if (n.x == null) continue;
          const dx = n.x - cx;
          const dy = n.y - cy;
          n.x = cx + dx * cos - dy * sin;
          n.y = cy + dx * sin + dy * cos;
          if (n.vx != null) {
            const { vx, vy } = n;
            n.vx = vx * cos - vy * sin;
            n.vy = vx * sin + vy * cos;
          }
        }
      }
      // with a node selected, lock the camera onto it as the graph moves
      if (selected && selected.x != null) {
        fgRef.current?.centerAt(selected.x, selected.y);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [growing, nodes, selected]);

  // pin/unpin every node's current position so the force simulation
  // (and dragging) can no longer move them around
  const toggleFrozen = useCallback(() => {
    setFrozen((f) => {
      const next = !f;
      for (const n of nodes) {
        if (next) {
          if (n.x != null) {
            n.fx = n.x;
            n.fy = n.y;
          }
        } else {
          delete n.fx;
          delete n.fy;
        }
      }
      return next;
    });
  }, [nodes]);

  const links = useMemo(() => {
    if (!raw) return [];
    let out;
    if (settings.linkMetric === 'similarity') {
      out = raw.links
        .filter((l) => l.value >= settings.simThreshold)
        .map((l) => ({ ...l }));
    } else {
      // shared genre tags: link every pair with enough tags in common
      out = [];
      for (let i = 0; i < raw.nodes.length; i++) {
        const tagsA = new Set(raw.nodes[i].tags);
        for (let j = i + 1; j < raw.nodes.length; j++) {
          let shared = 0;
          for (const t of raw.nodes[j].tags) if (tagsA.has(t)) shared++;
          if (shared >= settings.minSharedTags) {
            out.push({
              source: raw.nodes[i].id,
              target: raw.nodes[j].id,
              value: Math.min(shared / 4, 1),
            });
          }
        }
      }
    }
    // rank strongest-first so zoomed-out rendering can draw only the top tier
    [...out].sort((a, b) => b.value - a.value).forEach((l, i) => {
      l._rank = i;
    });
    return out;
  }, [raw, settings.linkMetric, settings.simThreshold, settings.minSharedTags]);

  const degree = useMemo(() => {
    const d = new Map();
    for (const l of links) {
      const s = idOf(l.source);
      const t = idOf(l.target);
      d.set(s, (d.get(s) || 0) + 1);
      d.set(t, (d.get(t) || 0) + 1);
    }
    return d;
  }, [links]);

  // same node objects are reused, so positions survive toggling this on/off
  const visibleNodes = useMemo(
    () =>
      settings.hideUnconnected
        ? nodes.filter((n) => (degree.get(n.id) || 0) > 0)
        : nodes,
    [nodes, degree, settings.hideUnconnected]
  );

  const graphData = useMemo(
    () => ({ nodes: visibleNodes, links }),
    [visibleNodes, links]
  );

  const neighbors = useMemo(() => {
    const m = new Map();
    for (const l of links) {
      const s = idOf(l.source);
      const t = idOf(l.target);
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s).add(t);
      m.get(t).add(s);
    }
    return m;
  }, [links]);

  const radii = useMemo(() => {
    const metric = (n) =>
      settings.sizeMetric === 'degree'
        ? degree.get(n.id) || 0
        : n[settings.sizeMetric] || 0;
    const max = Math.max(1, ...nodes.map(metric));
    return new Map(nodes.map((n) => [n.id, 3 + 13 * Math.sqrt(metric(n) / max)]));
  }, [nodes, degree, settings.sizeMetric]);

  // hovering takes precedence; otherwise a clicked node keeps the
  // highlight locked on until it's deselected
  const focusNode = hoverNode || selected;

  const highlight = useMemo(() => {
    if (!focusNode) return null;
    return new Set([focusNode.id, ...(neighbors.get(focusNode.id) || [])]);
  }, [focusNode, neighbors]);

  // Viewport bounds + zoom captured once per frame; draw callbacks read this
  // to skip everything off-screen instead of painting the whole graph.
  const frameRef = useRef({
    k: 1,
    left: -Infinity,
    top: -Infinity,
    right: Infinity,
    bottom: Infinity,
    tinyBatches: new Map(),
  });

  const onRenderFramePre = useCallback((ctx, globalScale) => {
    const fg = fgRef.current;
    if (!fg) return;
    const tl = fg.screen2GraphCoords(0, 0);
    const br = fg.screen2GraphCoords(window.innerWidth, window.innerHeight);
    const margin = 40 / globalScale + 20; // keep edge nodes and labels visible
    frameRef.current = {
      k: globalScale,
      left: tl.x - margin,
      top: tl.y - margin,
      right: br.x + margin,
      bottom: br.y + margin,
      tinyBatches: new Map(),
    };
  }, []);

  // Tiny far-away nodes get collected per color during the node pass and
  // drawn here as one path per color instead of thousands of separate fills.
  const onRenderFramePost = useCallback((ctx) => {
    const { tinyBatches } = frameRef.current;
    for (const [key, pts] of tinyBatches) {
      const sep = key.lastIndexOf('|');
      ctx.fillStyle = key.slice(0, sep);
      ctx.globalAlpha = Number(key.slice(sep + 1));
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 3) {
        const r = pts[i + 2];
        ctx.rect(pts[i] - r, pts[i + 1] - r, r * 2, r * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, []);

  // cap how far node repulsion reaches — big simulation speedup on large graphs
  useEffect(() => {
    fgRef.current?.d3Force('charge')?.distanceMax(350);
  }, [nodes]);

  const focusArtist = useCallback(
    (query) => {
      const q = query.toLowerCase();
      const node =
        visibleNodes.find((n) => n.id.toLowerCase() === q) ||
        visibleNodes.find((n) => n.id.toLowerCase().includes(q));
      if (node && fgRef.current && node.x != null) {
        fgRef.current.centerAt(node.x, node.y, 800);
        fgRef.current.zoom(4, 800);
        setSelected(node);
      }
    },
    [visibleNodes]
  );

  const drawNode = useCallback(
    (node, ctx, globalScale) => {
      const f = frameRef.current;
      if (node.x < f.left || node.x > f.right || node.y < f.top || node.y > f.bottom) {
        return; // off-screen
      }

      const r = radii.get(node.id) || 4;
      const sr = r * globalScale; // on-screen radius in px
      const dimmed = highlight && !highlight.has(node.id);
      const isFocused = node === hoverNode || node.id === selected?.id;

      if (sr < 2 && !isFocused) {
        if (sr < 0.35) return; // smaller than half a pixel — invisible
        // defer to the batched pass: one fill per color instead of per node
        const key = `${node.color}|${dimmed ? 0.12 : 1}`;
        let pts = f.tinyBatches.get(key);
        if (!pts) f.tinyBatches.set(key, (pts = []));
        pts.push(node.x, node.y, r);
        return;
      }

      ctx.globalAlpha = dimmed ? 0.12 : 1;
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fill();

      if (isFocused) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 2 / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5 / globalScale;
        ctx.stroke();
      }

      // labels fade in as nodes get big enough on screen to matter
      const labelAlpha = isFocused
        ? 1
        : highlight?.has(node.id) && sr > 5
          ? 0.85
          : sr > 10
            ? Math.min(1, (sr - 10) / 6)
            : 0;
      if (!dimmed && labelAlpha > 0) {
        const fontSize = Math.max(11 / globalScale, 2);
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = labelAlpha;
        ctx.fillStyle = 'rgba(229,231,235,0.9)';
        ctx.fillText(node.id, node.x, node.y + r + 2 / globalScale);
      }
      ctx.globalAlpha = 1;
    },
    [radii, highlight, hoverNode, selected]
  );

  const paintPointerArea = useCallback(
    (node, color, ctx) => {
      const f = frameRef.current;
      if (node.x < f.left || node.x > f.right || node.y < f.top || node.y > f.bottom) {
        return;
      }
      const r = radii.get(node.id) || 4;
      if (r * f.k < 2) return; // too small on screen to hover anyway
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 2, 0, 2 * Math.PI);
      ctx.fill();
    },
    [radii]
  );

  const linkVisibility = useCallback(
    (l) => {
      const s = l.source;
      const t = l.target;
      // always show the focused (hovered or selected) artist's connections
      if (focusNode && (idOf(s) === focusNode.id || idOf(t) === focusNode.id)) {
        return true;
      }
      const f = frameRef.current;
      if (typeof s === 'object' && typeof t === 'object') {
        if (
          (s.x < f.left && t.x < f.left) ||
          (s.x > f.right && t.x > f.right) ||
          (s.y < f.top && t.y < f.top) ||
          (s.y > f.bottom && t.y > f.bottom)
        ) {
          return false; // entirely off-screen
        }
      }
      // zoomed out: only the strongest links; more detail appears as you zoom in
      if (f.k < 2 && l._rank > 1500 * Math.max(f.k, 0.25)) return false;
      return true;
    },
    [focusNode]
  );

  const linkColor = useCallback(
    (l) => {
      if (highlight) {
        const touchesFocus =
          idOf(l.source) === focusNode.id || idOf(l.target) === focusNode.id;
        return touchesFocus ? 'rgba(167,139,250,0.6)' : 'rgba(255,255,255,0.02)';
      }
      // quantized alpha so the renderer can batch strokes by color
      const a = Math.round((0.06 + 0.24 * Math.min(l.value, 1)) * 20) / 20;
      return `rgba(255,255,255,${a})`;
    },
    [highlight, focusNode]
  );

  const linkWidth = useCallback(
    // quantized so the renderer can batch strokes by width
    (l) => Math.round((0.5 + 2.5 * Math.min(l.value, 1)) * 2) / 2,
    []
  );

  const big = nodes.length > 600;

  return (
    <div className="app">
      <ForceGraph2D
        ref={fgRef}
        width={w}
        height={h}
        graphData={graphData}
        backgroundColor="#0a0a0f"
        onRenderFramePre={onRenderFramePre}
        onRenderFramePost={onRenderFramePost}
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={paintPointerArea}
        nodeLabel={() => ''}
        linkVisibility={linkVisibility}
        linkColor={linkColor}
        linkWidth={linkWidth}
        onNodeHover={setHoverNode}
        onNodeClick={(node) =>
          setSelected((s) => (s?.id === node.id ? null : node))
        }
        onBackgroundClick={() => setSelected(null)}
        // dragging a node reheats the whole simulation — too heavy on huge graphs
        enableNodeDrag={!frozen && nodes.length <= 1000}
        // keep the render loop alive while grow mode spins the graph
        autoPauseRedraw={!growing}
        warmupTicks={big ? 20 : 60}
        cooldownTime={big ? 10000 : 6000}
        d3AlphaDecay={big ? 0.05 : 0.04}
        // big graphs: heavy damping + early stop so the physics loop ends
        // as soon as movement stops being visible. Smaller graphs get a
        // touch of extra friction too, so dragging nodes feels less floaty.
        d3VelocityDecay={big ? 0.6 : 0.5}
        d3AlphaMin={big ? 0.01 : 0}
      />

      {raw && !uiHidden && (
        <>
          <Controls
            settings={settings}
            onSettingsChange={setSettings}
            form={form}
            onFormChange={setForm}
            onSubmit={submitLoad}
            loading={loading}
            user={raw.user}
            growing={growing}
            onToggleGrow={setGrowing}
            frozen={frozen}
            onToggleFreeze={toggleFrozen}
          />

          <Legend nodes={visibleNodes} />
        </>
      )}

      {raw && (!searchHidden || (selected && !uiHidden)) && (
        <div className="left-column">
          {!searchHidden && (
            <SearchPanel
              artistNames={visibleNodes.map((n) => n.id)}
              onSearch={focusArtist}
            />
          )}
          {selected && !uiHidden && (
            <DetailsPanel
              node={selected}
              connections={degree.get(selected.id) || 0}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
      )}

      {raw && (
        <div className="bottom-bar">
          <button
            type="button"
            className="ui-toggle"
            onClick={() => setUiHidden((h) => !h)}
          >
            {uiHidden ? 'Show menus' : 'Hide menus'}
          </button>
          <button
            type="button"
            className="ui-toggle"
            onClick={() => setSearchHidden((h) => !h)}
          >
            {searchHidden ? 'Show search' : 'Hide search'}
          </button>
          <ShareMenu
            user={raw.user}
            fgRef={fgRef}
            nodes={visibleNodes}
            radii={radii}
            settings={settings}
            onSettingsChange={setSettings}
            onToggleGrow={setGrowing}
          />
        </div>
      )}

      {!raw && !loading && (
        <StartScreen
          form={form}
          onChange={setForm}
          onSubmit={submitLoad}
          onDemo={loadDemo}
          loading={loading}
        />
      )}

      {loading && (
        <div className="overlay">
          {progress?.phase === 'details' && progress.total > 0 ? (
            <>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.round((100 * progress.done) / progress.total)}%` }}
                />
              </div>
              <p>
                Fetching artist details… {progress.done.toLocaleString()} /{' '}
                {progress.total.toLocaleString()}
              </p>
            </>
          ) : (
            <>
              <div className="spinner" />
              <p>
                {progress?.phase === 'top'
                  ? `Fetching top artists… ${progress.artists.toLocaleString()} found` +
                    (progress.totalPages > 1 ? ` (page ${progress.page} of ${progress.totalPages})` : '')
                  : 'Connecting…'}
              </p>
            </>
          )}
          <p className="overlay-note">Repeat loads are much faster thanks to caching.</p>
        </div>
      )}

      {error && (
        <div className="toast" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {notice && !error && (
        <div className="toast warn" onClick={() => setNotice(null)}>
          {notice}
        </div>
      )}
    </div>
  );
}
