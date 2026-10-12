// /api/babybook — the book's one backend. Everything lives in this Netlify site's
// own Blob store ("babybook"): chapters and entries as two JSON documents, photos
// as binary blobs served by /photo/<name>. No database, no third-party account.
//
//   POST {op:'setup', pin}                      first run only: choose the family passphrase
//   POST {op:'list', pin}                       -> {chapters, entries}
//   POST {op:'save_chapter', pin, chapter}      -> {ok}
//   POST {op:'save_entry', pin, entry}          -> {ok}
//   POST {op:'upload', pin, type, data}         -> {url}            data = base64 image (≤ 5 MB)
//   POST {op:'album', pin, url}                 -> {title, photos}  Google Photos share link
//   POST {op:'import', pin, src}                -> {url, takenAt}   copy one album photo in
//
// The passphrase is BABYBOOK_PIN if that env var is set; otherwise the first visitor
// chooses it and a salted hash is kept in the store. Every op, reads included, needs it.

import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const config = { path: '/api/babybook' };

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const store = () => globalThis.__babybookStore || getStore({ name: 'babybook', consistency: 'strong' });

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}
const norm = (pin) => String(pin || '').trim().toLowerCase();
const hashPin = (salt, pin) => createHash('sha256').update(salt + ':' + norm(pin)).digest('hex');
function same(a, b) { const x = Buffer.from(a), y = Buffer.from(b); return x.length > 0 && x.length === y.length && timingSafeEqual(x, y); }

async function readDoc(key) { try { return (await store().get(key, { type: 'json' })) || {}; } catch (e) { return {}; } }
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const safeId = (v) => str(v, 60).replace(/[^a-zA-Z0-9_-]/g, '');
const photoName = (ext) => Date.now().toString(36) + '-' + randomBytes(4).toString('hex') + '.' + ext;

async function savePhoto(buf, type) {
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const name = photoName(ext);
  await store().set('photo/' + name, buf, { metadata: { type } });
  return '/photo/' + name;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body;
  try { body = await req.json(); } catch (e) { body = {}; }
  const op = String(body.op || 'list');

  try {
    // ---- passphrase ----
    const envPin = String(process.env.BABYBOOK_PIN || '');
    let ok = false;
    if (envPin) ok = same(norm(body.pin), norm(envPin));
    else {
      const cfg = await readDoc('doc/config');
      if (!cfg.pinHash) {
        if (op !== 'setup') return json({ error: 'Choose the family passphrase to open the book.', setup: true }, 401);
        const pin = norm(body.pin);
        if (pin.length < 4) return json({ error: 'Make the passphrase at least 4 characters.' }, 400);
        const salt = randomBytes(8).toString('hex');
        await store().setJSON('doc/config', { salt, pinHash: hashPin(salt, pin), createdAt: new Date().toISOString() });
        return json({ ok: true });
      }
      ok = same(hashPin(cfg.salt, body.pin), cfg.pinHash);
    }
    if (!ok) return json({ error: 'That passphrase is not right.' }, 401);
    if (op === 'setup') return json({ error: 'The passphrase is already set.' }, 400);

    // ---- data ----
    if (op === 'list') {
      const [c, e] = await Promise.all([readDoc('doc/chapters'), readDoc('doc/entries')]);
      const bySort = (a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0);
      return json({ chapters: Object.values(c).sort(bySort), entries: Object.values(e).sort(bySort) });
    }

    if (op === 'save_chapter') {
      const ch = body.chapter || {}; const id = safeId(ch.id);
      if (!id) return json({ error: 'chapter id required' }, 400);
      const doc = await readDoc('doc/chapters');
      doc[id] = { id, title: str(ch.title, 120), subtitle: str(ch.subtitle, 200), big: str(ch.big, 24),
        sort: Number(ch.sort) || 0, deleted: ch.deleted === true, updated_at: new Date().toISOString() };
      await store().setJSON('doc/chapters', doc);
      return json({ ok: true });
    }

    if (op === 'save_entry') {
      const en = body.entry || {}; const id = safeId(en.id);
      if (!id) return json({ error: 'entry id required' }, 400);
      const photos = Array.isArray(en.photos) ? en.photos.slice(0, 12).map(p => ({
        url: str(p && p.url, 400), caption: str(p && p.caption, 200) })).filter(p => /^(\/photo\/[A-Za-z0-9.-]+|https:\/\/[^\s"]+)$/.test(p.url)) : [];
      const kind = ['moment', 'quote', 'feature', 'cover', 'facts'].includes(en.kind) ? en.kind : 'moment';
      const doc = await readDoc('doc/entries');
      doc[id] = { id, chapter: safeId(en.chapter), time_label: str(en.time, 40), sort: Number(en.sort) || 0, kind,
        title: str(en.title, 160), body: str(en.body, 4000), cite: str(en.cite, 200), photos,
        deleted: en.deleted === true, updated_at: new Date().toISOString() };
      await store().setJSON('doc/entries', doc);
      return json({ ok: true });
    }

    // ---- photos ----
    if (op === 'upload') {
      const type = body.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const data = String(body.data || '').replace(/^data:[^,]*,/, '');
      const buf = Buffer.from(data, 'base64');
      if (!buf.length) return json({ error: 'no photo data' }, 400);
      if (buf.length > MAX_PHOTO_BYTES) return json({ error: 'photo too large (5 MB max after resizing)' }, 413);
      return json({ url: await savePhoto(buf, type) });
    }

    // Google Photos shared album: list every photo with its taken-at time, from the album page itself.
    if (op === 'album') {
      const shareUrl = String(body.url || '').trim();
      if (!/^https:\/\/(photos\.app\.goo\.gl|photos\.google\.com|goo\.gl)\//.test(shareUrl)) return json({ error: 'paste a Google Photos share link (photos.app.goo.gl/… or photos.google.com/share/…)' }, 400);
      const r = await fetch(shareUrl, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) return json({ error: 'Google Photos answered ' + r.status + ' for that link' }, 502);
      const html = await r.text();
      const photos = parseAlbum(html);
      const t = /<meta property="og:title" content="([^"]*)"/.exec(html);
      if (!photos.length) return json({ error: 'No photos found at that link. Make sure the album is shared with "anyone with the link".' }, 404);
      return json({ title: t ? t[1] : '', photos, finalUrl: r.url });
    }

    // Copy one album photo into the store (server side, so the phone never downloads it).
    if (op === 'import') {
      const src = String(body.src || '');
      if (!/^https:\/\/lh3\.googleusercontent\.com\//.test(src)) return json({ error: 'not a Google Photos image URL' }, 400);
      const base = src.replace(/=[^/]*$/, '');
      // videos: Google serves the movie for "=dv" only on video items; a photo never answers video/*
      try {
        const v = await fetch(base + '=dv', { headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(6000) });
        if (v.ok && /^video\//.test(v.headers.get('content-type') || '')) return json({ skipped: 'video' });
      } catch (e) { /* not a video, or unreachable: carry on as a photo */ }
      let takenAt = null;   // from the original's EXIF (first 256 KB), best effort
      try {
        const o = await fetch(base + '=d', { headers: { Range: 'bytes=0-262143' }, signal: AbortSignal.timeout(6000) });
        if (o.ok) takenAt = exifDateTime(new DataView(await o.arrayBuffer()));
      } catch (e) { takenAt = null; }
      const r = await fetch(base + '=w2400-h2400', { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return json({ error: 'Google answered ' + r.status + ' for that photo' }, 502);
      const type = (r.headers.get('content-type') || 'image/jpeg').split(';')[0];
      const buf = Buffer.from(await r.arrayBuffer());
      if (!buf.length) return json({ error: 'empty photo' }, 502);
      const url = await savePhoto(buf, type);
      // a small copy for the review sheet and duplicate detection
      let thumb = null;
      try {
        const s = await fetch(base + '=w320-h320', { signal: AbortSignal.timeout(6000) });
        if (s.ok) { const sb = Buffer.from(await s.arrayBuffer()); if (sb.length) { const tn = url.replace(/\.(\w+)$/, '-s.$1'); await store().set('photo/' + tn.split('/').pop(), sb, { metadata: { type: (s.headers.get('content-type') || type).split(';')[0] } }); thumb = tn; } }
      } catch (e) { thumb = null; }
      return json({ url, thumb, takenAt });
    }

    return json({ error: 'unknown op' }, 400);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 502);
  }
};

// Pull [url, width, height] triples and the first plausible ms timestamp (plus UTC offset)
// that follows each one out of a shared album page. Tolerant of the surrounding structure.
export function parseAlbum(html) {
  const out = []; const seen = new Set();
  const re = /\["(https:\/\/lh3\.googleusercontent\.com\/[^"]+)",(\d+),(\d+)/g;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1]; if (seen.has(src)) continue; seen.add(src);
    const width = +m[2], height = +m[3];
    if (width < 200 || height < 200) continue;                       // avatars, thumbnails
    const tail = html.slice(m.index, m.index + 600);
    const ts = /[\[,](1[5-9]\d{11}|2\d{12})[,\]]/.exec(tail);          // ms since epoch, 2017..2100
    let takenAt = null;
    if (ts) {
      const after = tail.slice(ts.index + ts[0].length);
      const off = /[\[,](-?\d{5,8})[,\]]/.exec(after);                  // UTC offset in ms, e.g. -21600000
      const offsetMs = off && Math.abs(+off[1]) <= 14 * 3600000 && (+off[1]) % 900000 === 0 ? +off[1] : null;
      takenAt = { ms: +ts[1], offsetMs };
    }
    out.push({ src, width, height, takenAt });
  }
  return out;
}

// EXIF DateTimeOriginal ("YYYY:MM:DD HH:MM:SS", camera-local) from a JPEG's first bytes.
export function exifDateTime(v) {
  try {
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 4 <= v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xFFE1 && o + 10 < v.byteLength && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const g16 = (p) => v.getUint16(p, le), g32 = (p) => v.getUint32(p, le);
        const find = (ifd, tag) => { if (ifd + 2 > v.byteLength) return -1; const n = g16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (e + 12 > v.byteLength) return -1; if (g16(e) === tag) return e; } return -1; };
        const ex = find(t + g32(t + 4), 0x8769); if (ex < 0) return null;
        let e = find(t + g32(ex + 8), 0x9003); if (e < 0) e = find(t + g32(ex + 8), 0x9004); if (e < 0) return null;
        const off = t + g32(e + 8); let s = '';
        for (let i = 0; i < 19 && off + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(off + i));
        return /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}/.test(s) ? s : null;
      }
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
      o += 2 + len;
    }
  } catch (e) { /* fall through */ }
  return null;
}
