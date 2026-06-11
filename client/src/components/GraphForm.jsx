export const MAX_LIMIT = 1000; // slider's rightmost position = entire library

const PERIODS = [
  ['7day', 'Last 7 days'],
  ['1month', 'Last month'],
  ['3month', 'Last 3 months'],
  ['6month', 'Last 6 months'],
  ['12month', 'Last 12 months'],
  ['overall', 'All time'],
];

export default function GraphForm({ form, onChange, onSubmit, loading, submitLabel }) {
  const { username, period, limit } = form;
  const isAll = limit === MAX_LIMIT;

  const set = (key, value) => onChange({ ...form, [key]: value });

  const submit = (e) => {
    e.preventDefault();
    if (username.trim() && !loading) onSubmit();
  };

  return (
    <form onSubmit={submit}>
      <label>
        Username
        <input
          type="text"
          value={username}
          onChange={(e) => set('username', e.target.value)}
          placeholder="Last.fm username"
          spellCheck={false}
        />
      </label>

      <label>
        Time period
        <select value={period} onChange={(e) => set('period', e.target.value)}>
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
          onChange={(e) => set('limit', Number(e.target.value))}
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
        {loading ? 'Loading…' : submitLabel}
      </button>
    </form>
  );
}
