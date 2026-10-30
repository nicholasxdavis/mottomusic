const DEFAULTS = [
  [72, 62, 52],
  [58, 54, 50],
  [84, 70, 58],
  [48, 46, 44],
];

let lastKey = '';

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function sample(img) {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ranked: [], luma: 0 };
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const buckets = new Map();
  let lumSum = 0;
  let lumN = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 200) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    lumSum += lum;
    lumN += 1;
    if (lum < 0.07 || lum > 0.93) continue;
    if (sat < 0.1) continue;
    const key = `${r >> 4},${g >> 4},${b >> 4}`;
    const cur = buckets.get(key);
    if (cur) {
      cur.n += 1;
      cur.r += r;
      cur.g += g;
      cur.b += b;
    } else {
      buckets.set(key, { n: 1, r, g, b });
    }
  }

  return {
    ranked: [...buckets.values()]
      .map((x) => ({ n: x.n, c: [x.r / x.n, x.g / x.n, x.b / x.n] }))
      .sort((a, b) => b.n - a.n),
    luma: lumN ? lumSum / lumN : 0,
  };
}

function pickDistinct(ranked, n = 4) {
  const picked = [];
  for (const minD of [88, 62, 42, 24]) {
    for (const item of ranked) {
      if (picked.every((p) => dist(p, item.c) > minD)) {
        picked.push(item.c);
        if (picked.length === n) return picked;
      }
    }
  }
  return picked;
}

function lift(c) {
  const l = luma(c);
  const target = Math.max(0.38, Math.min(0.78, l * 1.45 + 0.16));
  const mul = l < 0.02 ? 1 : target / l;
  return [
    Math.min(255, c[0] * mul + 18),
    Math.min(255, c[1] * mul + 16),
    Math.min(255, c[2] * mul + 14),
  ];
}

function fillToFour(colors) {
  const out = colors.map((c) => lift(c));
  let i = 0;
  while (out.length < 4) {
    const base = out[i % Math.max(out.length, 1)] || DEFAULTS[out.length];
    out.push(lift([
      Math.min(255, base[0] * 0.92 + 12),
      Math.min(255, base[1] * 0.92 + 10),
      Math.min(255, base[2] * 0.92 + 8),
    ]));
    i += 1;
  }
  return out.slice(0, 4);
}

function luma(c) {
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
}

function apply(colors) {
  const root = document.documentElement;
  colors.forEach((c, i) => {
    root.style.setProperty(
      `--amb${i + 1}`,
      `${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}`
    );
  });
  document.body.classList.toggle('has-ambiance', lastKey !== '');
  document.body.classList.remove('theme-light');
}

export function clearAmbiance() {
  lastKey = '';
  apply(DEFAULTS);
}

export function setAmbianceFromImage(img) {
  if (!img?.naturalWidth) {
    clearAmbiance();
    return;
  }
  const key = `${img.src}|${img.naturalWidth}x${img.naturalHeight}`;
  if (key === lastKey) return;
  try {
    const { ranked } = sample(img);
    lastKey = key;
    apply(fillToFour(pickDistinct(ranked)));
  } catch {
    clearAmbiance();
  }
}
