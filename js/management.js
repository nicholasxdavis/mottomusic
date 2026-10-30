import { state, on, emit } from './state.js';
import { filesFromTransfer, importUploads, loadBuiltinLibrary } from './library.js';
import { pickRandomCover } from './covers.js';
import { initDragScroll } from './drag-scroll.js';
import {
  artistFromPath,
  artistOnStation,
  applyStationChrome,
  getArtistRosters,
  getExcludedArtists,
  isArtistExcluded,
  MANAGED_STATIONS,
  updateRadioConfig,
  getPlayerSlots,
  getManagedStationMeta,
} from './radio.js';
import {
  addRadio,
  getAuthView,
  getSettings,
  removeRadio,
  saveAuth,
  saveUi,
  togglePlayerRadio,
} from './settings.js';

let root = null;
let menuEl = null;
let confirmEl = null;
let filter = '';
let saving = false;
let activeStation = 'self';
let stationEditMode = false;
let view = 'catalog';
let stationPage = 0;
const STATION_PAGE = 4;
let menuArtist = null;
let confirmArtist = null;
const nameSaveTimers = new Map();

function primaryArtist(name) {
  return String(name || '').split(/\s*(?:,|&|feat\.?|ft\.?|with)\s*/i)[0].trim();
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function stationLabel(id) {
  return getManagedStationMeta(id).label;
}

function trackArtistName(track) {
  return artistFromPath(track.path) || primaryArtist(track.artist) || track.artist;
}

function countTracksForArtist(artist) {
  const key = norm(artist);
  return state.tracks.filter((t) => norm(trackArtistName(t)) === key).length;
}

function getCatalogArtists() {
  const names = new Map();
  for (const t of state.tracks) {
    const a = trackArtistName(t);
    if (!a || a === 'Unknown artist') continue;
    names.set(norm(a), a);
  }
  const rosters = getArtistRosters();
  for (const station of MANAGED_STATIONS) {
    for (const a of rosters[station.id] || []) {
      if (!names.has(norm(a)) && !isArtistExcluded(a)) names.set(norm(a), a);
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function getRemovedArtists() {
  return getExcludedArtists().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function setStatus(msg) {
  const el = root?.querySelector('.mgmt-status');
  if (el) el.textContent = msg || '';
}

function closeMenu() {
  menuEl?.classList.remove('on');
  menuArtist = null;
}

function positionMenu(btn) {
  if (!menuEl || !btn) return;
  menuEl.style.left = '0px';
  menuEl.style.top = '0px';
  const r = btn.getBoundingClientRect();
  const mw = menuEl.offsetWidth || 168;
  const mh = menuEl.offsetHeight || 88;
  let left = r.right - mw;
  let top = r.bottom + 6;
  if (left < 8) left = 8;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

function openArtistMenu(btn, artist) {
  if (!menuEl) return;
  menuArtist = artist;
  menuEl.innerHTML = '<button type="button" data-act="delete">Delete</button>';
  menuEl.classList.add('on');
  positionMenu(btn);
}

function closeConfirm() {
  confirmEl?.classList.remove('on');
  confirmArtist = null;
}

function openConfirm(artist, mode = 'hide') {
  if (!confirmEl) return;
  confirmArtist = artist;
  confirmEl.dataset.mode = mode;
  const text = confirmEl.querySelector('.mgmt-confirm-text');
  const yes = confirmEl.querySelector('.mgmt-confirm-delete');
  if (mode === 'files') {
    if (text) text.textContent = `Delete ${artist} from this PC? The files are removed from the drive.`;
    if (yes) yes.textContent = 'Delete files';
  } else {
    if (text) text.textContent = `Remove ${artist} from your library?`;
    if (yes) yes.textContent = 'Remove';
  }
  confirmEl.classList.add('on');
}

function renderImport() {
  const pane = root?.querySelector('.mgmt-import');
  if (!pane) return;
  pane.innerHTML = `
    <section class="set-group mgmt-import-actions">
      <p class="set-kicker">Add music</p>
      <p class="set-note">Songs you already own.</p>
      <button type="button" class="mgmt-text-btn" data-import="files">Files or zip</button>
      <button type="button" class="mgmt-text-btn" data-import="folder">Folder</button>
    </section>
  `;
}

function renderHeader() {
  const stats = root?.querySelector('.mgmt-stats');
  const removedBtn = root?.querySelector('.mgmt-view-removed');
  if (!stats) return;

  const songs = state.tracks.length;
  const artists = getCatalogArtists().length;
  const removed = getRemovedArtists().length;
  stats.hidden = view === 'settings' || view === 'import';
  stats.textContent = view === 'removed'
    ? `${removed} removed`
    : `${songs} song${songs === 1 ? '' : 's'} · ${artists} artist${artists === 1 ? '' : 's'}`;

  if (removedBtn) {
    removedBtn.hidden = false;
    removedBtn.textContent = view === 'removed' ? 'Catalog' : 'Removed';
    removedBtn.classList.toggle('on', view === 'removed');
  }
  root?.querySelector('.mgmt-settings-btn')?.classList.toggle('on', view === 'settings');
  root?.querySelector('.mgmt-import-btn')?.classList.toggle('on', view === 'import');
  document.body.classList.toggle('mgmt-view-settings', view === 'settings');
  document.body.classList.toggle('mgmt-view-import', view === 'import');

  renderStationsHead();
}

function stationIconClass(id) {
  if (id === 'motto') return 'radio-icon radio-motto';
  if (id === 'self') return 'radio-icon';
  if (String(getManagedStationMeta(id).icon || '').endsWith('.svg')) return 'radio-icon';
  return 'radio-icon radio-art';
}

function renderStationsHead() {
  const catalog = root?.querySelector('.mgmt-catalog');
  const editBtn = root?.querySelector('.mgmt-edit-mode');
  const editing = stationEditMode && view === 'catalog';
  if (catalog) catalog.classList.toggle('mgmt-editing', editing);
  if (editBtn) {
    editBtn.hidden = false;
    editBtn.classList.toggle('on', stationEditMode && view === 'catalog');
    editBtn.textContent = stationEditMode ? 'Done' : 'Edit';
    editBtn.setAttribute('aria-pressed', String(stationEditMode));
  }
}

function renderStations() {
  const catalog = root?.querySelector('.mgmt-catalog');
  const bar = root?.querySelector('.mgmt-stations');
  if (!catalog || !bar) return;

  const showCatalog = view === 'catalog';
  catalog.hidden = !showCatalog;
  renderStationsHead();
  if (!showCatalog) return;

  const focused = stationEditMode
    ? document.activeElement?.closest?.('.mgmt-station-item')?.dataset?.station
    : null;

  const pages = Math.max(1, Math.ceil(MANAGED_STATIONS.length / STATION_PAGE));
  if (stationPage > pages - 1) stationPage = pages - 1;
  if (stationPage < 0) stationPage = 0;
  const back = root.querySelector('.mgmt-station-back');
  const more = root.querySelector('.mgmt-station-more');
  if (back) back.hidden = stationPage === 0;
  if (more) more.hidden = stationPage >= pages - 1;
  const visible = MANAGED_STATIONS.slice(stationPage * STATION_PAGE, stationPage * STATION_PAGE + STATION_PAGE);

  bar.innerHTML = visible.map((s) => {
    const on = s.id === activeStation;
    const meta = getManagedStationMeta(s.id);
    const iconClass = stationIconClass(s.id);
    const iconAct = stationEditMode ? 'swap' : 'select';
    const iconLabel = stationEditMode
      ? `Change ${meta.label} icon`
      : `Select ${meta.label}`;
    const swapOverlay = stationEditMode
      ? '<span class="mgmt-icon-swap" aria-hidden="true"><i class="ph ph-image"></i></span>'
      : '';
    const fileInput = stationEditMode
      ? '<input type="file" class="mgmt-icon-file" accept="image/*" hidden />'
      : '';
    const nameField = stationEditMode
      ? `<input type="text" class="mgmt-station-name" value="${esc(meta.label)}" aria-label="Station name" spellcheck="false" />`
      : `<span class="mgmt-station-name mgmt-station-label">${esc(meta.label)}</span>`;

    return `<div class="mgmt-station-item${on ? ' on' : ''}" data-station="${s.id}" role="tab" aria-selected="${on}">
      <button type="button" class="radio-btn mgmt-radio-btn${on ? ' on' : ''}" data-act="${iconAct}" aria-label="${esc(iconLabel)}">
        <span class="${iconClass}"><img src="${esc(meta.icon)}" alt="" /></span>
        ${swapOverlay}
      </button>
      ${nameField}
      ${fileInput}
    </div>`;
  }).join('');

  if (focused) {
    root.querySelector(`[data-station="${focused}"] .mgmt-station-name`)?.focus();
  }
}

function selectStation(stationId) {
  if (!stationId || stationId === activeStation) return;
  activeStation = stationId;
  renderManagement();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const match = /^data:[^;]+;base64,(.+)$/.exec(reader.result);
      resolve(match ? match[1] : '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function scheduleStationNameSave(stationId, label) {
  clearTimeout(nameSaveTimers.get(stationId));
  nameSaveTimers.set(stationId, setTimeout(() => saveStationMeta(stationId, { label }), 400));
}

async function saveStationMeta(stationId, { label, icon } = {}) {
  if (saving || view !== 'catalog') return;
  const meta = getManagedStationMeta(stationId);
  const nextLabel = label?.trim() || meta.label;
  const nextIcon = icon?.trim() || meta.icon;
  if (nextLabel === meta.label && nextIcon === meta.icon) return;
  saving = true;
  setStatus('Saving…');
  try {
    await updateRadioConfig({
      stations: {
        [meta.radioKey]: { label: nextLabel, icon: nextIcon },
      },
    });
    applyStationChrome();
    setStatus('');
    renderStations();
    renderHeader();
  } catch {
    setStatus('Save failed');
  } finally {
    saving = false;
  }
}

async function uploadStationIcon(stationId, file) {
  const meta = getManagedStationMeta(stationId);
  saving = true;
  setStatus('Uploading…');
  try {
    const data = await readFileAsBase64(file);
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
    const res = await fetch('/api/station-icon', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ station: meta.radioKey, data, mime: file.type, ext }),
    });
    if (!res.ok) throw new Error('Upload failed');
    const { icon } = await res.json();
    await saveStationMeta(stationId, { icon });
  } catch {
    setStatus('Upload failed');
    saving = false;
  }
}

function bindStationControls() {
  const bar = root?.querySelector('.mgmt-stations');
  if (!bar || bar.dataset.bound) return;
  bar.dataset.bound = '1';

  bar.addEventListener('click', (e) => {
    const item = e.target.closest('[data-station]');
    const stationId = item?.dataset.station;
    if (!stationId) return;

    if (stationEditMode && e.target.closest('[data-act="swap"]')) {
      e.preventDefault();
      item.querySelector('.mgmt-icon-file')?.click();
      return;
    }

    if (!stationEditMode && (e.target.closest('[data-act="select"]') || e.target.closest('.mgmt-station-label'))) {
      selectStation(stationId);
    }
  });

  bar.addEventListener('change', (e) => {
    if (!stationEditMode || !e.target.classList.contains('mgmt-icon-file')) return;
    const file = e.target.files?.[0];
    const stationId = e.target.closest('[data-station]')?.dataset.station;
    if (file && stationId) uploadStationIcon(stationId, file);
    e.target.value = '';
  });

  bar.addEventListener('focusin', (e) => {
    if (!stationEditMode) return;
    const input = e.target.closest('.mgmt-station-name');
    if (!input) return;
    const stationId = input.closest('[data-station]')?.dataset.station;
    if (!stationId || stationId === activeStation) return;
    activeStation = stationId;
    renderManagement();
    requestAnimationFrame(() => {
      root.querySelector(`[data-station="${stationId}"] .mgmt-station-name`)?.focus();
    });
  });

  bar.addEventListener('input', (e) => {
    if (!stationEditMode || !e.target.classList.contains('mgmt-station-name')) return;
    const stationId = e.target.closest('[data-station]')?.dataset.station;
    if (stationId) scheduleStationNameSave(stationId, e.target.value);
  });

  bar.addEventListener('keydown', (e) => {
    if (!stationEditMode || !e.target.classList.contains('mgmt-station-name')) return;
    if (e.key === 'Enter') e.target.blur();
  });
}

function artistCoverMap() {
  const map = new Map();
  for (const t of state.tracks) {
    const a = trackArtistName(t);
    const key = norm(a);
    if (!key || map.has(key)) continue;
    map.set(key, t.pictureUrl || pickRandomCover(t) || '');
  }
  return map;
}

function stationMetaLine(artist, count) {
  const stations = MANAGED_STATIONS
    .filter((s) => artistOnStation(artist, s.id))
    .map((s) => stationLabel(s.id));
  const songs = `${count} song${count === 1 ? '' : 's'}`;
  return stations.length ? `${songs} · ${stations.join(' · ')}` : songs;
}

function catalogRowHtml(artist, cover) {
  const on = artistOnStation(artist, activeStation);
  const count = countTracksForArtist(artist);
  const art = cover
    ? `<img class="mgmt-art" src="${esc(cover)}" alt="" />`
    : '<span class="mgmt-art-ph" aria-hidden="true"></span>';
  return `<div class="mgmt-row${on ? ' on' : ''}" data-artist="${esc(artist)}">
    ${art}
    <div class="mgmt-artist">
      <span class="mgmt-name">${esc(artist)}</span>
      <span class="mgmt-meta">${esc(stationMetaLine(artist, count))}</span>
    </div>
    <div class="mgmt-row-actions">
      <button type="button" class="mgmt-join${on ? ' on' : ''}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} ${esc(stationLabel(activeStation))}"></button>
      <button type="button" class="more-btn mgmt-more-btn" aria-label="More options for ${esc(artist)}">
        <i class="ph ph-dots-three-vertical" aria-hidden="true"></i>
      </button>
    </div>
  </div>`;
}

function removedRowHtml(artist) {
  return `<div class="mgmt-row mgmt-row-removed" data-artist="${esc(artist)}">
    <span class="mgmt-art-ph" aria-hidden="true"></span>
    <div class="mgmt-artist">
      <span class="mgmt-name">${esc(artist)}</span>
      <span class="mgmt-meta">Hidden from your library</span>
    </div>
    <div class="mgmt-row-actions">
      <button type="button" class="mgmt-restore">Restore</button>
      <button type="button" class="mgmt-forget">Delete files</button>
    </div>
  </div>`;
}

function setToggle(label, on, act) {
  return `<div class="set-row"><span>${label}</span><button type="button" class="mgmt-join${on ? ' on' : ''}" data-act="${act}" aria-pressed="${on}" aria-label="${label}"></button></div>`;
}

function renderSettings() {
  const pane = root?.querySelector('.mgmt-settings');
  if (!pane) return;
  const authView = getAuthView();
  const prefs = getSettings();
  const slots = new Set(getPlayerSlots());
  const modes = [
    ['email', 'Email and PIN'],
    ['pin', 'PIN'],
    ['pins', 'Several PINs'],
  ];
  const pins = (authView.pins || []).map((pin) => `<div class="set-row" data-pin="${esc(pin.id)}">
      <span>${esc(pin.label)}</span>
      <button type="button" class="mgmt-text-btn set-pin-remove">Remove</button>
    </div>`).join('');
  const pinBlock = authView.mode === 'email' ? '' : `
    <form class="set-add" data-form="pin">
      <input class="set-input" name="label" placeholder="Name" autocomplete="off" spellcheck="false" />
      <input class="set-input" name="pin" placeholder="PIN" type="password" inputmode="numeric" autocomplete="new-password" />
      <button type="submit" class="mgmt-text-btn">Add</button>
    </form>
    ${pins}`;
  const radios = MANAGED_STATIONS.map((s) => {
    const meta = getManagedStationMeta(s.id);
    const on = slots.has(s.radioKey);
    return `<div class="set-row" data-radio="${esc(s.radioKey)}" data-station="${esc(s.id)}">
      <span>${esc(meta.label)}</span>
      <span class="set-row-actions">
        <button type="button" class="mgmt-join${on ? ' on' : ''}" data-act="player" aria-pressed="${on}" aria-label="Show ${esc(meta.label)} on the player"></button>
        ${s.custom ? '<button type="button" class="mgmt-text-btn" data-act="remove-radio">Remove</button>' : ''}
      </span>
    </div>`;
  }).join('');

  pane.innerHTML = `
    <section class="set-group">
      <p class="set-kicker">Sign in</p>
      ${setToggle('Require a sign in', !!authView.enabled, 'auth-enabled')}
      <div class="set-modes">
        ${modes.map(([id, label]) => `<button type="button" class="mgmt-text-btn${authView.mode === id ? ' on' : ''}" data-auth-mode="${id}">${label}</button>`).join('')}
      </div>
      ${pinBlock}
    </section>
    <section class="set-group">
      <p class="set-kicker">Radios</p>
      ${radios}
      <form class="set-add" data-form="radio">
        <input class="set-input" name="name" placeholder="New radio" autocomplete="off" spellcheck="false" />
        <button type="submit" class="mgmt-text-btn">Add</button>
      </form>
    </section>
    <section class="set-group">
      <p class="set-kicker">Playback</p>
      ${setToggle('Open lyrics with the song', !!prefs.lyricsWithSong, 'lyrics')}
      ${setToggle('Skip songs you just played', !!prefs.avoidRecent, 'recent')}
    </section>
    <section class="set-group">
      <p class="set-kicker">Look</p>
      ${setToggle('Custom cursor', !!prefs.customCursor, 'cursor')}
      ${setToggle('Color from the cover', !!prefs.coverWash, 'wash')}
    </section>
  `;
}

async function onSettingsClick(e) {
  const mode = e.target.closest('[data-auth-mode]')?.dataset.authMode;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (mode) {
    await saveAuth({ mode });
    return;
  }
  if (act === 'auth-enabled') {
    await saveAuth({ enabled: !getAuthView().enabled });
    return;
  }
  if (act === 'lyrics') {
    await saveUi({ lyricsWithSong: !getSettings().lyricsWithSong });
    return;
  }
  if (act === 'recent') {
    await saveUi({ avoidRecent: !getSettings().avoidRecent });
    return;
  }
  if (act === 'cursor') {
    await saveUi({ customCursor: !getSettings().customCursor });
    return;
  }
  if (act === 'wash') {
    await saveUi({ coverWash: !getSettings().coverWash });
    return;
  }
  if (act === 'player') {
    const key = e.target.closest('[data-radio]')?.dataset.radio;
    if (key) await togglePlayerRadio(key);
    return;
  }
  if (act === 'remove-radio') {
    const id = e.target.closest('[data-station]')?.dataset.station;
    if (id) await removeRadio(id);
    return;
  }
  if (e.target.closest('.set-pin-remove')) {
    const id = e.target.closest('[data-pin]')?.dataset.pin;
    if (id) await saveAuth({ removePin: id });
  }
}

function bindSettings() {
  const pane = root?.querySelector('.mgmt-settings');
  if (!pane || pane.dataset.bound) return;
  pane.dataset.bound = '1';
  pane.addEventListener('click', async (e) => {
    if (e.target.closest('form')) return;
    if (!e.target.closest('[data-act], [data-auth-mode], .set-pin-remove')) return;
    try {
      await onSettingsClick(e);
      setStatus('');
    } catch (err) {
      setStatus(err.message || 'Save failed');
    }
    if (view === 'settings') renderManagement();
  });
  pane.addEventListener('submit', async (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    e.preventDefault();
    try {
      if (form.dataset.form === 'pin') {
        const data = new FormData(form);
        const saved = await saveAuth({ addPin: { label: data.get('label'), pin: data.get('pin') } });
        setStatus(saved.notice || '');
        if (!saved.notice) form.reset();
      } else if (form.dataset.form === 'radio') {
        const name = String(new FormData(form).get('name') || '').trim();
        if (!name) return;
        await addRadio(name);
        form.reset();
        stationPage = Math.max(0, Math.ceil(MANAGED_STATIONS.length / STATION_PAGE) - 1);
        setStatus('');
      }
    } catch (err) {
      setStatus(err.message || 'Save failed');
    }
    if (view === 'settings') renderManagement();
  });
}

export function renderManagement() {
  if (!root) return;
  renderHeader();
  renderStations();

  const list = root.querySelector('.mgmt-list');
  const settingsEl = root.querySelector('.mgmt-settings');
  const importEl = root.querySelector('.mgmt-import');
  if (settingsEl) settingsEl.hidden = view !== 'settings';
  if (importEl) importEl.hidden = view !== 'import';
  if (list) list.hidden = view === 'settings' || view === 'import';
  if (view === 'settings') {
    renderSettings();
    return;
  }
  if (view === 'import') {
    renderImport();
    return;
  }
  if (!list) return;

  const q = filter.trim().toLowerCase();
  const artists = (view === 'removed' ? getRemovedArtists() : getCatalogArtists())
    .filter((a) => !q || a.toLowerCase().includes(q));

  if (!artists.length) {
    const empty = view === 'removed'
      ? (q ? 'No matches' : 'No removed artists')
      : (q ? 'No matches' : 'No artists in library yet');
    list.innerHTML = `<p class="mgmt-empty">${empty}</p>`;
    return;
  }

  const covers = view === 'catalog' ? artistCoverMap() : null;
  list.innerHTML = artists
    .map((a) => (view === 'removed' ? removedRowHtml(a) : catalogRowHtml(a, covers.get(norm(a)))))
    .join('');
}

async function saveConfig(rosters, excluded, prune = false) {
  saving = true;
  setStatus('Saving…');
  try {
    await updateRadioConfig({ rosters, excluded, prune });
    setStatus('');
    emit('library');
    renderManagement();
  } catch {
    setStatus('Save failed');
  } finally {
    saving = false;
  }
}

async function toggleArtist(artist) {
  if (saving) return;
  const rosters = getArtistRosters();
  const key = norm(artist);
  const enabled = !artistOnStation(artist, activeStation);
  const next = { ...rosters };
  let list = (next[activeStation] || []).filter((a) => norm(a) !== key);
  if (enabled) list.push(artist);
  next[activeStation] = list;
  await saveConfig(next);
}

async function removeArtist(artist) {
  if (saving) return;
  const rosters = getArtistRosters();
  const key = norm(artist);
  const nextRosters = {};
  for (const s of MANAGED_STATIONS) {
    nextRosters[s.id] = (rosters[s.id] || []).filter((a) => norm(a) !== key);
  }
  const excluded = [...getExcludedArtists()];
  if (!excluded.some((a) => norm(a) === key)) excluded.push(artist);
  await saveConfig(nextRosters, excluded, true);
}

async function deleteArtistFiles(artist) {
  if (saving) return;
  saving = true;
  setStatus('Deleting…');
  try {
    const res = await fetch('/api/library/delete', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artist }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Delete failed');
    if (!data.removed) {
      setStatus('No files found for that artist');
      return;
    }
    const excluded = getExcludedArtists().filter((a) => norm(a) !== norm(artist));
    await updateRadioConfig({ excluded, prune: false });
    await loadBuiltinLibrary();
    setStatus('Deleted from this PC');
    emit('library');
    renderManagement();
  } catch (err) {
    setStatus(err.message || 'Delete failed');
  } finally {
    saving = false;
  }
}

async function restoreArtist(artist) {
  if (saving) return;
  const key = norm(artist);
  const excluded = getExcludedArtists().filter((a) => norm(a) !== key);
  saving = true;
  setStatus('Restoring…');
  try {
    await updateRadioConfig({ excluded, prune: false });
    await loadBuiltinLibrary();
    view = 'catalog';
    setStatus('');
    emit('library');
    renderManagement();
  } catch {
    setStatus('Restore failed');
  } finally {
    saving = false;
  }
}

function initMenus() {
  if (!menuEl) {
    menuEl = document.createElement('div');
    menuEl.id = 'mgmt-menu';
    menuEl.className = 'track-menu mgmt-menu';
    menuEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'delete' && menuArtist) {
        const artist = menuArtist;
        closeMenu();
        openConfirm(artist);
      }
    });
    document.body.appendChild(menuEl);
  }

  if (!confirmEl) {
    confirmEl = document.createElement('div');
    confirmEl.className = 'mgmt-confirm-backdrop';
    confirmEl.innerHTML = `
      <div class="mgmt-confirm-panel" role="dialog" aria-modal="true" aria-labelledby="mgmt-confirm-title">
        <p id="mgmt-confirm-title" class="mgmt-confirm-text"></p>
        <div class="mgmt-confirm-actions">
          <button type="button" class="mgmt-confirm-cancel" data-act="cancel">Cancel</button>
          <button type="button" class="mgmt-confirm-delete" data-act="delete">Delete</button>
        </div>
      </div>
    `;
    confirmEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel' || e.target === confirmEl) {
        closeConfirm();
        return;
      }
      if (act === 'delete' && confirmArtist) {
        const artist = confirmArtist;
        const mode = confirmEl.dataset.mode || 'hide';
        closeConfirm();
        if (mode === 'files') deleteArtistFiles(artist);
        else removeArtist(artist);
      }
    });
    document.body.appendChild(confirmEl);
  }

  document.addEventListener('pointerdown', (e) => {
    if (menuEl?.classList.contains('on') && !menuEl.contains(e.target) && !e.target.closest('.mgmt-more-btn')) {
      closeMenu();
    }
  });
  window.addEventListener('resize', () => {
    closeMenu();
    closeConfirm();
  });
}

export function initManagement() {
  root = document.getElementById('management');
  if (!root) return;

  initMenus();

  root.innerHTML = `
    <header class="mgmt-header">
      <div class="mgmt-header-row">
        <p class="mgmt-stats"></p>
        <div class="mgmt-header-actions">
          <button type="button" class="mgmt-text-btn mgmt-edit-mode" aria-pressed="false">Edit</button>
          <button type="button" class="mgmt-text-btn mgmt-view-removed" hidden>Removed</button>
          <button type="button" class="mgmt-text-btn mgmt-settings-btn" aria-pressed="false">Settings</button>
          <button type="button" class="mgmt-text-btn mgmt-import-btn" aria-pressed="false">Import</button>
          <input type="file" class="mgmt-import-file" accept=".mp3,.wav,.aif,.aiff,.flac,.m4a,.aac,.ogg,.opus,.zip,audio/*" multiple hidden />
          <input type="file" class="mgmt-import-folder" webkitdirectory directory multiple hidden />
        </div>
      </div>
    </header>
    <div class="mgmt-catalog">
      <div class="mgmt-station-row">
        <button type="button" class="mgmt-text-btn mgmt-station-back" data-dir="-1" hidden>Back</button>
        <nav class="mgmt-stations" role="tablist" aria-label="Radio stations"></nav>
        <button type="button" class="mgmt-text-btn mgmt-station-more" data-dir="1" hidden>More</button>
      </div>
      <div class="mgmt-search-wrap">
        <i class="ph ph-magnifying-glass" aria-hidden="true"></i>
        <input type="search" class="mgmt-search" placeholder="Search artists" autocomplete="off" spellcheck="false" />
        <button type="button" class="mgmt-search-clear" hidden aria-label="Clear search">
          <i class="ph ph-x" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div class="mgmt-list"></div>
    <div class="mgmt-settings" hidden></div>
    <div class="mgmt-import" hidden></div>
    <p class="mgmt-status" aria-live="polite"></p>
  `;

  bindStationControls();
  bindSettings();

  root.querySelector('.mgmt-station-row')?.addEventListener('click', (e) => {
    const dir = Number(e.target.closest('[data-dir]')?.dataset.dir);
    if (!dir) return;
    stationPage += dir;
    renderStations();
  });

  root.querySelector('.mgmt-edit-mode')?.addEventListener('click', () => {
    if (view !== 'catalog') {
      view = 'catalog';
      stationEditMode = false;
      renderManagement();
      return;
    }
    stationEditMode = !stationEditMode;
    if (!stationEditMode) document.activeElement?.blur?.();
    renderStations();
  });

  const importInput = root.querySelector('.mgmt-import-file');
  const folderInput = root.querySelector('.mgmt-import-folder');

  root.querySelector('.mgmt-import-btn')?.addEventListener('click', () => {
    view = view === 'import' ? 'catalog' : 'import';
    if (view === 'import') stationEditMode = false;
    closeMenu();
    renderManagement();
  });

  root.querySelector('.mgmt-import')?.addEventListener('click', (e) => {
    const kind = e.target.closest('[data-import]')?.dataset.import;
    if (kind === 'files') importInput?.click();
    if (kind === 'folder') folderInput?.click();
  });

  const runImport = async (files) => {
    if (view !== 'import') {
      view = 'import';
      stationEditMode = false;
      renderManagement();
    }
    if (!files?.length) return;
    try {
      const result = await importUploads(files, setStatus);
      await loadBuiltinLibrary();
      const n = result.imported;
      if (!n && result.failed) {
        setStatus(result.lastError || 'Import failed');
      } else if (!n) {
        setStatus('No audio files in that upload');
      } else {
        const bits = [`Imported ${n} song${n === 1 ? '' : 's'}`];
        if (result.skipped) bits.push(`${result.skipped} skipped`);
        if (result.failed) bits.push(`${result.failed} failed`);
        setStatus(bits.join(' · '));
      }
    } catch (err) {
      setStatus(err.message || 'Import failed');
    }
    renderManagement();
  };

  const onPicked = async (input) => {
    const files = [...(input.files || [])];
    input.value = '';
    await runImport(files);
  };
  importInput?.addEventListener('change', () => onPicked(importInput));
  folderInput?.addEventListener('change', () => onPicked(folderInput));

  let dragDepth = 0;
  root.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragDepth += 1;
    e.preventDefault();
    setStatus('Drop songs, folders, or a zip');
  });
  root.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
  });
  root.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    const status = root.querySelector('.mgmt-status');
    if (!dragDepth && status?.textContent === 'Drop songs, folders, or a zip') setStatus('');
  });
  root.addEventListener('drop', async (e) => {
    if (!e.dataTransfer) return;
    dragDepth = 0;
    e.preventDefault();
    setStatus('Reading…');
    const files = await filesFromTransfer(e.dataTransfer);
    await runImport(files);
  });

  root.querySelector('.mgmt-settings-btn')?.addEventListener('click', () => {
    view = view === 'settings' ? 'catalog' : 'settings';
    if (view === 'settings') stationEditMode = false;
    closeMenu();
    renderManagement();
  });

  root.querySelector('.mgmt-view-removed')?.addEventListener('click', () => {
    view = view === 'removed' ? 'catalog' : 'removed';
    filter = '';
    const search = root.querySelector('.mgmt-search');
    if (search) search.value = '';
    const searchClear = root.querySelector('.mgmt-search-clear');
    if (searchClear) searchClear.hidden = true;
    closeMenu();
    renderManagement();
  });

  const searchInput = root.querySelector('.mgmt-search');
  const searchClear = root.querySelector('.mgmt-search-clear');
  searchInput?.addEventListener('input', (e) => {
    filter = e.target.value;
    if (searchClear) searchClear.hidden = !filter.trim();
    renderManagement();
  });
  searchClear?.addEventListener('click', () => {
    filter = '';
    if (searchInput) searchInput.value = '';
    searchClear.hidden = true;
    searchInput?.focus();
    renderManagement();
  });

  root.querySelector('.mgmt-list')?.addEventListener('click', (e) => {
    const row = e.target.closest('.mgmt-row');
    const artist = row?.dataset.artist;
    if (!artist) return;

    const more = e.target.closest('.mgmt-more-btn');
    if (more) {
      e.stopPropagation();
      openArtistMenu(more, artist);
      return;
    }

    if (e.target.closest('.mgmt-join')) {
      toggleArtist(artist);
      return;
    }
    if (e.target.closest('.mgmt-restore')) {
      restoreArtist(artist);
      return;
    }
    if (e.target.closest('.mgmt-forget')) {
      openConfirm(artist, 'files');
    }
  });

  const dragIgnore = 'button, input, textarea, a, label, .mgmt-join, .mgmt-more-btn, .mgmt-restore, .mgmt-forget, .mgmt-radio-btn, .mgmt-station-name, .set-input';
  initDragScroll(root.querySelector('.mgmt-list'), { ignore: dragIgnore });
  initDragScroll(root.querySelector('.mgmt-settings'), { ignore: dragIgnore });
  initDragScroll(root.querySelector('.mgmt-import'), { ignore: dragIgnore });

  on('library', renderManagement);
  renderManagement();
}
