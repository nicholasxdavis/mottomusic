import { initDragScroll } from './drag-scroll.js';

const STORAGE_KEY = 'motto-studio';

const fx = {
  volume: 100,
  bass: 0,
  mid: 0,
  treble: 0,
  boost: 0,
  drive: 0,
  filter: 0,
  pitch: 0,
  reverb: 0,
  delay: 0,
  punch: 0,
};

let nodes = null;
let hooked = false;
let nodesCtx = null;
let lastAudible = 100;
let unlocked = false;

export function markAudioUnlocked() {
  unlocked = true;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    if (typeof saved.boost === 'boolean') saved.boost = saved.boost ? 50 : 0;
    if (typeof saved.normalize === 'boolean') {
      saved.punch = saved.normalize ? 50 : 0;
      delete saved.normalize;
    }
    Object.assign(fx, saved);
    if (fx.volume > 0) lastAudible = fx.volume;
  } catch {}
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fx));
  } catch {}
}

function makeImpulse(ctx, seconds = 1.8, decay = 2.4) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

function makeDriveCurve(amount) {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = amount * 40;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = k === 0 ? x : ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}

function createNodes(ctx) {
  const input = ctx.createGain();
  const bass = ctx.createBiquadFilter();
  const mid = ctx.createBiquadFilter();
  const treble = ctx.createBiquadFilter();
  const filter = ctx.createBiquadFilter();
  const drive = ctx.createWaveShaper();
  const driveGain = ctx.createGain();
  const dry = ctx.createGain();
  const delay = ctx.createDelay(1.2);
  const delayFb = ctx.createGain();
  const delayWet = ctx.createGain();
  const conv = ctx.createConvolver();
  const revWet = ctx.createGain();
  const mix = ctx.createGain();
  const punch = ctx.createDynamicsCompressor();
  const out = ctx.createGain();

  bass.type = 'lowshelf';
  bass.frequency.value = 130;
  mid.type = 'peaking';
  mid.frequency.value = 1000;
  mid.Q.value = 0.9;
  treble.type = 'highshelf';
  treble.frequency.value = 4800;
  filter.type = 'lowpass';
  filter.frequency.value = 18000;
  filter.Q.value = 0.7;
  drive.curve = makeDriveCurve(0);
  drive.oversample = '2x';
  conv.buffer = makeImpulse(ctx);
  delay.delayTime.value = 0.26;
  delayFb.gain.value = 0.32;
  punch.threshold.value = 0;
  punch.knee.value = 10;
  punch.ratio.value = 1;
  punch.attack.value = 0.004;
  punch.release.value = 0.18;

  input.connect(bass);
  bass.connect(mid);
  mid.connect(treble);
  treble.connect(filter);
  filter.connect(drive);
  drive.connect(driveGain);

  driveGain.connect(dry);
  dry.connect(mix);

  driveGain.connect(delay);
  delay.connect(delayFb);
  delayFb.connect(delay);
  delay.connect(delayWet);
  delayWet.connect(mix);

  driveGain.connect(conv);
  conv.connect(revWet);
  revWet.connect(mix);

  mix.connect(punch);
  punch.connect(out);

  return {
    input, bass, mid, treble, filter, drive, driveGain,
    dry, delay, delayFb, delayWet, conv, revWet, mix, punch, out,
  };
}

function hookMaster() {
  const Howler = window.Howler;
  const ctx = Howler?.ctx;
  if (!unlocked || !ctx || ctx.state === 'closed' || !Howler.masterGain) return false;
  if (ctx.state === 'suspended') {
    const p = ctx.resume();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  if (nodes && nodesCtx !== ctx) {
    nodes = null;
    hooked = false;
  }
  if (!nodes) {
    try {
      nodes = createNodes(ctx);
      nodesCtx = ctx;
    } catch {
      return false;
    }
  }

  try { Howler.masterGain.disconnect(); } catch {}
  try { nodes.out.disconnect(); } catch {}
  try {
    Howler.masterGain.connect(nodes.input);
    nodes.out.connect(ctx.destination);
  } catch {
    return false;
  }
  hooked = true;
  applyFX();
  return true;
}

export function setupAudioChain() {
  if (!unlocked) return false;
  const Howler = window.Howler;
  if (!Howler) return false;
  Howler.autoSuspend = false;
  const ctx = Howler.ctx;
  if (!ctx || ctx.state === 'closed') return false;
  if (ctx.state === 'suspended') {
    const p = ctx.resume();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }
  const ok = hookMaster();
  hookHtml5Howls();
  return ok;
}

export function hookHtml5Howls() {
  if (!unlocked || !nodes) return;
  const ctx = window.Howler?.ctx;
  if (!ctx || ctx.state === 'closed') return;
  const howls = window.Howler._howls || [];
  for (const h of howls) {
    for (const s of h._sounds || []) {
      const node = s._node;
      if (!node || node._mottoFx) continue;
      if (!node.tagName || (node.tagName !== 'AUDIO' && node.tagName !== 'VIDEO')) continue;
      try {
        const src = ctx.createMediaElementSource(node);
        src.connect(nodes.input);
        node._mottoFx = true;
      } catch {}
    }
  }
}

function applyPitch() {
  const rate = Math.pow(2, fx.pitch / 12);
  const howls = window.Howler?._howls || [];
  for (const h of howls) {
    try { h.rate(rate); } catch {}
  }
}

export function applyFX() {
  if (!nodes) return;
  const t = nodes.input.context.currentTime;
  const boostMul = 1 + (fx.boost / 100) * 0.55;
  nodes.out.gain.setTargetAtTime((fx.volume / 100) * boostMul, t, 0.02);
  nodes.bass.gain.setTargetAtTime(fx.bass, t, 0.03);
  nodes.mid.gain.setTargetAtTime(fx.mid, t, 0.03);
  nodes.treble.gain.setTargetAtTime(fx.treble, t, 0.03);
  const cutHz = 400 + (1 - fx.filter / 100) * 17600;
  nodes.filter.frequency.setTargetAtTime(cutHz, t, 0.04);
  nodes.drive.curve = makeDriveCurve(fx.drive / 100);
  nodes.driveGain.gain.setTargetAtTime(1 + (fx.drive / 100) * 0.15, t, 0.03);
  nodes.revWet.gain.setTargetAtTime(fx.reverb / 100, t, 0.05);
  nodes.delayWet.gain.setTargetAtTime(fx.delay / 100 * 0.7, t, 0.05);
  nodes.delayFb.gain.setTargetAtTime(0.18 + (fx.delay / 100) * 0.42, t, 0.05);
  const dry = Math.max(0.35, 1 - fx.reverb / 100 * 0.45 - fx.delay / 100 * 0.2);
  nodes.dry.gain.setTargetAtTime(dry, t, 0.05);
  nodes.punch.ratio.setTargetAtTime(1 + (fx.punch / 100) * 7, t, 0.04);
  nodes.punch.threshold.setTargetAtTime(fx.punch > 0 ? -22 : 0, t, 0.04);
  applyPitch();
  syncPlayerVolume();
  syncDials();
}

export function setVolume(val) {
  fx.volume = Math.max(0, Math.min(150, val));
  if (fx.volume > 0) lastAudible = fx.volume;
  applyFX();
  save();
}

export function toggleMute() {
  if (fx.volume > 0) {
    lastAudible = fx.volume;
    setVolume(0);
  } else {
    setVolume(lastAudible || 100);
  }
}

export function syncPlayerVolume() {
  const slider = document.getElementById('vol-slider');
  if (!slider) return;
  slider.value = fx.volume;
  slider.style.setProperty('--pct', `${pct(fx.volume, 0, 150)}%`);
  const icon = document.querySelector('.vol-icon');
  if (icon) {
    icon.classList.remove('ph-speaker-high', 'ph-speaker-low', 'ph-speaker-none');
    if (fx.volume === 0) icon.classList.add('ph-speaker-none');
    else if (fx.volume < 50) icon.classList.add('ph-speaker-low');
    else icon.classList.add('ph-speaker-high');
  }
  const btn = document.getElementById('vol-mute');
  if (btn) {
    btn.setAttribute('aria-pressed', fx.volume === 0 ? 'true' : 'false');
    btn.setAttribute('aria-label', fx.volume === 0 ? 'Unmute' : 'Mute');
  }
}

const DIALS = [
  ['studio-volume', 'volume', 0, 150, (v) => `${v}`],
  ['studio-bass', 'bass', 0, 12, (v) => `${v > 0 ? '+' : ''}${v}`],
  ['studio-mid', 'mid', -8, 8, (v) => `${v > 0 ? '+' : ''}${v}`],
  ['studio-treble', 'treble', -8, 8, (v) => `${v > 0 ? '+' : ''}${v}`],
  ['studio-boost', 'boost', 0, 100, (v) => `${v}`],
  ['studio-drive', 'drive', 0, 100, (v) => `${v}`],
  ['studio-filter', 'filter', 0, 100, (v) => `${v}`],
  ['studio-pitch', 'pitch', -12, 12, (v) => `${v > 0 ? '+' : ''}${v}`],
  ['studio-reverb', 'reverb', 0, 100, (v) => `${v}`],
  ['studio-delay', 'delay', 0, 100, (v) => `${v}`],
  ['studio-punch', 'punch', 0, 100, (v) => `${v}`],
];

function syncDials() {
  for (const [id, key, min, max, fmt] of DIALS) {
    updateDial(id, fx[key], min, max, fmt);
  }
}

function updateDial(id, val, min, max, fmt) {
  const input = document.getElementById(id);
  if (!input) return;
  const dial = input.closest('.dial');
  const valEl = document.getElementById(`${id}-val`);
  const p = pctOf(val, min, max);
  if (dial) dial.style.setProperty('--pct', p);
  if (valEl) valEl.textContent = fmt(val);
  if (Number(input.value) !== val) input.value = val;
}

export function initPlayerVolume() {
  const slider = document.getElementById('vol-slider');
  if (slider) {
    slider.value = fx.volume;
    slider.style.setProperty('--pct', `${pct(fx.volume, 0, 150)}%`);
    slider.addEventListener('input', () => setVolume(Number(slider.value)));
  }
  const btn = document.getElementById('vol-mute');
  if (btn) {
    btn.addEventListener('click', () => toggleMute());
  }
  syncPlayerVolume();
}

function pctOf(val, min, max) {
  return ((val - min) / (max - min)) * 100;
}

function pct(val, min, max) {
  return pctOf(val, min, max);
}

function signed(v) {
  return `${v > 0 ? '+' : ''}${v}`;
}

function dialModule(id, label, val, min, max, step, fmt) {
  const p = pctOf(val, min, max);
  return `
    <div class="dial-module">
      <div class="dial" style="--pct:${p}">
        <div class="dial-ring" aria-hidden="true">
          <span class="dial-cap"><i class="dial-tick"></i></span>
        </div>
        <input type="range" class="dial-input" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}" aria-label="${label}" />
      </div>
      <span class="dial-readout" id="${id}-val">${fmt(val)}</span>
      <span class="dial-label">${label}</span>
    </div>`;
}

function renderStudio() {
  const el = document.getElementById('studio');
  if (!el) return;

  el.innerHTML = `
    <div class="studio-rack">
      ${dialModule('studio-volume', 'Gain', fx.volume, 0, 150, 1, (v) => `${v}`)}
      ${dialModule('studio-bass', 'Bass', fx.bass, 0, 12, 0.5, signed)}
      ${dialModule('studio-mid', 'Mid', fx.mid, -8, 8, 0.5, signed)}
      ${dialModule('studio-treble', 'Air', fx.treble, -8, 8, 0.5, signed)}
      ${dialModule('studio-boost', 'Boost', fx.boost, 0, 100, 1, (v) => `${v}`)}
      ${dialModule('studio-drive', 'Drive', fx.drive, 0, 100, 1, (v) => `${v}`)}
      ${dialModule('studio-filter', 'Cut', fx.filter, 0, 100, 1, (v) => `${v}`)}
      ${dialModule('studio-pitch', 'Pitch', fx.pitch, -12, 12, 1, signed)}
      ${dialModule('studio-reverb', 'Room', fx.reverb, 0, 100, 1, (v) => `${v}`)}
      ${dialModule('studio-delay', 'Echo', fx.delay, 0, 100, 1, (v) => `${v}`)}
      ${dialModule('studio-punch', 'Punch', fx.punch, 0, 100, 1, (v) => `${v}`)}
    </div>`;

  wireStudio();
}

function setDialValue(id, key, val, min, max, fmt, onChange) {
  const n = Math.max(min, Math.min(max, val));
  if (onChange) onChange(n);
  else {
    fx[key] = n;
    updateDial(id, n, min, max, fmt);
    applyFX();
    save();
  }
}

function bindDialReadout(id, key, min, max, fmt, onChange) {
  const valEl = document.getElementById(`${id}-val`);
  const range = document.getElementById(id);
  if (!valEl) return;
  valEl.title = 'Double-click to type a value';
  valEl.style.cursor = 'text';

  valEl.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (valEl.querySelector('input')) return;

    const current = fx[key];
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = range?.step || '1';
    input.value = String(current);
    input.setAttribute('aria-label', valEl.closest('.dial-module')?.querySelector('.dial-label')?.textContent || 'Value');
    input.style.cssText = [
      'width:3.4em',
      'max-width:100%',
      'text-align:center',
      'font:inherit',
      'color:inherit',
      'background:transparent',
      'border:1px solid currentColor',
      'border-radius:4px',
      'padding:0 2px',
      'margin:0',
      '-moz-appearance:textfield',
    ].join(';');

    const restore = (val) => {
      valEl.textContent = fmt(val);
    };

    const commit = () => {
      const raw = input.value.trim();
      let val = raw === '' ? current : Number(raw);
      if (!Number.isFinite(val)) val = current;
      val = Math.max(min, Math.min(max, val));
      setDialValue(id, key, val, min, max, fmt, onChange);
      restore(val);
    };

    valEl.textContent = '';
    valEl.appendChild(input);
    input.focus();
    input.select();

    let cancelled = false;
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        input.blur();
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        cancelled = true;
        restore(current);
        updateDial(id, current, min, max, fmt);
        input.remove();
      }
    });
    input.addEventListener('blur', () => {
      if (!cancelled) commit();
    }, { once: true });
  });
}

function wireStudio() {
  const el = document.getElementById('studio');
  if (!el || el.dataset.wired) return;
  el.dataset.wired = '1';

  const bindDial = (id, key, min, max, onChange) => {
    const input = document.getElementById(id);
    const fmt = DIALS.find((d) => d[0] === id)?.[4] || ((v) => `${v}`);
    if (!input) return;
    input.addEventListener('input', () => {
      const val = Number(input.value);
      setDialValue(id, key, val, min, max, fmt, onChange);
    });
    bindDialReadout(id, key, min, max, fmt, onChange);
  };

  bindDial('studio-volume', 'volume', 0, 150, setVolume);
  bindDial('studio-bass', 'bass', 0, 12);
  bindDial('studio-mid', 'mid', -8, 8);
  bindDial('studio-treble', 'treble', -8, 8);
  bindDial('studio-boost', 'boost', 0, 100);
  bindDial('studio-drive', 'drive', 0, 100);
  bindDial('studio-filter', 'filter', 0, 100);
  bindDial('studio-pitch', 'pitch', -12, 12);
  bindDial('studio-reverb', 'reverb', 0, 100);
  bindDial('studio-delay', 'delay', 0, 100);
  bindDial('studio-punch', 'punch', 0, 100);
}

export function initStudio() {
  load();
  renderStudio();
  initPlayerVolume();
  initDragScroll(document.getElementById('studio'), {
    ignore: '.dial, .dial-input, .dial-readout, input, button',
  });
}
