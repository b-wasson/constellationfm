import { useEffect, useRef, useState } from 'react';

// Screenshot the graph canvas (panels are DOM, so they're never in the shot)
// and stamp a small credit in the corner.
function captureGraph(user) {
  const src = document.querySelector('.app canvas');
  if (!src) return Promise.resolve(null);
  const out = document.createElement('canvas');
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(src, 0, 0);

  const scale = src.clientWidth ? src.width / src.clientWidth : 1;
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

export default function ShareMenu({ user }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(null);
  const wrapRef = useRef();

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
    const blob = await captureGraph(user);
    if (blob) {
      download(blob);
      flash('Image saved!');
    }
  };

  const handleCopy = async () => {
    const blob = await captureGraph(user);
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
    const blob = await captureGraph(user);
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
    const blob = await captureGraph(user);
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
