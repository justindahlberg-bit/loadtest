// Data & plots tab: TDMS import, processing, plots and results.
import { state, save, uid, getPassData, registerChannels, gaugeOffset, groupKey, sortGauges, isStrain, isDefl, gaugeName, loadCaseById, vehicleById } from './state.js';
import { db } from './db.js';
import { parseTdms, toPass } from './tdms.js';
import { zeroChannel, vehicleWindows, positionAt, indexRange, channelPeaks, distribution, speedMph, bridgeLength, fmt, ftin } from './calc.js';
import { PlotView, seriesStyle, PALETTE } from './plot.js';
import { drawDistribution, drawInto } from './draw.js';
import { esc, $, $$, bindForm, opts, dialog, confirmDlg, toast, saveFile, fmtTime } from './ui.js';

const P = () => state.project;
const BAD = ['bad', 'unused', 'removed', 'replaced'];

// ---------- import ----------
export async function importTdmsFiles(files) {
  const p = P();
  let ok = 0;
  const errors = [];
  for (const file of files) {
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseTdms(buf);
      const pass = toPass(parsed, file.name);
      if (!pass.time.length) throw new Error('no samples in file');
      if (p.passes.find(x => x.fileName === file.name)) { errors.push(`${file.name}: already imported`); continue; }
      const id = uid();
      await db.put('passData', { id, time: pass.time, channels: pass.channels });
      registerChannels(pass.channels);
      const run = (/_R(\d+)_/.exec(file.name) || [])[1];
      const meta = {
        id, fileName: file.name, name: run ? `R${run}` : file.name.replace(/\.tdms$/i, ''),
        loadCaseId: '', title: pass.title, description: pass.description, startLocal: pass.startLocal, startText: pass.startText,
        sampleRate: pass.sampleRate, nSamples: pass.time.length, duration: pass.time[pass.time.length - 1] - pass.time[0],
        channels: pass.channels.map(c => ({ serial: c.serial, type: c.type, unit: c.unit })), clicks: pass.clicks,
        vehicles: [], excluded: [], zeroMode: '', notes: '', marksOverride: false, marks: { ...p.marks }, imported: Date.now(),
      };
      // Guess load case: next one in order without a pass yet
      const used = new Set(p.passes.map(x => x.loadCaseId));
      const nextLc = p.loadCases.find(lc => !used.has(lc.id));
      if (nextLc) meta.loadCaseId = nextLc.id;
      autoAssignVehicles(meta);
      p.passes.push(meta);
      ok++;
    } catch (e) {
      console.error(e);
      errors.push(`${file.name}: ${e.message}`);
    }
  }
  p.passes.sort((a, b) => String(a.startLocal).localeCompare(String(b.startLocal)));
  await save(true);
  if (errors.length) await dialog({ title: 'Some files were not imported', body: `<ul>${errors.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`, buttons: [{ label: 'OK', value: true, primary: true }] });
  if (ok) toast(`Imported ${ok} file${ok > 1 ? 's' : ''}`);
  return ok;
}

// Assign mark (click) groups to vehicles. Splits at the largest gaps between marks.
export function autoAssignVehicles(pass) {
  const p = P();
  const lc = loadCaseById(pass.loadCaseId);
  let ids = (lc && lc.vehicleIds && lc.vehicleIds.length) ? lc.vehicleIds : (p.vehicles[0] ? [p.vehicles[0].id] : ['']);
  const n = pass.clicks.length;
  if (!n) { pass.vehicles = ids.map(id => ({ vehicleId: id, from: 0, to: 0, manual: true, tOn: '', tOff: '' })); return; }
  const k = Math.min(ids.length, n);
  ids = ids.slice(0, k);
  const gaps = [];
  for (let i = 1; i < n; i++) gaps.push({ i, g: pass.clicks[i].t - pass.clicks[i - 1].t });
  const median = [...gaps].sort((a, b) => a.g - b.g)[Math.floor(gaps.length / 2)]?.g || 0;
  let cuts = [...gaps].sort((a, b) => b.g - a.g).slice(0, k - 1);
  // if gaps are not clearly larger than typical spacing, split evenly instead
  if (cuts.some(c => c.g < median * 1.5)) cuts = Array.from({ length: k - 1 }, (_, j) => ({ i: Math.round(n * (j + 1) / k) }));
  const bounds = [0, ...cuts.map(c => c.i).sort((a, b) => a - b), n];
  pass.vehicles = ids.map((id, j) => ({ vehicleId: id, from: bounds[j] + 1, to: bounds[j + 1], manual: false, tOn: '', tOff: '' }));
}

// ---------- processing ----------
export function activeGauges(pass) {
  const p = P();
  const ex = new Set(pass.excluded || []);
  const serials = new Set(pass.channels.map(c => c.serial));
  return sortGauges(p.gauges.filter(g => serials.has(g.serial) && !BAD.includes(g.status) && !ex.has(g.serial)), p.settings.sortBy);
}

export async function processPass(pass) {
  const p = P();
  const data = await getPassData(pass.id);
  if (!data) return null;
  const time = data.time;
  const mode = pass.zeroMode || p.settings.zeroMode;
  const gauges = activeGauges(pass);
  const series = {};
  for (const ch of data.channels) {
    if (!gauges.find(g => g.serial === ch.serial)) continue;
    series[ch.serial] = zeroChannel(time, ch.data, mode, p.settings.zeroN || 10);
  }
  const wins = vehicleWindows(pass, p, time);
  const distGauges = gauges.filter(g => g.dist && isStrain(g)).map(g => ({ serial: g.serial, name: gaugeName(g), girder: g.girder, offset: gaugeOffset(g) }))
    .sort((a, b) => (isFinite(a.offset) ? a.offset : 1e9) - (isFinite(b.offset) ? b.offset : 1e9));
  const E = Number(p.bridge.E) || 29000;
  const results = wins.map(w => {
    const [i0, i1] = indexRange(time, w.t0, w.t1);
    const pos = new Float64Array(i1 - i0);
    for (let i = i0; i < i1; i++) pos[i - i0] = positionAt(w.knots, time[i]);
    const peaks = {};
    for (const g of gauges) {
      const y = series[g.serial]; if (!y) continue;
      const pk = channelPeaks(y, i0, i1);
      peaks[g.serial] = { ...pk, tMax: time[pk.iMax], tMin: time[pk.iMin], xMax: positionAt(w.knots, time[pk.iMax]), xMin: positionAt(w.knots, time[pk.iMin]) };
    }
    const dist = distribution(distGauges, series, i0, i1, p.settings.distMethod, p.bridge.type);
    if (dist) { dist.tPeak = time[dist.iPeak]; dist.xPeak = positionAt(w.knots, dist.tPeak); }
    return { win: w, i0, i1, pos, peaks, dist, speed: speedMph(w.knots), vehicle: vehicleById(w.vehicleId) };
  });
  return { time, series, gauges, wins, results, E, mode };
}

export const passLabel = pass => {
  const lc = loadCaseById(pass.loadCaseId);
  return `${lc ? lc.name + ' · ' : ''}${pass.name}`;
};

export function passStart(pass) { const d = new Date(pass.startLocal); return isNaN(d) ? null : d; }

export function logInPass(pass) {
  const s = passStart(pass); if (!s) return [];
  const t0 = s.getTime() - 30000, t1 = s.getTime() + (pass.duration || 0) * 1000 + 30000;
  return P().log.filter(e => { const t = new Date(e.ts).getTime(); return t >= t0 && t <= t1; });
}

// ---------- UI ----------
let plotView = null;
let view = { x: 'time', vehicle: 0, qty: 'strain', group: '__all', pick: null };

export function renderPasses(main) {
  const p = P();
  main.innerHTML = `<div class="split">
    <div class="card"><div class="row"><h2 style="margin:0">Load passes</h2><span class="spacer"></span>
      <button class="btn primary" id="importBtn">Import .tdms files</button></div>
      <p class="muted small">One file per pass, straight from STS-Live — no Excel step. Copy files from the laptop to the iPad (AirDrop, Files, Box, USB drive), then import. You can select several at once.</p>
      <div class="list" id="passList"></div></div>
    <div id="passDetail"></div></div>`;
  $('#importBtn').onclick = () => $('#tdmsInput').click();
  renderPassList();
  renderDetail();
}

function renderPassList() {
  const p = P(), host = $('#passList');
  if (!host) return;
  if (!p.passes.length) { host.innerHTML = `<div class="empty">No data yet.</div>`; return; }
  host.innerHTML = p.passes.map(ps => {
    const lc = loadCaseById(ps.loadCaseId);
    const st = passStart(ps);
    return `<div class="pass-item ${ps.id === state.passId ? 'active' : ''}" data-id="${ps.id}">
      <span class="name">${esc(ps.name)}</span>
      <span class="pill">${esc(lc ? lc.name : 'No load case')}</span>
      <span class="muted small">${st ? st.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''} · ${fmt(ps.duration, 0)} s · ${ps.clicks.length} marks · ${ps.channels.length} ch</span></div>`;
  }).join('');
  $$('.pass-item', host).forEach(el => el.onclick = () => { state.passId = el.dataset.id; view.vehicle = 0; renderPassList(); renderDetail(); });
}

async function renderDetail() {
  const p = P(), host = $('#passDetail');
  if (!host) return;
  const pass = p.passes.find(x => x.id === state.passId) || p.passes[0];
  if (!pass) { host.innerHTML = ''; plotView = null; return; }
  state.passId = pass.id;
  const pi = p.passes.indexOf(pass);
  const st = passStart(pass);
  const lcs = p.loadCases;
  host.innerHTML = `
  <div class="card">
    <div class="row"><h2 style="margin:0">${esc(pass.name)}</h2><span class="muted small">${esc(pass.fileName)}</span><span class="spacer"></span>
      <button class="btn small" id="csvBtn">Export CSV</button><button class="btn small danger" id="delPass">Delete pass</button></div>
    <div class="grid" style="margin-top:10px">
      <label>Pass name<input data-bind="passes.${pi}.name"></label>
      <label>Load case<select data-bind="passes.${pi}.loadCaseId" id="lcSel">${opts([['', '— choose —'], ...lcs.map(l => [l.id, `${l.name}${l.description ? ' – ' + l.description : ''}`])])}</select></label>
      <label>Zeroing<select data-bind="passes.${pi}.zeroMode" id="zeroSel">${opts([['', `Default (${p.settings.zeroMode === 'linear' ? 'linear drift' : p.settings.zeroMode})`], ['linear', 'Linear drift: start → end'], ['initial', 'Initial readings only'], ['none', 'None (raw)']])}</select></label>
      <label>Notes<input data-bind="passes.${pi}.notes" placeholder="e.g. third truck deviated west"></label>
    </div>
    <dl class="kv" style="margin-top:10px"><dt>Started</dt><dd>${st ? st.toLocaleString() : '–'} ${esc(pass.title ? '· ' + pass.title : '')}</dd>
      <dt>Samples</dt><dd>${pass.nSamples} at ${pass.sampleRate} Hz (${fmt(pass.duration, 1)} s)</dd><dt>Marks</dt><dd>${pass.clicks.length ? pass.clicks.map(c => fmt(c.t, 1)).join(', ') + ' s' : 'none — set vehicle on/off times below'}</dd></dl>
  </div>
  <div class="card"><h3 style="margin-top:0">Truck position</h3>
    <div class="grid">
      <label>First mark position (ft from start of bridge, − = approach)<input data-bind="marks.first" data-type="num" inputmode="decimal"></label>
      <label>Mark spacing (ft)<input data-bind="marks.spacing" data-type="num" inputmode="decimal"></label>
      <label>Or list each mark (ft)<input data-bind="marks.custom" placeholder="-20, 0, 20, 40, 60"></label>
    </div>
    <p class="muted small">Marks apply to every pass in this test (front axle crosses each mark). Bridge length ${ftin(bridgeLength(p))}.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Vehicle</th><th>Marks from</th><th>to</th><th>Use times instead</th><th>On bridge (s)</th><th>Off bridge (s)</th><th class="num">Speed</th><th></th></tr></thead><tbody id="vehRows"></tbody></table></div>
    <div class="row" style="margin-top:8px"><button class="btn small" id="addVeh">＋ Vehicle in this pass</button><button class="btn small" id="autoVeh">Auto-split marks</button>
      <span class="muted small" id="pickHint"></span></div>
  </div>
  <div class="card"><div class="row"><h3 style="margin:0">Plot</h3><span class="spacer"></span>
      <select id="xSel" style="width:auto"></select>
      <select id="qtySel" style="width:auto">${opts([['strain', 'Strain (µε)'], ['stress', `Stress (${p.settings.stressUnit})`], ['defl', 'Deflection (in)']], view.qty)}</select>
      <select id="grpSel" style="width:auto"></select>
      <button class="btn small" id="toReport" title="Report includes all passes automatically">Group by: ${esc(p.settings.groupBy)}</button></div>
    <div id="plot"></div></div>
  <div id="results"></div>
  <div class="card"><h3 style="margin-top:0">Field log during this pass</h3><div id="passLog"></div></div>
  <div class="card"><h3 style="margin-top:0">Channels in this pass</h3><p class="muted small">Untick a channel to drop it from this pass only (e.g. a gauge that misbehaved once). Use the Gauges tab to mark a gauge bad for the whole test.</p><div class="chips" id="chanChips"></div></div>`;
  bindForm(host, async (path) => {
    if (path.endsWith('.loadCaseId')) { autoAssignVehicles(pass); save(); renderPassList(); }
    if (path.endsWith('.name')) renderPassList();
    if (/loadCaseId|zeroMode|marks\./.test(path)) { renderVehRows(pass); await refresh(pass); }
  });
  $('#delPass').onclick = async () => {
    if (!(await confirmDlg(`Delete pass ${pass.name}? The imported data is removed from this iPad (your original .tdms file is not affected).`, 'Delete', true))) return;
    p.passes.splice(p.passes.indexOf(pass), 1); await db.del('passData', pass.id); state.passCache.delete(pass.id); state.passId = p.passes[0]?.id || null; save(); renderPassList(); renderDetail();
  };
  $('#csvBtn').onclick = () => exportCsv(pass);
  $('#addVeh').onclick = () => { pass.vehicles.push({ vehicleId: p.vehicles[0]?.id || '', from: 1, to: pass.clicks.length, manual: !pass.clicks.length, tOn: '', tOff: '' }); save(); renderVehRows(pass); refresh(pass); };
  $('#autoVeh').onclick = () => { autoAssignVehicles(pass); save(); renderVehRows(pass); refresh(pass); };
  $('#toReport').onclick = async () => {
    const r = await dialog({ title: 'Group gauges by', body: `<select name="g">${opts([['girder', 'Girder'], ['span', 'Span'], ['section', 'Section'], ['location', 'Location'], ['type', 'Type'], ['none', 'None']], p.settings.groupBy)}</select>`, buttons: [{ label: 'Cancel', value: null }, { label: 'OK', primary: true, value: d => $('select', d).value }] });
    if (r) { p.settings.groupBy = r; view.group = '__all'; save(); renderDetail(); }
  };
  // channel chips
  const chips = $('#chanChips');
  const gmap = new Map(p.gauges.map(g => [g.serial, g]));
  chips.innerHTML = pass.channels.map(c => {
    const g = gmap.get(c.serial);
    const off = g && BAD.includes(g.status);
    return `<button class="chip ${!(pass.excluded || []).includes(c.serial) && !off ? 'on' : ''}" data-s="${esc(c.serial)}" ${off ? 'disabled title="Marked ' + esc(g.status) + ' on Gauges tab"' : ''}>${esc(g ? gaugeName(g) : c.serial)}</button>`;
  }).join('');
  $$('.chip', chips).forEach(b => b.onclick = () => {
    const s = b.dataset.s; pass.excluded = pass.excluded || [];
    const i = pass.excluded.indexOf(s); if (i >= 0) pass.excluded.splice(i, 1); else pass.excluded.push(s);
    b.classList.toggle('on'); save(); refresh(pass);
  });
  plotView = new PlotView($('#plot'), {
    height: 380, onXClick: x => {
      if (!view.pick || view.x !== 'time') return;
      const v = pass.vehicles[view.pick.row]; if (!v) return;
      v[view.pick.field] = +x.toFixed(2); view.pick = null; $('#pickHint').textContent = '';
      save(); renderVehRows(pass); refresh(pass);
    },
  });
  $('#qtySel').onchange = e => { view.qty = e.target.value; refresh(pass); };
  $('#xSel').onchange = e => { const v = e.target.value; if (v === 'time') view.x = 'time'; else { view.x = 'pos'; view.vehicle = Number(v); } refresh(pass); };
  $('#grpSel').onchange = e => { view.group = e.target.value; refresh(pass); };
  renderVehRows(pass);
  await refresh(pass);
}

function renderVehRows(pass) {
  const p = P(), tb = $('#vehRows'); if (!tb) return;
  const pi = p.passes.indexOf(pass);
  const time = state.passCache.get(pass.id)?.time;
  const wins = time ? vehicleWindows(pass, p, time) : [];
  tb.innerHTML = pass.vehicles.map((v, i) => `<tr>
    <td><select data-bind="passes.${pi}.vehicles.${i}.vehicleId" style="min-width:130px">${opts([['', '—'], ...p.vehicles.map(x => [x.id, x.name])])}</select></td>
    <td><input data-bind="passes.${pi}.vehicles.${i}.from" data-type="num" inputmode="numeric" style="width:64px" ${v.manual ? 'disabled' : ''}></td>
    <td><input data-bind="passes.${pi}.vehicles.${i}.to" data-type="num" inputmode="numeric" style="width:64px" ${v.manual ? 'disabled' : ''}></td>
    <td><input type="checkbox" data-bind="passes.${pi}.vehicles.${i}.manual"></td>
    <td><div class="row" style="flex-wrap:nowrap"><input data-bind="passes.${pi}.vehicles.${i}.tOn" data-type="num" inputmode="decimal" style="width:80px" ${v.manual ? '' : 'disabled'}><button class="btn small" data-pick="${i}:tOn" ${v.manual ? '' : 'disabled'}>Pick</button></div></td>
    <td><div class="row" style="flex-wrap:nowrap"><input data-bind="passes.${pi}.vehicles.${i}.tOff" data-type="num" inputmode="decimal" style="width:80px" ${v.manual ? '' : 'disabled'}><button class="btn small" data-pick="${i}:tOff" ${v.manual ? '' : 'disabled'}>Pick</button></div></td>
    <td class="num" data-speed="${i}">${wins[i] ? fmt(speedMph(wins[i].knots), 1) + ' mph' : '–'}</td>
    <td><button class="btn small danger" data-delv="${i}">✕</button></td></tr>`).join('') || `<tr><td colspan="8" class="muted">No vehicles assigned.</td></tr>`;
  bindForm(tb, async (path) => { if (/manual/.test(path)) renderVehRows(pass); await refresh(pass); });
  $$('[data-delv]', tb).forEach(b => b.onclick = () => { pass.vehicles.splice(Number(b.dataset.delv), 1); save(); renderVehRows(pass); refresh(pass); });
  $$('[data-pick]', tb).forEach(b => b.onclick = () => {
    const [row, field] = b.dataset.pick.split(':');
    view.pick = { row: Number(row), field }; view.x = 'time';
    $('#pickHint').textContent = `Tap the plot where the front axle ${field === 'tOn' ? 'enters' : 'leaves'} the bridge`;
    refresh(pass);
  });
}

async function refresh(pass) {
  const p = P();
  const r = await processPass(pass);
  if (!r || !plotView) return;
  // x selector
  const xSel = $('#xSel');
  const xo = [['time', 'vs Time'], ...r.results.map((res, i) => [String(i), `vs Position – ${res.vehicle ? res.vehicle.name : 'Vehicle ' + (i + 1)}`])];
  if (view.x === 'pos' && view.vehicle >= r.results.length) { view.x = 'time'; }
  xSel.innerHTML = opts(xo, view.x === 'time' ? 'time' : String(view.vehicle));
  // group selector
  const by = p.settings.groupBy;
  const groupNames = [...new Set(r.gauges.map(g => groupKey(g, by)))];
  const grpSel = $('#grpSel');
  if (view.group !== '__all' && view.group !== '__dist' && !groupNames.includes(view.group)) view.group = '__all';
  grpSel.innerHTML = opts([['__all', 'All gauges'], ['__dist', 'Distribution gauges'], ...groupNames.map(g => [g, g])], view.group);

  r.results.forEach((res, i) => { const td = $(`[data-speed="${i}"]`); if (td) td.textContent = isFinite(res.speed) ? fmt(res.speed, 1) + ' mph' : '–'; });
  plotView.set(buildSpec(pass, r, view), true);
  renderResults(pass, r);
  renderPassLog(pass);
}

export function buildSpec(pass, r, v, opt = {}) {
  const p = P();
  const unit = p.settings.stressUnit;
  let gauges = r.gauges.filter(g => v.qty === 'defl' ? isDefl(g) : isStrain(g));
  if (v.group === '__dist') gauges = gauges.filter(g => g.dist);
  else if (v.group && v.group !== '__all') gauges = gauges.filter(g => groupKey(g, p.settings.groupBy) === v.group);
  const k = v.qty === 'stress' ? r.E * 1e-6 * (unit === 'psi' ? 1000 : 1) : 1;
  const yLabel = v.qty === 'strain' ? 'Strain (µε)' : v.qty === 'stress' ? `Stress (${unit})` : 'Deflection (in)';
  const series = [];
  let x, vlines = [], vbands = [], xLabel, title = opt.title || '';
  if (v.x === 'pos' && r.results[v.vehicle]) {
    const res = r.results[v.vehicle];
    x = res.pos; xLabel = 'Front axle position from start of bridge (ft)';
    gauges.forEach((g, i) => { const y = r.series[g.serial].subarray(res.i0, res.i1); series.push({ name: gaugeName(g), y: k === 1 ? y : y.map(val => val * k), ...seriesStyle(i) }); });
    let acc = 0;
    vlines.push({ x: 0, label: 'Bridge start', color: '#888' });
    (p.bridge.spans || []).forEach((s, j) => { acc += Number(s) || 0; vlines.push({ x: acc, label: j === p.bridge.spans.length - 1 ? 'Bridge end' : `Support ${j + 2}`, color: '#888' }); });
    if (res.dist && v.qty !== 'defl') vlines.push({ x: res.dist.xPeak, label: 'Peak', color: '#d62728', dash: [2, 2], row: 1 });
    if (!res.win.knots.length) title = (title ? title + ' – ' : '') + 'no position data (set marks or on/off times)';
  } else {
    x = r.time; xLabel = 'Time (s)';
    gauges.forEach((g, i) => { const y = r.series[g.serial]; series.push({ name: gaugeName(g), y: k === 1 ? y : y.map(val => val * k), ...seriesStyle(i) }); });
    (pass.clicks || []).forEach((c, i) => vlines.push({ x: c.t, color: 'rgba(120,120,120,0.55)', dash: [1, 3], label: opt.noClickLabels ? '' : String(i + 1) }));
    r.results.forEach((res, i) => {
      if (r.results.length > 1) vbands.push({ x0: res.win.t0, x1: res.win.t1, color: i % 2 ? 'rgba(31,111,180,0.05)' : 'rgba(239,127,14,0.05)' });
      if (res.dist && v.qty !== 'defl') vlines.push({ x: res.dist.tPeak, label: `Peak ${res.vehicle ? res.vehicle.name : ''}`, color: '#d62728', dash: [2, 2], row: 1 });
      if (res.win.manual) {
        const num = t => t !== '' && t != null && isFinite(t);
        if (num(res.win.tOn)) vlines.push({ x: Number(res.win.tOn), label: 'On', color: '#2a9d3a', dash: [] });
        if (num(res.win.tOff)) vlines.push({ x: Number(res.win.tOff), label: 'Off', color: '#2a9d3a', dash: [] });
      }
    });
    if (!opt.noLog) {
      const s = passStart(pass);
      if (s) for (const e of logInPass(pass)) vlines.push({ x: (new Date(e.ts) - s) / 1000, label: '✎ ' + (e.tag || ''), color: '#8b5cc4', dash: [6, 3], row: 2 });
    }
  }
  return { x, series, xLabel, yLabel, vlines, vbands, title };
}

// Series for the distribution-vs-cross-section plot (one per vehicle)
export function distSeries(pass, r) {
  const lc = loadCaseById(pass.loadCaseId);
  return r.results.map((res, i) => res.dist ? { name: res.vehicle ? res.vehicle.name : `Vehicle ${i + 1}`, color: PALETTE[i % PALETTE.length], rows: res.dist.rows, loadCase: lc } : null).filter(Boolean);
}

function renderResults(pass, r) {
  const p = P(), host = $('#results'); if (!host) return;
  const unit = p.settings.stressUnit, k = r.E * 1e-6 * (unit === 'psi' ? 1000 : 1);
  const series = distSeries(pass, r);
  const missing = series.length ? series[0].rows.filter(x => !isFinite(x.offset)).map(x => x.name) : [];
  const distCard = series.length ? `<div class="card"><div class="row"><h2 style="margin:0">Load distribution across the bridge</h2><span class="spacer"></span>
      <select id="distMetric" style="width:auto">${opts([['df', 'Distribution (%)'], ['strain', 'Strain at peak (µε)']], view.distMetric || 'df')}</select></div>
      <p class="muted small">Each vehicle's distribution at its peak, plotted at the gauge positions over the ${p.bridge.type === 'slab' ? 'slab' : 'girders'}${loadCaseById(pass.loadCaseId) ? `, with the ${esc(loadCaseById(pass.loadCaseId).name)} wheel lines` : ''}.</p>
      ${missing.length ? `<p class="warn-box">Not plotted (no girder or offset): ${esc(missing.join(', '))}. Set them on the Gauges tab.</p>` : ''}
      <canvas class="diagram" id="distCanvas"></canvas></div>` : '';
  host.innerHTML = distCard + r.results.map((res, vi) => {
    const vname = res.vehicle ? res.vehicle.name : `Vehicle ${vi + 1}`;
    const d = res.dist;
    let distHtml = '';
    if (d) {
      const maxDf = Math.max(...d.rows.map(x => x.df).filter(isFinite), 0.01);
      distHtml = `<h3>Load distribution – ${p.bridge.type === 'slab' ? 'slab' : 'girders'} at ${esc(p.bridge.distSection || 'section')}</h3>
      <p class="muted small">Strains at ${fmt(d.tPeak, 2)} s${isFinite(d.xPeak) ? `, front axle at ${fmt(d.xPeak, 1)} ft` : ''} (${p.settings.distMethod === 'maxSum' ? 'time of largest total strain' : 'time of largest single-gauge strain'}).</p>
      <div class="table-wrap"><table class="data"><thead><tr><th>Gauge</th><th>Girder</th><th class="num">Offset (ft)</th><th class="num">Strain (µε)</th><th class="num">Distribution</th><th style="width:30%"></th></tr></thead><tbody>
      ${d.rows.map(x => `<tr><td>${esc(x.name)}</td><td>${esc(x.girder || '')}</td><td class="num">${fmt(x.offset, 2)}</td><td class="num">${fmt(x.strain, 1)}</td><td class="num">${fmt(x.df * 100, 1)}%</td><td><div class="bar" style="width:${Math.max(0, x.df / maxDf * 100)}%"></div></td></tr>`).join('')}
      <tr><td colspan="3"><b>Sum</b></td><td class="num"><b>${fmt(d.sum, 1)}</b></td><td class="num">100%</td><td></td></tr></tbody></table></div>
      ${p.bridge.type === 'slab' ? `<p><b>Equivalent strip width = ${fmt(d.stripWidth, 2)} ft</b> <span class="muted small">(area under transverse strain profile ${fmt(d.profileArea, 1)} µε·ft ÷ peak ${fmt(d.peakStrain, 1)} µε)</span></p>` : ''}`;
    } else distHtml = `<p class="warn-box">No distribution gauges in this pass. On the Gauges tab, tick <b>Dist.</b> for the bottom gauges at ${esc(p.bridge.distSection || 'the distribution section')}, or use “Pick distribution gauges…”.</p>`;
    const strainG = r.gauges.filter(isStrain), deflG = r.gauges.filter(isDefl);
    const pkRow = (g, isD) => { const pk = res.peaks[g.serial]; if (!pk) return ''; return `<tr><td>${esc(gaugeName(g))}</td><td>${esc([g.girder, g.location, g.section].filter(Boolean).join(' · '))}</td>
      <td class="num">${fmt(pk.max, isD ? 4 : 1)}</td><td class="num">${fmt(pk.tMax, 2)}</td><td class="num">${fmt(pk.xMax, 1)}</td><td class="num">${fmt(pk.min, isD ? 4 : 1)}</td><td class="num">${fmt(pk.tMin, 2)}</td>${isD ? '' : `<td class="num">${fmt(Math.max(Math.abs(pk.max), Math.abs(pk.min)) * k, unit === 'psi' ? 0 : 2)}</td>`}</tr>`; };
    return `<div class="card"><div class="row"><h2 style="margin:0">${esc(vname)}</h2><span class="muted small">${isFinite(res.speed) ? fmt(res.speed, 1) + ' mph · ' : ''}${fmt(res.win.t0, 1)}–${fmt(res.win.t1, 1)} s</span></div>
      ${distHtml}
      <details ${vi === 0 ? '' : ''}><summary class="btn small" style="display:inline-block;margin-top:12px">Peak values for all gauges</summary>
      <div class="table-wrap"><table class="data"><thead><tr><th>Strain gauge</th><th>Location</th><th class="num">Max (µε)</th><th class="num">t (s)</th><th class="num">x (ft)</th><th class="num">Min (µε)</th><th class="num">t (s)</th><th class="num">|σ| max (${unit})</th></tr></thead><tbody>${strainG.map(g => pkRow(g, false)).join('')}</tbody></table></div>
      ${deflG.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Deflection</th><th>Location</th><th class="num">Max (in)</th><th class="num">t (s)</th><th class="num">x (ft)</th><th class="num">Min (in)</th><th class="num">t (s)</th></tr></thead><tbody>${deflG.map(g => pkRow(g, true)).join('')}</tbody></table></div>` : ''}
      </details></div>`;
  }).join('');
  if (series.length) {
    const drawD = () => drawInto($('#distCanvas'), 380, (ctx, w, h, theme) => drawDistribution(ctx, w, h, p, series, { theme, metric: view.distMetric || 'df' }));
    $('#distMetric').onchange = e => { view.distMetric = e.target.value; drawD(); };
    requestAnimationFrame(drawD);
  }
}

function renderPassLog(pass) {
  const host = $('#passLog'); if (!host) return;
  const entries = logInPass(pass);
  const s = passStart(pass);
  host.innerHTML = entries.length ? entries.map(e => `<div class="row small"><b>${fmtTime(e.ts)}</b> <span class="muted">(${fmt((new Date(e.ts) - s) / 1000, 0)} s)</span> <span class="pill">${esc(e.tag || e.kind)}</span> ${esc(e.text || e.caption || '')}</div>`).join('')
    : `<p class="muted small">No notes or photos during this pass. Notes are matched by clock time, so keep the iPad and laptop clocks in sync.</p>`;
}

async function exportCsv(pass) {
  const r = await processPass(pass);
  if (!r) return;
  const g = r.gauges;
  const head = ['Time (s)', 'Front axle position (ft)', ...g.map(x => `${x.serial} (${isDefl(x) ? 'in' : 'ue'})`)];
  const lines = [head.join(',')];
  for (let i = 0; i < r.time.length; i++) {
    const t = r.time[i];
    const res = r.results.find(rr => t >= rr.win.t0 && t <= rr.win.t1);
    const x = res ? positionAt(res.win.knots, t) : NaN;
    lines.push([t.toFixed(3), isFinite(x) ? x.toFixed(2) : '', ...g.map(gg => r.series[gg.serial][i].toFixed(isDefl(gg) ? 5 : 2))].join(','));
  }
  await saveFile(new Blob([lines.join('\n')], { type: 'text/csv' }), `${pass.name}_${r.mode}-zeroed.csv`);
}
