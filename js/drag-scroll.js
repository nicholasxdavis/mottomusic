const DEFAULT_IGNORE = 'button, input, textarea, a, label, .more-btn, .mgmt-join, .mgmt-restore, .mgmt-radio-btn, .mgmt-view-removed, .mgmt-more-btn';

export function initDragScroll(el, { ignore = DEFAULT_IGNORE, threshold = 8 } = {}) {
  if (!el || el.dataset.dragScroll === '1') return;
  el.dataset.dragScroll = '1';

  let dragging = false;
  let moved = false;
  let startY = 0;
  let startScroll = 0;
  let pointerId = null;

  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (ignore && e.target.closest(ignore)) return;
    dragging = true;
    moved = false;
    startY = e.clientY;
    startScroll = el.scrollTop;
    pointerId = e.pointerId;
  });

  el.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dy) < threshold) return;
    if (!moved) {
      moved = true;
      el.classList.add('is-dragging');
      try {
        el.setPointerCapture(pointerId);
      } catch {}
    }
    el.scrollTop = startScroll - dy;
    e.preventDefault();
  });

  const endDrag = (e) => {
    if (!dragging || (e.pointerId != null && e.pointerId !== pointerId)) return;
    dragging = false;
    el.classList.remove('is-dragging');
    if (moved) el.dataset.suppressClick = '1';
    try {
      el.releasePointerCapture(pointerId);
    } catch {}
    pointerId = null;
  };

  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  el.addEventListener(
    'click',
    (e) => {
      if (!el.dataset.suppressClick) return;
      delete el.dataset.suppressClick;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}
