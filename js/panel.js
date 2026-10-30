import { state, emit } from './state.js';
import { renderQueue } from './queue.js';
import { signOut } from './auth.js';

import { renderManagement } from './management.js';

const PANEL_IDS = ['lyrics', 'studio', 'queue', 'management'];

export function getActivePanel() {
  return state.panel;
}

export function setPanel(id) {
  if (!id || !PANEL_IDS.includes(id) || id === state.panel) return;
  state.panel = id;
  emit('panel', id);

  document.querySelectorAll('.panel-tab[data-tab]').forEach((t) => {
    const on = t.dataset.tab === id;
    t.classList.toggle('on', on);
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  PANEL_IDS.forEach((key) => {
    const pane = document.getElementById(`panel-${key}`);
    if (!pane) return;
    const on = key === id;
    pane.classList.toggle('on', on);
    pane.hidden = !on;
  });

  if (id === 'queue') renderQueue();
  if (id === 'management') renderManagement();
}

export function initPanel() {
  const dock = document.getElementById('brand-dock');

  document.querySelectorAll('.panel-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.action === 'signout') {
        signOut();
        dock?.classList.remove('open');
        return;
      }
      setPanel(tab.dataset.tab);
    });
  });

  dock?.addEventListener('click', (e) => {
    if (e.target.closest('.panel-tab')) return;
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    dock.classList.toggle('open');
  });

  document.addEventListener('pointerdown', (e) => {
    if (!dock?.classList.contains('open')) return;
    if (dock.contains(e.target)) return;
    dock.classList.remove('open');
  });

  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (e.target.matches('input, textarea')) return;
    const map = {
      Digit1: 'lyrics', Numpad1: 'lyrics',
      Digit2: 'studio', Numpad2: 'studio',
      Digit3: 'queue', Numpad3: 'queue',
    };
    const id = map[e.code];
    if (!id) return;
    e.preventDefault();
    setPanel(id);
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      dock?.classList.add('open');
    }
  });
}
