import {
  MANAGED_STATIONS,
  applyStationChrome,
  getArtistRosters,
  getPlayerSlots,
  setAvoidRecent,
  setPlayerSlots,
  updateRadioConfig,
} from './radio.js';

const RESERVED = new Set(['shuffle', 'radio', 'tiio', 'kult', 'motto', 'self', 'sad', 'energy', 'all', 'none']);

const ui = {
  lyricsWithSong: false,
  customCursor: true,
  coverWash: true,
  avoidRecent: true,
  playerRadios: ['radio', 'tiio', 'kult', 'motto'],
};

let auth = { enabled: true, mode: 'email', pins: [] };

export function getSettings() {
  return ui;
}

export function getAuthView() {
  return auth;
}

function applyLocal() {
  document.body.classList.toggle('cursor-off', !ui.customCursor);
  document.body.classList.toggle('wash-off', !ui.coverWash);
  document.body.classList.toggle('auth-off', !auth.enabled);
  setAvoidRecent(ui.avoidRecent);
  setPlayerSlots(ui.playerRadios);
  applyStationChrome();
}

function take(data) {
  if (data?.ui) Object.assign(ui, data.ui);
  if (data?.auth) auth = data.auth;
  applyLocal();
}

export async function loadSettings() {
  try {
    const res = await fetch('/api/settings', { credentials: 'same-origin' });
    if (res.ok) take(await res.json());
  } catch {}
  applyLocal();
}

async function save(body) {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save settings');
  take(data);
  return data;
}

export function saveUi(patch) {
  return save({ ui: { ...ui, ...patch } });
}

export function saveAuth(patch) {
  return save({ auth: patch });
}

function slugRadio(name) {
  const base = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
  if (!base || RESERVED.has(base)) return '';
  let id = base;
  let n = 2;
  const taken = new Set(MANAGED_STATIONS.map((s) => s.id).concat(MANAGED_STATIONS.map((s) => s.radioKey)));
  while (taken.has(id)) id = `${base.slice(0, 20)}${n++}`;
  return id;
}

export async function addRadio(name) {
  const id = slugRadio(name);
  if (!id) throw new Error('Give the radio a different name');
  const rosters = getArtistRosters();
  rosters[id] = [];
  await updateRadioConfig({
    rosters,
    stations: {
      [id]: {
        label: String(name).trim(),
        icon: 'assets/radio-icon.svg',
        mode: 'shuffle',
        filter: id,
      },
    },
  });
  return id;
}

export async function removeRadio(id) {
  const station = MANAGED_STATIONS.find((s) => s.id === id);
  if (!station?.custom) return;
  const rosters = getArtistRosters();
  delete rosters[id];
  const slots = getPlayerSlots().filter((key) => key !== station.radioKey);
  await updateRadioConfig({ rosters, removeStations: [id] });
  await saveUi({ playerRadios: slots });
}

export async function togglePlayerRadio(key) {
  const slots = getPlayerSlots();
  if (slots.includes(key)) {
    if (slots.length <= 1) return;
    await saveUi({ playerRadios: slots.filter((item) => item !== key) });
    return;
  }
  const next = slots.length < 4 ? [...slots, key] : [...slots.slice(0, 3), key];
  await saveUi({ playerRadios: next });
}
