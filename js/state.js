const listeners = new Map();

export const COLORS = [
  '#5b8def', '#5ecf8c', '#e8d44d', '#f0a03c',
  '#e85d5d', '#c75de8', '#5dcee8', '#e87a5d',
  '#7ad0a8', '#d08ad0', '#8aa0d0', '#d0a07a',
];

export const state = {
  tracks: [],
  trackMap: new Map(),
  queue: [],
  queueIndex: -1,
  currentId: null,
  playing: false,
  seek: 0,
  duration: 0,
  buffering: false,
  folderName: '',
  panel: 'lyrics',
  radio: null,
  radioMode: null,
  radioFilter: null,
  radioQueue: [],
  ready: false,
  coverNonce: 0,
};

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event).delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (set) for (const fn of set) fn(payload);
}

export function getTrack(id) {
  return state.trackMap.get(id) || null;
}

export function currentTrack() {
  return getTrack(state.currentId);
}

export function formatTime(sec) {
  if (!sec || !isFinite(sec) || sec < 0) return '00:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 60 / 60);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function extOf(name) {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function titleFromFilename(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
}

export function uid(file, path = '') {
  return `${path}|${file.name}|${file.size}|${file.lastModified}`;
}
