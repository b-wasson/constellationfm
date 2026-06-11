import GraphForm from './GraphForm';

const SIZE_METRICS = [
  ['userPlaycount', 'Your scrobbles'],
  ['listeners', 'Global listeners'],
  ['degree', 'Connection count'],
  ['globalPlaycount', 'Global playcount'],
];

export default function Controls({
  settings,
  onSettingsChange,
  form,
  onFormChange,
  onSubmit,
  loading,
  user,
  growing,
  onToggleGrow,
}) {
  const set = (key, value) => onSettingsChange({ ...settings, [key]: value });

  return (
    <div className="panel controls">
      <h2 className="panel-title">Constellation.fm</h2>

      <GraphForm
        form={form}
        onChange={onFormChange}
        onSubmit={onSubmit}
        loading={loading}
        submitLabel="Reload graph"
      />

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
    </div>
  );
}
