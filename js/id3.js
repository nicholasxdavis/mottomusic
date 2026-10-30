import { titleFromFilename } from './state.js';

function textDecode(enc, bytes) {
  try {
    if (enc === 1 || enc === 2) {
      const le = bytes[0] === 0xff && bytes[1] === 0xfe;
      const be = bytes[0] === 0xfe && bytes[1] === 0xff;
      const slice = be || le ? bytes.slice(2) : bytes;
      return new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(slice).replace(/\0/g, '').trim();
    }
    if (enc === 3) return new TextDecoder('utf-8').decode(bytes).replace(/\0/g, '').trim();
  } catch {}
  let s = '';
  for (let i = 0; i < bytes.length; i++) if (bytes[i]) s += String.fromCharCode(bytes[i]);
  return s.trim();
}

function synchsafe(b, o) {
  return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];
}

function u32(b, o) {
  return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];
}

function latin1(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) break;
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

function parseId3(bytes) {
  const ver = bytes[3];
  const size = synchsafe(bytes, 6);
  let offset = 10;
  if (bytes[5] & 0x40) {
    const h = ver >= 4 ? synchsafe(bytes, 10) : u32(bytes, 10);
    offset += h;
  }
  const end = Math.min(bytes.length, 10 + size);
  const meta = { title: '', artist: '', album: '', genre: '', year: '', trackNo: '', picture: null };

  while (offset + 10 < end) {
    const id = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const len = ver >= 4 ? synchsafe(bytes, offset + 4) : u32(bytes, offset + 4);
    const dataStart = offset + 10;
    const dataEnd = Math.min(dataStart + len, bytes.length);
    if (len <= 0 || dataStart >= bytes.length) break;
    const data = bytes.subarray(dataStart, dataEnd);

    if (id === 'TIT2' || id === 'TPE1' || id === 'TALB' || id === 'TCON' || id === 'TYER' || id === 'TDRC' || id === 'TRCK') {
      const enc = data[0] || 0;
      const val = textDecode(enc, data.subarray(1));
      if (id === 'TIT2') meta.title = val;
      if (id === 'TPE1') meta.artist = val;
      if (id === 'TALB') meta.album = val;
      if (id === 'TCON') meta.genre = val.replace(/^\(\d+\)/, '').trim();
      if (id === 'TYER' || id === 'TDRC') meta.year = val.slice(0, 4);
      if (id === 'TRCK') meta.trackNo = val.split('/')[0];
    }

    if (id === 'APIC' && !meta.picture) {
      const enc = data[0] || 0;
      let i = 1;
      while (i < data.length && data[i] !== 0) i++;
      const mime = latin1(data.subarray(1, i)) || 'image/jpeg';
      i++;
      i++;
      if (enc === 1 || enc === 2) {
        while (i + 1 < data.length && !(data[i] === 0 && data[i + 1] === 0)) i++;
        i += 2;
      } else {
        while (i < data.length && data[i] !== 0) i++;
        i++;
      }
      const pic = data.subarray(i);
      if (pic.length > 32) {
        meta.picture = new Blob([pic], { type: mime.startsWith('image/') ? mime : 'image/jpeg' });
      }
    }

    offset = dataEnd;
  }
  return meta;
}

function parseFlacComments(bytes) {
  const meta = { title: '', artist: '', album: '', genre: '', year: '', trackNo: '', picture: null };
  let o = 4;
  while (o + 4 < bytes.length) {
    const block = bytes[o];
    const last = block & 0x80;
    const type = block & 0x7f;
    const size = (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3];
    o += 4;
    const body = bytes.subarray(o, Math.min(o + size, bytes.length));
    if (type === 4) {
      let i = 4 + body[0] + (body[1] << 8) + (body[2] << 16) + (body[3] << 24);
      if (i + 4 > body.length) break;
      const count = body[i] | (body[i + 1] << 8) | (body[i + 2] << 16) | (body[i + 3] << 24);
      i += 4;
      for (let n = 0; n < count && i + 4 <= body.length; n++) {
        const len = body[i] | (body[i + 1] << 8) | (body[i + 2] << 16) | (body[i + 3] << 24);
        i += 4;
        const kv = new TextDecoder('utf-8').decode(body.subarray(i, i + len));
        i += len;
        const eq = kv.indexOf('=');
        if (eq < 0) continue;
        const k = kv.slice(0, eq).toUpperCase();
        const v = kv.slice(eq + 1);
        if (k === 'TITLE') meta.title = v;
        if (k === 'ARTIST' || k === 'ALBUMARTIST') meta.artist = meta.artist || v;
        if (k === 'ALBUM') meta.album = v;
        if (k === 'GENRE') meta.genre = v;
        if (k === 'DATE') meta.year = v.slice(0, 4);
        if (k === 'TRACKNUMBER') meta.trackNo = v.split('/')[0];
      }
    }
    if (type === 6 && !meta.picture && body.length > 32) {
      const mimeLen = u32(body, 4);
      const mime = latin1(body.subarray(8, 8 + mimeLen)) || 'image/jpeg';
      const descLen = u32(body, 8 + mimeLen);
      let p = 32 + mimeLen + descLen;
      const picLen = u32(body, p - 4);
      const pic = body.subarray(p, p + picLen);
      if (pic.length > 32) meta.picture = new Blob([pic], { type: mime });
    }
    o += size;
    if (last) break;
  }
  return meta;
}

export async function readMetadata(file) {
  const head = await file.slice(0, 2 * 1024 * 1024).arrayBuffer();
  const bytes = new Uint8Array(head);
  let meta;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) meta = parseId3(bytes);
  else if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) meta = parseFlacComments(bytes);
  else meta = { title: '', artist: '', album: '', genre: '', year: '', trackNo: '', picture: null };

  return {
    title: meta.title || titleFromFilename(file.name),
    artist: meta.artist || 'Unknown artist',
    album: meta.album || 'Unknown album',
    genre: meta.genre || '',
    year: meta.year || '',
    trackNo: meta.trackNo || '',
    pictureUrl: meta.picture ? URL.createObjectURL(meta.picture) : null,
  };
}

export function getDuration(file) {
  return new Promise((resolve) => {
    const a = document.createElement('audio');
    a.preload = 'metadata';
    const url = URL.createObjectURL(file);
    a.onloadedmetadata = () => {
      resolve(isFinite(a.duration) ? a.duration : 0);
      URL.revokeObjectURL(url);
    };
    a.onerror = () => {
      resolve(0);
      URL.revokeObjectURL(url);
    };
    a.src = url;
  });
}
