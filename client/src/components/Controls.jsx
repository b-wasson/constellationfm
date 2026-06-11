import { useState } from 'react';

const PERIODS = [
  ['7day', 'Last 7 days'],
  ['1month', 'Last month'],
  ['3month', 'Last 3 months'],
  ['6month', 'Last 6 months'],
  ['12month', 'Last 12 months'],
  ['overall', 'All time'],
];

// slider's rightmost position means "fetch the entire library"
const MAX_LIMIT = 1000;

const SIZE_METRICS = [
  ['userPlaycount', 'Your scrobbles'],
  ['listeners', 'Global listeners'],
  ['degree', 'Connection count'],
  ['globalPlaycount', 'Global playcount'],
];

export default function Controls({
  settings,
  onSettingsChange,
  onLoad,
  loading,
  hasData,
  user,
  growing,
  onToggleGrow,
}) {
  const [username, setUsername] = useState('');
  const [period, setPeriod] = useState('overall');
  const [limit, setLimit] = useState(50);

  const set = (key, value) => onSettingsChange({ ...settings, [key]: value });

  const isAll = limit === MAX_LIMIT;

  const submit = (e) => {
    e.preventDefault();
    if (username.trim() && !loading) {
      onLoad(username.trim(), period, isAll ? 'all' : limit);
    }
  };

  return (
    <div className="panel controls">
      <h2 className="panel-title">last.fm graph</h2>

      <form onSubmit={submit}>
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Last.fm username"
            spellCheck={false}
          />
        </label>

        <label>
          Time period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <label>
          Artists: {isAll ? 'All' : limit}
          <input
            type="range"
            min="20"
            max={MAX_LIMIT}
            step="5"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </label>

        {limit > 200 && (
          <p className="warning">
            {isAll
              ? '⚠ Loading your entire library can take several minutes the first time, and the graph may get crowded.'
              : `⚠ Loading ${limit} artists can take a few minutes the first time, and the graph may get crowded.`}
          </p>
        )}

        <button type="submit" disabled={loading || !username.trim()}>
          {loading ? 'Loading…' : hasData ? 'Reload graph' : 'Build graph'}
        </button>
      </form>

      {hasData && (
        <>
          <div className="divider" />
          <p className="current-user">Showing: <strong>{user}</strong></p>

          <label>
            Node size
            <select
              value={settings.sizeMetric}
              onChange={(e) => set('sizeMetric', e.target.value)}
            >
              {SIZE_METRICS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label>
            Links represent
            <select
              value={settings.linkMetric}
              onChange={(e) => set('linkMetric', e.target.value)}
            >
              <option value="similarity">Artist similarity</option>
              <option value="tags">Shared genre tags</option>
            </select>
          </label>

          {settings.linkMetric === 'similarity' ? (
            <>
              <label>
                Min similarity: {settings.simThreshold.toFixed(2)}
                <input
                  type="range"
                  min="0"
                  max="0.9"
                  step="0.01"
                  value={settings.simThreshold}
                  onChange={(e) => {
                    if (growing) onToggleGrow(false);
                    set('simThreshold', Number(e.target.value));
                  }}
                />
              </label>
              {settings.simThreshold < 0.15 && !growing && (
                <p className="warning">
                  ⚠ Low similarity values show many more connections, which can
                  make the graph slow and tangled — especially with lots of
                  artists.
                </p>
              )}
            </>
          ) : (
            <label>
              Min shared tags: {settings.minSharedTags}
              <input
                type="range"
                min="1"
                max="4"
                step="1"
                value={settings.minSharedTags}
                onChange={(e) => {
                  if (growing) onToggleGrow(false);
                  set('minSharedTags', Number(e.target.value));
                }}
              />
            </label>
          )}

          <button
            type="button"
            className={`toggle-btn${growing ? ' active' : ''}`}
            onClick={() => onToggleGrow(!growing)}
          >
            {growing ? '◼ Stop growing' : '▶ Grow connections'}
          </button>

          <button
            type="button"
            className={`toggle-btn${settings.hideUnconnected ? ' active' : ''}`}
            onClick={() => set('hideUnconnected', !settings.hideUnconnected)}
          >
            {settings.hideUnconnected
              ? 'Show unconnected artists'
              : 'Hide unconnected artists'}
          </button>

        </>
      )}
    </div>
  );
}
