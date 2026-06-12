export const MAX_LIMIT = 10000; // slider's rightmost position = entire library

// The slider moves logarithmically: equal drag covers 20→200 and 1000→10000,
// so small graphs stay easy to dial in while huge ones remain reachable.
const MIN_ARTISTS = 20;
const SLIDER_STEPS = 200;

const posToLimit = (pos) => {
  if (pos >= SLIDER_STEPS) return MAX_LIMIT;
  const raw = MIN_ARTISTS * (MAX_LIMIT / MIN_ARTISTS) ** (pos / SLIDER_STEPS);
  // snap to a friendly increment that scales with magnitude: 5s below 100,
  // 10s below 1000, 100s above
  const step = Math.max(5, 10 ** Math.floor(Math.log10(raw)) / 10);
  return Math.min(Math.round(raw / step) * step, MAX_LIMIT);
};

const limitToPos = (limit) =>
  limit >= MAX_LIMIT
    ? SLIDER_STEPS
    : Math.round(
        (SLIDER_STEPS * Math.log(limit / MIN_ARTISTS)) /
          Math.log(MAX_LIMIT / MIN_ARTISTS)
      );

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
        Artists: {isAll ? 'All' : limit.toLocaleString()}
        <input
          type="range"
          min="0"
          max={SLIDER_STEPS}
          step="1"
          value={limitToPos(limit)}
          onChange={(e) => set('limit', posToLimit(Number(e.target.value)))}
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
