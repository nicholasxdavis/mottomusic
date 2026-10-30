import { state, emit, getTrack } from './state.js';
import { playFromList } from './player.js';
import { pickRandomCover } from './covers.js';
import { openTrackMenu } from './menu.js';
import { initDragScroll } from './drag-scroll.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let lastKey = '';
let drag = null;

export function renderQueue() {
  const el = document.getElementById('queue');
  if (!el) return;
  if (state.panel !== 'queue' && lastKey) return;
  if (drag) return;

  if (!state.ready && !state.queue.length) {
    lastKey = 'skelly';
    el.innerHTML = `<div class="skelly-queue">
      <div class="skelly-row"><span class="skelly sq"></span><span class="skelly"></span></div>
      <div class="skelly-row"><span class="skelly sq"></span><span class="skelly"></span></div>
      <div class="skelly-row"><span class="skelly sq"></span><span class="skelly w2"></span></div>
    </div>`;
    return;
  }

  if (!state.queue.length) {
    lastKey = 'empty';
    el.innerHTML = '<p class="queue-empty">Nothing queued</p>';
    return;
  }

  const now = Math.max(0, state.queueIndex);
  const key = `${now}|${state.queue.join(',')}|${state.currentId}`;
  if (key === lastKey) return;
  lastKey = key;

  el.innerHTML = state.queue.map((id, i) => {
    const t = getTrack(id);
    if (!t) return '';
    const art = t.pictureUrl || pickRandomCover(t);
    return `<div class="queue-row${i === now ? ' now' : ''}" data-idx="${i}">
      <img src="${esc(art)}" alt="" />
      <button type="button" class="queue-main" data-idx="${i}">
        <b>${esc(t.title)}</b>
        <i>${esc(t.artist)}</i>
      </button>
      <button type="button" class="more-btn" data-idx="${i}" aria-label="More">
        <i class="ph ph-dots-three-vertical"></i>
      </button>
    </div>`;
  }).join('');
}

function rowFromPoint(el, y) {
  const rows = [...el.querySelectorAll('.queue-row')];
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) return row;
  }
  if (!rows.length) return null;
  return y < rows[0].getBoundingClientRect().top ? rows[0] : rows[rows.length - 1];
}

function moveQueueItem(from, to) {
  if (from === to || from < 0 || to < 0) return;
  if (from >= state.queue.length || to >= state.queue.length) return;
  const id = state.queue.splice(from, 1)[0];
  state.queue.splice(to, 0, id);
  if (state.currentId) state.queueIndex = state.queue.indexOf(state.currentId);
  lastKey = '';
  emit('queue');
}

export function initQueue() {
  const el = document.getElementById('queue');
  if (!el) return;

  initDragScroll(el, { ignore: '.queue-row, .more-btn' });

  el.addEventListener('click', (e) => {
    const more = e.target.closest('.more-btn');
    if (more) {
      e.preventDefault();
      e.stopPropagation();
      const idx = Number(more.dataset.idx);
      const id = state.queue[idx];
      if (!id) return;
      openTrackMenu(more, { source: 'queue', id, idx });
      return;
    }
  });

  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.more-btn')) return;
    const row = e.target.closest('.queue-row');
    if (!row) return;
    const idx = Number(row.dataset.idx);
    if (!Number.isFinite(idx)) return;
    drag = {
      from: idx,
      idx,
      y: e.clientY,
      x: e.clientX,
      moved: false,
      row,
      pointerId: e.pointerId,
      canDrag: true,
    };
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    drag.moved = true;
    if (!drag.row.classList.contains('dragging')) {
      drag.row.classList.add('dragging');
      try { drag.row.setPointerCapture(drag.pointerId); } catch {}
    }
    const over = rowFromPoint(el, e.clientY);
    if (!over || over === drag.row) return;
    const to = Number(over.dataset.idx);
    if (!Number.isFinite(to) || to === drag.idx) return;
    const parent = drag.row.parentElement;
    if (to > drag.idx) parent.insertBefore(over, drag.row);
    else parent.insertBefore(drag.row, over);
    [...parent.querySelectorAll('.queue-row')].forEach((r, i) => { r.dataset.idx = String(i); });
    drag.idx = Number(drag.row.dataset.idx);
  });

  const endDrag = (e) => {
    if (!drag) return;
    const { moved, from, row, idx } = drag;
    row.classList.remove('dragging');
    try { row.releasePointerCapture(drag.pointerId); } catch {}
    drag = null;
    if (moved) {
      moveQueueItem(from, idx);
      lastKey = '';
      renderQueue();
      return;
    }
    if (e.target.closest?.('.more-btn')) return;
    const playIdx = Number(row.dataset.idx);
    if (playIdx < 0 || playIdx >= state.queue.length) return;
    playFromList(state.queue, state.queue[playIdx]);
  };

  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', () => {
    if (!drag) return;
    drag.row.classList.remove('dragging');
    drag = null;
    lastKey = '';
    renderQueue();
  });

  renderQueue();
}
