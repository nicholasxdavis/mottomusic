import { state, emit } from './state.js';
import { playFromList, playTrack } from './player.js';
import { pickAvoidingRecent, shuffleSpreadArtists } from './recent.js';

let config = null;
let manifest = null;
let kultArtists = new Set();
let selfArtists = new Set();
let tiioArtists = new Set();
let mottoArtists = new Set();
let excludedArtists = new Set();

const BUILTIN_STATIONS = [
  { id: 'self', radioKey: 'radio', label: 'Self Radio', rosterKey: 'self_artists', defaultIcon: 'assets/radio-icon.svg' },
  { id: 'tiio', radioKey: 'tiio', label: 'Worldwide FM', rosterKey: 'tiio_artists', defaultIcon: 'assets/Worldwide_FM_print.webp' },
  { id: 'kult', radioKey: 'kult', label: 'k.u.l.t', rosterKey: 'kult_artists', defaultIcon: 'assets/01cf0-16081939853251-800.webp' },
  { id: 'motto', radioKey: 'motto', label: 'Motto Radio', rosterKey: 'motto_artists', defaultIcon: 'assets/ip/motto-ip.png' },
];
const RESERVED_STATION_KEYS = new Set(['shuffle', 'radio', 'tiio', 'kult', 'motto', 'self', 'sad', 'energy', 'all', 'none']);
export let MANAGED_STATIONS = BUILTIN_STATIONS.slice();
const rosterSets = new Map();
let playerSlots = ['radio', 'tiio', 'kult', 'motto'];
let avoidRecentPlays = true;

export function rebuildManagedStations() {
  const extras = [];
  for (const [key, val] of Object.entries(config?.stations || {})) {
    if (!val || typeof val !== 'object' || RESERVED_STATION_KEYS.has(key)) continue;
    if (!/^[a-z][a-z0-9]{0,23}$/.test(key)) continue;
    extras.push({
      id: key,
      radioKey: key,
      label: val.label || key,
      rosterKey: `${key}_artists`,
      defaultIcon: val.icon || 'assets/radio-icon.svg',
      custom: true,
    });
  }
  extras.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  MANAGED_STATIONS = [...BUILTIN_STATIONS, ...extras];
}

function rosterFor(id) {
  return rosterSets.get(id) || new Set();
}

export function setAvoidRecent(on) {
  avoidRecentPlays = on !== false;
}

export function getPlayerSlots() {
  return playerSlots.slice();
}

export function setPlayerSlots(keys) {
  const known = MANAGED_STATIONS.map((s) => s.radioKey);
  const next = [];
  for (const key of keys || []) {
    if (known.includes(key) && !next.includes(key)) next.push(key);
    if (next.length === 4) break;
  }
  for (const key of known) {
    if (next.length === 4) break;
    if (!next.includes(key)) next.push(key);
  }
  playerSlots = next;
}
let sadArtists = new Set();
let coverMap = new Map();

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function cryptoRandomInt(max) {
  if (max <= 0) return 0;
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0] % max;
  }
  return Math.floor(Math.random() * max);
}

export function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = cryptoRandomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pickRandom(ids) {
  if (!ids?.length) return null;
  return ids[cryptoRandomInt(ids.length)];
}

function isRootTrack(track) {
  const p = (track.path || '').replace(/\\/g, '/');
  return p === 'music' || p === '';
}

function parseFilenameArtistTitle(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  if (m) return { artist: m[1].trim(), title: m[2].trim() };
  return { artist: 'Unknown artist', title: base.trim() };
}

export function artistFromPath(path) {
  const parts = String(path || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts[0] === 'music' && parts.length >= 2) return parts[1];
  return null;
}

export function enrichTrackFromFilename(track) {
  if (!track) return;
  const folderArtist = artistFromPath(track.path);
  const baseTitle = track.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

  if (isRootTrack(track)) {
    const parsed = parseFilenameArtistTitle(track.name);
    if (parsed.artist !== 'Unknown artist') track.artist = parsed.artist;
    if (parsed.title) track.title = parsed.title;
    return;
  }

  if (folderArtist && (!track.artist || track.artist === 'Unknown artist')) {
    track.artist = folderArtist;
  }
  if (!track.title || track.title === baseTitle || track.title === track.name) {
    track.title = baseTitle;
  }
  const parts = String(track.path || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length > 2 && (!track.album || track.album === 'Unknown album')) {
    track.album = parts[parts.length - 1];
  } else if (folderArtist && (!track.album || track.album === 'Unknown album')) {
    track.album = 'Singles';
  }
}

function primaryArtist(name) {
  return String(name || '').split(/\s*(?:,|&|feat\.?|ft\.?|with)\s*/i)[0].trim();
}

function matchesArtistSet(folderArtist, trackArtist, roster) {
  const targets = [
    norm(folderArtist),
    norm(primaryArtist(trackArtist)),
    norm(trackArtist),
  ].filter(Boolean);
  const unique = [...new Set(targets)];
  for (const t of unique) {
    if (roster.has(t)) return true;
    for (const k of roster) {
      if (t.length < 4 || k.length < 4) continue;
      if (t === k || t.startsWith(k) || k.startsWith(t)) return true;
    }
  }
  return false;
}

function isKultPath(path) {
  return /\/kult(\/|$)/i.test(String(path || '').replace(/\\/g, '/'));
}

function isKultArtist(folderArtist, trackArtist) {
  return matchesArtistSet(folderArtist, trackArtist, kultArtists);
}

function isSelfArtist(folderArtist, trackArtist) {
  return matchesArtistSet(folderArtist, trackArtist, selfArtists);
}

function isExcludedArtist(folderArtist, trackArtist) {
  return matchesArtistSet(folderArtist, trackArtist, excludedArtists);
}

function matchesMottoTrack(track) {
  const rows = config?.motto_tracks || [];
  if (!rows.length || !track) return false;
  const title = norm(track.title);
  const artists = [
    norm(artistFromPath(track.path)),
    norm(primaryArtist(track.artist)),
    norm(track.artist),
  ].filter(Boolean);
  for (const row of rows) {
    const wantTitle = norm(typeof row === 'string' ? row : row.title);
    const wantArtist = norm(typeof row === 'string' ? '' : row.artist);
    if (!wantTitle) continue;
    const titleOk = title.includes(wantTitle) || wantTitle.includes(title);
    const artistOk = !wantArtist || artists.some((a) => a === wantArtist || a.includes(wantArtist) || wantArtist.includes(a));
    if (titleOk && artistOk) return true;
  }
  return false;
}

export function isTrackExcluded(track) {
  if (!track) return false;
  return isExcludedArtist(artistFromPath(track.path), track.artist);
}

export function isArtistExcluded(artist) {
  return matchesArtistSet(artist, artist, excludedArtists);
}

export function getExcludedArtists() {
  return [...(config?.excluded_artists || [])];
}

export function applyCatalogExclusions() {
  const kept = state.tracks.filter((t) => !isTrackExcluded(t));
  for (const t of state.tracks) {
    if (!kept.includes(t)) state.trackMap.delete(t.id);
  }
  state.tracks = kept;
  if (state.currentId && !state.trackMap.has(state.currentId)) {
    state.currentId = state.tracks[0]?.id || null;
    state.queueIndex = state.currentId ? 0 : -1;
  }
}

function rebuildArtistSets() {
  rebuildManagedStations();
  rosterSets.clear();
  for (const station of MANAGED_STATIONS) {
    const set = new Set();
    for (const name of config?.[station.rosterKey] || []) set.add(norm(name));
    rosterSets.set(station.id, set);
  }
  selfArtists = rosterFor('self');
  tiioArtists = rosterFor('tiio');
  kultArtists = rosterFor('kult');
  mottoArtists = rosterFor('motto');
  excludedArtists = new Set();
  for (const name of config?.excluded_artists || []) excludedArtists.add(norm(name));
}

export function getArtistRosters() {
  const out = {};
  for (const s of MANAGED_STATIONS) {
    out[s.id] = [...(config?.[s.rosterKey] || [])];
  }
  return out;
}

export function artistOnStation(artist, station) {
  return matchesArtistSet(artist, artist, rosterFor(station));
}

export function refreshTrackStations() {
  for (const t of state.tracks) applyManifestToTrack(t);
}

export function getManagedStationMeta(id) {
  const def = MANAGED_STATIONS.find((s) => s.id === id);
  const station = config?.stations?.[def?.radioKey];
  return {
    id,
    radioKey: def?.radioKey || id,
    label: station?.label || def?.label || id,
    icon: station?.icon || def?.defaultIcon || '',
  };
}

function iconClassFor(id, icon) {
  if (id === 'motto') return 'radio-icon radio-motto';
  if (id === 'self' || String(icon || '').endsWith('.svg')) return 'radio-icon';
  return 'radio-icon radio-art';
}

export function applyStationChrome() {
  document.querySelectorAll('.player .radio-slot').forEach((btn, i) => {
    const key = playerSlots[i];
    const station = MANAGED_STATIONS.find((s) => s.radioKey === key);
    if (!key || !station) return;
    const meta = getManagedStationMeta(station.id);
    btn.dataset.radio = meta.radioKey;
    btn.setAttribute('aria-label', meta.label);
    btn.title = meta.label;
    const face = btn.querySelector('.radio-icon, .radio-face');
    if (face) face.className = iconClassFor(station.id, meta.icon);
    const img = btn.querySelector('img');
    if (img && meta.icon) img.src = meta.icon;
  });
}

function buildRadioPayload(rosters, excluded, removeStations) {
  const payload = {};
  for (const s of MANAGED_STATIONS) {
    payload[s.rosterKey] = rosters?.[s.id] ?? config?.[s.rosterKey] ?? [];
  }
  payload.excluded_artists = excluded ?? config?.excluded_artists ?? [];
  payload.stations = config?.stations || {};
  if (removeStations?.length) payload.removeStations = removeStations;
  return payload;
}

export async function updateRadioConfig({ rosters, excluded, stations, removeStations, prune = false } = {}) {
  if (!config) config = {};
  if (stations) {
    config.stations = config.stations || {};
    for (const [key, val] of Object.entries(stations)) {
      config.stations[key] = { ...config.stations[key], ...val };
    }
  }
  if (removeStations?.length) {
    for (const id of removeStations) {
      delete config.stations?.[id];
      delete config[`${id}_artists`];
    }
  }
  rebuildArtistSets();
  const payload = buildRadioPayload(rosters, excluded, removeStations);
  for (const s of MANAGED_STATIONS) config[s.rosterKey] = payload[s.rosterKey];
  config.excluded_artists = payload.excluded_artists;
  refreshTrackStations();
  if (prune || excluded !== undefined) applyCatalogExclusions();
  setPlayerSlots(playerSlots);
  applyStationChrome();
  const res = await fetch('/api/radio-config', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Could not save radio config');
}

export async function updateArtistRosters(rosters) {
  return updateRadioConfig({ rosters });
}

export async function loadRadioConfig() {
  try {
    const res = await fetch('/config/radio.json');
    if (res.ok) config = await res.json();
  } catch {}
  sadArtists = new Set();
  coverMap = new Map();
  rebuildArtistSets();
  try {
    const res = await fetch('/api/manifest');
    if (res.ok) manifest = await res.json();
    for (const block of manifest?.artists || []) {
      if (block.mood === 'sad') sadArtists.add(norm(block.name));
      for (const t of block.tracks || []) {
        const key = `${norm(block.name)}::${norm(t.title)}`;
        if (t.cover_file) coverMap.set(key, t.cover_file);
      }
    }
  } catch {}
  try {
    const res = await fetch('/music/import/comehelpglo_covers.json');
    if (res.ok) {
      const glo = await res.json();
      for (const t of Object.values(glo.tracks || {})) {
        if (!t?.cover_file) continue;
        const key = `comehelpglo::${norm(t.title)}`;
        coverMap.set(key, t.cover_file);
      }
    }
  } catch {}
}

export function applyManifestToTrack(track) {
  if (!track) return;
  const folderArtist = artistFromPath(track.path);
  const keys = [
    `${norm(folderArtist)}::${norm(track.title)}`,
    `${norm(track.artist)}::${norm(track.title)}`,
  ];
  for (const key of keys) {
    const cover = coverMap.get(key);
    if (cover && !track.pictureUrl) {
      track.pictureUrl = '/' + cover.replace(/^\//, '');
    }
  }

  if (isExcludedArtist(folderArtist, track.artist)) {
    track.stations = [];
    return;
  }

  const isKult = isKultPath(track.path) || isKultArtist(folderArtist, track.artist);
  track.stations = [];
  if (isSelfArtist(folderArtist, track.artist)) track.stations.push('self');
  if (matchesArtistSet(folderArtist, track.artist, tiioArtists)) track.stations.push('tiio');
  if (isKult) track.stations.push('kult');
  if (matchesArtistSet(folderArtist, track.artist, mottoArtists) || matchesMottoTrack(track)) {
    track.stations.push('motto');
  }
  for (const station of MANAGED_STATIONS) {
    if (!station.custom) continue;
    if (matchesArtistSet(folderArtist, track.artist, rosterFor(station.id))) track.stations.push(station.id);
  }

  const artistNorm = norm(folderArtist || track.artist);
  if (sadArtists.has(artistNorm) && isKult) track.stations.push('sad');
  const energy = config?.energy_artists || [];
  if (isKult && energy.some((a) => artistNorm.includes(norm(a)) || norm(a).includes(artistNorm))) {
    track.stations.push('energy');
  }
}

function filterTracks(filterId) {
  const all = state.tracks;
  if (!all.length) return [];

  switch (filterId) {
    case 'all':
      return all.filter((t) => !isTrackExcluded(t));
    case 'none':
      return [];
    case 'self':
      return all.filter((t) => t.stations?.includes('self'));
    case 'tiio':
      return all.filter((t) => t.stations?.includes('tiio'));
    case 'kult':
      return all.filter((t) => t.stations?.includes('kult'));
    case 'motto':
      return all.filter((t) => t.stations?.includes('motto'));
    case 'sad':
      return all.filter((t) => t.stations?.includes('sad'));
    case 'energy':
      return all.filter((t) => t.stations?.includes('energy'));
    default:
      return all.filter((t) => t.stations?.includes(filterId));
  }
}

export function getStation(id) {
  return config?.stations?.[id] || null;
}

export function stationTrackIds(stationId) {
  return filterTracks(getStation(stationId)?.filter).map((t) => t.id);
}

function pickStationStart(queue, stationId) {
  if (!queue.length) return null;
  const key = `motto-last-start-${stationId}`;
  let last = '';
  try { last = sessionStorage.getItem(key) || ''; } catch {}
  const pick = (ids, excludeId) => (
    avoidRecentPlays ? pickAvoidingRecent(ids, excludeId) : null
  ) || pickRandom(ids.filter((id) => id !== excludeId)) || pickRandom(ids);
  let start = pick(queue);
  if (queue.length > 1 && start === last) {
    const alt = queue.filter((id) => id !== last);
    start = pick(alt, last);
  }
  try { sessionStorage.setItem(key, start); } catch {}
  return start;
}

export function playStation(stationId) {
  const station = getStation(stationId);
  if (!station) return false;
  const ids = stationTrackIds(stationId);
  if (!ids.length) {
    if (stationId === 'tiio') return false;
    return false;
  }

  const queue = station.mode === 'shuffle' ? shuffleSpreadArtists(ids) : ids.slice();
  const start = station.mode === 'shuffle' ? pickStationStart(queue, stationId) : queue[0];
  state.radioMode = station.mode;
  state.radioFilter = station.filter;
  state.radioQueue = queue;
  state.radioPlayCount = 0;
  playFromList(queue, start);
  return true;
}

export function radioAdvance() {
  const mode = state.radioMode;
  const queue = state.radioQueue;
  if (!state.radio || !queue?.length) return null;

  state.radioPlayCount = (state.radioPlayCount || 0) + 1;

  if (mode === 'shuffle') {
    const cur = state.currentId;
    let pool = queue.filter((id) => id !== cur);
    if (!pool.length) pool = queue.slice();
    if (state.radioPlayCount % queue.length === 0) {
      state.radioQueue = shuffleSpreadArtists(queue);
      pool = state.radioQueue.filter((id) => id !== cur);
    }
    const poolIds = pool.length ? pool : state.radioQueue;
    return (avoidRecentPlays ? pickAvoidingRecent(poolIds, cur) : null) || pickRandom(poolIds);
  }

  let i = state.queueIndex + 1;
  if (i >= queue.length) i = 0;
  return queue[i];
}

export function selectRadioStation(id) {
  if (!id) return;
  state.radio = id;
  document.querySelectorAll('.radio-btn[data-radio]').forEach((btn) => {
    const on = btn.dataset.radio === id;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  emit('radio', id);

  const station = getStation(id);
  if (station) playStation(id);
}
