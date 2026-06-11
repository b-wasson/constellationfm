import { useState } from 'react';

export default function SearchPanel({ artistNames, onSearch }) {
  const [search, setSearch] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (search.trim()) onSearch(search.trim());
  };

  return (
    <div className="panel">
      <form onSubmit={submit}>
        <label>
          Find artist
          <input
            type="text"
            list="artist-list"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the graph…"
            spellCheck={false}
          />
        </label>
        <datalist id="artist-list">
          {artistNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </form>
    </div>
  );
}
