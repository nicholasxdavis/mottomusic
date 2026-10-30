import { state, on } from './state.js';
import { searchTracks } from './library.js';
import { playFromList } from './player.js';
import { pickRandomCover } from './covers.js';
import { openTrackMenu, isMenuEvent } from './menu.js';
import { initDragScroll } from './drag-scroll.js';

let open = false;
let activeIndex = 0;
let results = [];

function $(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function highlight(i) {
  const el = $('search-results');
  if (!el) return;
  el.querySelector('.search-row.on')?.classList.remove('on');
  const row = el.querySelector(`[data-i="${i}"]`);
  row?.classList.add('on');
  row?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

function renderResults() {
  const input = $('search-input');
  const el = $('search-results');
  if (!el) return;

  const q = input?.value || '';
  results = searchTracks(q);
  activeIndex = results.length ? Math.min(activeIndex, results.length - 1) : 0;

  if (!state.tracks.length) {
    el.innerHTML = state.ready
      ? `<p class="search-empty">No music found</p>`
      : `<div class="skelly-queue">
          <div class="skelly-row"><span class="skelly sq"></span><span class="skelly"></span></div>
          <div class="skelly-row"><span class="skelly sq"></span><span class="skelly"></span></div>
        </div>`;
    return;
  }

  if (!results.length) {
    el.innerHTML = `<p class="search-empty">No results for "${esc(q)}"</p>`;
    return;
  }

  el.innerHTML = results.map((t, i) => {
    const art = t.pictureUrl || pickRandomCover(t);
    const on = i === activeIndex ? ' on' : '';
    const playing = t.id === state.currentId ? ' playing' : '';
    return `<div class="search-row${on}${playing}" data-i="${i}">
      <button type="button" class="search-main" data-i="${i}">
        <span class="search-art"><img src="${esc(art)}" alt="" loading="lazy" /></span>
        <span class="search-info">
          <span class="search-title">${esc(t.title)}</span>
          <span class="search-artist">${esc(t.artist)}</span>
        </span>
      </button>
      <button type="button" class="more-btn" data-i="${i}" aria-label="More">
        <i class="ph ph-dots-three-vertical"></i>
      </button>
    </div>`;
  }).join('');
}

function playIndex(i) {
  const track = results[i];
  if (!track) return;
  playFromList(results.map((t) => t.id), track.id);
  closeSearch();
}

function isMobile() {
  return window.matchMedia('(max-width: 700px)').matches;
}

function placePanel(panel) {
  const dropdown = $('search-dropdown');
  if (!panel || !dropdown) return;
  if (isMobile()) {
    if (panel.parentElement !== document.body) document.body.appendChild(panel);
  } else if (panel.parentElement !== dropdown) {
    dropdown.appendChild(panel);
  }
}

export function openSearch() {
  const panel = $('search-panel');
  const dropdown = $('search-dropdown');
  const btn = $('btn-search');
  if (!panel || open) return;
  open = true;
  activeIndex = 0;
  placePanel(panel);
  dropdown?.classList.add('open');
  btn?.setAttribute('aria-expanded', 'true');
  document.body.classList.add('search-open');
  renderResults();
  panel.classList.add('on');
  const input = $('search-input');
  input?.focus({ preventScroll: true });
  input?.select();
}

export function closeSearch() {
  const panel = $('search-panel');
  const dropdown = $('search-dropdown');
  const btn = $('btn-search');
  if (!panel || !open) return;
  open = false;
  panel.classList.remove('on');
  dropdown?.classList.remove('open');
  btn?.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('search-open');
  const input = $('search-input');
  if (input) input.value = '';
  activeIndex = 0;
  if (dropdown && panel.parentElement !== dropdown && !isMobile()) {
    dropdown.appendChild(panel);
  }
}

export function toggleSearch() {
  if (open) closeSearch();
  else openSearch();
}

function playFromSearchEvent(e) {
  if (e.target.closest('.more-btn')) return false;
  const row = e.target.closest('.search-row');
  if (!row) return false;
  const i = Number(row.dataset.i);
  if (Number.isNaN(i)) return false;
  playIndex(i);
  return true;
}

export function initSearch() {
  const dropdown = $('search-dropdown');
  const input = $('search-input');
  const resultsEl = $('search-results');
  initDragScroll(resultsEl, { ignore: '.more-btn' });

  $('btn-search')?.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });
  $('btn-search')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSearch();
  });
  const closeIfOutside = (e) => {
    if (!open) return;
    const panel = $('search-panel');
    if (dropdown?.contains(e.target) || panel?.contains(e.target) || isMenuEvent(e.target)) return;
    closeSearch();
  };
  document.addEventListener('pointerdown', closeIfOutside);

  input?.addEventListener('input', () => {
    activeIndex = 0;
    renderResults();
  });

  resultsEl?.addEventListener('click', (e) => {
    const more = e.target.closest('.more-btn');
    if (more) {
      e.preventDefault();
      e.stopPropagation();
      const i = Number(more.dataset.i);
      const track = results[i];
      if (!track) return;
      openTrackMenu(more, {
        source: 'search',
        id: track.id,
        ids: results.map((t) => t.id),
      });
      return;
    }
    playFromSearchEvent(e);
  });

  document.addEventListener('keydown', (e) => {
    if (!open) {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
        e.preventDefault();
        openSearch();
      }
      return;
    }

    if (e.code === 'Escape') {
      e.preventDefault();
      closeSearch();
      return;
    }

    if (!results.length) return;

    if (e.code === 'ArrowDown') {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, results.length - 1);
      highlight(activeIndex);
    } else if (e.code === 'ArrowUp') {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlight(activeIndex);
    } else if (e.code === 'Enter') {
      e.preventDefault();
      playIndex(activeIndex);
    }
  });

  on('library', () => {
    if (open) renderResults();
  });

  on('track', () => {
    if (open) renderResults();
  });
}
