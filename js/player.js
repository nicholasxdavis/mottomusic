import { state, emit, getTrack, extOf, currentTrack } from './state.js';
import { setupAudioChain, applyFX, markAudioUnlocked, hookHtml5Howls } from './studio.js';
import { recordRecentPlay } from './recent.js';

function applyPlayFx() {
  if (!armed) return;
  setupAudioChain();
  hookHtml5Howls();
  applyFX();
}

let howl = null;
let raf = 0;
let armed = false;

function resumeCtx() {
  if (!armed) return;
  const Howler = window.Howler;
  if (!Howler) return;
  const ac = Howler.ctx;
  if (!ac || ac.state === 'closed') return;
  if (ac.state === 'suspended') {
    const p = ac.resume();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
}

export function unlockAudio() {
  if (armed) {
    resumeCtx();
    try { setupAudioChain(); } catch {}
    return;
  }
  armed = true;
  markAudioUnlocked();
  try { window.Howler.volume(1); } catch {}
  window.Howler?.ctx?.addEventListener?.('statechange', () => {
    if (window.Howler.ctx?.state === 'running') {
      try { setupAudioChain(); } catch {}
    }
  });
  resumeCtx();
  try { setupAudioChain(); } catch {}
}

export function initPlayer() {
  window.Howler.autoUnlock = true;
  window.Howler.autoSuspend = false;
  window.Howler.html5PoolSize = 2;
}

function teardown() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (howl) {
    try { howl.stop(); } catch {}
    try { howl.unload(); } catch {}
    howl = null;
  }
}

function startTick() {
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function stopTick() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

let lastTick = 0;

function tick(now) {
  if (!howl) return;
  if (now - lastTick >= 80) {
    lastTick = now;
    const seek = howl.seek();
    if (typeof seek === 'number' && isFinite(seek)) state.seek = seek;
    const d = howl.duration();
    if (d && isFinite(d)) state.duration = d;
    emit('tick');
  }
  if (state.playing) raf = requestAnimationFrame(tick);
}

function trackSrc(track) {
  if (track.src) return track.src;
  if (!track.url && track.file) track.url = URL.createObjectURL(track.file);
  return track.url;
}

function ensureQueue() {
  if (!state.queue.length && state.tracks.length) {
    state.queue = state.tracks.map((t) => t.id);
    const idx = state.currentId ? state.queue.indexOf(state.currentId) : -1;
    state.queueIndex = idx >= 0 ? idx : 0;
  }
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  const src = track.pictureUrl || track.fallbackCover;
  const art = src ? [{ src, sizes: '512x512' }] : [];
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album || '',
    artwork: art,
  });
  navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
}

export function initMediaSession() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.setActionHandler('play', () => togglePlay());
  navigator.mediaSession.setActionHandler('pause', () => togglePlay());
  navigator.mediaSession.setActionHandler('previoustrack', () => prev());
  navigator.mediaSession.setActionHandler('nexttrack', () => next(true));
  navigator.mediaSession.setActionHandler('seekto', (d) => {
    if (d.seekTime != null) seekTo(d.seekTime);
  });
}

export function cueTrack(id, { fromQueue = true } = {}) {
  const track = getTrack(id);
  if (!track) return;
  teardown();
  state.currentId = id;
  state.coverNonce = (state.coverNonce || 0) + 1;
  state.playing = false;
  state.buffering = false;
  state.seek = 0;
  state.duration = track.duration || 0;
  if (fromQueue) {
    ensureQueue();
    const qi = state.queue.indexOf(id);
    if (qi >= 0) state.queueIndex = qi;
  }
  emit('track');
  emit('queue');
  emit('play');
  updateMediaSession(track);
}

function makeHowl(src, track, html5) {
  return new window.Howl({
    src: [src],
    html5,
    preload: true,
    format: [extOf(track.name) || 'mp3'],
    volume: 1,
    onload() {
      applyPlayFx();
      const d = howl?.duration();
      if (d && isFinite(d)) {
        state.duration = d;
        track.duration = d;
      }
      state.buffering = false;
      emit('track');
    },
    onloaderror(_, err) {
      if (!html5) {
        const failed = howl;
        howl = null;
        try { failed?.unload(); } catch {}
        howl = makeHowl(src, track, true);
        if (armed) howl.play();
        return;
      }
      state.buffering = false;
      console.warn('loaderror', err);
      emit('track');
    },
    onplayerror() {
      resumeCtx();
      howl?.once('unlock', () => howl.play());
    },
    onplay() {
      applyPlayFx();
      state.playing = true;
      state.buffering = false;
      updateMediaSession(track);
      emit('play');
      startTick();
    },
    onend() {
      if (!advanceAfterEnd(false)) next(false);
    },
    onstop() {
      state.playing = false;
      stopTick();
      updateMediaSession(track);
      emit('play');
    },
    onpause() {
      state.playing = false;
      stopTick();
      updateMediaSession(track);
      emit('play');
    },
    onseek() {
      const seek = howl?.seek();
      if (typeof seek === 'number' && isFinite(seek)) {
        state.seek = seek;
        emit('tick');
      }
    },
  });
}

export async function playTrack(id, { fromQueue = true } = {}) {
  unlockAudio();
  const track = getTrack(id);
  if (!track) return;
  teardown();

  const src = trackSrc(track);
  if (!src) return;

  state.currentId = id;
  state.coverNonce = (state.coverNonce || 0) + 1;
  state.buffering = true;
  state.seek = 0;
  state.duration = track.duration || 0;
  emit('track');
  emit('queue');
  updateMediaSession(track);

  if (fromQueue) {
    ensureQueue();
    const qi = state.queue.indexOf(id);
    if (qi >= 0) state.queueIndex = qi;
  }

  howl = makeHowl(src, track, true);
  howl.play();
  recordRecentPlay(id);
  applyPlayFx();
}

export function togglePlay() {
  unlockAudio();
  ensureQueue();
  if (!howl) {
    const id = state.currentId || state.queue[0] || state.tracks[0]?.id;
    if (id) playTrack(id);
    return;
  }
  if (state.playing) {
    howl.pause();
  } else {
    howl.play();
  }
}

export function seekTo(sec) {
  if (!howl) return;
  const d = howl.duration() || state.duration;
  if (!d) return;
  const t = Math.max(0, Math.min(d, sec));
  howl.seek(t);
  state.seek = t;
  emit('tick');
}

function advanceAfterEnd(manual) {
  if (!manual && state.radio) {
    import('./radio.js').then(({ radioAdvance }) => {
      const radioId = radioAdvance();
      if (radioId) {
        const qi = state.queue.indexOf(radioId);
        if (qi >= 0) state.queueIndex = qi;
        playTrack(radioId);
        return;
      }
      next(false);
    });
    return true;
  }
  return false;
}

export function next(manual = true) {
  ensureQueue();
  if (!state.queue.length) return;
  if (!manual && advanceAfterEnd(false)) return;
  let i = state.queueIndex + 1;
  if (i >= state.queue.length) {
    if (!manual) {
      state.playing = false;
      stopTick();
      updateMediaSession(currentTrack());
      emit('play');
      return;
    }
    i = 0;
  }
  state.queueIndex = i;
  playTrack(state.queue[i]);
}

export function prev() {
  ensureQueue();
  if (howl && state.seek > 3) {
    seekTo(0);
    return;
  }
  if (!state.queue.length) return;
  let i = state.queueIndex - 1;
  if (i < 0) i = state.queue.length - 1;
  state.queueIndex = i;
  playTrack(state.queue[i]);
}

export function playFromList(ids, startId) {
  state.queue = ids.slice();
  const i = Math.max(0, ids.indexOf(startId));
  state.queueIndex = i;
  emit('queue');
  playTrack(ids[i]);
}

export function playNext(id) {
  if (!id) return;
  ensureQueue();
  const q = state.queue;
  const cur = Math.max(0, state.queueIndex);
  const existing = q.indexOf(id);
  if (existing === cur) return;
  if (existing >= 0) q.splice(existing, 1);
  const insertAt = Math.min((existing >= 0 && existing < cur ? cur : cur + 1), q.length);
  q.splice(insertAt, 0, id);
  if (state.currentId) state.queueIndex = q.indexOf(state.currentId);
  emit('queue');
}

export function addToQueue(id) {
  if (!id) return;
  ensureQueue();
  if (state.queue.includes(id)) return;
  state.queue.push(id);
  emit('queue');
}

export function removeFromQueue(index) {
  ensureQueue();
  if (index < 0 || index >= state.queue.length) return;
  const wasCurrent = index === state.queueIndex;
  state.queue.splice(index, 1);
  if (wasCurrent) {
    if (!state.queue.length) {
      state.queueIndex = -1;
      emit('queue');
      return;
    }
    const next = Math.min(index, state.queue.length - 1);
    state.queueIndex = next;
    playTrack(state.queue[next]);
    return;
  }
  if (index < state.queueIndex) state.queueIndex -= 1;
  emit('queue');
}
