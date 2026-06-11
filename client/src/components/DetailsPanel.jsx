const fmt = (n) => n.toLocaleString('en-US');

export default function DetailsPanel({ node, connections, onClose }) {
  return (
    <div className="panel details">
      <button className="close" onClick={onClose} aria-label="Close">×</button>
      <h2 className="panel-title">{node.id}</h2>
      <span className="genre-chip" style={{ '--chip-color': node.color }}>
        {node.genre}
      </span>

      <dl className="stats">
        <div>
          <dt>Your scrobbles</dt>
          <dd>{fmt(node.userPlaycount)}</dd>
        </div>
        <div>
          <dt>Global listeners</dt>
          <dd>{fmt(node.listeners)}</dd>
        </div>
        <div>
          <dt>Global plays</dt>
          <dd>{fmt(node.globalPlaycount)}</dd>
        </div>
        <div>
          <dt>Connections</dt>
          <dd>{fmt(connections)}</dd>
        </div>
      </dl>

      {node.tags.length > 0 && (
        <div className="tags">
          {node.tags.map((t) => (
            <span key={t} className="tag">{t}</span>
          ))}
        </div>
      )}

      <a href={node.url} target="_blank" rel="noreferrer" className="lastfm-link">
        Open on Last.fm ↗
      </a>
    </div>
  );
}
