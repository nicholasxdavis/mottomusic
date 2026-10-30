function parseColor(cssColor) {
  const m = cssColor.match(/[\d.]+/g);
  if (!m || m.length < 3) return null;
  const [r, g, b] = m.map(Number);
  const a = m.length > 3 ? Number(m[3]) : 1;
  if (a < 0.08 || cssColor === 'transparent') return null;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return { lum, a };
}

function isTextEl(el) {
  if (!el || el.id === 'cursor-dot') return false;
  if (el.childElementCount === 0 && el.textContent?.trim()) return true;
  return el.matches('.lyrics-word, .lyric-line, .lyrics-empty, .lyrics-plain, .lyrics-toggle, .track-title, .track-artist, p, span, h1, pre');
}

function surfaceBrightness(x, y, dot) {
  if (dot) dot.style.visibility = 'hidden';
  const el = document.elementFromPoint(x, y);
  if (dot) dot.style.visibility = '';

  if (!el || el.id === 'cursor-dot') return 0;

  const style = getComputedStyle(el);

  if (isTextEl(el)) {
    const text = parseColor(style.color);
    if (text && text.lum > 0.38) return text.lum;
  }

  let node = el;
  while (node && node !== document.documentElement) {
    const bg = parseColor(getComputedStyle(node).backgroundColor);
    if (bg) return bg.lum;
    node = node.parentElement;
  }

  return 0;
}

function moveCursor(dot, x, y, bright) {
  dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
  dot.classList.add('on');
  if (bright != null) dot.classList.toggle('invert', bright > 0.38);
}

export function initCursor() {
  if (window.matchMedia('(pointer: coarse)').matches) return;
  if (window.matchMedia('(max-width: 700px)').matches) return;

  let dot = document.getElementById('cursor-dot');
  if (!dot) {
    dot = document.createElement('div');
    dot.id = 'cursor-dot';
    dot.className = 'cursor-dot';
    document.body.appendChild(dot);
  }

  if (dot.dataset.ready === '1') return;
  dot.dataset.ready = '1';

  let px = 0;
  let py = 0;
  let raf = 0;
  let lastSample = 0;
  const paint = (now) => {
    raf = 0;
    let bright = null;
    if (now - lastSample > 90) {
      lastSample = now;
      bright = surfaceBrightness(px, py, dot);
    }
    moveCursor(dot, px, py, bright);
  };
  const onMove = (e) => {
    if (document.body.classList.contains('locked')) return;
    px = e.clientX;
    py = e.clientY;
    if (!raf) raf = requestAnimationFrame(paint);
  };

  window.addEventListener('pointermove', onMove, { passive: true });

  document.documentElement.addEventListener('mouseleave', () => {
    dot.classList.remove('on');
  });
}
