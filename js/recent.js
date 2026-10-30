import { state, getTrack } from './state.js';

const STORAGE_KEY = 'motto-recent-plays';
export const RECENT_LIMIT = 10;

function cryptoRandomInt(max) {
  if (max <= 0) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] % max;
  }
  return Math.floor(Math.random() * max);
}

function cryptoRandom() {
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] / 0xffffffff;
  }
  return Math.random();
}

function normArtist(name) {
  return String(name || '')
    .replace(/\s*(?:,|&|feat\.?|ft\.?|with)\s*.*/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function trackArtist(id) {
  const t = getTrack(id);
  return normArtist(t?.artist);
}

function loadRecent() {
  if (state.recentPlays?.length) return state.recentPlays.slice();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    state.recentPlays = Array.isArray(list) ? list : [];
    return state.recentPlays.slice();
  } catch {
    state.recentPlays = [];
    return [];
  }
}

function saveRecent(list) {
  const trimmed = list.slice(-RECENT_LIMIT);
  state.recentPlays = trimmed;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function recordRecentPlay(id) {
  if (!id) return;
  const list = loadRecent().filter((x) => x !== id);
  list.push(id);
  saveRecent(list);
}

export function recentSet(excludeId = null) {
  const set = new Set(loadRecent());
  if (excludeId) set.add(excludeId);
  return set;
}

function recentArtistWeights(excludeId = null) {
  const counts = new Map();
  const recent = loadRecent();
  for (const id of recent) {
    const a = trackArtist(id);
    if (!a) continue;
    counts.set(a, (counts.get(a) || 0) + 1);
  }
  const current = excludeId ? trackArtist(excludeId) : '';
  if (current) counts.set(current, (counts.get(current) || 0) + 4);
  return { counts, current };
}

function weightForTrack(id, excludeId, recentTracks, artistInfo) {
  if (id === excludeId) return 0;
  const artist = trackArtist(id);
  const { counts, current } = artistInfo;

  let w = 1;
  if (recentTracks.has(id)) w *= 0.12;

  if (artist && current && artist === current) w *= 0.04;

  const plays = artist ? counts.get(artist) || 0 : 0;
  if (plays >= 4) w *= 0.06;
  else if (plays === 3) w *= 0.1;
  else if (plays === 2) w *= 0.22;
  else if (plays === 1) w *= 0.45;

  return Math.max(0.02, w);
}

function weightedPick(ids, weights) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return ids[cryptoRandomInt(ids.length)];
  let roll = cryptoRandom() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return ids[i];
  }
  return ids[ids.length - 1];
}

/**
 * Pick a track avoiding recent plays and repeating the same artist too often.
 */
export function pickAvoidingRecent(ids, excludeId = null) {
  if (!ids?.length) return null;

  const recentTracks = recentSet(excludeId);
  const artistInfo = recentArtistWeights(excludeId);
  const { current } = artistInfo;

  let pool = ids.filter((id) => !recentTracks.has(id) && id !== excludeId);
  if (!pool.length) pool = ids.filter((id) => id !== excludeId);
  if (!pool.length) pool = ids.slice();

  const otherArtists = pool.filter((id) => {
    const a = trackArtist(id);
    return !current || !a || a !== current;
  });
  if (otherArtists.length) pool = otherArtists;

  const weights = pool.map((id) => weightForTrack(id, excludeId, recentTracks, artistInfo));
  return weightedPick(pool, weights);
}

/** Build a shuffled queue that round-robins across artists. */
export function shuffleSpreadArtists(ids) {
  if (!ids?.length) return [];
  const buckets = new Map();
  for (const id of ids) {
    const key = trackArtist(id) || `track:${id}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(id);
  }
  for (const tracks of buckets.values()) {
    for (let i = tracks.length - 1; i > 0; i--) {
      const j = cryptoRandomInt(i + 1);
      [tracks[i], tracks[j]] = [tracks[j], tracks[i]];
    }
  }
  const keys = [...buckets.keys()];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = cryptoRandomInt(i + 1);
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const out = [];
  let more = true;
  while (more) {
    more = false;
    for (const key of keys) {
      const bucket = buckets.get(key);
      if (bucket?.length) {
        out.push(bucket.shift());
        more = true;
      }
    }
  }
  return out;
}
