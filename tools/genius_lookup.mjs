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

function slugify(...parts) {
  return parts
    .join('-')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
  const endMarkers = ['RecommendedSongs__Container', 'About__Container', 'SongPage__Section'];
  let end = chunk.length;
  for (const marker of endMarkers) {
    const i = chunk.indexOf(marker);
    if (i > open) end = Math.min(end, i);
  }
  chunk = chunk.slice(open, end);
  chunk = chunk.replace(/<div data-exclude-from-selection[\s\S]*?<\/div>\s*<\/div>/i, '');
  let plain = htmlToLyrics(chunk);
  plain = plain.replace(/<[\s\S]*$/g, '').trim();
  for (const s of ['You might also like', 'Get tickets', 'See ', '<aside']) {
    const i = plain.indexOf(s);
    if (i > 80) plain = plain.slice(0, i);
  }
  const lines = plain.split('\n').filter((l) => l.trim());
  const dropHeader = lines.findIndex((l) => /^\[/.test(l.trim()) || l.length > 20);
  return (dropHeader > 0 ? lines.slice(dropHeader) : lines).join('\n').trim();
}

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    redirect: 'follow',
  });
  if (!res.ok) return null;
  return res.text();
}

async function tryUrl(url) {
  const html = await fetchPage(url);
  if (!html) return null;
  const plain = scrapeGeniusHtml(html);
  return plain.length > 40 ? { plain, synced: '', source: 'genius' } : null;
}

function normArtist(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function titleVariants(title) {
  const out = new Set();
  const base = String(title || '').trim();
  if (!base) return [];
  const add = (s) => {
    const v = String(s || '').trim();
    if (v) out.add(v);
  };

  add(base);
  let t = base.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\.$/, '').trim();
  add(t);
  add(base.replace(/\s*\(prod[^)]*\)/gi, '').replace(/\.\([^)]*\)/g, '').replace(/\.$/, '').trim());
  add(base.replace(/\(prod[^)]*\)/gi, '').replace(/\.$/, '').trim());
  add(t.replace(/[''`]/g, ''));
  add(t.replace(/n't/gi, 'nt').replace(/'/g, ''));
  if (/\bsht\b/i.test(t)) add(t.replace(/\bsht\b/gi, 'shit'));
  if (/^don'?t\s+/i.test(t)) add(t.replace(/^don'?t\s+/i, ''));
  const words = t.replace(/[^\w\s']/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length > 6) add(words.slice(0, 6).join(' '));
  if (words.length > 4) add(words.slice(0, 4).join(' '));

  return [...out];
}

function artistVariants(artist, title) {
  const out = new Set([artist]);
  const n = normArtist(artist);
  if (n.includes('comehelpglo') || n === 'comehelpglo') {
    out.add('Comehelpglo');
    out.add('comehelpglo');
  }
  if (normTitleKey(title).includes('imtryingtomoveon')) {
    out.add('XLOGAN!');
    out.add('XLOGAN');
  }
  return [...out];
}

async function geniusSearch(query, seen) {
  try {
    const search = await fetch(
      `https://genius.com/api/search/multi?per_page=8&q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Referer: 'https://genius.com/' } },
    );
    if (!search.ok) return null;
    const json = await search.json();
    const hits = json?.response?.sections?.find((s) => s.type === 'song')?.hits || [];
    for (const h of hits) {
      const url = h?.result?.url;
      const result = h?.result || {};
      const primary = normArtist(result.primary_artist?.name || '');
      const featured = (result.featured_artists || []).map((a) => normArtist(a?.name || ''));
      const resultTitle = String(result.title || '').toLowerCase();
      const hasGlo = primary.includes('comehelpglo')
        || featured.some((a) => a.includes('comehelpglo'))
        || resultTitle.includes('comehelpglo');
      if (!url || seen.has(url)) continue;
      if (normArtist(query).includes('comehelpglo') && !hasGlo) continue;
      seen.add(url);
      const hit = await tryUrl(url);
      if (hit) return hit;
    }
  } catch {}
  return null;
}

async function fetchGenius(artist, title) {
  const seen = new Set();
  const artists = artistVariants(artist, title);
  const titles = titleVariants(title);

  for (const a of artists) {
    for (const t of titles) {
      const candidates = [
        `https://genius.com/${slugify(a, t)}-lyrics`,
        `https://genius.com/${slugify(a)}-${slugify(t)}-lyrics`,
        `https://genius.com/${slugify(t)}-lyrics`,
      ];
      for (const url of candidates) {
        if (seen.has(url)) continue;
        seen.add(url);
        const hit = await tryUrl(url);
        if (hit) return hit;
      }
    }
  }

  for (const a of artists) {
    for (const t of titles) {
      const hit = await geniusSearch(`${a} ${t}`, seen);
      if (hit) return hit;
    }
  }

  if (normArtist(artist).includes('comehelpglo')) {
    for (const t of titles) {
      const hit = await geniusSearch(`comehelpglo ${t}`, seen);
      if (hit) return hit;
    }
    if (normTitleKey(title).includes('imtryingtomoveon')) {
      for (const a of ['XLOGAN!', 'XLOGAN', 'comehelpglo']) {
        const hit = await geniusSearch(`${a} im trying to move on`, seen);
        if (hit) return hit;
      }
    }
  }

  return null;
}

function normTitleKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const artist = process.argv[2] || '';
const title = process.argv[3] || '';
const out = await fetchGenius(artist, title);
process.stdout.write(JSON.stringify(out || { plain: '', synced: '', source: 'none' }));
