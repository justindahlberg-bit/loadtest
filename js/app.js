// App entry: navigation, test management, report tab, backups.
import { state, save, newProject, loadProjects, openProject, uid } from './state.js';
import { db } from './db.js';
import { esc, $, $$, bindForm, opts, dialog, confirmDlg, promptDlg, toast, saveFile } from './ui.js';
import { renderBridge, renderGauges, renderVehicles, renderLoadCases } from './setup.js';
import { renderPasses, importTdmsFiles } from './passes.js';
import { renderLog, renderLogList, addNote, addPhotos } from './log.js';
import { buildReport, REPORT_SECTIONS } from './report.js';

const TABS = { bridge: renderBridge, gauges: renderGauges, vehicles: renderVehicles, loadcases: renderLoadCases, passes: renderPasses, log: renderLog, report: renderReport };

function render() {
  const main = $('#main');
  $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === state.tab));
  if (!state.project) { main.innerHTML = `<div class="card empty"><h2>No test yet</h2><p>Create a test for each bridge.</p><button class="btn primary" id="firstNew">New test</button></div>`; $('#firstNew').onclick = newTest; return; }
  try { (TABS[state.tab] || renderBridge)(main); } catch (e) { console.error(e); main.innerHTML = `<div class="card warn-box">Something went wrong: ${esc(e.message)}</div>`; }
  try { localStorage.setItem('loadtest.tab', state.tab); } catch { }
}

function renderProjectSelect() {
  const sel = $('#projectSelect');
  sel.innerHTML = state.projects.map(p => `<option value="${p.id}" ${state.project && p.id === state.project.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('') || '<option>No tests</option>';
}

async function newTest() {
  const name = await promptDlg('New test', '', 'Name (e.g. bridge number and date)');
  if (!name) return;
  const p = newProject(name);
  state.project = p; state.passCache.clear(); state.passId = null;
  await save(true);
  await loadProjects(); renderProjectSelect();
  state.tab = 'bridge'; render();
}

// ---------------- Report tab ----------------
function renderReport(main) {
  const p = state.project, rep = p.report;
  rep.sections = rep.sections || {};
  main.innerHTML = `
  <div class="card"><h2>Report</h2>
    <div class="grid">
      <label>Report title<input data-bind="report.title"></label>
      <label>Prepared by<input data-bind="report.author"></label>
      <label>Company<input data-bind="report.company"></label>
      <label>Prepared for (client)<input data-bind="report.client"></label>
      <label>Report date<input type="date" data-bind="report.date"></label>
      <label>Plots for each pass<select data-bind="report.plotMode">${opts([['group', 'One figure per gauge group'], ['dist', 'Distribution gauges only'], ['all', 'All strain gauges in one figure']], rep.plotMode || 'group')}</select></label>
      <label>Group gauges by<select data-bind="settings.groupBy">${opts([['girder', 'Girder'], ['span', 'Span'], ['section', 'Section'], ['location', 'Location'], ['type', 'Type'], ['none', 'None']])}</select></label>
      <label class="row" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-bind="report.includeDefl"> Deflection plots</label>
      <label class="row" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" data-bind="report.includePeakTables"> Peak value tables</label>
      <label class="wide">Introduction (leave blank for standard text)<textarea data-bind="report.intro"></textarea></label>
      <label class="wide">Conclusions<textarea data-bind="report.conclusions" placeholder="Leave blank to insert a placeholder you can fill in Word"></textarea></label>
    </div>
    <h3>Sections</h3>
    <div class="chips" id="secChips">${REPORT_SECTIONS.map(([k, l]) => `<button type="button" class="chip ${rep.sections[k] !== false ? 'on' : ''}" data-k="${k}">${esc(l)}</button>`).join('')}</div>
    <div class="row" style="margin-top:16px"><button class="btn primary" id="genReport">Create Word report</button><span class="muted small" id="genStatus"></span></div>
    <p class="muted small">Highlighted [bracketed] text in the report marks places to fill in. On the iPad, the share sheet lets you save the file to Files, Box, or email it.</p>
  </div>
  <div class="card"><h2>Analysis settings</h2>
    <div class="grid">
      <label>Default zeroing<select data-bind="settings.zeroMode">${opts([['linear', 'Linear drift: first → last readings'], ['initial', 'Initial readings only'], ['none', 'None']])}</select></label>
      <label>Readings averaged at start/end<input data-bind="settings.zeroN" data-type="num" inputmode="numeric"></label>
      <label>Distribution taken at<select data-bind="settings.distMethod">${opts([['maxGauge', 'Time of peak single-gauge strain'], ['maxSum', 'Time of peak total strain']])}</select></label>
      <label>Stress units<select data-bind="settings.stressUnit">${opts([['ksi', 'ksi'], ['psi', 'psi']])}</select></label>
    </div></div>`;
  if (rep.includeDefl === undefined) rep.includeDefl = true;
  if (rep.includePeakTables === undefined) rep.includePeakTables = true;
  bindForm(main);
  $$('#secChips .chip').forEach(c => c.onclick = () => { const k = c.dataset.k; rep.sections[k] = rep.sections[k] === false; c.classList.toggle('on', rep.sections[k] !== false); save(); });
  $('#genReport').onclick = async () => {
    const btn = $('#genReport'), st = $('#genStatus');
    btn.disabled = true;
    try {
      const blob = await buildReport(msg => { st.textContent = msg + '…'; });
      const base = (p.bridge.structureNo || p.name || 'Bridge').replace(/[\\/:*?"<>|]+/g, '-');
      st.textContent = `Done (${(blob.size / 1e6).toFixed(1)} MB)`;
      await saveFile(blob, `${base} Load Test Report.docx`);
    } catch (e) { console.error(e); st.textContent = ''; dialog({ title: 'Report failed', body: `<p>${esc(e.message)}</p>`, buttons: [{ label: 'OK', value: true, primary: true }] }); }
    btn.disabled = false;
  };
}

// ---------------- Backup ----------------
function b64(typed) {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
function unb64(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }

async function exportBackup() {
  const p = state.project;
  toast('Preparing backup…');
  const passData = [];
  for (const ps of p.passes) {
    const d = await db.get('passData', ps.id); if (!d) continue;
    passData.push({ id: d.id, time: b64(d.time), channels: d.channels.map(c => ({ ...c, data: b64(c.data) })) });
  }
  const photos = [];
  for (const e of p.log.filter(x => x.photoId)) {
    const r = await db.get('photos', e.photoId); if (!r) continue;
    photos.push({ id: r.id, type: r.blob.type, w: r.w, h: r.h, name: r.name, data: b64(new Uint8Array(await r.blob.arrayBuffer())) });
  }
  const json = JSON.stringify({ format: 'bridge-loadtest-backup', version: 1, exported: new Date().toISOString(), project: p, passData, photos });
  const name = `${(p.name || 'test').replace(/[\\/:*?"<>|]+/g, '-')} backup ${new Date().toISOString().slice(0, 10)}.json`;
  await saveFile(new Blob([json], { type: 'application/json' }), name);
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('Not a valid backup file'); return; }
  if (data.format !== 'bridge-loadtest-backup') { toast('Not a backup from this app'); return; }
  const p = data.project;
  const exists = await db.get('projects', p.id);
  if (exists) {
    const r = await dialog({ title: 'Test already on this device', body: `<p>“${esc(exists.name)}” is already here. Replace it with the backup, or import the backup as a separate copy?</p>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Import as copy', value: 'copy' }, { label: 'Replace', value: 'replace', danger: true }] });
    if (!r) return;
    if (r === 'copy') {
      const passMap = new Map(), photoMap = new Map();
      p.id = uid(); p.name += ' (copy)';
      p.passes.forEach(ps => { const n = uid(); passMap.set(ps.id, n); ps.id = n; });
      p.log.forEach(e => { if (e.photoId) { const n = uid(); photoMap.set(e.photoId, n); e.photoId = n; } });
      data.passData.forEach(d => { d.id = passMap.get(d.id) || d.id; });
      data.photos.forEach(ph => { ph.id = photoMap.get(ph.id) || ph.id; });
    }
  }
  for (const d of data.passData) {
    const time = new Float64Array(unb64(d.time).buffer);
    await db.put('passData', { id: d.id, time, channels: d.channels.map(c => ({ ...c, data: new Float64Array(unb64(c.data).buffer) })) });
  }
  for (const ph of data.photos) await db.put('photos', { id: ph.id, blob: new Blob([unb64(ph.data)], { type: ph.type || 'image/jpeg' }), w: ph.w, h: ph.h, name: ph.name });
  await db.put('projects', p);
  await loadProjects(); await openProject(p.id); renderProjectSelect(); render();
  toast(`Imported “${p.name}”`);
}

// ---------------- Boot ----------------
async function boot() {
  $$('#tabs button').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; render(); window.scrollTo(0, 0); });
  $('#projectSelect').onchange = async e => { await save(true); await openProject(e.target.value); render(); };
  $('#newProjectBtn').onclick = newTest;
  const menu = $('#menu');
  $('#menuBtn').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.hidden = true; });
  menu.onclick = async e => {
    const act = e.target.dataset.act; if (!act) return;
    menu.hidden = true;
    const p = state.project;
    if (act === 'import') { $('#backupInput').click(); return; }
    if (!p) return;
    if (act === 'rename') { const n = await promptDlg('Rename test', p.name); if (n) { p.name = n; await save(true); renderProjectSelect(); } }
    if (act === 'export') exportBackup();
    if (act === 'duplicate') {
      const c = JSON.parse(JSON.stringify(p));
      Object.assign(c, { id: uid(), name: p.name + ' (setup copy)', passes: [], log: [], created: Date.now() });
      c.gauges.forEach(g => { if (g.status === 'replaced') g.status = 'ok'; });
      state.project = c; await save(true); await loadProjects(); renderProjectSelect(); render(); toast('Setup copied – gauges, vehicles and load paths kept');
    }
    if (act === 'storage') {
      const est = await db.estimate();
      dialog({ title: 'Storage', body: `<p>${est ? `Using ${(est.usage / 1e6).toFixed(1)} MB of about ${(est.quota / 1e9).toFixed(1)} GB available to this app.` : 'Storage estimate not available.'}</p><p class="muted">Data stays on this iPad. Export a backup file after each test day.</p>`, buttons: [{ label: 'OK', value: true, primary: true }] });
    }
    if (act === 'delete') {
      if (!(await confirmDlg(`Delete “${p.name}” and all its data and photos from this device? This cannot be undone. Export a backup first if you might need it.`, 'Delete', true))) return;
      for (const ps of p.passes) await db.del('passData', ps.id);
      for (const e of p.log) if (e.photoId) await db.del('photos', e.photoId);
      await db.del('projects', p.id);
      const all = await loadProjects();
      state.project = null;
      if (all.length) await openProject(all[0].id);
      renderProjectSelect(); render();
    }
  };
  $('#tdmsInput').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length || !state.project) return;
    if (await importTdmsFiles(files)) { state.passId = state.project.passes[state.project.passes.length - 1]?.id; if (state.tab !== 'passes') state.tab = 'passes'; render(); }
  };
  $('#photoInput').onchange = async e => {
    const files = [...e.target.files]; e.target.value = '';
    if (!files.length || !state.project) return;
    if (await addPhotos(files) && state.tab === 'log') renderLogList();
  };
  $('#backupInput').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) importBackup(f); };
  $('#quickNote').onclick = async () => { if (!state.project) return; if (await addNote() && state.tab === 'log') renderLogList(); };
  $('#quickPhoto').onclick = () => { if (state.project) $('#photoInput').click(); };
  const setOnline = () => { $('#offlineBadge').hidden = navigator.onLine; };
  window.addEventListener('online', setOnline); window.addEventListener('offline', setOnline); setOnline();
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(true); });

  db.persist();
  const all = await loadProjects();
  let last = null; try { last = localStorage.getItem('loadtest.lastProject'); state.tab = localStorage.getItem('loadtest.tab') || 'bridge'; } catch { }
  const pick = all.find(p => p.id === last) || all[0];
  if (pick) await openProject(pick.id);
  renderProjectSelect();
  render();

  const devHost = /localhost|127\.0\.0\.1/.test(location.hostname) && !/[?&]sw=1/.test(location.search);
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !devHost) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  }
}

window.__loadtest = { state, save, render: () => render(), renderProjectSelect: () => renderProjectSelect(), loadProjects };

boot().catch(e => { console.error(e); document.getElementById('main').innerHTML = `<div class="card warn-box">Could not start: ${esc(e.message)}</div>`; });
