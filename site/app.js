// Myles's baby book — app logic.
// The story ships in story.js. The live site (/api/babybook, family passphrase)
// adds what Abby saves: edits, new chapters and moments, photos. Without the
// API (local file, preview) the book reads the shipped copy and hides editing.
// The first visitor to a fresh site chooses the passphrase.
(function () {
  'use strict';
  const API = '/api/babybook';
  const SEED = window.MYLES_STORY;
  const $ = (s, r) => (r || document).querySelector(s);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  const state = { book: Object.assign({}, SEED.book), chapters: [], entries: [], db: { chapters: [], entries: [] }, mode: 'loading', pin: '' };
  try { state.pin = localStorage.getItem('babybook_pin') || ''; } catch (e) {}

  /* ---------- data ---------- */
  function dbToEntry(r) {
    return { id: r.id, chapter: r.chapter, time: r.time_label || '', sort: Number(r.sort) || 0, kind: r.kind || 'moment',
      title: r.title || '', body: r.body || '', cite: r.cite || '', photos: Array.isArray(r.photos) ? r.photos : [], deleted: !!r.deleted };
  }
  function merge() {
    const chs = new Map(SEED.chapters.map(c => [c.id, Object.assign({ photos: [] }, c)]));
    state.db.chapters.forEach(r => chs.set(r.id, { id: r.id, title: r.title, subtitle: r.subtitle, big: r.big, sort: Number(r.sort) || 0, deleted: !!r.deleted }));
    const ens = new Map(SEED.entries.map(e => [e.id, Object.assign({ kind: 'moment', photos: [], cite: '' }, e)]));
    state.db.entries.forEach(r => ens.set(r.id, dbToEntry(r)));
    state.book = Object.assign({}, SEED.book);
    const cover = ens.get('cover'); if (cover && !cover.deleted && cover.photos[0]) state.book.coverPhoto = cover.photos[0];
    const facts = ens.get('facts'); if (facts && !facts.deleted && facts.body) { try { const f = JSON.parse(facts.body); if (Array.isArray(f) && f.length) state.book.facts = f; } catch (e) {} }
    state.chapters = [...chs.values()].filter(c => !c.deleted).sort((a, b) => a.sort - b.sort);
    state.entries = [...ens.values()].filter(e => !e.deleted && e.kind !== 'cover' && e.kind !== 'facts').sort((a, b) => a.sort - b.sort);
  }
  function entriesOf(chId) { return state.entries.filter(e => e.chapter === chId); }

  async function api(payload) {
    const r = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ pin: state.pin }, payload)) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) { const err = new Error(j.error || ('HTTP ' + r.status)); err.status = r.status; err.setup = j.setup === true; throw err; }
    return j;
  }

  async function load() {
    setStatus('Opening the book…');
    try {
      const j = await api({ op: 'list' });
      state.db = { chapters: j.chapters || [], entries: j.entries || [] };
      state.mode = 'live';
      try { localStorage.setItem('babybook_pin', state.pin); } catch (e) {}
    } catch (e) {
      if (e.status === 401 && e.setup) { state.mode = 'setup'; }
      else if (e.status === 401) { state.mode = 'locked'; state.reason = state.pin ? e.message : ''; }
      else { state.mode = 'readonly'; state.reason = e.status === 501 ? e.message : ''; }
    }
    merge(); renderAll(); syncChrome();
  }

  /* ---------- chrome ---------- */
  function setStatus(t) { $('#status').textContent = t; }
  function syncChrome() {
    const pinbar = $('#pinbar');
    pinbar.hidden = state.mode !== 'locked' && state.mode !== 'setup';
    $('#pin-label').textContent = state.mode === 'setup' ? 'Choose the family passphrase (first time only)' : 'Family passphrase';
    $('#pin-go').textContent = state.mode === 'setup' ? 'Set passphrase' : 'Open the book';
    $('#pin').autocomplete = state.mode === 'setup' ? 'new-password' : 'current-password';
    $('#btn-lock').hidden = state.mode !== 'live';
    $('#add-moment').hidden = state.mode !== 'live';
    $('#add-photos').hidden = state.mode !== 'live';
    $('#import-album').hidden = state.mode !== 'live';
    $('#add-chapter').hidden = state.mode !== 'live';
    $('#edit-facts').hidden = state.mode !== 'live';
    $('#edit-cover-l').hidden = state.mode !== 'live';
    if (state.mode === 'live') setStatus('Tap any moment to edit it or add photos. Saved for the whole family.');
    else if (state.mode === 'setup') setStatus('This book has no passphrase yet. Pick one and share it with the family; it is needed to read and to add.');
    else if (state.mode === 'locked') setStatus(state.reason || 'Enter the family passphrase to open the book.');
    else setStatus(state.reason || 'Reading the shipped copy. Open the live site with the family passphrase to add to the book.');
  }
  $('#pinbar').addEventListener('submit', async (ev) => {
    ev.preventDefault(); state.pin = $('#pin').value.trim();
    if (state.mode === 'setup') {
      setStatus('Saving the passphrase…');
      try { await api({ op: 'setup' }); } catch (e) { setStatus(e.message || String(e)); return; }
    }
    load();
  });
  $('#btn-lock').addEventListener('click', () => { state.pin = ''; try { localStorage.removeItem('babybook_pin'); } catch (e) {} state.mode = 'locked'; state.db = { chapters: [], entries: [] }; merge(); renderAll(); syncChrome(); });

  const tabs = [...document.querySelectorAll('.tabs button')];
  function showView(id) {
    tabs.forEach(t => t.setAttribute('aria-selected', t.dataset.view === id ? 'true' : 'false'));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + id));
    try { location.hash = id; } catch (e) {}
    if (id === 'book') renderBook();
  }
  tabs.forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));
  $('#btn-print').addEventListener('click', () => { showView('book'); setTimeout(() => window.print(), 150); });

  /* ---------- shared bits ---------- */
  function photoFig(p, cls) {
    const f = el('figure'); const img = el('img'); img.src = p.url; img.alt = p.caption || ''; if (cls) img.className = cls; f.appendChild(img);
    if (p.caption) f.appendChild(el('figcaption', null, p.caption));
    return f;
  }
  function pillClass(e) { return /AM|PM/.test(e.time) ? 'pill' : 'pill t'; }

  /* ---------- Read view ---------- */
  function renderRead() {
    const root = $('#read'); root.innerHTML = '';
    state.chapters.forEach(ch => {
      const sec = el('section', 'ch');
      const head = el('div', 'ch-head');
      head.appendChild(el('div', 'eyebrow', ch.title + (ch.big ? ' · ' + ch.big : '')));
      const h2 = el('h2', null, ch.subtitle || ch.title); head.appendChild(h2);
      sec.appendChild(head);
      entriesOf(ch.id).forEach(e => {
        const live = state.mode === 'live';
        if (e.kind === 'quote' || e.kind === 'feature') {
          const q = el(live ? 'button' : 'div', 'q' + (e.kind === 'feature' ? ' f' : '')); if (live) q.type = 'button';
          if (e.kind === 'feature') { q.appendChild(el('cite', null, e.time || '')); q.appendChild(el('h3', null, e.title)); q.appendChild(el('p', null, e.body)); }
          else { q.appendChild(el('blockquote', null, e.body)); if (e.cite) q.appendChild(el('cite', null, e.cite)); }
          if (e.photos && e.photos.length) { const ph = el('div', 'ph'); e.photos.forEach(x => { const i = el('img'); i.src = x.url; i.alt = x.caption || ''; i.loading = 'lazy'; ph.appendChild(i); }); q.appendChild(ph); }
          if (live) q.addEventListener('click', () => openEditor(e));
          sec.appendChild(q); return;
        }
        const mo = el(live ? 'button' : 'div', 'mo' + (live ? ' edit' : '') + ((e.body.length + e.title.length) > 170 ? ' long' : '')); if (live) mo.type = 'button';
        mo.appendChild(el('span', pillClass(e), e.time || '·'));
        const p = el('p'); if (e.title) { const b = el('b', null, e.title + ' '); p.appendChild(b); } p.appendChild(document.createTextNode(e.body)); mo.appendChild(p);
        if (e.photos && e.photos.length) { const ph = el('div', 'ph'); e.photos.forEach(x => { const i = el('img'); i.src = x.url; i.alt = x.caption || ''; i.loading = 'lazy'; ph.appendChild(i); }); mo.appendChild(ph); }
        if (live) mo.addEventListener('click', () => openEditor(e));
        sec.appendChild(mo);
      });
      if (state.mode === 'live') {
        const add = el('button', 'btn add', '+ Add a moment to ' + ch.title); add.type = 'button';
        add.addEventListener('click', () => openEditor(null, ch.id)); sec.appendChild(add);
      }
      root.appendChild(sec);
    });
  }

  /* ---------- Book view (pages) ---------- */
  // Page sizes. Blurb's PDF to Book spec for Standard Portrait: trim 8 x 10 in,
  // 0.125 in bleed top, bottom and outside edge, so each PDF page is 8.125 x 10.25.
  // We design every page at 8.25 x 10.25 (bleed on all four sides) and clip the
  // spine-side bleed when printing: recto pages drop the left strip, verso the right.
  const SIZES = {
    blurb:  { label: 'Blurb 8×10', pageW: '8.25in', pageH: '10.25in', sheetW: '8.125in', sheetH: '10.25in', bleed: '0.125in', ratio: '8.25/10.25', coverSeparate: true },
    letter: { label: 'Letter', pageW: '8.5in', pageH: '11in', sheetW: '8.5in', sheetH: '11in', bleed: '0in', ratio: '8.5/11', coverSeparate: false },
  };
  let sizeKey = 'blurb';
  try { sizeKey = localStorage.getItem('babybook_size') || 'blurb'; } catch (e) {}
  if (!SIZES[sizeKey]) sizeKey = 'blurb';
  function applySize() {
    const s = SIZES[sizeKey];
    const r = document.documentElement.style;
    r.setProperty('--page-w', s.pageW); r.setProperty('--page-h', s.pageH); r.setProperty('--sheet-w', s.sheetW); r.setProperty('--sheet-h', s.sheetH); r.setProperty('--bleed', s.bleed); r.setProperty('--page-ratio', s.ratio);
    let st = $('#pagesize-style'); if (!st) { st = el('style'); st.id = 'pagesize-style'; document.head.appendChild(st); }
    st.textContent = '@media print{@page{size:' + s.sheetW + ' ' + s.sheetH + ';margin:0}}';
    $('#size').value = sizeKey;
  }
  $('#size').addEventListener('change', () => { sizeKey = $('#size').value; try { localStorage.setItem('babybook_size', sizeKey); } catch (e) {} applySize(); renderBook(); });

  // Pages are measured as they're filled, so the web fonts must be in before the
  // flow runs; a later swap would reflow the text and spill past the page.
  let fontsSettled = false;
  const FONTS = ['500 16px "Cormorant Garamond"', 'italic 500 16px "Cormorant Garamond"', '600 16px "Cormorant Garamond"', '400 16px "Crimson Pro"', 'italic 400 16px "Crimson Pro"', '600 16px "Crimson Pro"'];
  if (document.fonts && document.fonts.load) {
    Promise.all(FONTS.map(f => document.fonts.load(f).catch(() => null))).then(() => { fontsSettled = true; if ($('#view-book').classList.contains('on')) renderBook(); });
    document.fonts.addEventListener('loadingdone', () => { if ($('#view-book').classList.contains('on')) renderBook(); });
  } else fontsSettled = true;

  /* ---------- photo shapes for the book ---------- */
  // The book lays photos out at their own proportions (no cropping to a fixed frame), so it
  // needs each photo's aspect ratio. Measured once per photo; until then a portrait is assumed.
  const dims = new Map();           // url -> width / height
  let dimsLoading = null;
  const arOf = (p) => dims.get(p.url) || 0.8;
  function ensureDims(urls) {
    const missing = urls.filter(u => !dims.has(u));
    if (!missing.length) return null;
    if (!dimsLoading) dimsLoading = Promise.all(missing.map(u => loadImg(u).then(i => dims.set(u, (i.naturalWidth / i.naturalHeight) || 0.8)).catch(() => dims.set(u, 0.8)))).then(() => { dimsLoading = null; });
    return dimsLoading;
  }

  // Photo rows: every photo in a row shares one height and keeps its own shape, so a row of
  // three portraits comes out smaller than a pair and a lone landscape runs the width of the
  // text block. Heights are in cqw (hundredths of the page width); the text block is INNER_W wide.
  const INNER_W = 80, ROW_GAP = 2, ROW_MAX = 60, SMALL_MAX = 26;
  const rowHeight = (phs) => (INNER_W - ROW_GAP * (phs.length - 1)) / phs.reduce((s, p) => s + arOf(p), 0);
  function partitionRows(list) {      // greedy; the cap alternates so pairs and triples both happen
    const rows = []; let cur = [];
    list.forEach(p => { cur.push(p); const cap = rows.length % 2 === 0 ? 52 : 40; if (rowHeight(cur) <= cap) { rows.push(cur); cur = []; } });
    if (cur.length) {
      const last = rows[rows.length - 1];
      if (cur.length === 1 && arOf(cur[0]) < 1 && last && rowHeight(last.concat(cur)) >= 22) last.push(cur[0]);   // no lone portrait at the end
      else rows.push(cur);
    }
    return rows.map(phs => ({ phs, h: Math.min(rowHeight(phs), ROW_MAX) }));
  }
  function rowNode(row, h) {
    const wrap = el('div', 'pset');
    const r = el('div', 'prow'); r.style.height = (h || row.h).toFixed(2) + 'cqw';
    row.phs.forEach(p => { const f = el('figure'); const img = el('img'); img.src = p.url; img.alt = p.caption || ''; img.style.aspectRatio = String(arOf(p)); f.appendChild(img); r.appendChild(f); });
    wrap.appendChild(r);
    const caps = row.phs.map(p => p.caption).filter(Boolean);
    if (caps.length) wrap.appendChild(el('div', 'pcap', caps.join(' · ')));
    return wrap;
  }
  const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };

  let dimsRerender = false;
  function renderBook() {
    applySize();
    const root = $('#book'); root.innerHTML = '';
    const b = state.book;
    { const urls = []; state.entries.forEach(e => (e.photos || []).forEach(p => urls.push(p.url))); if (b.coverPhoto) urls.push(b.coverPhoto.url);
      const pending = ensureDims(urls);
      if (pending && !dimsRerender) { dimsRerender = true; pending.then(() => { dimsRerender = false; if ($('#view-book').classList.contains('on')) renderBook(); }); } }
    const page = (cls) => { const p = el('div', 'page' + (cls ? ' ' + cls : '')); root.appendChild(p); return p; };
    // .inner is a normal block (the .frame overlay is absolute), so its height is the content height; the page itself clips
    const fits = (p) => p.querySelector('.inner').getBoundingClientRect().height <= p.clientHeight * 0.985;

    const SPRIG = '<svg class="sprig" viewBox="0 0 64 40" fill="none" stroke="COLOR" stroke-width="1.2" stroke-linecap="round"><path d="M32 38V6"/><path d="M32 30c-8-2-14-8-16-16 8 2 14 8 16 16zM32 30c8-2 14-8 16-16-8 2-14 8-16 16zM32 20c-6-2-10-6-12-12 6 2 10 6 12 12zM32 20c6-2 10-6 12-12-6 2-10 6-12 12z"/></svg>';
    const sprig = (color) => { const t = document.createElement('template'); t.innerHTML = SPRIG.replace('COLOR', color); return t.content.firstChild; };
    const frame = (p) => { p.appendChild(el('div', 'frame')); return p; };
    const photoPage = (ph, title) => {   // full-bleed photo with an ivory caption plate
      const p = page('photo'); const g = el('div', 'photo-pg');
      const img = el('img'); img.src = ph.url; img.alt = ph.caption || ''; g.appendChild(img);
      const plate = el('div', 'plate'); if (title) plate.appendChild(el('b', null, title)); plate.appendChild(document.createTextNode(ph.caption || '')); g.appendChild(plate);
      p.appendChild(g); return p;
    };

    // cover: monogram
    { const p = frame(page('cover')); const c = el('div', 'cov');
      c.appendChild(el('div', 'mono', b.name.charAt(0)));
      c.appendChild(el('div', 'rule'));
      c.appendChild(el('div', 'eyebrow', 'The birth of'));
      const h = el('h2'); const parts = b.fullName.split(' '); h.appendChild(document.createTextNode(parts.slice(0, -1).join(' ') + ' ')); h.appendChild(el('em', null, parts[parts.length - 1])); c.appendChild(h);
      c.appendChild(el('div', 'sub', b.date + '\n' + b.born + ' in the ' + (b.bornAmPm === 'PM' ? 'afternoon' : 'morning') + '\n' + b.place)); c.lastChild.style.whiteSpace = 'pre-line';
      c.appendChild(sprig('#8a9a7b')); p.appendChild(c); }

    // frontispiece: the cover photo, full bleed
    if (b.coverPhoto) photoPage(b.coverPhoto, b.fullName);

    // dedication
    { const p = frame(page('ded')); const i = el('div', 'inner'); i.style.height = '100%'; i.style.justifyContent = 'center'; i.style.gap = '3.2cqw';
      i.appendChild(el('div', 'ch', 'A birth story'));
      i.appendChild(el('h2', 'h', b.parents + ' welcoming their firstborn son'));
      i.appendChild(el('div', 'rule'));
      const d = el('div', null, b.date + '\n' + b.place); d.style.cssText = 'text-align:center;font:italic 3.1cqw/1.55 var(--body);color:var(--ink-soft);white-space:pre-line'; i.appendChild(d);
      i.appendChild(el('div', 'rule'));
      const r = el('div', null, 'As witnessed and lovingly recorded by ' + b.recorder); r.style.cssText = 'text-align:center;font:italic 3.1cqw/1.55 var(--body);color:var(--ink-soft)'; i.appendChild(r);
      p.appendChild(i); }

    // arrival facts
    { const p = frame(page('facts')); const i = el('div', 'inner');
      i.appendChild(el('div', 'ch', 'His arrival'));
      i.appendChild(el('h2', 'h', 'Welcome to the world'));
      const st = el('div', 'stat');
      (b.facts || []).forEach(f => { const c = el('div'); c.appendChild(el('b', null, f.label));
        c.appendChild(el('span', String(f.value || '').length > 6 ? 'long' : '', f.value)); if (f.note) c.appendChild(el('small', null, f.note)); st.appendChild(c); });
      const team = el('div'); team.appendChild(el('b', null, 'Delivery team')); team.appendChild(el('span', 'txt', b.team)); st.appendChild(team);
      const vis = el('div'); vis.appendChild(el('b', null, 'First visitors')); vis.appendChild(el('span', 'txt', b.visitors)); st.appendChild(vis);
      i.appendChild(st); p.appendChild(i); }

    // chapters: the text flows page to page with the photos set among it. A moment's photos
    // follow its words as rows of mixed size; a single portrait sits beside the words; a photo
    // marked "full" gets its own page, slipped in when the current page is full so the order holds.
    state.chapters.forEach(ch => {
      let p = null, inner = null; const pendingFull = [];
      const fullPage = (f) => { const fp = photoPage(f.photo, f.title); if (f.words) { const plate = fp.querySelector('.plate'); plate.textContent = ''; plate.appendChild(el('b', null, f.title)); plate.appendChild(document.createTextNode(f.words)); } };
      const flushFull = () => { pendingFull.splice(0).forEach(fullPage); };
      const newPage = () => { flushFull(); p = frame(page()); inner = el('div', 'inner'); p.appendChild(inner); };
      const cqw = () => p.clientWidth / 100;
      const spare = () => (p.clientHeight * 0.985 - inner.getBoundingClientRect().height) / cqw();   // room left on the page, in cqw
      const tryAdd = (node) => { if (!p) newPage(); inner.appendChild(node); if (fits(p)) return true; inner.removeChild(node); return false; };
      const add = (node) => { if (!tryAdd(node)) { newPage(); inner.appendChild(node); } };
      const addRow = (row) => {
        if (tryAdd(rowNode(row))) return;
        if (p) {                                              // shrink the row into the space that is left, within reason
          const room = spare() - 4.5;
          for (const h of [room, room * 0.92]) if (h >= 22 && h >= row.h * 0.45 && tryAdd(rowNode(row, h))) return;
        }
        newPage(); inner.appendChild(rowNode(row));
      };
      const pullQuote = (e) => {   // a quote set into the flow of the page rather than on a page of its own
        const q = el('div', 'pull'); q.appendChild(el('blockquote', null, e.body)); if (e.cite) q.appendChild(el('cite', null, e.cite)); return q;
      };
      const featureNote = (e) => { // a featured moment that has no photo yet: a centered passage in the flow
        const f = el('div', 'pull note'); if (e.time) f.appendChild(el('cite', null, e.time)); f.appendChild(el('h3', null, e.title)); f.appendChild(el('p', null, e.body)); return f;
      };
      const textRow = (e) => { const row = el('div', 'row'); row.appendChild(el('time', null, e.time || '')); row.appendChild(words(e)); return row; };
      const words = (e) => { const t = el('p'); if (e.title) t.appendChild(el('b', null, e.title + '. ')); t.appendChild(document.createTextNode(e.body)); return t; };
      const sideRow = (e, ph, small) => {   // words on the left, one photo on the right
        const row = el('div', 'side' + (small ? ' sm' : '')); const left = el('div');
        left.appendChild(el('time', null, e.time || '')); left.appendChild(words(e)); row.appendChild(left);
        const f = el('figure'); const img = el('img'); img.src = ph.url; img.alt = ph.caption || ''; img.style.aspectRatio = String(arOf(ph)); f.appendChild(img);
        if (ph.caption) f.appendChild(el('figcaption', null, ph.caption)); row.appendChild(f); return row;
      };

      newPage();
      inner.appendChild(el('div', 'ch', ch.title));
      inner.appendChild(el('h2', 'h', ch.subtitle || ch.title));
      inner.appendChild(el('div', 'rule'));

      entriesOf(ch.id).forEach(e => {
        const photos = e.photos || [];
        if (e.kind === 'quote') {
          add(pullQuote(e));
          partitionRows(photos).forEach(addRow);
          return;
        }
        if (e.kind === 'feature') {
          // its own page: the lead photo full bleed with the words on the plate (the first photo
          // marked "full", else the first photo); the rest of its photos follow as rows.
          // Without a photo it is a centered passage in the flow.
          const hero = photos.find(x => x.size === 'full') || photos[0];
          if (!hero) { add(featureNote(e)); return; }
          const lead = { photo: hero, title: e.title + (e.time ? ' · ' + e.time : ''), words: e.body + (hero.caption ? ' ' + hero.caption : '') };
          if (p && spare() > 60) pendingFull.push(lead);        // the page has barely begun: fill it first, the lead photo follows at the page turn
          else { flushFull(); fullPage(lead); p = null; }      // otherwise the lead photo comes right here
          const rest = photos.filter(x => x !== hero);
          partitionRows(rest.filter(x => x.size !== 'small')).forEach(addRow);
          chunk(rest.filter(x => x.size === 'small'), 4).forEach(phs => addRow({ phs, h: Math.min(rowHeight(phs), SMALL_MAX) }));
          return;
        }
        const fulls = photos.filter(x => x.size === 'full'), rest = photos.filter(x => x.size !== 'full');
        let normals = rest.filter(x => x.size !== 'small'); const smalls = rest.filter(x => x.size === 'small');
        if (rest.length === 1 && arOf(rest[0]) < 1.05) { add(sideRow(e, rest[0], rest[0].size === 'small')); normals = []; smalls.length = 0; }
        else if (normals.length % 2 === 1 && arOf(normals[0]) < 1 && e.body.length <= 320) { add(sideRow(e, normals[0])); normals = normals.slice(1); }
        else add(textRow(e));
        chunk(smalls, 4).forEach(phs => addRow({ phs, h: Math.min(rowHeight(phs), SMALL_MAX) }));   // detail shots sit close to the words
        partitionRows(normals).forEach(addRow);
        fulls.forEach(photo => pendingFull.push({ photo, title: e.title }));
      });
      flushFull();
    });

    // closing
    { const p = frame(page('end')); const i = el('div', 'inner');
      i.appendChild(sprig('#8a9a7b'));
      i.appendChild(el('div', 'ch', 'Day one of ' + b.name + "'s story"));
      i.appendChild(el('h2', 'h', 'To be continued'));
      i.appendChild(el('div', 'rule'));
      i.appendChild(el('div', 'sub', 'Recorded in Room 115 by ' + b.recorder + '. The next chapters are Abby\'s to write.')); p.appendChild(i); }

    // cover handling, even page count, recto/verso sheets
    const size = SIZES[sizeKey];
    const coverart = $('#coverart');
    coverart.hidden = !size.coverSeparate;
    [...coverart.querySelectorAll('.page')].forEach(n => n.remove());
    if (size.coverSeparate) { const cv = root.firstChild; coverart.appendChild(cv); }
    if (size.coverSeparate && root.children.length % 2 === 1) { const blank = page('blank'); blank.appendChild(el('div', 'inner')); }
    [...root.children].forEach((pg, n) => {
      const pageNo = size.coverSeparate ? n + 1 : n;           // Blurb: first inside page is page 1 (recto)
      const recto = pageNo % 2 === 1;
      if (pageNo > 0 && !/quote|end|blank|photo|ded|feature/.test(pg.className)) pg.appendChild(el('div', 'folio', '· ' + pageNo + ' ·'));
      const leaf = el('div', 'leaf ' + (recto ? 'recto' : 'verso')); root.replaceChild(leaf, pg); leaf.appendChild(pg);
    });
    const n = root.children.length;
    $('#pagecount').textContent = n + ' pages' + (size.coverSeparate ? ' inside' + (n < 20 ? ' (Blurb needs at least 20)' : '') : '');
  }

  function renderAll() { renderRead(); if ($('#view-book').classList.contains('on')) renderBook(); }

  /* ---------- editor ---------- */
  const dlg = $('#sheet');
  let editing = null; // {entry, isNew}
  function uid() { return 'a-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function openEditor(entry, chapterId) {
    const isNew = !entry;
    const e = entry ? JSON.parse(JSON.stringify(entry)) : { id: uid(), chapter: chapterId || (state.chapters[state.chapters.length - 1] || {}).id, time: '', sort: 0, kind: 'moment', title: '', body: '', cite: '', photos: [] };
    if (isNew) { const ex = entriesOf(e.chapter); e.sort = (ex.length ? ex[ex.length - 1].sort : 0) + 1; }
    editing = { entry: e, isNew };
    $('#sh-title').textContent = isNew ? 'Add a moment' : 'Edit this moment';
    const sel = $('#f-chapter'); sel.innerHTML = ''; state.chapters.forEach(c => { const o = el('option', null, c.title); o.value = c.id; sel.appendChild(o); }); sel.value = e.chapter;
    $('#f-kind').value = ['quote', 'feature'].includes(e.kind) ? e.kind : 'moment';
    $('#f-time').value = e.time; $('#f-sort').value = e.sort; $('#f-title').value = e.title; $('#f-body').value = e.body; $('#f-cite').value = e.cite;
    $('#f-delete').hidden = isNew; $('#f-err').textContent = '';
    renderPhotoList(); kindChanged();
    dlg.showModal();
  }
  function kindChanged() { const q = $('#f-kind').value === 'quote'; $('#l-cite').hidden = !q; $('#l-title').hidden = q; }
  $('#f-kind').addEventListener('change', kindChanged);

  function renderPhotoList() {
    const list = $('#f-photos'); list.innerHTML = '';
    editing.entry.photos.forEach((p, i) => {
      const row = el('div', 'pitem'); const img = el('img'); img.src = p.url; img.alt = ''; row.appendChild(img);
      const cap = el('input'); cap.placeholder = 'Caption'; cap.value = p.caption || ''; cap.addEventListener('input', () => { p.caption = cap.value; }); row.appendChild(cap);
      const sz = el('select'); sz.title = 'Size in the book';
      [['', 'Auto size'], ['small', 'Small'], ['full', 'Full page']].forEach(([v, t]) => { const o = el('option', null, t); o.value = v; sz.appendChild(o); });
      sz.value = p.size || ''; sz.addEventListener('change', () => { if (sz.value) p.size = sz.value; else delete p.size; }); row.appendChild(sz);
      const rm = el('button', 'btn d', 'Remove'); rm.type = 'button'; rm.addEventListener('click', () => { editing.entry.photos.splice(i, 1); renderPhotoList(); }); row.appendChild(rm);
      list.appendChild(row);
    });
  }

  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url);
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); resolve(c.toDataURL('image/jpeg', 0.84)); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a photo the browser can read.')); };
      img.src = url;
    });
  }
  async function uploadFiles(files, onDone) {
    const errBox = $('#f-err'); const btn = $('#f-addphoto');
    btn.disabled = true;
    try {
      for (let i = 0; i < files.length; i++) {
        errBox.textContent = 'Uploading photo ' + (i + 1) + ' of ' + files.length + '…';
        const data = await resizeImage(files[i], 2400);
        const j = await api({ op: 'upload', type: 'image/jpeg', data });
        onDone({ url: j.url, caption: '' });
      }
      errBox.textContent = '';
    } catch (e) { errBox.textContent = e.message || String(e); }
    btn.disabled = false;
  }
  $('#f-file').addEventListener('change', (ev) => { const fs = [...ev.target.files]; ev.target.value = ''; if (fs.length) uploadFiles(fs, (p) => { editing.entry.photos.push(p); renderPhotoList(); }); });

  $('#f-cancel').addEventListener('click', () => dlg.close());
  $('#f-delete').addEventListener('click', async () => {
    if ($('#f-delete').dataset.armed !== '1') { $('#f-delete').dataset.armed = '1'; $('#f-delete').textContent = 'Tap again to delete'; return; }
    await saveEntry(Object.assign({}, editing.entry, { deleted: true }));
  });
  $('#sheetform').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = editing.entry;
    e.chapter = $('#f-chapter').value; e.kind = $('#f-kind').value; e.time = $('#f-time').value.trim(); e.sort = Number($('#f-sort').value) || 0;
    e.title = $('#f-title').value.trim(); e.body = $('#f-body').value.trim(); e.cite = $('#f-cite').value.trim();
    if (!e.body) { $('#f-err').textContent = 'Write a few words first.'; return; }
    await saveEntry(e);
  });
  async function saveEntry(e) {
    $('#f-err').textContent = 'Saving…'; $('#f-save').disabled = true;
    try {
      await api({ op: 'save_entry', entry: e });
      const row = { id: e.id, chapter: e.chapter, time_label: e.time, sort: e.sort, kind: e.kind, title: e.title, body: e.body, cite: e.cite, photos: e.photos, deleted: !!e.deleted };
      state.db.entries = state.db.entries.filter(r => r.id !== e.id).concat([row]);
      merge(); renderAll(); dlg.close();
    } catch (err) { $('#f-err').textContent = err.message || String(err); }
    $('#f-save').disabled = false; $('#f-delete').dataset.armed = '0'; $('#f-delete').textContent = 'Delete';
  }

  /* ---------- photos placed by timestamp ---------- */
  // DateTimeOriginal straight out of the JPEG's EXIF block (no library), else the file's own date.
  function exifDate(file) {
    return new Promise(resolve => {
      const fallback = file.lastModified ? new Date(file.lastModified) : null;
      const r = new FileReader();
      r.onerror = () => resolve(fallback);
      r.onload = () => { try { resolve(parseExif(new DataView(r.result)) || fallback); } catch (e) { resolve(fallback); } };
      r.readAsArrayBuffer(file.slice(0, 256 * 1024));
    });
  }
  function parseExif(v) {
    if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o + 4 <= v.byteLength) {
      const marker = v.getUint16(o), len = v.getUint16(o + 2);
      if (marker === 0xFFE1 && o + 10 < v.byteLength && v.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const g16 = (p) => v.getUint16(p, le), g32 = (p) => v.getUint32(p, le);
        const find = (ifd, tag) => { const n = g16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (e + 12 > v.byteLength) return -1; if (g16(e) === tag) return e; } return -1; };
        const ex = find(t + g32(t + 4), 0x8769); if (ex < 0) return null;
        const exifIfd = t + g32(ex + 8);
        let e = find(exifIfd, 0x9003); if (e < 0) e = find(exifIfd, 0x9004); if (e < 0) return null;
        const off = t + g32(e + 8); let s = '';
        for (let i = 0; i < 19 && off + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(off + i));
        const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s); if (!m) return null;
        return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
      }
      if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
      o += 2 + len;
    }
    return null;
  }
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const birthDay = () => { const d = (SEED.book.dateISO || '2026-10-10').split('-'); return new Date(+d[0], d[1] - 1, +d[2]); };
  function labelMinutes(label) {       // "4:51 AM" -> minutes since midnight, else null
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(String(label || '').trim()); if (!m) return null;
    let h = +m[1] % 12; if (/pm/i.test(m[3] || '')) h += 12; if (!m[3] && +m[1] <= 6) h += 12;   // bare "1:17" in this book is afternoon
    return h * 60 + +m[2];
  }
  function labelDay(label) {           // "Oct 12" or "Oct 12, 2026" -> Date at midnight, else null
    const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/.exec(String(label || '').trim()); if (!m) return null;
    const mo = MONTHS.indexOf(m[1].toLowerCase()); if (mo < 0) return null;
    const b = birthDay(); let y = m[3] ? +m[3] : b.getFullYear(); if (!m[3] && mo < b.getMonth()) y += 1;
    return new Date(y, mo, +m[2]);
  }
  const sameDay = (a, b) => a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  // Every entry gets a wall-clock instant: timed moments on the birth day, dated labels on their day,
  // untimed ones inherit the previous entry's. Returns [{entry, at}] in book order.
  function entryInstants() {
    const out = []; const b = birthDay(); let last = b.getTime();
    state.chapters.forEach(ch => {
      const chDay = labelDay(ch.big) || labelDay(ch.title);
      entriesOf(ch.id).forEach(e => {
        let at = null; const mins = labelMinutes(e.time), day = labelDay(e.time);
        if (day) at = day.getTime() + (12 * 60) * 60000;
        else if (mins != null) at = (chDay || b).getTime() + mins * 60000;
        else at = last;
        last = at; out.push({ entry: e, at });
      });
    });
    return out;
  }
  function bestEntryFor(when) {        // the latest moment at or just before the photo, on the same day
    const inst = entryInstants(); if (!inst.length) return null;
    if (!when) return inst[inst.length - 1].entry;
    const t = when.getTime();
    const day = inst.filter(x => sameDay(new Date(x.at), when));
    if (!day.length) return null;
    let pick = day[0]; day.forEach(x => { if (x.at <= t + 60000) pick = x; });
    return pick.entry;
  }
  const fmtWhen = (d) => d ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'no date in the photo';

  /* ---------- near-duplicates: keep the sharpest of a burst ---------- */
  // Fingerprint = 64-bit difference hash of a 9x8 grayscale thumbnail, plus a sharpness
  // score (variance of a Laplacian over a 64x64 grayscale). Two photos within two minutes
  // of each other whose hashes differ in 10 bits or fewer are the same shot.
  function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('image failed to load')); i.src = src; }); }
  function grayOf(img, w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, w, h); const d = x.getImageData(0, 0, w, h).data; const g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return g;
  }
  async function fingerprint(src) {
    const img = await loadImg(src);
    const g = grayOf(img, 9, 8); const bits = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) bits.push(g[r * 9 + c] > g[r * 9 + c + 1] ? 1 : 0);
    const s = grayOf(img, 64, 64); let sum = 0, sum2 = 0, n = 0;
    for (let r = 1; r < 63; r++) for (let c = 1; c < 63; c++) { const v = 4 * s[r * 64 + c] - s[(r - 1) * 64 + c] - s[(r + 1) * 64 + c] - s[r * 64 + c - 1] - s[r * 64 + c + 1]; sum += v; sum2 += v * v; n++; }
    const mean = sum / n; const sharp = sum2 / n - mean * mean;
    return { hash: bits, sharp, px: img.naturalWidth * img.naturalHeight };
  }
  const hamming = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
  async function dedupe(list) {
    for (const ph of list) { try { ph.fp = await fingerprint(ph.thumb); } catch (e) { ph.fp = null; } ph.dup = false; ph.dupOf = null; }
    const groups = [];
    list.forEach(ph => {
      if (!ph.fp) return;
      const g = groups.find(gr => gr.some(o => o.fp && hamming(o.fp.hash, ph.fp.hash) <= 10 && (!o.when || !ph.when || Math.abs(o.when - ph.when) <= 120000)));
      if (g) g.push(ph); else groups.push([ph]);
    });
    let skipped = 0;
    groups.filter(g => g.length > 1).forEach(g => {
      const best = g.reduce((a, b) => (b.fp.sharp > a.fp.sharp * 1.05 || (Math.abs(b.fp.sharp - a.fp.sharp) <= a.fp.sharp * 0.05 && b.fp.px > a.fp.px)) ? b : a);
      g.forEach(ph => { if (ph !== best) { ph.dup = true; ph.dupOf = best; skipped++; } });
    });
    return skipped;
  }

  const pdlg = $('#psheet');
  let placing = [];
  $('#bulk-file').addEventListener('change', async (ev) => {
    const files = [...ev.target.files]; ev.target.value = ''; if (!files.length) return;
    placing = [];
    const lbl = $('#add-photos'); lbl.classList.add('busy');
    try {
      for (let i = 0; i < files.length; i++) {
        setStatus('Reading photo ' + (i + 1) + ' of ' + files.length + '…');
        const when = await exifDate(files[i]);
        const data = await resizeImage(files[i], 2400);
        setStatus('Uploading photo ' + (i + 1) + ' of ' + files.length + '…');
        const j = await api({ op: 'upload', type: 'image/jpeg', data });
        placing.push({ url: j.url, thumb: data, when, caption: '', entry: bestEntryFor(when) });
      }
      placing.sort((a, b) => (a.when ? a.when.getTime() : 0) - (b.when ? b.when.getTime() : 0));
      setStatus('Checking for duplicate shots…'); await dedupe(placing);
      openPlacer();
    } catch (e) { setStatus(e.message || String(e)); }
    lbl.classList.remove('busy'); if (state.mode === 'live' && !placing.length) syncChrome();
  });
  function openPlacer() {
    const list = $('#ps-list'); list.innerHTML = ''; $('#ps-err').textContent = '';
    const dups = placing.filter(p => p.dup).length;
    $('#ps-note').textContent = dups ? dups + (dups === 1 ? ' near-duplicate shot is' : ' near-duplicate shots are') + ' skipped in favor of the sharpest; tap Keep on any you want anyway.' : '';
    placing.forEach((ph, i) => {
      const row = el('div', 'ps' + (ph.dup ? ' dup' : '')); const img = el('img'); img.src = ph.thumb; img.alt = ''; row.appendChild(img);
      const when = el('div', 'when', fmtWhen(ph.when)); row.appendChild(when);
      if (ph.dup) { const k = el('button', 'btn keep', 'Duplicate · skipped. Keep?'); k.type = 'button'; k.addEventListener('click', () => { ph.dup = false; row.classList.remove('dup'); k.remove(); }); when.appendChild(k); }
      const sel = el('select'); sel.id = 'ps-sel-' + i;
      state.chapters.forEach(ch => { const og = el('optgroup'); og.label = ch.title;
        entriesOf(ch.id).forEach(e => { const o = el('option', null, (e.time ? e.time + ' · ' : '') + (e.title || e.body.slice(0, 40))); o.value = e.id; og.appendChild(o); });
        const nw = el('option', null, '+ New moment in ' + ch.title); nw.value = 'new:' + ch.id; og.appendChild(nw); sel.appendChild(og); });
      sel.value = ph.entry ? ph.entry.id : 'new:' + (state.chapters[state.chapters.length - 1] || {}).id;
      sel.addEventListener('change', () => { ph.target = sel.value; }); ph.target = sel.value; row.appendChild(sel);
      const cap = el('input'); cap.placeholder = 'Caption (optional)'; cap.id = 'ps-cap-' + i; cap.addEventListener('input', () => { ph.caption = cap.value; }); row.appendChild(cap);
      list.appendChild(row);
    });
    pdlg.showModal();
  }
  $('#ps-cancel').addEventListener('click', () => { pdlg.close(); syncChrome(); });

  // Google Photos album → the same placement sheet. The server reads the album and copies
  // each photo; the taken-at time comes from the album data or the photo's EXIF.
  const adlg = $('#asheet');
  $('#import-album').addEventListener('click', () => { $('#a-err').textContent = ''; adlg.showModal(); $('#a-url').focus(); });
  $('#a-cancel').addEventListener('click', () => adlg.close());
  const exifToDate = (s) => { const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null; };
  const albumToDate = (t) => { if (!t || !t.ms) return null; const utc = new Date(t.ms); if (t.offsetMs == null) return utc; // camera-local wall clock, rebuilt in this browser's zone
    const d = new Date(t.ms + t.offsetMs); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()); };
  $('#asheetform').addEventListener('submit', async (ev) => {
    ev.preventDefault(); const url = $('#a-url').value.trim(); if (!url) return;
    $('#a-go').disabled = true; $('#a-err').textContent = 'Reading the album…';
    try {
      const a = await api({ op: 'album', url });
      const list = a.photos || []; placing = []; let videos = 0, failed = 0;
      for (let i = 0; i < list.length; i++) {
        $('#a-err').textContent = 'Copying ' + (i + 1) + ' of ' + list.length + (a.title ? ' from "' + a.title + '"' : '') + '…';
        let j; try { j = await api({ op: 'import', src: list[i].src }); } catch (e) { failed++; continue; }
        if (j.skipped === 'video') { videos++; continue; }
        const when = exifToDate(j.takenAt) || albumToDate(list[i].takenAt);
        placing.push({ url: j.url, thumb: j.thumb || j.url, when, caption: '', entry: bestEntryFor(when) });
      }
      placing.sort((x, y) => (x.when ? x.when.getTime() : 0) - (y.when ? y.when.getTime() : 0));
      $('#a-err').textContent = 'Checking for duplicate shots…'; const dups = await dedupe(placing);
      adlg.close(); $('#a-err').textContent = '';
      setStatus(placing.length + ' photos copied' + (videos ? ', ' + videos + ' video' + (videos === 1 ? '' : 's') + ' left out' : '') + (dups ? ', ' + dups + ' duplicate' + (dups === 1 ? '' : 's') + ' skipped' : '') + (failed ? ', ' + failed + ' could not be copied' : '') + '.');
      if (placing.length) openPlacer(); else if (!videos && !failed) setStatus('No photos found in that album.');
    } catch (e) { $('#a-err').textContent = e.message || String(e); }
    $('#a-go').disabled = false;
  });
  $('#psheetform').addEventListener('submit', async (ev) => {
    ev.preventDefault(); $('#ps-err').textContent = 'Placing…'; $('#ps-save').disabled = true;
    try {
      const byTarget = new Map();
      placing.filter(ph => !ph.dup).forEach(ph => { const k = ph.target; if (!byTarget.has(k)) byTarget.set(k, []); byTarget.get(k).push(ph); });
      for (const [k, phs] of byTarget) {
        let e;
        if (k.startsWith('new:')) {
          const chId = k.slice(4); const ex = entriesOf(chId); const first = phs[0].when;
          const timeLabel = first ? (sameDay(first, birthDay()) ? first.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : first.toLocaleDateString([], { month: 'short', day: 'numeric' })) : '';
          e = { id: uid(), chapter: chId, time: timeLabel, sort: (ex.length ? ex[ex.length - 1].sort : 0) + 1, kind: 'moment', title: '', body: 'Photos' + (timeLabel ? ' from ' + timeLabel : ''), cite: '', photos: [] };
        } else { e = JSON.parse(JSON.stringify(state.entries.find(x => x.id === k))); }
        e.photos = (e.photos || []).concat(phs.map(ph => ({ url: ph.url, caption: ph.caption || '' })));
        await api({ op: 'save_entry', entry: e });
        const row = { id: e.id, chapter: e.chapter, time_label: e.time, sort: e.sort, kind: e.kind, title: e.title, body: e.body, cite: e.cite, photos: e.photos, deleted: false };
        state.db.entries = state.db.entries.filter(r => r.id !== e.id).concat([row]);
      }
      merge(); renderAll(); pdlg.close(); placing = []; syncChrome();
    } catch (err) { $('#ps-err').textContent = err.message || String(err); }
    $('#ps-save').disabled = false;
  });

  // chapter editor
  const cdlg = $('#csheet');
  $('#add-chapter').addEventListener('click', () => { $('#c-title').value = ''; $('#c-sub').value = ''; $('#c-big').value = ''; $('#c-err').textContent = ''; cdlg.showModal(); });
  $('#c-cancel').addEventListener('click', () => cdlg.close());
  $('#csheetform').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const title = $('#c-title').value.trim(); if (!title) { $('#c-err').textContent = 'Give the chapter a name.'; return; }
    const ch = { id: uid(), title, subtitle: $('#c-sub').value.trim(), big: $('#c-big').value.trim(), sort: (state.chapters.length ? state.chapters[state.chapters.length - 1].sort : 0) + 1 };
    $('#c-err').textContent = 'Saving…';
    try { await api({ op: 'save_chapter', chapter: ch }); state.db.chapters.push(Object.assign({ deleted: false }, ch)); merge(); renderAll(); cdlg.close(); }
    catch (err) { $('#c-err').textContent = err.message || String(err); }
  });
  $('#add-moment').addEventListener('click', () => openEditor(null));

  // cover photo
  $('#edit-cover').addEventListener('change', async (ev) => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    setStatus('Uploading cover photo…');
    try { const data = await resizeImage(f, 2400); const j = await api({ op: 'upload', type: 'image/jpeg', data });
      const e = { id: 'cover', chapter: '', time: '', sort: 0, kind: 'cover', title: '', body: 'cover', cite: '', photos: [{ url: j.url, caption: '' }] };
      await api({ op: 'save_entry', entry: e });
      state.db.entries = state.db.entries.filter(r => r.id !== 'cover').concat([{ id: 'cover', kind: 'cover', photos: e.photos, body: 'cover', chapter: '', time_label: '', sort: 0, title: '', cite: '', deleted: false }]);
      merge(); renderAll(); syncChrome();
    } catch (err) { setStatus(err.message || String(err)); }
  });

  // facts editor
  const fdlg = $('#fsheet');
  $('#edit-facts').addEventListener('click', () => {
    const list = $('#fs-list'); list.innerHTML = '';
    (state.book.facts || []).forEach(addFactRow);
    $('#fs-err').textContent = ''; fdlg.showModal();
  });
  function addFactRow(f) {
    const row = el('div', 'pitem'); ['label', 'value', 'note'].forEach(k => { const i = el('input'); i.placeholder = k === 'label' ? 'Label (Weight)' : k === 'value' ? 'Value (7 lb 9 oz)' : 'Small note'; i.value = (f && f[k]) || ''; i.dataset.k = k; row.appendChild(i); });
    row.dataset.tone = (f && f.tone) || ''; $('#fs-list').appendChild(row);
  }
  $('#fs-add').addEventListener('click', () => addFactRow(null));
  $('#fs-cancel').addEventListener('click', () => fdlg.close());
  $('#fsheetform').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const facts = [...$('#fs-list').children].map((row, i) => { const o = { tone: row.dataset.tone || (i % 3 === 0 ? 'sage' : '') }; row.querySelectorAll('input').forEach(inp => { o[inp.dataset.k] = inp.value.trim(); }); return o; }).filter(f => f.label && f.value);
    $('#fs-err').textContent = 'Saving…';
    try { const e = { id: 'facts', chapter: '', time: '', sort: 0, kind: 'facts', title: '', body: JSON.stringify(facts), cite: '', photos: [] };
      await api({ op: 'save_entry', entry: e });
      state.db.entries = state.db.entries.filter(r => r.id !== 'facts').concat([{ id: 'facts', kind: 'facts', body: e.body, photos: [], chapter: '', time_label: '', sort: 0, title: '', cite: '', deleted: false }]);
      merge(); renderAll(); fdlg.close(); }
    catch (err) { $('#fs-err').textContent = err.message || String(err); }
  });

  /* ---------- boot ---------- */
  merge(); renderAll();
  const h = (location.hash || '').replace('#', '');
  showView(h === 'book' ? 'book' : 'read');
  window.addEventListener('resize', () => { if ($('#view-book').classList.contains('on')) renderBook(); });
  window.addEventListener('beforeprint', () => { showView('book'); });
  load();
})();
