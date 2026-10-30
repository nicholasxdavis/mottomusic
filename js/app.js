import { state, on, emit, currentTrack } from './state.js';

import { initPlayer, initMediaSession, togglePlay, next, prev, seekTo, unlockAudio } from './player.js';

import { initLibrary, loadBuiltinLibrary, restoreFolder } from './library.js';

import { loadLyricsForTrack } from './lyrics.js';

import { initUI } from './ui.js';

import { initCursor } from './cursor.js';

import { initSearch } from './search.js';

import { initPanel } from './panel.js';

import { initStudio } from './studio.js';

import { initQueue, renderQueue } from './queue.js';

import { initTrackMenu } from './menu.js';

import { loadRadioConfig, selectRadioStation } from './radio.js';

import { loadSettings } from './settings.js';

import { requireAuth } from './auth.js';

import { initManagement } from './management.js';



function unlock() {

  unlockAudio();

}



function syncChrome() {

  document.body.classList.toggle('panel-lyrics', state.panel === 'lyrics');

  document.body.classList.toggle('panel-studio', state.panel === 'studio');

  document.body.classList.toggle('panel-queue', state.panel === 'queue');

  document.body.classList.toggle('panel-management', state.panel === 'management');

}



function onTrackChange() {
  const t = currentTrack();
  if (!t) return;
  const l = t.lyrics;
  if (l?.source && l.source !== 'none' && (l.synced?.length || l.plain?.trim())) return;
  loadLyricsForTrack(t);
}



function initRadios() {

  document.querySelectorAll('.radio-btn[data-radio]').forEach((btn) => {

    btn.addEventListener('click', () => {

      selectRadioStation(btn.dataset.radio);

    });

  });

}



function initSeekBar() {

  const seekTrack = $('seek-track');

  if (!seekTrack) return;



  let seeking = false;



  const ratioFromEvent = (e) => {

    const rect = seekTrack.getBoundingClientRect();

    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

  };



  const seekFromEvent = (e) => {

    seekTo(ratioFromEvent(e) * (state.duration || 0));

  };



  seekTrack.addEventListener('pointerdown', (e) => {

    seeking = true;

    seekTrack.classList.add('seeking');

    seekTrack.setPointerCapture(e.pointerId);

    seekFromEvent(e);

  });



  seekTrack.addEventListener('pointermove', (e) => {

    if (!seeking) return;

    seekFromEvent(e);

  });



  const endSeek = () => {

    seeking = false;

    seekTrack.classList.remove('seeking');

  };



  seekTrack.addEventListener('pointerup', endSeek);

  seekTrack.addEventListener('pointercancel', endSeek);

}



export async function boot() {

  initLibrary();

  initPlayer();

  initMediaSession();

  await loadRadioConfig();

  await loadSettings();

  await initUI();

  initCursor();

  initSearch();

  initTrackMenu();

  initPanel();

  initStudio();

  initQueue();

  initManagement();

  initSeekBar();

  initRadios();



  on('queue', renderQueue);

  on('track', renderQueue);



  syncChrome();

  on('panel', syncChrome);



  document.body.addEventListener('pointerdown', unlock, { once: true });

  document.body.addEventListener('touchstart', unlock, { once: true, passive: true });

  document.body.addEventListener('keydown', unlock, { once: true });



  $('btn-play')?.addEventListener('click', () => togglePlay());

  $('btn-prev')?.addEventListener('click', () => prev());

  $('btn-next')?.addEventListener('click', () => next(true));



  document.addEventListener('keydown', (e) => {

    if (document.body.classList.contains('search-open')) return;

    if (e.target.matches('input, textarea')) return;

    if (e.code === 'Space') {

      e.preventDefault();

      togglePlay();

    }

    if (e.code === 'ArrowRight') next(true);

    if (e.code === 'ArrowLeft') prev();

  });



  on('track', onTrackChange);

  await loadBuiltinLibrary();

  restoreFolder();

}



function $(id) {

  return document.getElementById(id);

}



requireAuth().then(() => boot());


