import { useEffect, useRef, useState } from 'react';

const MAX_LABELS = 12;

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

export default function ShareMenu({ user, fgRef, nodes, radii }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const wrapRef = useRef();

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
    setStatus(msg);
    setTimeout(() => setStatus(null), 2500);
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
