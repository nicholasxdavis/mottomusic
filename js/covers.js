import { state } from './state.js';

const FALLBACK = [
  'option.jpeg',
  'option.jpg',
  'option.png',
  'option.webp',
  'option2.jpg',
  'option3.jpg',
  'option4.jpg',
];

let files = FALLBACK;
const lastByTrack = new Map();

export async function loadCovers() {
  try {
    const res = await fetch('assets/random/manifest.json');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) files = data;
    }
  } catch {}
}

function toUrl(name) {
  return name.startsWith('assets/') ? name : `assets/random/${name}`;
}

function allUrls() {
  return files.map(toUrl);
}

function usageCounts() {
  const counts = new Map();
  for (const t of state.tracks) {
    if (t.pictureUrl || !t.fallbackCover) continue;
    counts.set(t.fallbackCover, (counts.get(t.fallbackCover) || 0) + 1);
  }
  return counts;
}

export function pickRandomCover(track, { fresh = false } = {}) {
  if (!track) return null;
  if (track.pictureUrl) return track.pictureUrl;

  if (!fresh && track.fallbackCover) return track.fallbackCover;

  const urls = allUrls();
  if (!urls.length) return null;

  const prev = lastByTrack.get(track.id) || track.fallbackCover || null;
  const usage = usageCounts();
  if (fresh && track.fallbackCover) {
    usage.set(track.fallbackCover, Math.max(0, (usage.get(track.fallbackCover) || 1) - 1));
  }

  const underTwo = urls.filter((u) => u !== prev && (usage.get(u) || 0) < 2);
  const unused = urls.filter((u) => u !== prev);
  const pool = underTwo.length ? underTwo : (unused.length ? unused : urls);
  const pick = pool[Math.floor(Math.random() * pool.length)];

  track.fallbackCover = pick;
  lastByTrack.set(track.id, pick);
  return pick;
}

export function randomCover(trackOrId) {
  if (trackOrId && typeof trackOrId === 'object') return pickRandomCover(trackOrId);
  const t = state.trackMap.get(trackOrId);
  if (t) return pickRandomCover(t);
  const urls = allUrls();
  if (!urls.length) return null;
  return urls[Math.floor(Math.random() * urls.length)];
}
