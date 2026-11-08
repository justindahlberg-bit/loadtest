// Field log: timestamped notes, events and tagged photos.
import { state, save, uid, PHOTO_TAGS, NOTE_TAGS, gaugeName, sortGauges, loadCaseById } from './state.js';
import { db } from './db.js';
import { esc, $, $$, opts, dialog, confirmDlg, toast, fmtTime, toLocalInput } from './ui.js';

const P = () => state.project;

export async function photoUrl(id) {
  if (state.photoUrlCache.has(id)) return state.photoUrlCache.get(id);
  const rec = await db.get('photos', id);
  if (!rec) return '';
  const url = URL.createObjectURL(rec.blob);
  state.photoUrlCache.set(id, url);
  return url;
}

// Downscale to keep storage reasonable (max 2400 px long side, JPEG 0.85)
async function compress(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return { blob: file, w: 0, h: 0 };
  const max = 2400, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  return { blob: blob || file, w, h };
}

function gaugeOptions() {
  return sortGauges(P().gauges, P().settings.sortBy).map(g => [g.serial, gaugeName(g) + (g.girder ? ` – ${g.girder}` : '') + (g.location ? ` ${g.location}` : '')]);
}

// Called with files from the photo input. Prompts for a tag for each photo.
export async function addPhotos(files) {
  let n = 0;
  for (const file of files) {
    const now = Date.now();
    const taken = file.lastModified && Math.abs(now - file.lastModified) > 120000 ? file.lastModified : now;
    const previewUrl = URL.createObjectURL(file);
    const r = await photoDialog({ previewUrl, ts: taken, tag: '', gauge: '', lc: lastLc(), caption: '' }, `Tag photo${files.length > 1 ? ` (${n + 1} of ${files.length})` : ''}`);
    URL.revokeObjectURL(previewUrl);
    if (!r) continue;
    const { blob, w, h } = await compress(file);
    const id = uid();
    await db.put('photos', { id, blob, w, h, name: file.name });
    P().log.push({ id: uid(), kind: 'photo', ts: new Date(r.ts).toISOString(), tag: r.tag, gauge: r.gauge, loadCaseId: r.lc, text: r.caption, photoId: id, w, h });
    n++;
  }
  if (n) { await save(true); toast(`${n} photo${n > 1 ? 's' : ''} saved`); }
  return n;
}

function lastLc() {
  const log = P().log; for (let i = log.length - 1; i >= 0; i--) if (log[i].loadCaseId) return log[i].loadCaseId;
  return '';
}

function photoDialog(init, title) {
  const p = P();
  let tag = init.tag;
  return dialog({
    title,
    body: `${init.previewUrl ? `<img class="preview" src="${init.previewUrl}" alt="">` : ''}
      <p class="field">What does this photo show?</p>
      <div class="chips" id="tagChips">${PHOTO_TAGS.map(t => `<button type="button" class="chip ${t === tag ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="grid" style="margin-top:12px">
        <label id="gaugeWrap">Gauge<select name="gauge">${opts([['', '—'], ...gaugeOptions()], init.gauge)}</select></label>
        <label>Load case<select name="lc">${opts([['', '—'], ...p.loadCases.map(l => [l.id, l.name])], init.lc)}</select></label>
        <label>Time taken<input name="ts" type="datetime-local" step="1" value="${toLocalInput(init.ts)}"></label>
        <label class="wide">Caption<input name="cap" value="${esc(init.caption)}" placeholder="Optional description for the report"></label>
      </div>`,
    buttons: [{ label: 'Skip', value: null }, { label: 'Save photo', primary: true, value: d => ({ tag, gauge: $('[name=gauge]', d).value, lc: $('[name=lc]', d).value, ts: new Date($('[name=ts]', d).value).getTime() || init.ts, caption: $('[name=cap]', d).value.trim() }) }],
    validate: () => tag ? null : 'Choose a tag for this photo',
    onOpen: d => {
      $$('#tagChips .chip', d).forEach(c => c.onclick = () => { tag = c.dataset.t; $$('#tagChips .chip', d).forEach(x => x.classList.toggle('on', x === c)); });
    },
  });
}

export async function addNote(preset = {}) {
  const p = P();
  let tag = preset.tag || 'General';
  const now = Date.now();
  const r = await dialog({
    title: 'Field note',
    body: `<p class="muted small">Time stamped ${fmtTime(now)}. Notes made during a pass appear on that pass's plot.</p>
      <div class="chips" id="noteTags">${NOTE_TAGS.map(t => `<button type="button" class="chip ${t === tag ? 'on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      <div class="grid" style="margin-top:12px">
        <label>Load case<select name="lc">${opts([['', '—'], ...p.loadCases.map(l => [l.id, `${l.name}${l.description ? ' – ' + l.description : ''}`])], preset.lc ?? lastLc())}</select></label>
        <label>Gauge (optional)<select name="gauge">${opts([['', '—'], ...gaugeOptions()], '')}</select></label>
        <label class="wide">Note<textarea name="text" placeholder="What happened?"></textarea></label>
      </div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Save note', primary: true, value: d => ({ tag, lc: $('[name=lc]', d).value, gauge: $('[name=gauge]', d).value, text: $('[name=text]', d).value.trim() }) }],
    validate: (d) => ($('[name=text]', d).value.trim() || tag !== 'General') ? null : 'Write a note or choose a tag',
    onOpen: d => {
      $$('#noteTags .chip', d).forEach(c => c.onclick = () => { tag = c.dataset.t; $$('#noteTags .chip', d).forEach(x => x.classList.toggle('on', x === c)); });
      setTimeout(() => $('[name=text]', d).focus(), 50);
    },
  });
  if (!r) return false;
  p.log.push({ id: uid(), kind: 'note', ts: new Date(now).toISOString(), tag: r.tag, loadCaseId: r.lc, gauge: r.gauge, text: r.text });
  await save(true);
  toast('Note saved');
  return true;
}

let filter = 'all';
export function renderLog(main) {
  const p = P();
  main.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Field log</h2><span class="spacer"></span>
    <button class="btn" data-quick="Pass start">▶ Pass start</button><button class="btn" data-quick="Pass end">■ Pass end</button>
    <button class="btn primary" id="logNote">＋ Note</button><button class="btn primary" id="logPhoto">📷 Photo</button></div>
    <p class="muted small">Everything is time-stamped automatically. Pass start/end buttons log the time instantly with the current load case.</p>
    <div class="row" style="margin-top:8px"><span class="muted small">Show</span>
      <select id="logFilter" style="width:auto">${opts([['all', 'Everything'], ['note', 'Notes'], ['photo', 'Photos'], ...p.loadCases.map(l => ['lc:' + l.id, l.name])], filter)}</select>
      <span class="muted small" id="logCount"></span></div></div>
    <div class="list" id="logList"></div>`;
  $('#logNote').onclick = async () => { if (await addNote()) renderLogList(); };
  $('#logPhoto').onclick = () => $('#photoInput').click();
  $('#logFilter').onchange = e => { filter = e.target.value; renderLogList(); };
  $$('[data-quick]', main).forEach(b => b.onclick = async () => {
    const lcId = await pickLc(b.dataset.quick);
    if (lcId === null) return;
    p.log.push({ id: uid(), kind: 'note', ts: new Date().toISOString(), tag: b.dataset.quick, loadCaseId: lcId, text: '' });
    await save(true); toast(`${b.dataset.quick} logged ${fmtTime(Date.now())}`); renderLogList();
  });
  renderLogList();
}

async function pickLc(what) {
  const p = P();
  if (!p.loadCases.length) return '';
  const cur = lastLc();
  return dialog({
    title: what, body: `<div class="chips">${p.loadCases.map(l => `<button type="button" class="chip ${l.id === cur ? 'on' : ''}" data-l="${l.id}">${esc(l.name)}${l.description ? ' – ' + esc(l.description) : ''}</button>`).join('')}</div>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Log it', primary: true, value: d => ($('.chip.on', d) || {}).dataset?.l || '' }],
    onOpen: d => $$('.chip', d).forEach(c => c.onclick = () => { $$('.chip', d).forEach(x => x.classList.toggle('on', x === c)); }),
  });
}

export async function renderLogList() {
  const p = P(), host = $('#logList'); if (!host) return;
  let list = [...p.log].sort((a, b) => new Date(b.ts) - new Date(a.ts));
  if (filter === 'note') list = list.filter(e => e.kind !== 'photo');
  else if (filter === 'photo') list = list.filter(e => e.kind === 'photo');
  else if (filter.startsWith('lc:')) list = list.filter(e => e.loadCaseId === filter.slice(3));
  $('#logCount').textContent = `${list.length} entr${list.length === 1 ? 'y' : 'ies'}`;
  if (!list.length) { host.innerHTML = `<div class="card empty">Nothing logged yet. Use <b>＋ Note</b> or <b>📷 Photo</b> — they're also at the bottom-right of every screen.</div>`; return; }
  let lastDay = '';
  host.innerHTML = list.map(e => {
    const day = new Date(e.ts).toLocaleDateString();
    const dayHdr = day !== lastDay ? `<div class="muted small" style="margin-top:6px">${esc(day)}</div>` : '';
    lastDay = day;
    const lc = loadCaseById(e.loadCaseId);
    return `${dayHdr}<div class="log-entry" data-id="${e.id}">
      <div class="time">${fmtTime(e.ts)}</div>
      ${e.kind === 'photo' ? `<img data-photo="${e.photoId}" alt="${esc(e.tag)}">` : ''}
      <div class="body"><div class="row"><span class="pill">${esc(e.tag || e.kind)}</span>${lc ? `<span class="pill">${esc(lc.name)}</span>` : ''}${e.gauge ? `<span class="pill strain">${esc(e.gauge)}</span>` : ''}</div>
        <div class="text">${esc(e.text || '')}</div></div>
      <div class="row" style="flex-direction:column;gap:4px"><button class="btn small" data-edit="${e.id}">Edit</button><button class="btn small danger" data-del="${e.id}">Delete</button></div></div>`;
  }).join('');
  $$('img[data-photo]', host).forEach(async img => {
    img.src = await photoUrl(img.dataset.photo);
    img.onclick = () => dialog({ body: `<img src="${img.src}" style="width:100%;border-radius:8px">`, buttons: [{ label: 'Close', value: true, primary: true }] });
  });
  $$('[data-del]', host).forEach(b => b.onclick = async () => {
    const e = p.log.find(x => x.id === b.dataset.del);
    if (!(await confirmDlg(`Delete this ${e.kind}?`, 'Delete', true))) return;
    if (e.photoId) { await db.del('photos', e.photoId); state.photoUrlCache.delete(e.photoId); }
    p.log.splice(p.log.indexOf(e), 1); await save(true); renderLogList();
  });
  $$('[data-edit]', host).forEach(b => b.onclick = async () => {
    const e = p.log.find(x => x.id === b.dataset.edit);
    if (e.kind === 'photo') {
      const r = await photoDialog({ previewUrl: await photoUrl(e.photoId), ts: new Date(e.ts).getTime(), tag: e.tag, gauge: e.gauge, lc: e.loadCaseId, caption: e.text }, 'Edit photo');
      if (!r) return;
      Object.assign(e, { tag: r.tag, gauge: r.gauge, loadCaseId: r.lc, text: r.caption, ts: new Date(r.ts).toISOString() });
    } else {
      const r = await dialog({
        title: 'Edit note', body: `<div class="grid"><label>Tag<select name="tag">${opts(NOTE_TAGS, e.tag)}</select></label>
          <label>Load case<select name="lc">${opts([['', '—'], ...p.loadCases.map(l => [l.id, l.name])], e.loadCaseId)}</select></label>
          <label>Time<input name="ts" type="datetime-local" step="1" value="${toLocalInput(e.ts)}"></label>
          <label class="wide">Note<textarea name="text">${esc(e.text)}</textarea></label></div>`,
        buttons: [{ label: 'Cancel', value: null }, { label: 'Save', primary: true, value: d => ({ tag: $('[name=tag]', d).value, lc: $('[name=lc]', d).value, ts: $('[name=ts]', d).value, text: $('[name=text]', d).value }) }],
      });
      if (!r) return;
      Object.assign(e, { tag: r.tag, loadCaseId: r.lc, text: r.text, ts: new Date(r.ts).toISOString() });
    }
    await save(true); renderLogList();
  });
}
