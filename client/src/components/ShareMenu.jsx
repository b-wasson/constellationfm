import { useEffect, useRef, useState } from 'react';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

const MAX_LABELS = 12;

// GIF export: record the real, live simulation through one full grow cycle —
// a 360° rotation plus a threshold down-and-back sweep. Physics drift means
// the end never matches the start exactly, so a few extra frames are
// recorded past the loop point and crossfaded over the opening frames.
const GIF_FRAMES = 70; // one full loop
const GIF_OVERLAP = 10; // extra frames blended into the start to hide the seam
const GIF_DELAY = 100; // ms per frame (10 fps, ~7s loop)
const GIF_WIDTH = 720;

// Label the most prominent artists in view so the screenshot has substance
// even when zoomed out (where the live render hides every name).
function drawLabels(ctx, fg, nodes, radii, scale, w, h) {
  if (!fg) return;
  const zoom = fg.zoom();
  const candidates = [];
  for (const n of nodes) {
    if (n.x == null) continue;
    const p = fg.graph2ScreenCoords(n.x, n.y);
    if (p.x < 0 || p.x > w || p.y < 0 || p.y > h) continue;
    candidates.push({ name: n.id, x: p.x, y: p.y, r: (radii.get(n.id) || 4) * zoom });
  }
  candidates.sort((a, b) => b.r - a.r);

  const fontSize = 13;
  ctx.font = `600 ${fontSize * scale}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineJoin = 'round';

  const placed = [];
  for (const c of candidates) {
    if (placed.length >= MAX_LABELS) break;
    const tw = ctx.measureText(c.name).width / scale;
    const y = c.y + Math.max(c.r, 1.5) + 3;
    const box = {
      left: c.x - tw / 2 - 4,
      right: c.x + tw / 2 + 4,
      top: c.y - Math.max(c.r, 1.5) - 2, // include the node so dots aren't covered
      bottom: y + fontSize + 4,
    };
    if (box.left < 4 || box.right > w - 4 || box.bottom > h - 4) continue;
    const collides = placed.some(
      (b) =>
        box.right > b.left && box.left < b.right && box.bottom > b.top && box.top < b.bottom
    );
    if (collides) continue;
    placed.push(box);

    // dark halo so names stay readable over links and other nodes
    ctx.lineWidth = 3.5 * scale;
    ctx.strokeStyle = 'rgba(10, 10, 15, 0.9)';
    ctx.strokeText(c.name, c.x * scale, y * scale);
    ctx.fillStyle = 'rgba(235, 236, 240, 0.95)';
    ctx.fillText(c.name, c.x * scale, y * scale);
  }
}

// Mirror the in-app legend: top genres by node count, bottom-left corner.
function drawLegend(ctx, nodes, scale, w, h) {
  const counts = new Map();
  for (const n of nodes) {
    const entry = counts.get(n.genre) || { color: n.color, count: 0 };
    entry.count++;
    counts.set(n.genre, entry);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);
  if (top.length === 0) return;

  const fs = 13 * scale;
  const pad = 14 * scale;
  const rowH = 22 * scale;
  const dot = 9 * scale;

  ctx.font = `500 ${fs}px Inter, system-ui, sans-serif`;
  const rows = top.map(([genre, { color, count }]) => ({
    label: genre.charAt(0).toUpperCase() + genre.slice(1),
    count: String(count),
    color,
  }));
  let textW = 0;
  for (const r of rows) {
    textW = Math.max(textW, ctx.measureText(`${r.label}  ${r.count}`).width);
  }

  const bw = pad * 2 + dot + 8 * scale + textW;
  const bh = pad * 2 + rowH * rows.length - (rowH - fs);
  const bx = 16 * scale;
  const by = h * scale - bh - 16 * scale;

  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 10 * scale);
  else ctx.rect(bx, by, bw, bh);
  ctx.fillStyle = 'rgba(18, 18, 26, 0.88)';
  ctx.fill();
  ctx.lineWidth = scale;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  rows.forEach((r, i) => {
    const cy = by + pad + fs / 2 + rowH * i;
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(bx + pad + dot / 2, cy, dot / 2, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = 'rgba(209, 213, 219, 0.95)';
    ctx.fillText(r.label, bx + pad + dot + 8 * scale, cy);
    ctx.fillStyle = 'rgba(107, 114, 128, 0.95)';
    ctx.fillText(
      r.count,
      bx + pad + dot + 8 * scale + ctx.measureText(r.label).width + 7 * scale,
      cy
    );
  });
}

// Screenshot the graph canvas (panels are DOM, so they're never in the shot),
// then add artist labels, a genre legend, and a credit stamp.
function captureGraph({ user, fg, nodes, radii }) {
  const src = document.querySelector('.app canvas');
  if (!src) return Promise.resolve(null);
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  // the graph canvas is transparent (its dark background is CSS), so the
  // export needs its own black backdrop or the PNG comes out see-through
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(src, 0, 0);

  const scale = src.clientWidth ? src.width / src.clientWidth : 1;
  const w = src.clientWidth || src.width;
  const h = src.clientHeight || src.height;

  drawLabels(ctx, fg, nodes, radii, scale, w, h);
  drawLegend(ctx, nodes, scale, w, h);

  const pad = 18 * scale;
  const size = 15 * scale;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  if (user) {
    ctx.font = `500 ${size * 0.85}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(156, 163, 175, 0.95)';
    ctx.fillText(`${user}'s music library`, out.width - pad, out.height - pad - size * 1.3);
  }
  ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(196, 181, 253, 0.95)';
  ctx.fillText('Constellation.fm', out.width - pad, out.height - pad);

  return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
}

const tick = () => new Promise((r) => setTimeout(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// One rigid rotation step around the centroid — the same spin grow mode does,
// applied to positions and velocities so the live physics keeps making sense.
function rotateNodes(nodes, dTheta) {
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
  if (count === 0) return;
  cx /= count;
  cy /= count;
  const cos = Math.cos(dTheta);
  const sin = Math.sin(dTheta);
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

// Record the real, live grow animation. The export drives one full cycle —
// threshold sweeping down and back up while the graph turns exactly 360° —
// and grabs frames straight off the app canvas, so the d3 physics (links
// pulling clusters together, drift, settling) is all genuinely in the GIF.
// Threshold and rotation return to their start values; the leftover physics
// drift is hidden by recording GIF_OVERLAP extra frames and crossfading them
// over the opening frames, so the loop ghost-morphs instead of jumping.
async function recordGrowGif({
  fg,
  nodes,
  radii,
  settings,
  onSettingsChange,
  onToggleGrow,
  user,
  onProgress,
}) {
  const src = document.querySelector('.app canvas');
  if (!src || !fg || nodes.length === 0) return null;

  const vw = src.clientWidth;
  const vh = src.clientHeight;
  const outW = Math.min(GIF_WIDTH, vw);
  const outScale = outW / vw;
  const outH = Math.round(vh * outScale);

  onToggleGrow(false); // the recorder drives the cycle itself

  const isSim = settings.linkMetric === 'similarity';
  const hi = isSim ? Math.max(settings.simThreshold, 0.35) : 4; // enough range to be visible
  const lo = isSim ? 0 : 1;
  const startVal = isSim ? settings.simThreshold : settings.minSharedTags;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const screenOf = (n) => {
    const g = fg.graph2ScreenCoords(n.x, n.y);
    return { x: g.x * outScale, y: g.y * outScale };
  };

  // pick the labeled artists once up front; their labels follow the live
  // node positions each frame instead of flickering in and out
  const labelFont = '600 12px Inter, system-ui, sans-serif';
  ctx.font = labelFont;
  const labelCands = [];
  for (const n of nodes) {
    if (n.x == null) continue;
    const s = screenOf(n);
    if (s.x < 0 || s.x > outW || s.y < 0 || s.y > outH) continue;
    labelCands.push({ id: n.id, x: s.x, y: s.y, r: (radii.get(n.id) || 4) * fg.zoom() * outScale });
  }
  labelCands.sort((a, b) => b.r - a.r);
  const labelIds = new Set();
  const placed = [];
  for (const c of labelCands) {
    if (labelIds.size >= MAX_LABELS) break;
    const tw = ctx.measureText(c.id).width;
    const y = c.y + c.r + 3;
    const box = { left: c.x - tw / 2 - 4, right: c.x + tw / 2 + 4, top: c.y - c.r - 2, bottom: y + 16 };
    if (box.left < 2 || box.right > outW - 2 || box.bottom > outH - 2) continue;
    const hits = placed.some(
      (b) => box.right > b.left && box.left < b.right && box.bottom > b.top && box.top < b.bottom
    );
    if (hits) continue;
    placed.push(box);
    labelIds.add(c.id);
  }

  // --- record: drive the animation for real and capture each frame ---
  const total = GIF_FRAMES + GIF_OVERLAP;
  const dTheta = (2 * Math.PI) / GIF_FRAMES;
  const frames = [];
  for (let f = 0; f < total; f++) {
    const t = (f % GIF_FRAMES) / GIF_FRAMES;
    // triangle wave: hi → lo → hi, periodic so the overlap frames line up
    let v = lo + (hi - lo) * Math.abs(1 - 2 * t);
    v = isSim ? +v.toFixed(2) : Math.round(v);
    onSettingsChange((s) => {
      if (isSim) return s.simThreshold === v ? s : { ...s, simThreshold: v };
      return s.minSharedTags === v ? s : { ...s, minSharedTags: v };
    });
    rotateNodes(nodes, dTheta);
    // keep-alive: autoPauseRedraw stops repainting once the engine settles
    // (no-op while the render loop is already running)
    fg.resumeAnimation?.();

    await wait(GIF_DELAY); // the real simulation reacts and renders in here

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, outW, outH);
    ctx.drawImage(src, 0, 0, outW, outH);

    const k = fg.zoom();
    ctx.font = labelFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    for (const n of nodes) {
      if (!labelIds.has(n.id) || n.x == null) continue;
      const p = screenOf(n);
      const y = p.y + (radii.get(n.id) || 4) * k * outScale + 3;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,10,15,0.9)';
      ctx.strokeText(n.id, p.x, y);
      ctx.fillStyle = 'rgba(235,236,240,0.95)';
      ctx.fillText(n.id, p.x, y);
    }

    // legend + stamp; 0.8 scales the screenshot helper down to GIF resolution
    drawLegend(ctx, nodes, 0.8, outW / 0.8, outH / 0.8);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    if (user) {
      ctx.font = '500 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(156, 163, 175, 0.95)';
      ctx.fillText(`${user}'s music library`, outW - 14, outH - 31);
    }
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(196, 181, 253, 0.95)';
    ctx.fillText('Constellation.fm', outW - 14, outH - 14);

    frames.push(ctx.getImageData(0, 0, outW, outH));
    onProgress?.(`Recording… ${f + 1} / ${total}`);
  }

  // put the slider back where the user had it
  onSettingsChange((s) =>
    isSim ? { ...s, simThreshold: startVal } : { ...s, minSharedTags: startVal }
  );

  // --- crossfade the overlap onto the loop start to hide the drift seam ---
  // frame N follows frame N-1 seamlessly and matches frame 0's threshold and
  // rotation, so blending continuation → original over the first few frames
  // turns the position drift into a gentle morph.
  for (let i = 0; i < GIF_OVERLAP; i++) {
    const w = (i + 1) / (GIF_OVERLAP + 1); // weight of the original frame
    const a = frames[i].data;
    const b = frames[GIF_FRAMES + i].data;
    for (let p = 0; p < a.length; p += 4) {
      a[p] = a[p] * w + b[p] * (1 - w);
      a[p + 1] = a[p + 1] * w + b[p + 1] * (1 - w);
      a[p + 2] = a[p + 2] * w + b[p + 2] * (1 - w);
    }
  }

  // --- encode (after recording, so quantizing can't stutter the physics) ---
  const gif = GIFEncoder();
  for (let f = 0; f < GIF_FRAMES; f++) {
    const { data } = frames[f];
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, outW, outH, { palette, delay: GIF_DELAY, repeat: 0 });
    onProgress?.(`Encoding GIF… ${f + 1} / ${GIF_FRAMES}`);
    await tick();
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

export default function ShareMenu({
  user,
  fgRef,
  nodes,
  radii,
  settings,
  onSettingsChange,
  onToggleGrow,
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef();
  const statusTimer = useRef();

  const snap = () => captureGraph({ user, fg: fgRef?.current, nodes, radii });

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const flash = (msg) => {
    setOpen(false);
    clearTimeout(statusTimer.current);
    setStatus(msg);
    statusTimer.current = setTimeout(() => setStatus(null), 2500);
  };

  const progress = (msg) => {
    clearTimeout(statusTimer.current);
    setStatus(msg);
  };

  const fileName = `constellation-${(user || 'graph').toLowerCase()}.png`;
  const shareText = `${user ? `${user}'s` : 'My'} music library, mapped as a constellation of artists 🌌 Constellation.fm`;

  const download = (blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownload = async () => {
    const blob = await snap();
    if (blob) {
      download(blob);
      flash('Image saved!');
    }
  };

  const handleCopy = async () => {
    const blob = await snap();
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      flash('Copied to clipboard!');
    } catch {
      download(blob);
      flash('Copying not supported here — saved instead.');
    }
  };

  const handleNativeShare = async () => {
    const blob = await snap();
    if (!blob) return;
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      setOpen(false);
      try {
        await navigator.share({ files: [file], text: shareText });
      } catch {
        // user closed the share sheet — not an error
      }
    } else {
      download(blob);
      flash('Sharing not supported here — saved instead.');
    }
  };

  const handleGif = async () => {
    if (busy) return;
    const fg = fgRef?.current;
    setOpen(false);
    setBusy(true);
    try {
      const blob = await recordGrowGif({
        fg,
        nodes,
        radii,
        settings,
        onSettingsChange,
        onToggleGrow,
        user,
        onProgress: progress,
      });
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `constellation-${(user || 'graph').toLowerCase()}.gif`;
        a.click();
        URL.revokeObjectURL(url);
        flash('GIF saved!');
      } else {
        flash('Nothing to record yet.');
      }
    } catch {
      flash('GIF export failed.');
    } finally {
      setBusy(false);
    }
  };

  // Social compose links can't carry an image, so save the screenshot first
  // and open the post window with a caption — the user attaches the image.
  const handleSocial = async (url) => {
    const blob = await snap();
    if (blob) download(blob);
    window.open(url, '_blank', 'noopener');
    flash('Image saved — attach it to your post!');
  };

  const text = encodeURIComponent(shareText);
  const socials = [
    ['X / Twitter', `https://twitter.com/intent/tweet?text=${text}`],
    ['Bluesky', `https://bsky.app/intent/compose?text=${text}`],
    ['Reddit', `https://www.reddit.com/submit?title=${text}`],
    [
      'Facebook',
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.origin)}&quote=${text}`,
    ],
  ];

  return (
    <div className="share-wrap" ref={wrapRef}>
      <button
        type="button"
        className="ui-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        Share
      </button>

      {open && (
        <div className="share-menu">
          <button type="button" onClick={handleDownload}>
            ⬇ Download image
          </button>
          <button type="button" onClick={handleCopy}>
            ⧉ Copy image
          </button>
          <button type="button" onClick={handleGif} disabled={busy}>
            ◉ Export loop GIF
          </button>
          <button type="button" onClick={handleNativeShare}>
            ↗ Share…
          </button>
          <div className="share-sep" />
          {socials.map(([label, url]) => (
            <button key={label} type="button" onClick={() => handleSocial(url)}>
              {label}
            </button>
          ))}
          <p className="share-note">
            Social posts open with a caption — attach the saved image.
          </p>
        </div>
      )}

      {status && <div className="share-status">{status}</div>}
    </div>
  );
}
