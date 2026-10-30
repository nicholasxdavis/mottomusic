import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 1) continue;
    const key = trimmed.slice(0, i).trim();
    const val = trimmed.slice(i + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

const MOTTO_EMAIL = (process.env.MOTTO_EMAIL || '').trim().toLowerCase();
const MOTTO_PIN = (process.env.MOTTO_PIN || '').trim();
const SESSION_SECRET = process.env.MOTTO_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE = 'motto_session';
const SESSION_MS = 12 * 60 * 60 * 1000;
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function signSession(email, remember) {
  const exp = Date.now() + (remember ? REMEMBER_MS : SESSION_MS);
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return { token: `${payload}.${sig}`, maxAge: Math.floor((remember ? REMEMBER_MS : SESSION_MS) / 1000) };
}

function verifySession(token) {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data?.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function sessionFromReq(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  return verifySession(token);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e5) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function setSessionCookie(res, token, maxAge) {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

const AUTH_PATH = path.join(__dirname, 'config', 'auth.json');
const SETTINGS_PATH = path.join(__dirname, 'config', 'settings.json');
const RADIO_PATH = path.join(__dirname, 'config', 'radio.json');
const RADIO_EXAMPLE_PATH = path.join(__dirname, 'config', 'radio.example.json');

function ensureRadioFile() {
  if (fs.existsSync(RADIO_PATH)) return;
  if (!fs.existsSync(RADIO_EXAMPLE_PATH)) return;
  fs.mkdirSync(path.dirname(RADIO_PATH), { recursive: true });
  fs.copyFileSync(RADIO_EXAMPLE_PATH, RADIO_PATH);
}

ensureRadioFile();

function readJsonFile(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function defaultAuth() {
  return { enabled: true, mode: 'email', pins: [] };
}

function defaultSettings() {
  return {
    lyricsWithSong: false,
    customCursor: true,
    coverWash: true,
    avoidRecent: true,
    playerRadios: ['radio', 'tiio', 'kult', 'motto'],
    setupComplete: false,
  };
}

function loadAuth() {
  const raw = readJsonFile(AUTH_PATH, {});
  const mode = raw.mode === 'pin' || raw.mode === 'pins' ? raw.mode : 'email';
  const pins = Array.isArray(raw.pins) ? raw.pins.filter((row) => row?.id && row?.hash && row?.salt) : [];
  return { enabled: raw.enabled !== false, mode, pins };
}

function saveAuth(auth) {
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  fs.writeFileSync(AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`);
}

function loadSettings() {
  return { ...defaultSettings(), ...readJsonFile(SETTINGS_PATH, {}) };
}

function saveSettings(settings) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`);
}

function knownRadioKeys() {
  const radio = readJsonFile(RADIO_PATH, {});
  const keys = [];
  for (const [key, val] of Object.entries(radio.stations || {})) {
    if (!val || key === 'shuffle') continue;
    if (val.filter === 'all' || val.filter === 'none') continue;
    keys.push(key);
  }
  return keys;
}

function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return { salt, hash };
}

function verifyPin(pin, row) {
  try {
    const hash = crypto.scryptSync(String(pin), row.salt, 32).toString('hex');
    if (hash.length !== String(row.hash).length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(String(row.hash)));
  } catch {
    return false;
  }
}

function authEnabled() {
  return loadAuth().enabled;
}

function publicAuth(auth) {
  return {
    enabled: auth.enabled,
    mode: auth.mode,
    pins: auth.pins.map((row) => ({ id: row.id, label: row.label || 'PIN' })),
  };
}

function needsAuth(url) {
  if (!authEnabled()) return false;
  if (url.startsWith('/api/auth')) return false;
  if (url.startsWith('/api/')) return true;
  if (url.startsWith('/music/')) return true;
  return false;
}

async function handleAuthLogin(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }
  const auth = loadAuth();
  if (!auth.enabled) {
    const { token, maxAge } = signSession('open', false);
    setSessionCookie(res, token, maxAge);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  const knownEmails = [MOTTO_EMAIL, String(auth.email || '').trim().toLowerCase()].filter(Boolean);
  if ((!MOTTO_PIN && !auth.pins.length) || (auth.mode === 'email' && !knownEmails.length)) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Auth not configured' }));
  }
  try {
    const { email = '', pin = '', remember = false } = await readJsonBody(req);
    const givenPin = String(pin).trim();
    const pinOk = givenPin && (givenPin === MOTTO_PIN || auth.pins.some((row) => verifyPin(givenPin, row)));
    const emailOk = auth.mode !== 'email' || knownEmails.includes(String(email).trim().toLowerCase());
    if (!pinOk || !emailOk) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: auth.mode === 'email' ? 'Invalid email or PIN' : 'Invalid PIN' }));
    }
    const { token, maxAge } = signSession(auth.mode === 'email' ? MOTTO_EMAIL : 'pin', !!remember);
    setSessionCookie(res, token, maxAge);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request' }));
  }
}

function handleAuthSession(req, res) {
  if (!authEnabled()) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, open: true }));
  }
  const session = sessionFromReq(req);
  if (!session) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: false }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}

function handleAuthGate(req, res) {
  const auth = loadAuth();
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify({ enabled: auth.enabled, mode: auth.mode }));
}

function sanitizeSettings(input, prev) {
  const base = { ...defaultSettings(), ...prev };
  const next = { ...base };
  if (typeof input.lyricsWithSong === 'boolean') next.lyricsWithSong = input.lyricsWithSong;
  if (typeof input.customCursor === 'boolean') next.customCursor = input.customCursor;
  if (typeof input.coverWash === 'boolean') next.coverWash = input.coverWash;
  if (typeof input.avoidRecent === 'boolean') next.avoidRecent = input.avoidRecent;
  if (Array.isArray(input.playerRadios)) {
    const known = new Set(knownRadioKeys());
    const slots = [];
    for (const key of input.playerRadios) {
      const id = String(key || '');
      if (!known.has(id) || slots.includes(id)) continue;
      slots.push(id);
      if (slots.length === 4) break;
    }
    for (const key of known) {
      if (slots.length === 4) break;
      if (!slots.includes(key)) slots.push(key);
    }
    if (slots.length) next.playerRadios = slots;
  }
  return next;
}

async function handleSettings(req, res) {
  if (req.method === 'GET') {
    const auth = loadAuth();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(JSON.stringify({ ui: loadSettings(), auth: publicAuth(auth) }));
  }
  if (req.method !== 'PUT') {
    res.writeHead(405);
    return res.end();
  }
  try {
    const body = await readJsonBody(req);
    let notice = '';
    if (body.ui && typeof body.ui === 'object') saveSettings(sanitizeSettings(body.ui, loadSettings()));

    if (body.auth && typeof body.auth === 'object') {
      const auth = loadAuth();
      if (typeof body.auth.enabled === 'boolean') auth.enabled = body.auth.enabled;
      if (body.auth.mode === 'email' || body.auth.mode === 'pin' || body.auth.mode === 'pins') auth.mode = body.auth.mode;
      if (body.auth.addPin && typeof body.auth.addPin === 'object') {
        const label = String(body.auth.addPin.label || '').trim().slice(0, 32);
        const pin = String(body.auth.addPin.pin || '').trim();
        if (!label || pin.length < 4 || pin.length > 32) notice = 'A PIN needs a name and at least 4 characters';
        else if (auth.pins.length >= 8) notice = 'Eight PINs is the limit';
        else {
          const { salt, hash } = hashPin(pin);
          auth.pins.push({ id: crypto.randomBytes(8).toString('hex'), label, salt, hash });
        }
      }
      if (body.auth.removePin) {
        const id = String(body.auth.removePin);
        auth.pins = auth.pins.filter((row) => row.id !== id);
      }
      saveAuth(auth);
    }

    const auth = loadAuth();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ui: loadSettings(), auth: publicAuth(auth), notice }));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad request' }));
  }
}

function handleAuthLogout(req, res) {
  clearSessionCookie(res);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
}
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm|mp4|aiff|aif)$/i;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/opus',
  '.webp': 'image/webp',
  '.lrc': 'text/plain; charset=utf-8',
};

const MP3_LIMIT = 200 * 1024 * 1024;
const LRC_LIMIT = 1024 * 1024;
const ZIP_LIMIT = 32 * 1024 * 1024 * 1024;
const ZIP_ENTRY_LIMIT = 8000;
const ZIP_TOTAL_LIMIT = 32 * 1024 * 1024 * 1024;

function safePathPart(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function safeSegments(rel) {
  return String(rel || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => safePathPart(part, ''))
    .filter(Boolean)
    .slice(0, 24);
}

function looksLikeMp3(buf) {
  if (!buf || buf.length < 4) return false;
  if (buf.slice(0, 3).toString('latin1') === 'ID3') return true;
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(data));
}

function streamBodyToFile(req, dest, limit) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      req.destroy();
      out.destroy();
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) return fail(new Error('File too large'));
      if (!out.write(chunk)) req.pause();
    });
    out.on('drain', () => req.resume());
    req.on('end', () => out.end());
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve(size);
    });
  });
}

function musicRoot() {
  return path.resolve(__dirname, 'music');
}

function moveUnique(src, dir, filename) {
  const ext = path.extname(filename);
  const base = filename.slice(0, filename.length - ext.length);
  fs.mkdirSync(dir, { recursive: true });
  for (let n = 1; n < 10000; n += 1) {
    const name = n === 1 ? filename : `${base} ${n}${ext}`;
    const dest = path.join(dir, name);
    try {
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
      return dest;
    } catch (err) {
      if (err.code === 'EEXIST') continue;
      throw err;
    }
  }
  throw new Error('Import failed');
}

function placeUpload(parts, src) {
  const root = musicRoot();
  if (!parts.length) throw new Error('Invalid name');
  const filename = parts[parts.length - 1];
  const dir = path.resolve(root, ...parts.slice(0, -1));
  const relDir = path.relative(root, dir);
  if (relDir.startsWith('..') || path.isAbsolute(relDir)) throw new Error('Invalid name');
  const dest = moveUnique(src, dir, filename);
  const rel = path.relative(root, dest);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    fs.rmSync(dest, { force: true });
    throw new Error('Invalid name');
  }
  return { path: `music/${rel.split(path.sep).join('/')}`, name: path.basename(dest) };
}

function readFileHead(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size);
    const n = fs.readSync(fd, buf, 0, size, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function inspectZip(zipPath) {
  const fd = fs.openSync(zipPath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size < 22) return { ok: false, error: 'That file is not a zip' };
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) return { ok: false, error: 'That file is not a zip' };
    let entries = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      if (eocd < 20 || tail.readUInt32LE(eocd - 20) !== 0x07064b50) {
        return { ok: false, error: 'That zip is too large to read' };
      }
      const z64 = Number(tail.readBigUInt64LE(eocd - 12));
      const zbuf = Buffer.alloc(56);
      fs.readSync(fd, zbuf, 0, 56, z64);
      if (zbuf.readUInt32LE(0) !== 0x06064b50) return { ok: false, error: 'That file is not a zip' };
      entries = Number(zbuf.readBigUInt64LE(32));
      cdSize = Number(zbuf.readBigUInt64LE(40));
      cdOffset = Number(zbuf.readBigUInt64LE(48));
    }
    if (!Number.isFinite(entries) || entries < 0 || entries > ZIP_ENTRY_LIMIT) {
      return { ok: false, error: 'That zip has too many files' };
    }
    if (!Number.isFinite(cdSize) || cdSize < 0 || cdSize > 8 * 1024 * 1024) {
      return { ok: false, error: 'That zip could not be read' };
    }
    if (!Number.isFinite(cdOffset) || cdOffset < 0 || cdOffset + cdSize > size) {
      return { ok: false, error: 'That zip could not be read' };
    }
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    let p = 0;
    let total = 0;
    let songs = 0;
    while (p + 46 <= cd.length) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const flags = cd.readUInt16LE(p + 8);
      if (flags & 1) return { ok: false, error: 'That zip is password protected' };
      let comp = cd.readUInt32LE(p + 20);
      let uncomp = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const extraStart = p + 46 + nameLen;
      const name = cd.slice(p + 46, extraStart).toString('utf8');
      const extra = cd.slice(extraStart, extraStart + extraLen);
      if (uncomp === 0xffffffff || comp === 0xffffffff) {
        let o = 0;
        while (o + 4 <= extra.length) {
          const id = extra.readUInt16LE(o);
          const len = extra.readUInt16LE(o + 2);
          if (id === 1 && o + 4 + len <= extra.length) {
            const field = extra.slice(o + 4, o + 4 + len);
            let q = 0;
            if (uncomp === 0xffffffff && q + 8 <= field.length) {
              uncomp = Number(field.readBigUInt64LE(q));
              q += 8;
            }
            if (comp === 0xffffffff && q + 8 <= field.length) comp = Number(field.readBigUInt64LE(q));
            break;
          }
          o += 4 + len;
        }
      }
      if (!name.endsWith('/') && !name.endsWith('\\')) {
        total += uncomp;
        if (/\.(mp3|wav|aif|aiff|flac|m4a|aac|ogg|opus)$/i.test(name)) {
          songs += 1;
          if (uncomp > MP3_LIMIT) return { ok: false, error: 'A song in that zip is too large' };
        }
        if (comp > 0 && uncomp > comp * 100 && uncomp > 50 * 1024 * 1024) {
          return { ok: false, error: 'That zip could not be read' };
        }
      }
      if (total > ZIP_TOTAL_LIMIT) return { ok: false, error: 'That zip is too large' };
      p += 46 + nameLen + extraLen + commentLen;
    }
    if (!songs) return { ok: false, error: 'No audio files in that zip' };
    return { ok: true, songs };
  } catch {
    return { ok: false, error: 'That zip could not be read' };
  } finally {
    fs.closeSync(fd);
  }
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve) => {
    const child = spawn('tar', ['-xf', zipPath, '-C', destDir], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (chunk) => {
      err += chunk.toString();
      if (err.length > 4000) err = err.slice(-4000);
    });
    child.on('error', (error) => resolve({ code: 1, err: error.message }));
    child.on('close', (code) => resolve({ code, err }));
  });
}

function walkImportFiles(dir, base = '') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === '__MACOSX' || ent.name === '.' || ent.name === '..') continue;
    if (ent.name.startsWith('.') || ent.name.startsWith('._')) continue;
    const rel = base ? `${base}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    let st;
    try {
      st = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) out.push(...walkImportFiles(full, rel));
    else if (st.isFile()) out.push({ full, rel, size: st.size });
  }
  return out;
}

async function handleImport(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }
  const tmp = path.join(os.tmpdir(), `motto-import-${crypto.randomBytes(8).toString('hex')}`);
  const extra = [];
  try {
    const q = new URL(req.url, 'http://localhost').searchParams;
    const original = String(q.get('name') || '');
    const isLrc = /\.lrc$/i.test(original);
    const isAudio = KEEP_AUDIO.test(original);
    if (!isAudio && !isLrc) return sendJson(res, 400, { error: 'Upload an audio file' });
    await streamBodyToFile(req, tmp, isLrc ? LRC_LIMIT : MP3_LIMIT);
    const stat = fs.statSync(tmp);
    if (/\.mp3$/i.test(original)) {
      if (stat.size < 128 || !looksLikeMp3(readFileHead(tmp, 16))) {
        return sendJson(res, 400, { error: 'That file is not an MP3' });
      }
    } else if (!stat.size) {
      return sendJson(res, 400, { error: 'That file is empty' });
    }
    const packed = isAudio ? await storedAudio(tmp, path.extname(original).toLowerCase()) : { file: tmp, ext: '.lrc' };
    if (packed.file !== tmp) extra.push(packed.file);
    const ext = isLrc ? '.lrc' : packed.ext;
    const dir = q.get('dir');
    let parts;
    if (dir) {
      const base = safePathPart(original.replace(/\.[^.]+$/, ''), 'track');
      parts = [...safeSegments(dir), `${base}${ext}`];
    } else if (isLrc) {
      const base = safePathPart(original.replace(/\.lrc$/i, ''), 'lyrics');
      parts = ['Imports', `${base}.lrc`];
    } else if (ext === '.mp3') {
      const artist = safePathPart(q.get('artist'), 'Imports');
      const album = safePathPart(q.get('album'), 'Singles');
      const title = safePathPart(q.get('title'), original.replace(/\.mp3$/i, ''));
      parts = [artist, album, `${title}.mp3`];
    } else {
      const base = safePathPart(original.replace(/\.[^.]+$/, ''), 'track');
      parts = ['Imports', 'Singles', `${base}${ext}`];
    }
    const saved = placeUpload(parts, packed.file);
    sendJson(res, 200, { ok: true, path: saved.path, name: saved.name });
  } catch (err) {
    const tooBig = err?.message === 'File too large';
    sendJson(res, tooBig ? 413 : 500, { error: tooBig ? 'That file is too large' : 'Import failed' });
  } finally {
    fs.rmSync(tmp, { force: true });
    for (const file of extra) fs.rmSync(file, { force: true });
  }
}

async function handleImportZip(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }
  const id = crypto.randomBytes(8).toString('hex');
  const zipPath = path.join(os.tmpdir(), `motto-zip-${id}.zip`);
  const outDir = path.join(os.tmpdir(), `motto-zip-${id}`);
  try {
    await streamBodyToFile(req, zipPath, ZIP_LIMIT);
    const check = inspectZip(zipPath);
    if (!check.ok) return sendJson(res, 400, { error: check.error });
    fs.mkdirSync(outDir);
    await extractZip(zipPath, outDir);
    const files = walkImportFiles(outDir);
    let imported = 0;
    let lyrics = 0;
    let skipped = 0;
    for (const file of files) {
      const isAudio = KEEP_AUDIO.test(file.rel);
      const isLrc = /\.lrc$/i.test(file.rel);
      if (!isAudio && !isLrc) continue;
      if (isAudio && (file.size < 32 || file.size > MP3_LIMIT)) {
        skipped += 1;
        continue;
      }
      if (/\.mp3$/i.test(file.rel) && (file.size < 128 || !looksLikeMp3(readFileHead(file.full, 16)))) {
        skipped += 1;
        continue;
      }
      if (isLrc && (file.size < 1 || file.size > LRC_LIMIT)) continue;
      try {
        const packed = isAudio ? await storedAudio(file.full, path.extname(file.rel).toLowerCase()) : { file: file.full, ext: '.lrc' };
        const rel = packed.ext === path.extname(file.rel).toLowerCase()
          ? file.rel
          : file.rel.replace(/\.[^.]+$/, packed.ext);
        placeUpload(safeSegments(rel), packed.file);
        if (packed.file !== file.full) fs.rmSync(packed.file, { force: true });
        if (isAudio) imported += 1;
        else lyrics += 1;
      } catch {
        if (isAudio) skipped += 1;
      }
    }
    if (!imported) return sendJson(res, 400, { error: 'No audio files in that zip' });
    sendJson(res, 200, { ok: true, imported, lyrics, skipped });
  } catch (err) {
    const tooBig = err?.message === 'File too large';
    sendJson(res, tooBig ? 413 : 500, { error: tooBig ? 'That zip is too large' : 'Import failed' });
  } finally {
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

const KEEP_AUDIO = /\.(mp3|wav|aif|aiff|flac|m4a|aac|ogg|opus)$/i;
const RAW_AUDIO = /\.(wav|aif|aiff)$/i;

let ffmpegReady = null;

function hasFfmpeg() {
  if (ffmpegReady != null) return ffmpegReady;
  try {
    execFileSync('ffmpeg', ['-version'], { windowsHide: true, stdio: 'ignore' });
    ffmpegReady = true;
  } catch {
    ffmpegReady = false;
  }
  return ffmpegReady;
}

function packLossless(src, dest) {
  return new Promise((resolve) => {
    const child = spawn('ffmpeg', [
      '-y',
      '-i', src,
      '-map_metadata', '0',
      '-c:a', 'flac',
      '-compression_level', '8',
      dest,
    ], { windowsHide: true });
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      resolve(code === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 32);
    });
  });
}

async function storedAudio(src, ext) {
  if (!RAW_AUDIO.test(ext) || !hasFfmpeg()) return { file: src, ext };
  const dest = `${src}.flac`;
  const ok = await packLossless(src, dest);
  return ok ? { file: dest, ext: '.flac' } : { file: src, ext };
}

function handleSetup(req, res) {
  if (req.method === 'GET') {
    return sendJson(res, 200, { needed: loadSettings().setupComplete !== true });
  }
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }
  return readJsonBody(req).then((body) => {
    if (loadSettings().setupComplete === true) {
      return sendJson(res, 403, { error: 'Setup is already finished' });
    }
    const mode = body.mode === 'open' || body.mode === 'pin' || body.mode === 'email' ? body.mode : '';
    if (!mode) return sendJson(res, 400, { error: 'Choose how Motto should open' });
    const pin = String(body.pin || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    let auth;
    if (mode === 'open') {
      auth = { enabled: false, mode: 'email', email: '', pins: [] };
    } else if (pin.length < 4 || pin.length > 32) {
      return sendJson(res, 400, { error: 'Use at least 4 characters' });
    } else if (mode === 'email' && !email.includes('@')) {
      return sendJson(res, 400, { error: 'Enter the email you want to use' });
    } else {
      const row = hashPin(pin);
      auth = {
        enabled: true,
        mode,
        email: mode === 'email' ? email : '',
        pins: [{ id: crypto.randomBytes(8).toString('hex'), label: 'PIN', salt: row.salt, hash: row.hash }],
      };
    }
    saveAuth(auth);
    saveSettings({ ...loadSettings(), setupComplete: true });
    const { token, maxAge } = signSession(mode === 'email' ? email : 'setup', true);
    setSessionCookie(res, token, maxAge);
    return sendJson(res, 200, { ok: true, enabled: auth.enabled, mode: auth.mode });
  }).catch(() => sendJson(res, 400, { error: 'Bad request' }));
}

function normKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function handleLibraryDelete(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }
  return readJsonBody(req).then((body) => {
    const want = normKey(body.artist);
    if (!want || want.length < 2) return sendJson(res, 400, { error: 'Name that artist' });
    const root = musicRoot();
    if (!fs.existsSync(root)) return sendJson(res, 200, { ok: true, removed: 0 });
    let removed = 0;
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.isSymbolicLink()) continue;
      if (normKey(ent.name) !== want) continue;
      const dest = path.resolve(root, ent.name);
      const rel = path.relative(root, dest);
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
      fs.rmSync(dest, { recursive: true, force: true });
      removed += 1;
    }
    return sendJson(res, 200, { ok: true, removed });
  }).catch(() => sendJson(res, 400, { error: 'Could not delete those files' }));
}

function scanMusic(dir, base = 'music') {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = `${base}/${ent.name}`;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...scanMusic(full, rel));
    else if (AUDIO_EXT.test(ent.name)) out.push({ path: rel.replace(/\\/g, '/'), name: ent.name });
  }
  return out;
}

function serveFile(req, res, file) {
  fs.stat(file, (err, stat) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }

    const ext = path.extname(file).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? parseInt(m[1], 10) : 0;
        const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
        if (start >= stat.size || end >= stat.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
          return res.end();
        }
        const stream = fs.createReadStream(file, { start, end });
        const rangeHeaders = {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Content-Type': type,
          'Cache-Control': 'no-cache',
        };
        if (/^\.(avif|gif|jpe?g|png|svg|webp)$/i.test(ext)) {
          rangeHeaders['Access-Control-Allow-Origin'] = '*';
        }
        res.writeHead(206, rangeHeaders);
        return stream.pipe(res);
      }
    }

    const headers = {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    };
    if (/^\.(avif|gif|jpe?g|png|svg|webp)$/i.test(ext)) {
      headers['Access-Control-Allow-Origin'] = '*';
    }
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}

async function fetchLrclib(artist, title, duration) {
  const params = new URLSearchParams({
    artist_name: artist,
    track_name: title,
    album_name: '',
    duration: String(Math.round(duration || 0)),
  });
  const res = await fetch(`https://lrclib.net/api/get?${params}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.plainLyrics && !data.syncedLyrics) return null;
  return {
    plain: data.plainLyrics || '',
    synced: data.syncedLyrics || '',
    source: 'lrclib',
  };
}

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToLyrics(html) {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
  );
}

function scrapeGeniusHtml(html) {
  const start = html.indexOf('data-lyrics-container="true"');
  if (start < 0) return '';
  let chunk = html.slice(start);
  const open = chunk.indexOf('>') + 1;
  const endMarkers = [
    'RecommendedSongs__Container',
    'About__Container',
    'SongPage__Section',
  ];
  let end = chunk.length;
  for (const marker of endMarkers) {
    const i = chunk.indexOf(marker);
    if (i > open) end = Math.min(end, i);
  }
  chunk = chunk.slice(open, end);
  chunk = chunk.replace(/<div data-exclude-from-selection[\s\S]*?<\/div>\s*<\/div>/i, '');
  let plain = htmlToLyrics(chunk);
  plain = plain.replace(/<[\s\S]*$/g, '').trim();
  const stop = ['You might also like', 'Get tickets', '<aside'];
  for (const s of stop) {
    const i = plain.indexOf(s);
    if (i > 80) plain = plain.slice(0, i);
  }
  const lines = plain.split('\n').filter((l) => l.trim());
  const dropHeader = lines.findIndex((l) => /^\[/.test(l.trim()) || l.length > 20);
  return (dropHeader > 0 ? lines.slice(dropHeader) : lines).join('\n').trim();
}

async function fetchGenius(artist, title) {
  const { spawnSync } = await import('child_process');
  const script = path.join(__dirname, 'tools', 'genius_lookup.mjs');
  const proc = spawnSync('node', [script, artist, title], { encoding: 'utf8', timeout: 35000 });
  if (proc.status === 0 && proc.stdout?.trim()) {
    try {
      const data = JSON.parse(proc.stdout);
      if (data.source === 'genius' && data.plain) return data;
    } catch {}
  }
  return null;
}

async function fetchLyricsOvh(artist, title) {
  const a = encodeURIComponent(artist);
  const t = encodeURIComponent(title);
  const res = await fetch(`https://api.lyrics.ovh/v1/${a}/${t}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data?.lyrics?.trim()) return null;
  return { plain: data.lyrics.trim(), synced: '', source: 'lyrics.ovh' };
}

function normArtistKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normTitleKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isComehelpgloArtist(artist) {
  return normArtistKey(artist).includes('comehelpglo');
}

let comehelpgloLyrics = { tracks: {} };
const gloCachePath = path.join(__dirname, 'music', 'import', 'lyrics', 'comehelpglo.json');
try {
  if (fs.existsSync(gloCachePath)) {
    comehelpgloLyrics = JSON.parse(fs.readFileSync(gloCachePath, 'utf8'));
  }
} catch {}

function getComehelpgloCached(title) {
  const hit = comehelpgloLyrics.tracks?.[normTitleKey(title)];
  if (!hit?.plain?.trim()) return null;
  return { plain: hit.plain.trim(), synced: '', source: hit.source || 'genius-cache' };
}

async function resolveLyrics(artist, title, duration) {
  const tries = [
    { artist, title },
    { artist, title: title.replace(/\s*\([^)]*\)\s*/g, ' ').trim() },
  ];
  const seen = new Set();
  const glo = isComehelpgloArtist(artist);

  for (const { artist: a, title: t } of tries) {
    const key = `${a}|${t}`;
    if (!a || !t || seen.has(key)) continue;
    seen.add(key);

    const lrc = await fetchLrclib(a, t, duration);
    if (lrc?.synced?.trim()) return lrc;

    if (glo) {
      const cached = getComehelpgloCached(t);
      if (cached) return cached;
      const genius = await fetchGenius(a, t);
      if (genius) return genius;
    }

    if (lrc?.plain?.trim()) return lrc;

    if (!glo) {
      const genius = await fetchGenius(a, t);
      if (genius) return genius;
      const ovh = await fetchLyricsOvh(a, t);
      if (ovh) return ovh;
    }
  }

  if (glo) {
    const cached = getComehelpgloCached(title);
    if (cached) return cached;
  }

  return { plain: '', synced: '', source: 'none' };
}

const coverCache = new Map();

async function fetchItunesCover(artist, title) {
  const key = `${artist}|${title}`;
  if (coverCache.has(key)) return coverCache.get(key);
  const params = new URLSearchParams({
    term: `${artist} ${title}`,
    entity: 'song',
    limit: '1',
    country: 'US',
  });
  try {
    const res = await fetch(`https://itunes.apple.com/search?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const hit = data.results?.[0];
    if (!hit?.artworkUrl100) return null;
    const url = hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    coverCache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

async function handleCover(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const artist = u.searchParams.get('artist') || '';
  const title = u.searchParams.get('title') || '';
  let url = null;
  try {
    url = await fetchItunesCover(artist, title);
    if (!url) url = await fetchItunesCover(artist, title.replace(/\s*\([^)]*\)/g, '').trim());
  } catch {}
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' });
  res.end(JSON.stringify({ url }));
}

async function handleLyrics(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const artist = u.searchParams.get('artist') || '';
  const title = u.searchParams.get('title') || '';
  const duration = Number(u.searchParams.get('duration') || 0);
  let out = { plain: '', synced: '', source: 'none' };
  try {
    out = await resolveLyrics(artist, title, duration);
  } catch {}
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(out));
}

const STATION_ICON_KEYS = new Set(['radio', 'tiio', 'kult', 'motto']);

async function handleStationIcon(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }
  try {
    const body = await readJsonBody(req);
    const station = String(body.station || '');
    if (!STATION_ICON_KEYS.has(station)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid station' }));
    }
    const data = body.data;
    if (!data || typeof data !== 'string') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing data' }));
    }
    const buf = Buffer.from(data, 'base64');
    if (buf.length > 2 * 1024 * 1024) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'File too large' }));
    }
    const mimeExt = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
    };
    let ext = mimeExt[body.mime] || '.png';
    if (body.ext && /^\.(jpe?g|png|webp|gif|svg)$/i.test(body.ext)) ext = body.ext.toLowerCase();
    const dir = path.join(__dirname, 'assets', 'stations');
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${station}-${Date.now()}${ext}`;
    fs.writeFileSync(path.join(dir, filename), buf);
    const icon = `assets/stations/${filename}`;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ icon }));
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Upload failed' }));
  }
}

async function handleRadioConfig(req, res) {
  const configPath = path.join(__dirname, 'config', 'radio.json');
  if (req.method === 'GET') {
    if (!fs.existsSync(configPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end('{}');
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(configPath));
  }
  if (req.method !== 'PUT') {
    res.writeHead(405);
    return res.end();
  }
  try {
    const body = await readJsonBody(req);
    const config = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
      : {};
    const builtin = new Set(['shuffle', 'radio', 'tiio', 'kult', 'motto']);
    for (const [key, val] of Object.entries(body)) {
      if (!Array.isArray(val)) continue;
      if (key === 'excluded_artists' || /^[a-z][a-z0-9]{0,23}_artists$/.test(key)) {
        config[key] = val.map(String);
      }
    }
    if (body.stations && typeof body.stations === 'object') {
      config.stations = config.stations || {};
      for (const [key, val] of Object.entries(body.stations)) {
        if (!/^[a-z][a-z0-9]{0,23}$/.test(key)) continue;
        if (!val || typeof val !== 'object') continue;
        config.stations[key] = { ...config.stations[key], ...val };
      }
    }
    if (Array.isArray(body.removeStations)) {
      for (const id of body.removeStations.map(String)) {
        if (builtin.has(id) || !/^[a-z][a-z0-9]{0,23}$/.test(id)) continue;
        delete config.stations?.[id];
        delete config[`${id}_artists`];
      }
    }
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Save failed' }));
  }
}

async function handleGenius(req, res) {
  const u = new URL(req.url, 'http://localhost');
  const artist = u.searchParams.get('artist') || '';
  const title = u.searchParams.get('title') || '';
  let out = { plain: '', synced: '', source: 'none' };
  try {
    if (isComehelpgloArtist(artist)) {
      out = getComehelpgloCached(title) || await fetchGenius(artist, title) || out;
    } else {
      out = await fetchGenius(artist, title) || out;
    }
  } catch {}
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(out));
}

function requestHost(req) {
  const raw = String(req.headers.host || '').trim().toLowerCase();
  if (raw.startsWith('[')) {
    const end = raw.indexOf(']');
    return end > 1 ? raw.slice(1, end) : '';
  }
  return raw.replace(/:\d+$/, '');
}

function isLocalRequest(req) {
  const addr = req.socket?.remoteAddress || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  const host = requestHost(req);
  const hostOk = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  return loopback && hostOk;
}

const onRequest = async (req, res) => {
  if (!isLocalRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Motto only answers on this PC.');
    return;
  }

  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];

  if (url === '/api/auth/login') return handleAuthLogin(req, res);
  if (url === '/api/auth/session') return handleAuthSession(req, res);
  if (url === '/api/auth/logout') return handleAuthLogout(req, res);
  if (url === '/api/auth/gate') return handleAuthGate(req, res);
  if (url === '/api/setup') return handleSetup(req, res);

  if (needsAuth(url) && !sessionFromReq(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  if (url === '/api/import') return handleImport(req, res);
  if (url === '/api/import-zip') return handleImportZip(req, res);
  if (url === '/api/library/delete') return handleLibraryDelete(req, res);

  if (url === '/api/library') {
    const tracks = scanMusic(path.join(__dirname, 'music'));
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    });
    return res.end(JSON.stringify(tracks));
  }

  if (url === '/api/manifest') {
    const manifestPath = path.join(__dirname, 'music', 'import', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      res.writeHead(404);
      return res.end('{}');
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    return res.end(fs.readFileSync(manifestPath));
  }

  if (url === '/api/settings') return handleSettings(req, res);
  if (url === '/api/radio-config') return handleRadioConfig(req, res);
  if (url === '/api/station-icon') return handleStationIcon(req, res);

  if (url === '/api/lyrics') return handleLyrics(req, res);
  if (url === '/api/genius') return handleGenius(req, res);
  if (url === '/api/cover') return handleCover(req, res);

  if (url === '/config/auth.json' || url === '/.env' || url.startsWith('/.env')) {
    res.writeHead(404);
    return res.end();
  }

  const file = path.join(__dirname, decodeURIComponent(url));
  if (!file.startsWith(__dirname)) {
    res.writeHead(403);
    return res.end();
  }

  serveFile(req, res, file);
};

const server = http.createServer(onRequest);
server.requestTimeout = 0;
server.timeout = 0;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Motto at http://localhost:${PORT}`);
  console.log('Private to this PC. Other devices on the network cannot open it.');
});

const v6 = http.createServer(onRequest);
v6.requestTimeout = 0;
v6.timeout = 0;
v6.on('error', () => {});
v6.listen(PORT, '::1');
