import { playFromList, playNext, addToQueue, removeFromQueue } from './player.js';
import { state } from './state.js';

let menuEl = null;
let ctx = null;

function closeMenu() {
  if (!menuEl) return;
  menuEl.classList.remove('on');
  ctx = null;
}

function position(btn) {
  const r = btn.getBoundingClientRect();
  menuEl.style.left = '0px';
  menuEl.style.top = '0px';
  const mw = menuEl.offsetWidth || 168;
  const mh = menuEl.offsetHeight || 120;
  let left = r.right - mw;
  let top = r.bottom + 6;
  if (left < 8) left = 8;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

function onPick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || !ctx) return;
  const act = btn.dataset.act;
  const { id, idx, ids } = ctx;
  closeMenu();
  if (act === 'play') {
    if (ids?.length) playFromList(ids, id);
    else playFromList(state.queue.length ? state.queue : [id], id);
  } else if (act === 'next') {
    playNext(id);
  } else if (act === 'queue') {
    addToQueue(id);
  } else if (act === 'remove' && Number.isFinite(idx)) {
    removeFromQueue(idx);
  }
}

export function openTrackMenu(btn, context) {
  if (!menuEl || !btn) return;
  ctx = context;
  const queue = context.source === 'queue';
  const items = queue
    ? [['play', 'Play'], ['next', 'Play Next'], ['remove', 'Remove']]
    : [['play', 'Play'], ['next', 'Play Next'], ['queue', 'Add to Queue']];
  menuEl.innerHTML = items.map(([act, label]) => (
    `<button type="button" data-act="${act}">${label}</button>`
  )).join('');
  menuEl.classList.add('on');
  position(btn);
}

export function isMenuEvent(target) {
  return !!(menuEl?.contains(target) || target.closest?.('.more-btn'));
}

export function initTrackMenu() {
  if (menuEl) return;
  menuEl = document.createElement('div');
  menuEl.id = 'track-menu';
  menuEl.className = 'track-menu';
  menuEl.addEventListener('click', onPick);
  document.body.appendChild(menuEl);

  document.addEventListener('pointerdown', (e) => {
    if (!menuEl.classList.contains('on')) return;
    if (isMenuEvent(e.target)) return;
    closeMenu();
  });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);
}
