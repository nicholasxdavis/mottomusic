import { state, emit, uid, extOf, COLORS, titleFromFilename } from './state.js';
import { readMetadata, getDuration } from './id3.js';
import { parseLrc } from './lyrics.js';
import { applyManifestToTrack, enrichTrackFromFilename, isTrackExcluded } from './radio.js';

const AUDIO_EXT = /^(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm|mp4|aiff|aif)$/i;
const DB_NAME = 'motto-library';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readonly');
    const r = tx.objectStore('kv').get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function idbSet(key, val) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function isAudioName(name) {
  return AUDIO_EXT.test(extOf(name));
}

async function fileToTrack(file, path, handle) {
  const id = uid(file, path);
  if (state.trackMap.has(id)) return state.trackMap.get(id);
  const meta = await readMetadata(file);
  const duration = await getDuration(file);
  const track = {
    id,
    name: file.name,
    path,
    file,
    handle: handle || null,
    url: null,
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    pictureUrl: meta.pictureUrl,
    duration,
    color: COLORS[state.tracks.length % COLORS.length],
    lyrics: null,
    lrcText: null,
  };
  state.trackMap.set(id, track);
  state.tracks.push(track);
  return track;
}

async function attachSidecar(track, file) {
  if (!track.handle?.getFile) return;
  const base = file.name.replace(/\.[^.]+$/, '');
  try {
    const parent = await track.handle.getParent?.();
    if (!parent) return;
    for (const name of [`${base}.lrc`, `${base}.LRC`]) {
      try {
        const h = await parent.getFileHandle(name);
        const lrcFile = await h.getFile();
        track.lrcText = await lrcFile.text();
        track.lyrics = {
          plain: track.lrcText.replace(/\[[^\]]+\]/g, '').trim(),
          synced: parseLrc(track.lrcText),
          source: 'file',
        };
        return;
      } catch {}
    }
  } catch {}
}

async function walkDir(dirHandle, path = '') {
  for await (const [name, child] of dirHandle.entries()) {
    if (child.kind === 'directory') {
      await walkDir(child, path ? `${path}/${name}` : name);
    } else if (isAudioName(name)) {
      try {
        const file = await child.getFile();
        const tr = await fileToTrack(file, path, child);
        await attachSidecar(tr, file);
      } catch (err) {
        console.warn('skip', name, err);
      }
    }
  }
}

function encodeSrc(relPath) {
  return '/' + relPath.split('/').map((p) => encodeURIComponent(p)).join('/');
}

async function fetchCoverForTrack(track) {
  if (track.pictureUrl || !track.artist || !track.title) return;
  if (track.artist === 'Unknown artist') return;
  try {
    const params = new URLSearchParams({
      artist: track.artist,
      title: track.title,
    });
    const res = await fetch(`/api/cover?${params}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data?.url) track.pictureUrl = data.url;
  } catch {}
}

async function fetchTagBlob(src, name) {
  const headRes = await fetch(src, { headers: { Range: 'bytes=0-9' } });
  if (!headRes.ok) return null;
  const head = new Uint8Array(await headRes.arrayBuffer());
  let last = 65535;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33 && head.length >= 10) {
    const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    last = Math.min(size + 10, 1500000) - 1;
  }
  if (last < 15) return new File([head], name);
  const res = await fetch(src, { headers: { Range: `bytes=0-${last}` } });
  if (!res.ok) return null;
  return new File([await res.blob()], name);
}

async function enrichTrackMeta(track) {
  if (track.metaReady) return;
  enrichTrackFromFilename(track);
  try {
    const file = await fetchTagBlob(track.src, track.name);
    if (file) {
      const meta = await readMetadata(file);
      if (meta.title && meta.title !== titleFromFilename(track.name)) track.title = meta.title;
      if (meta.artist && meta.artist !== 'Unknown artist') track.artist = meta.artist;
      else enrichTrackFromFilename(track);
      track.album = meta.album;
      if (meta.pictureUrl) track.pictureUrl = meta.pictureUrl;
    }
  } catch {}
  applyManifestToTrack(track);
  if (!track.pictureUrl) await fetchCoverForTrack(track);
  track.metaReady = true;
}

async function addUrlTrack(entry) {
  const id = `url:${entry.path}`;
  if (state.trackMap.has(id)) return state.trackMap.get(id);
  const track = {
    id,
    name: entry.name,
    path: entry.path.replace(/\/[^/]+$/, ''),
    file: null,
    src: encodeSrc(entry.path),
    url: null,
    title: titleFromFilename(entry.name),
    artist: 'Unknown artist',
    album: 'Unknown album',
    pictureUrl: null,
    duration: 0,
    color: COLORS[state.tracks.length % COLORS.length],
    lyrics: null,
    lrcText: null,
    stations: [],
  };
  enrichTrackFromFilename(track);
  applyManifestToTrack(track);
  state.trackMap.set(id, track);
  state.tracks.push(track);
  return track;
}

export async function loadBuiltinLibrary() {
  try {
    const res = await fetch('/api/library');
    if (!res.ok) {
      state.ready = true;
      emit('library');
      return;
    }
    const entries = await res.json();
    const tracks = [];
    for (const entry of entries) tracks.push(await addUrlTrack(entry));
    if (tracks.length) emit('library');
    const pending = tracks.filter((track) => !track.metaReady);
    const current = pending.find((track) => track.id === state.currentId);
    const ordered = current ? [current, ...pending.filter((track) => track !== current)] : pending;
    let cursor = 0;
    const workers = Math.min(2, ordered.length);
    await Promise.all(Array.from({ length: workers }, async () => {
      while (cursor < ordered.length) {
        const track = ordered[cursor];
        cursor += 1;
        await enrichTrackMeta(track);
      }
    }));
    for (const t of state.tracks) {
      applyManifestToTrack(t);
      enrichTrackFromFilename(t);
    }
    const kept = state.tracks.filter((t) => !isTrackExcluded(t));
    for (const t of state.tracks) {
      if (!kept.includes(t)) state.trackMap.delete(t.id);
    }
    state.tracks = kept;
    state.ready = true;
    emit('library');
    if (state.currentId) emit('track');
    const { loadLyricsForTrack } = await import('./lyrics.js');
    const cur = state.trackMap.get(state.currentId);
    if (cur && !cur.lyrics?.synced?.length && !cur.lyrics?.plain?.trim()) {
      loadLyricsForTrack(cur);
    }
  } catch {
    state.ready = true;
    emit('library');
  }
}

export async function restoreFolder() {
  try {
    const handle = await idbGet('dir');
    if (!handle) return;
    const perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') {
      const next = await handle.requestPermission({ mode: 'read' });
      if (next !== 'granted') return;
    }
    state.folderName = handle.name;
    await walkDir(handle);
    emit('library');
  } catch {}
  if (!state.ready) {
    state.ready = true;
    emit('library');
  }
}

export function searchTracks(query = '') {
  const q = query.trim().toLowerCase();
  let list = state.tracks;
  if (q) {
    list = list.filter((t) =>
      `${t.title} ${t.artist} ${t.album} ${t.name}`.toLowerCase().includes(q)
    );
  }
  return list.slice().sort((a, b) => a.title.localeCompare(b.title));
}

function uploadPath(file) {
  return file?.relativePath || file?.webkitRelativePath || file?.name || '';
}

async function pool(items, limit, fn) {
  let cursor = 0;
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await fn(item);
    }
  }));
}

const IMPORT_AUDIO = /\.(mp3|wav|aif|aiff|flac|m4a|aac|ogg|opus)$/i;

export async function importMp3File(file, relDir = '') {
  const name = file?.name || '';
  if (!IMPORT_AUDIO.test(name)) throw new Error('Upload an audio file');
  const params = new URLSearchParams({ name });
  if (relDir) {
    params.set('dir', relDir);
  } else {
    let meta = null;
    try {
      meta = await readMetadata(file);
    } catch {}
    if (meta?.artist && meta.artist !== 'Unknown artist') params.set('artist', meta.artist);
    if (meta?.title) params.set('title', meta.title);
    if (meta?.album && meta.album !== 'Unknown album') params.set('album', meta.album);
  }
  const res = await fetch(`/api/import?${params}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Import failed');
  return data;
}

async function importLrcFile(file) {
  const rel = uploadPath(file);
  const parts = rel.split(/[/\\]/).filter(Boolean);
  const name = parts.pop() || file.name;
  const res = await fetch(`/api/import?${new URLSearchParams({ name, dir: parts.join('/') })}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    body: file,
  });
  if (!res.ok) throw new Error('Lyrics skipped');
}

async function importZipFile(file) {
  const res = await fetch(`/api/import-zip?${new URLSearchParams({ name: file.name || 'songs.zip' })}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/zip' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Import failed');
  return data;
}

export async function importUploads(list, onProgress) {
  const files = [...list];
  const mp3s = [];
  const zips = [];
  const lrcs = [];
  let skipped = 0;
  for (const file of files) {
    const base = uploadPath(file).split(/[/\\]/).pop() || '';
    if (/\.zip$/i.test(base)) zips.push(file);
    else if (IMPORT_AUDIO.test(base)) mp3s.push(file);
    else if (/\.lrc$/i.test(base)) lrcs.push(file);
    else skipped += 1;
  }
  if (!mp3s.length && !zips.length) throw new Error('Drop songs, a folder, or a zip');
  let imported = 0;
  let failed = 0;
  let lastError = '';
  let index = 0;
  const songTotal = mp3s.length;

  await pool(mp3s, 4, async (file) => {
    index += 1;
    const n = index;
    onProgress?.(songTotal > 1 ? `Importing ${n} of ${songTotal}` : 'Importing…');
    const rel = uploadPath(file);
    const parts = rel.split(/[/\\]/).filter(Boolean);
    parts.pop();
    try {
      await importMp3File(file, parts.join('/'));
      imported += 1;
    } catch (err) {
      failed += 1;
      lastError = err.message || lastError;
    }
  });

  for (const zip of zips) {
    onProgress?.(`Unpacking ${zip.name || 'zip'}`);
    try {
      const data = await importZipFile(zip);
      imported += data.imported || 0;
      skipped += data.skipped || 0;
    } catch (err) {
      failed += 1;
      lastError = err.message || lastError;
    }
  }

  if (lrcs.length) {
    onProgress?.('Saving lyrics');
    await pool(lrcs, 4, async (file) => {
      try {
        await importLrcFile(file);
      } catch {}
    });
  }

  return { imported, skipped, failed, lastError };
}

function readAllEntries(reader) {
  return new Promise((resolve, reject) => {
    const all = [];
    const next = () => {
      reader.readEntries((batch) => {
        if (!batch.length) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    };
    next();
  });
}

async function walkEntry(entry, prefix, out) {
  const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    file.relativePath = rel;
    out.push(file);
    return;
  }
  if (!entry.isDirectory) return;
  const children = await readAllEntries(entry.createReader());
  for (const child of children) await walkEntry(child, rel, out);
}

export async function filesFromTransfer(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entries = items
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter(Boolean);
  if (!entries.length) return [...(dataTransfer?.files || [])];
  const out = [];
  for (const entry of entries) await walkEntry(entry, '', out);
  return out;
}

export function initLibrary() {}
