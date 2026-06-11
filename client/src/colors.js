// Ordered keyword → color mapping; more specific genres come first so
// e.g. "indie rock" resolves to indie before rock.
const GENRE_COLORS = [
  ['hip-hop', '#f97316'],
  ['hip hop', '#f97316'],
  ['rap', '#f97316'],
  ['metal', '#dc2626'],
  ['punk', '#f43f5e'],
  ['emo', '#fb7185'],
  ['r&b', '#f59e0b'],
  ['rnb', '#f59e0b'],
  ['soul', '#f59e0b'],
  ['funk', '#fbbf24'],
  ['jazz', '#eab308'],
  ['classical', '#fde68a'],
  ['country', '#b45309'],
  ['blues', '#3b82f6'],
  ['reggae', '#16a34a'],
  ['folk', '#84cc16'],
  ['ambient', '#2dd4bf'],
  ['techno', '#06b6d4'],
  ['house', '#0ea5e9'],
  ['edm', '#22d3ee'],
  ['dance', '#22d3ee'],
  ['idm', '#38bdf8'],
  ['electronic', '#38bdf8'],
  ['electronica', '#38bdf8'],
  ['synth', '#818cf8'],
  ['shoegaze', '#a78bfa'],
  ['dream pop', '#c4b5fd'],
  ['k-pop', '#f472b6'],
  ['j-pop', '#f472b6'],
  ['pop', '#ec4899'],
  ['indie', '#60a5fa'],
  ['alternative', '#93c5fd'],
  ['rock', '#ef4444'],
];

export const DEFAULT_NODE_COLOR = '#a78bfa';

function hashColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return `hsl(${((h % 360) + 360) % 360} 60% 65%)`;
}

export function genreOf(tags = []) {
  for (const [keyword, color] of GENRE_COLORS) {
    if (tags.some((t) => t.includes(keyword))) return { genre: keyword, color };
  }
  if (tags.length > 0) return { genre: tags[0], color: hashColor(tags[0]) };
  return { genre: 'unknown', color: DEFAULT_NODE_COLOR };
}
