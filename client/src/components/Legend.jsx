import { useMemo } from 'react';

export default function Legend({ nodes }) {
  const top = useMemo(() => {
    const counts = new Map();
    for (const n of nodes) {
      const entry = counts.get(n.genre) || { color: n.color, count: 0 };
      entry.count++;
      counts.set(n.genre, entry);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8);
  }, [nodes]);

  return (
    <div className="legend">
      {top.map(([genre, { color, count }]) => (
        <span key={genre} className="legend-item">
          <span className="legend-dot" style={{ background: color }} />
          {genre} <span className="legend-count">{count}</span>
        </span>
      ))}
    </div>
  );
}
