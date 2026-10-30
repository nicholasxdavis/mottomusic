import { state, emit } from './state.js';

import { artistFromPath } from './radio.js';



const cache = new Map();
const STORE_KEY = 'motto-lyrics';

function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function storeKey(artist, title) {
  return `${normKey(artist)}::${normKey(title)}`;
}

function readStored(artist, title) {
  try {
    const db = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    const hit = db[storeKey(artist, title)];
    if (!hit) return null;
    if (!hit.plain?.trim() && !hit.synced?.length) return null;
    return {
      plain: hit.plain || '',
      synced: Array.isArray(hit.synced) ? hit.synced : [],
      source: hit.source || 'cache',
    };
  } catch {
    return null;
  }
}

function writeStored(artist, title, data) {
  try {
    const db = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    db[storeKey(artist, title)] = {
      plain: data.plain || '',
      synced: data.synced || [],
      source: data.source || 'api',
    };
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {}
}



export function parseLrc(text) {

  const lines = [];

  const re = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)/g;

  for (const raw of text.split('\n')) {

    let m;

    while ((m = re.exec(raw)) !== null) {

      const ms = Number(m[3] || 0);

      const pad = String(ms).length === 1 ? ms * 100 : String(ms).length === 2 ? ms * 10 : ms;

      const t = Number(m[1]) * 60 + Number(m[2]) + pad / 1000;

      const text = m[4].trim();

      if (text) lines.push({ t, text });

    }

  }

  lines.sort((a, b) => a.t - b.t);

  return lines;

}



export function lineAt(lines, sec) {

  if (!lines?.length) return null;

  let idx = 0;

  for (let i = 0; i < lines.length; i++) {

    if (lines[i].t <= sec) idx = i;

    else break;

  }

  return { index: idx, line: lines[idx], next: lines[idx + 1] || null };

}



function cleanArtist(artist) {

  return String(artist || '')

    .replace(/\s*(?:,|&|feat\.?|ft\.?|with)\s*.*/i, '')

    .trim();

}



function cleanTitle(title) {

  return String(title || '')

    .replace(/\s*\(feat\.[^)]+\)/gi, '')

    .replace(/\s*\(og version\)/gi, '')

    .replace(/\s*\(official[^)]*\)/gi, '')

    .replace(/\s*\[[^\]]+\]/g, '')

    .replace(/\s+/g, ' ')

    .trim();

}



function lyricSearchPairs(track) {

  const title = cleanTitle(track.title);

  const artists = new Set();

  const a = cleanArtist(track.artist);

  if (a && a.toLowerCase() !== 'unknown artist') artists.add(a);

  const folder = artistFromPath(track.path);

  if (folder) artists.add(folder);

  if (!artists.size) artists.add('');



  const pairs = [];

  const seen = new Set();

  for (const artist of artists) {

    for (const t of [title, title.replace(/\.$/, '')]) {

      const key = `${artist}|${t}`;

      if (!t || seen.has(key)) continue;

      seen.add(key);

      pairs.push({ artist, title: t });

    }

  }

  return pairs;

}



function isComehelpgloArtist(artist) {
  return normKey(artist).includes('comehelpglo');
}

function isComehelpgloTrack(track) {
  if (!track) return false;
  return isComehelpgloArtist(track.artist) || isComehelpgloArtist(artistFromPath(track.path));
}

async function fetchGeniusApi(artist, title) {
  try {
    const res = await fetch(`/api/genius?${new URLSearchParams({ artist, title })}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.plain?.trim()) return null;
    return {
      plain: data.plain.trim(),
      synced: [],
      source: data.source || 'genius',
    };
  } catch {
    return null;
  }
}

async function fetchLrclibDirect(artist, title, duration) {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
    album_name: '',
    duration: String(Math.round(duration || 0)),
  });
  try {
    const res = await fetch(`https://lrclib.net/api/get?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.plainLyrics && !data?.syncedLyrics) return null;
    const out = {
      plain: data.plainLyrics || '',
      synced: data.syncedLyrics ? parseLrc(data.syncedLyrics) : [],
      source: 'lrclib',
    };
    if (!out.plain && !out.synced?.length) return null;
    return out;
  } catch {
    return null;
  }
}

async function fetchLyricsApi(artist, title, duration, { preferGenius = false } = {}) {
  const key = `${artist}|${title}`;
  if (cache.has(key)) return cache.get(key);

  const dur = String(Math.round(duration || 0));
  let data = null;

  try {
    const res = await fetch(`/api/lyrics?${new URLSearchParams({ artist, title, duration: dur })}`);
    if (res.ok) data = await res.json();
  } catch {}

  const storeHit = (hit) => {
    cache.set(key, hit);
    writeStored(artist, title, hit);
    return hit;
  };

  if (!data || data.source === 'none') {
    const direct = await fetchLrclibDirect(artist, title, duration);
    if (direct?.synced?.length) return storeHit(direct);
    if (preferGenius) {
      const genius = await fetchGeniusApi(artist, title);
      if (genius) return storeHit(genius);
    }
    if (direct) return storeHit(direct);
    if (preferGenius) {
      const genius = await fetchGeniusApi(artist, title);
      if (genius) return storeHit(genius);
    }
    return null;
  }

  const synced = data.synced ? parseLrc(data.synced) : (data.syncedLines || []);
  const out = {
    plain: data.plain || '',
    synced,
    source: data.source || 'api',
  };

  if (!out.plain && !out.synced?.length) return null;
  if (preferGenius && !out.synced?.length) {
    const genius = await fetchGeniusApi(artist, title);
    if (genius?.plain) return storeHit(genius);
  }

  return storeHit(out);
}



function hasLyricsData(lyrics) {
  if (!lyrics) return false;
  if (Array.isArray(lyrics.synced) && lyrics.synced.length) return true;
  return typeof lyrics.plain === 'string' && lyrics.plain.trim().length > 0;
}

export async function loadLyricsForTrack(track) {
  if (!track) return null;

  const gen = (track._lyricsGen || 0) + 1;
  track._lyricsGen = gen;
  const stale = () => track._lyricsGen !== gen;

  if (!track.lrcText && track.src && /\.mp3$/i.test(track.src)) {
    try {
      const res = await fetch(track.src.replace(/\.mp3$/i, '.lrc'));
      if (res.ok) {
        const text = await res.text();
        if (text && !text.trim().startsWith('<')) track.lrcText = text;
      }
    } catch {}
  }

  if (track.lrcText) {
    const lyrics = {
      plain: track.lrcText.replace(/\[\d{1,2}:\d{2}[^\]]*\]/g, '').trim(),
      synced: parseLrc(track.lrcText),
      source: 'file',
    };
    if (!stale()) {
      track.lyrics = lyrics;
      emit('lyrics', track.id);
    }
    return track.lyrics || lyrics;
  }

  const dur = Math.round(track.duration || 0);
  const prevDur = track._lyricsDur ?? 0;
  if (track.lyrics?.source === 'none' && dur > 0 && prevDur === 0) {
    track.lyrics = null;
  }
  track._lyricsDur = dur;

  if (hasLyricsData(track.lyrics) && track.lyrics.source !== 'none') {
    if (!stale()) emit('lyrics', track.id);
    return track.lyrics;
  }

  const pairs = lyricSearchPairs(track);

  try {
    for (const { artist, title } of pairs) {
      if (stale()) return track.lyrics;

      const stored = readStored(artist, title);
      if (stored) {
        if (!stale()) {
          track.lyrics = stored;
          emit('lyrics', track.id);
        }
        return track.lyrics || stored;
      }

      const remote = await fetchLyricsApi(artist, title, track.duration, {
        preferGenius: isComehelpgloTrack(track) || isComehelpgloArtist(artist),
      });
      if (stale()) return track.lyrics;
      if (remote) {
        track.lyrics = remote;
        emit('lyrics', track.id);
        return remote;
      }
    }
  } catch (err) {
    console.warn('lyrics lookup failed', err);
  }

  if (stale()) return track.lyrics;
  if (hasLyricsData(track.lyrics)) return track.lyrics;

  track.lyrics = { plain: '', synced: [], source: 'none' };
  emit('lyrics', track.id);
  return track.lyrics;
}


