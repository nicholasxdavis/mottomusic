import { state, on, formatTime, currentTrack } from './state.js';
import { lineAt } from './lyrics.js';
import { loadCovers, pickRandomCover } from './covers.js';
import { pickAvoidingRecent, shuffleSpreadArtists } from './recent.js';
import { setAmbianceFromImage, clearAmbiance } from './ambiance.js';
import { initDragScroll } from './drag-scroll.js';
import { getSettings } from './settings.js';

const el = {};
let coverUrl = '';
let lastLyricIndex = -1;
let lastSeekSec = -1;
let lastDurSec = -1;
let lastPlaying = null;
let lastTitle = '';
let lastArtist = '';
let lastCoverId = null;
let lastCoverNonce = -1;
let lyricWords = [];
let lyricsOpen = false;
let spotRaf = 0;
let spotX = 0;
let spotY = 0;
let glowRaf = 0;
let glowLit = false;
let autoLyricsFor = null;

const SPOT_RADIUS = 100;

function cacheEls() {
  el.cover = document.getElementById('cover');
  el.coverImg = document.getElementById('cover-img');
  el.coverPh = document.getElementById('cover-ph');
  el.lyricsToggle = document.getElementById('lyrics-toggle');
  el.lyrics = document.getElementById('lyrics');
  el.spot = document.querySelector('.lyrics-spot');
  if (el.spot && el.spot.parentElement !== document.body) {
    document.body.appendChild(el.spot);
  }
  el.title = document.getElementById('track-title');
  el.artist = document.getElementById('track-artist');
  el.timeCur = document.getElementById('time-cur');
  el.timeEnd = document.getElementById('time-end');
  el.fill = document.getElementById('seek-fill');
  el.playIcon = document.getElementById('play-icon');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setGlowMode(on) {
  el.lyrics?.classList.toggle('glow-active', on);
  if (!on) clearWordGlow();
}

function wrapLyricWords(text) {
  return String(text).split(/(\s+)/).map((token) => {
    if (!token) return '';
    if (/^\s+$/.test(token)) return token;
    return `<span class="lyrics-word">${escapeHtml(token)}</span>`;
  }).join('');
}

function clearWordGlow() {
  if (!glowLit) {
    el.spot?.classList.remove('on');
    return;
  }
  for (const word of lyricWords) {
    word.style.textShadow = '';
    word.style.color = '';
  }
  el.spot?.classList.remove('on');
  glowLit = false;
}

function lyricsVisible() {
  return !!(
    el.lyrics?.classList.contains('glow-active')
    && document.body.classList.contains('lyrics-open')
  );
}

function pointerInLyrics(x, y) {
  const root = el.lyrics;
  if (!lyricsVisible() || !root) return false;
  const r = root.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function trackHasLyrics(t) {
  const l = t?.lyrics;
  if (!l) return false;
  if (Array.isArray(l.synced) && l.synced.length) return true;
  if (typeof l.plain === 'string' && l.plain.trim()) return true;
  return false;
}

function syncLyricsToggle() {
  const btn = el.lyricsToggle;
  if (!btn) return;
  btn.textContent = lyricsOpen ? 'Hide lyrics' : 'Lyrics';
  btn.setAttribute('aria-expanded', lyricsOpen ? 'true' : 'false');
}

function syncPlayerView() {
  const t = currentTrack();
  const has = trackHasLyrics(t);
  const noLyrics = t?.lyrics?.source === 'none';

  if (noLyrics) lyricsOpen = false;

  document.body.classList.toggle('has-lyrics', has);
  document.body.classList.toggle('no-lyrics', noLyrics);
  document.body.classList.toggle('lyrics-open', lyricsOpen && !noLyrics);
  syncLyricsToggle();
  if (!(has && lyricsOpen)) clearWordGlow();
}

function toggleLyrics() {
  if (!trackHasLyrics(currentTrack())) return;
  lyricsOpen = !lyricsOpen;
  syncPlayerView();
  requestViewportGlow();
}

function coverCrossOrigin(url) {
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return null;
  try {
    const u = new URL(url, location.href);
    if (u.origin === location.origin) return null;
    return 'anonymous';
  } catch {
    return null;
  }
}

function showCover(url) {
  const { coverImg: img, coverPh: ph } = el;
  if (!img || !ph) return;
  if (url === coverUrl && img.classList.contains('loaded')) return;
  coverUrl = url || '';

  img.onload = null;
  img.onerror = null;
  img.classList.remove('loaded');

  el.cover?.classList.toggle('has-art', false);

  if (!url) {
    img.removeAttribute('src');
    img.hidden = true;
    ph.classList.remove('skelly');
    ph.style.background = '#141414';
    clearAmbiance();
    return;
  }

  ph.classList.add('skelly');
  ph.style.background = '#141414';

  const finish = () => {
    img.classList.add('loaded');
    img.hidden = false;
    ph.classList.remove('skelly');
    ph.style.background = 'transparent';
    el.cover?.classList.add('has-art');
    setAmbianceFromImage(img);
  };

  const fail = () => {
    img.classList.remove('loaded');
    img.hidden = true;
    ph.classList.remove('skelly');
    ph.style.background = '#141414';
    el.cover?.classList.remove('has-art');
    clearAmbiance();
  };

  img.onload = finish;
  img.onerror = fail;
  const crossOrigin = coverCrossOrigin(url);
  if (crossOrigin) img.crossOrigin = crossOrigin;
  else img.removeAttribute('crossorigin');
  img.hidden = false;
  img.src = url;
  if (img.complete && img.naturalWidth > 0) finish();
}

export function renderCover() {
  const t = currentTrack();
  if (!t) {
    lastCoverId = null;
    lastCoverNonce = -1;
    showCover(null);
    return;
  }
  if (t.pictureUrl) {
    lastCoverId = t.id;
    lastCoverNonce = state.coverNonce;
    showCover(t.pictureUrl);
    return;
  }
  const fresh = lastCoverId !== t.id || lastCoverNonce !== state.coverNonce;
  lastCoverId = t.id;
  lastCoverNonce = state.coverNonce;
  showCover(pickRandomCover(t, { fresh }));
}

function cacheLyricWords() {
  lyricWords = el.lyrics ? [...el.lyrics.querySelectorAll('.lyrics-word')] : [];
  requestViewportGlow();
}

function maybeAutoLyrics(t) {
  if (!t || !getSettings().lyricsWithSong || !trackHasLyrics(t)) return;
  if (autoLyricsFor === t.id) return;
  autoLyricsFor = t.id;
  lyricsOpen = true;
}

export function renderLyrics() {
  const root = el.lyrics;
  if (!root) return;
  lastLyricIndex = -1;
  const t = currentTrack();
  maybeAutoLyrics(t);
  syncPlayerView();

  if (!trackHasLyrics(t)) {
    root.innerHTML = '';
    setGlowMode(false);
    lyricWords = [];
    el.spot?.classList.remove('on');
    return;
  }

  const { synced, plain } = t.lyrics;

  if (synced?.length) {
    root.classList.add('lyrics-glowable');
    setGlowMode(true);
    const active = lineAt(synced, state.seek);
    lastLyricIndex = active?.index ?? -1;
    root.innerHTML = synced.map((l, i) =>
      `<p class="lyric-line${i === lastLyricIndex ? ' active' : ''}">${wrapLyricWords(l.text)}</p>`
    ).join('');
    cacheLyricWords();
    const activeEl = lastLyricIndex >= 0 ? root.children[lastLyricIndex] : null;
    activeEl?.scrollIntoView({ block: 'center', behavior: 'instant' });
    requestViewportGlow();
  } else if (plain?.trim()) {
    root.classList.add('lyrics-glowable');
    setGlowMode(true);
    root.innerHTML = plain.split('\n').map((line) =>
      `<p class="lyric-line">${line.trim() ? wrapLyricWords(line) : '&nbsp;'}</p>`
    ).join('');
    cacheLyricWords();
    requestViewportGlow();
  } else {
    root.classList.remove('lyrics-glowable');
    setGlowMode(false);
    root.innerHTML = '';
    lyricWords = [];
    el.spot?.classList.remove('on');
  }
}

function updateActiveLyricLine() {
  const t = currentTrack();
  const synced = t?.lyrics?.synced;
  const root = el.lyrics;
  if (!root || !synced?.length) return;

  const idx = lineAt(synced, state.seek)?.index ?? -1;
  if (idx === lastLyricIndex) return;

  if (lastLyricIndex >= 0) root.children[lastLyricIndex]?.classList.remove('active');
  const next = idx >= 0 ? root.children[idx] : null;
  next?.classList.add('active');
  lastLyricIndex = idx;

  if (next) {
    const pr = root.getBoundingClientRect();
    const nr = next.getBoundingClientRect();
    if (nr.top < pr.top + 24 || nr.bottom > pr.bottom - 24) {
      next.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }
  requestViewportGlow();
}

function updateSeek() {
  if (el.fill) {
    const pct = state.duration > 0 ? state.seek / state.duration : 0;
    el.fill.style.transform = `scaleX(${pct})`;
  }
  const sec = Math.floor(state.seek || 0);
  if (sec !== lastSeekSec && el.timeCur) {
    lastSeekSec = sec;
    el.timeCur.textContent = formatTime(state.seek);
  }
  const dsec = Math.floor(state.duration || 0);
  if (dsec !== lastDurSec && el.timeEnd) {
    lastDurSec = dsec;
    el.timeEnd.textContent = formatTime(state.duration);
  }
}

export function renderPlayer() {
  const t = currentTrack();
  const title = t ? t.title : 'title goes here';
  const artist = t ? t.artist : 'artist goes here';

  if (el.title && title !== lastTitle) {
    lastTitle = title;
    el.title.textContent = title;
  }
  if (el.artist && artist !== lastArtist) {
    lastArtist = artist;
    el.artist.textContent = artist;
  }

  updateSeek();

  const playing = !!state.playing;
  if (el.playIcon && playing !== lastPlaying) {
    lastPlaying = playing;
    el.playIcon.classList.toggle('ph-play', !playing);
    el.playIcon.classList.toggle('ph-pause', playing);
  }
}

export function renderAll() {
  renderCover();
  renderLyrics();
  renderPlayer();
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function uiRgb() {
  return getComputedStyle(document.documentElement)
    .getPropertyValue('--ui-rgb')
    .split(',')
    .map((n) => Number(n.trim()) || 0);
}

function wordKeepsActiveColor(word) {
  return !!word.closest('.lyric-line.active');
}

function paintWordGlow(word, t, keepColor = false, rgb) {
  if (t < 0.03) {
    word.style.textShadow = '';
    if (!keepColor) word.style.color = '';
    return;
  }
  const [ur, ug, ub] = rgb || uiRgb();
  const blur = 8 + t * 24;
  word.style.textShadow = `0 0 ${blur}px rgba(${ur},${ug},${ub},${t * 0.55})`;
  if (keepColor) {
    word.style.color = '';
    return;
  }
  const d = 85;
  word.style.color = `rgb(${Math.round(d + t * (ur - d))},${Math.round(d + t * (ug - d))},${Math.round(d + t * (ub - d))})`;
}

function isTouchGlow() {
  return window.matchMedia('(hover: none), (max-width: 700px)').matches;
}

function paintSpotlight() {
  spotRaf = 0;
  const { lyrics: root, spot } = el;
  if (!lyricsVisible() || !lyricWords.length) {
    clearWordGlow();
    return;
  }

  if (spot) {
    spot.style.transform = `translate(${spotX}px, ${spotY}px) translate(-50%, -50%)`;
    spot.classList.add('on');
  }

  glowLit = true;
  const rgb = uiRgb();
  const pr = root.getBoundingClientRect();
  for (const word of lyricWords) {
    const rect = word.getBoundingClientRect();
    if (rect.bottom < pr.top || rect.top > pr.bottom) {
      paintWordGlow(word, 0, wordKeepsActiveColor(word), rgb);
      continue;
    }
    const dist = Math.hypot(spotX - (rect.left + rect.width / 2), spotY - (rect.top + rect.height / 2));
    paintWordGlow(word, smoothstep(Math.max(0, 1 - dist / SPOT_RADIUS)), wordKeepsActiveColor(word), rgb);
  }
}

function paintViewportGlow() {
  glowRaf = 0;
  const { lyrics: root, spot } = el;
  if (!lyricsVisible() || !lyricWords.length) {
    clearWordGlow();
    return;
  }

  const pr = root.getBoundingClientRect();
  if (pr.height < 2) {
    clearWordGlow();
    return;
  }
  const midX = (pr.left + pr.right) / 2;
  const midY = (pr.top + pr.bottom) / 2;
  const halfH = pr.height / 2;

  if (spot) {
    spot.style.transform = `translate(${midX}px, ${midY}px) translate(-50%, -50%)`;
    spot.classList.add('on');
  }

  glowLit = true;
  const rgb = uiRgb();
  for (const word of lyricWords) {
    const rect = word.getBoundingClientRect();
    const visible = Math.max(0, Math.min(rect.bottom, pr.bottom) - Math.max(rect.top, pr.top));
    const vis = visible / Math.max(rect.height, 1);
    const keepColor = wordKeepsActiveColor(word);
    if (vis <= 0) {
      paintWordGlow(word, 0, keepColor, rgb);
      continue;
    }
    const cy = rect.top + rect.height / 2;
    const falloff = smoothstep(Math.max(0, 1 - Math.abs(cy - midY) / halfH));
    paintWordGlow(word, vis * falloff * 0.85, keepColor, rgb);
  }
}

function requestViewportGlow() {
  if (!isTouchGlow()) return;
  if (!glowRaf) glowRaf = requestAnimationFrame(paintViewportGlow);
}

function requestHoverGlow() {
  if (isTouchGlow()) return;
  if (!spotRaf) spotRaf = requestAnimationFrame(paintSpotlight);
}

function initLyricsSpotlight() {
  const root = el.lyrics;
  if (!root) return;

  document.addEventListener('mousemove', (e) => {
    if (isTouchGlow()) return;
    if (!pointerInLyrics(e.clientX, e.clientY)) {
      clearWordGlow();
      return;
    }
    spotX = e.clientX;
    spotY = e.clientY;
    requestHoverGlow();
  }, { passive: true });

  root.addEventListener('scroll', () => {
    requestViewportGlow();
    if (!isTouchGlow() && pointerInLyrics(spotX, spotY)) requestHoverGlow();
  }, { passive: true });
  window.addEventListener('resize', requestViewportGlow, { passive: true });
  window.visualViewport?.addEventListener('resize', requestViewportGlow, { passive: true });
  window.visualViewport?.addEventListener('scroll', requestViewportGlow, { passive: true });
  requestViewportGlow();
}

export async function initUI() {
  cacheEls();
  await loadCovers();
  initDragScroll(el.lyrics);
  initLyricsSpotlight();
  el.lyricsToggle?.addEventListener('click', toggleLyrics);
  on('track', renderAll);
  on('play', renderPlayer);
  let lyricTick = 0;
  on('tick', () => {
    updateSeek();
    const now = performance.now();
    if (now - lyricTick < 200) return;
    lyricTick = now;
    updateActiveLyricLine();
  });
  on('lyrics', (trackId) => {
    if (trackId && trackId !== state.currentId) return;
    renderLyrics();
  });
  on('panel', () => {
    syncPlayerView();
    requestViewportGlow();
  });
  on('radio', requestViewportGlow);
  on('library', () => {
    if (state.currentId) renderCover();
    if (!state.currentId && state.tracks.length) {
      import('./player.js').then((m) => {
        const ids = shuffleSpreadArtists(state.tracks.map((tr) => tr.id));
        const start = pickAvoidingRecent(ids) || ids[0];
        state.queue = ids;
        state.queueIndex = Math.max(0, ids.indexOf(start));
        m.cueTrack(start);
      });
    }
  });
  renderAll();
}
