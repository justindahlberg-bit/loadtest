// Setup tabs: Bridge, Gauges, Vehicles, Load paths
import { state, save, uid, LOCATIONS, gaugeOffset, groupKey, sortGauges, isDefl, isStrain, shortSerial, newGauge, serialKey } from './state.js';
import { esc, $, $$, bindForm, opts, dialog, confirmDlg, toast } from './ui.js';
import { drawCrossSection, drawTruck, drawInto, loadCaseWheels, crossSectionHeight } from './draw.js';
import { ftin, bridgeLength, isCL, clPos, fmtPos, parsePos, posUnit, parsePosList } from './calc.js';

const P = () => state.project;
const BAD = ['bad', 'unused', 'removed', 'replaced'];
const usedInPasses = serial => !!serial && P().passes.some(ps => ps.channels.some(c => c.serial === serial));
const sideName = (p, side) => { // side 'A' (left / Edge A) or 'B'
  const br = p.bridge;
  if (isCL(p)) {
    const left = side === 'A';
    const driver = (br.driverSide || 'left') === 'left' ? left : !left;
    return `${left ? 'Left' : 'Right'} (${driver ? 'driver' : 'passenger'})`;
  }
  return side === 'A' ? `${br.edgeA || 'Edge A'} side` : `${br.edgeB || 'Edge B'} side`;
};

function crossSectionGauges() {
  return P().gauges.filter(g => !['unused', 'removed', 'replaced'].includes(g.status))
    .map(g => ({ serial: g.serial, short: g.label || shortSerial(g.serial) || '?', type: g.type, location: g.location, offset: gaugeOffset(g) }));
}

export function drawXS(canvas, extra = {}) {
  const lcs = extra.loadCases ?? P().loadCases;
  drawInto(canvas, Math.max(220, crossSectionHeight(P(), lcs.length)), (ctx, w, hh, theme) => drawCrossSection(ctx, w, hh, P(), { theme, gauges: crossSectionGauges(), loadCases: lcs, ...extra }));
}

// User-defined extra fields (label/value), e.g. anything a particular client or bridge needs
function renderCustom(host, list, onChange) {
  const draw = () => {
    host.innerHTML = list.map((f, i) => `<div class="row" style="flex-wrap:nowrap;margin-top:6px">
      <input data-cf="${i}" data-k="label" value="${esc(f.label)}" placeholder="Field name" style="max-width:40%">
      <input data-cf="${i}" data-k="value" value="${esc(f.value)}" placeholder="Value">
      <button class="btn small danger" data-cfdel="${i}" aria-label="Remove field">✕</button></div>`).join('') +
      `<button class="btn small" data-cfadd style="margin-top:8px">＋ Add field</button>`;
    $$('[data-cf]', host).forEach(el => el.addEventListener('input', () => { list[Number(el.dataset.cf)][el.dataset.k] = el.value; save(); if (onChange) onChange(); }));
    $$('[data-cfdel]', host).forEach(b => b.onclick = () => { list.splice(Number(b.dataset.cfdel), 1); save(); draw(); });
    $('[data-cfadd]', host).onclick = () => { list.push({ label: '', value: '' }); save(); draw(); $$('[data-k=label]', host).pop()?.focus(); };
  };
  draw();
}

// Convert every stored transverse position between datums (edge ↔ centerline)
function convertDatum(p, to) {
  const cl = clPos(p);
  const conv = v => (v === '' || v == null || !isFinite(Number(v))) ? v : +(to === 'cl' ? Number(v) - cl : Number(v) + cl).toFixed(3);
  const br = p.bridge;
  (br.girders || []).forEach(g => { g.offset = conv(g.offset); });
  p.gauges.forEach(g => { g.offset = conv(g.offset); g.plannedOffset = conv(g.plannedOffset); });
  p.loadCases.forEach(lc => { lc.offset = conv(lc.offset); });
  br.curbA = conv(br.curbA); br.curbB = conv(br.curbB);
  const lanes = parsePosList(p, br.laneLines).map(conv);
  br.datum = to;
  br.laneLines = lanes.map(v => fmtPos(p, v)).join(', ');
}

// ---------------- Bridge ----------------
export function renderBridge(main) {
  const p = P(), b = p.bridge;
  b.custom = b.custom || []; p.test.custom = p.test.custom || [];
  const cl = isCL(p);
  main.innerHTML = `
  <div class="card"><h2>Bridge</h2>
    <div class="grid">
      <label>Structure number / Bridge ID<input data-bind="bridge.structureNo"></label>
      <label>FHWA number<input data-bind="bridge.fhwaNo"></label>
      <label>Bridge name<input data-bind="bridge.name"></label>
      <label>Location<input data-bind="bridge.location"></label>
      <label>County<input data-bind="bridge.county"></label>
      <label>Route / feature carried<input data-bind="bridge.route"></label>
      <label>Feature crossed<input data-bind="bridge.featureCrossed"></label>
      <label>Owner<input data-bind="bridge.owner"></label>
      <label>Year built<input data-bind="bridge.yearBuilt" inputmode="numeric"></label>
      <label>Test date<input type="date" data-bind="bridge.testDate"></label>
      <label>Inspection report date<input data-bind="bridge.inspectionDate" placeholder="e.g. Oct 3, 2024"></label>
      <label>Condition ratings (deck / super / sub)<input data-bind="bridge.ratings" placeholder="5 / 5 / 7"></label>
      <label>Load rating<input data-bind="bridge.loadRating" placeholder="LFR Inv. RF 0.64, Opr. RF 1.06"></label>
    </div>
    <h3>Other bridge information</h3><p class="muted small">Add anything else this bridge or client needs. It is included in the report.</p>
    <div id="bridgeCustom"></div>
  </div>
  <div class="card"><h2>Structure</h2>
    <div class="grid">
      <label>Bridge type<select data-bind="bridge.type">${opts([['girder', 'Girder / beam bridge'], ['slab', 'Slab bridge'], ['other', 'Other (box, culvert, truss…)']])}</select></label>
      <label>Superstructure description<input data-bind="bridge.girderType" placeholder="e.g. continuous CIP concrete slab, W36x150, PPCB"></label>
      <label>Material<select data-bind="bridge.material">${opts([['steel', 'Steel'], ['concrete', 'Reinforced concrete'], ['prestressed', 'Prestressed concrete'], ['timber', 'Timber'], ['other', 'Other']])}</select></label>
      <label>Modulus E (ksi)<input data-bind="bridge.E" data-type="num" inputmode="decimal"></label>
      <label>Slab thickness / girder depth<input data-bind="bridge.depth" placeholder='16 in. + overlay'></label>
      <label>Span lengths (ft, comma separated)<input data-bind="bridge.spans" data-type="list" placeholder="24.5, 30, 24.5"></label>
      <label>Skew (deg)<input data-bind="bridge.skew" data-type="num" inputmode="decimal"></label>
      <label>Rails / barriers<input data-bind="bridge.rails"></label>
      <label>Substructure<input data-bind="bridge.substructure"></label>
      <label class="wide">Notes / condition near gauges<textarea data-bind="bridge.notes" placeholder="Cracking, leaching, bearings, approach…"></textarea></label>
    </div>
    <p class="muted small">Total length: <b id="totLen">${ftin(bridgeLength(p))}</b></p>
  </div>
  <div class="card"><h2>Cross-section and transverse positions</h2>
    <div class="grid">
      <label>Measure transverse positions from<select id="datumSel">${opts([['edgeA', 'An edge of the deck (Edge A)'], ['cl', 'Roadway centerline (L / R)']], b.datum || 'edgeA')}</select></label>
      ${cl ? `<label>Driver's side (looking ${esc(b.lookDir || 'ahead')})<select data-bind="bridge.driverSide">${opts([['left', 'Left'], ['right', 'Right']])}</select></label>
      <label>Centerline position, ft from left edge of deck (blank = middle)<input data-bind="bridge.clOffset" data-type="num" inputmode="decimal"></label>` : ''}
      <label>Deck width, out-to-out (ft)<input data-bind="bridge.deckWidth" data-type="num" inputmode="decimal"></label>
      <label>${cl ? 'Left' : 'Edge A side'} curb / rail face (${posUnit(p)})<input data-bind="bridge.curbA" data-type="pos"></label>
      <label>${cl ? 'Right' : 'Edge B side'} curb / rail face (${posUnit(p)})<input data-bind="bridge.curbB" data-type="pos"></label>
      <label>Lane / white lines (${posUnit(p)}, comma separated)<input data-bind="bridge.laneLines" placeholder="${cl ? '13 L, CL, 13 R' : '3.2, 15, 26.8'}"></label>
      <label>Section viewed looking<input data-bind="bridge.lookDir" placeholder="north / toward far abutment"></label>
      <label>Left edge label (Edge A)<input data-bind="bridge.edgeA"></label>
      <label>Right edge label (Edge B)<input data-bind="bridge.edgeB"></label>
      <label>Section used for load distribution<input data-bind="bridge.distSection" placeholder="Midspan of Span 1"></label>
    </div>
    <p class="muted small">${cl ? 'Positions are entered as distance left or right of the centerline: <b>8 L</b>, <b>CL</b>, <b>2.5 R</b>. Left and right are as seen looking the way the section is viewed.' : 'Positions are entered in feet from Edge A (the left edge of the drawing).'} Switching this later converts the positions you have already entered.</p>
  </div>
  <div class="card" id="girderCard"><div class="row"><h2 style="margin:0">Girder lines</h2><span class="spacer"></span>
      <button class="btn small" id="genGirders">Generate evenly spaced…</button><button class="btn small" id="addGirder">＋ Girder</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Position (${posUnit(p)})</th><th>Description</th><th></th></tr></thead><tbody id="girderRows"></tbody></table></div>
  </div>
  <div class="card"><h2>Test details</h2>
    <div class="grid">
      <label>Test start time<input data-bind="test.startTime" placeholder="8:30 AM"></label>
      <label>Crew<input data-bind="test.crew"></label>
      <label>Weather<input data-bind="test.weather"></label>
      <label>Air temperature (°F)<input data-bind="test.temperature"></label>
      <label>Deck surface temperature (°F)<input data-bind="test.deckTemp"></label>
      <label>Data acquisition system<input data-bind="test.dataSystem"></label>
      <label>DAQ serial<input data-bind="test.daqSerial"></label>
      <label>Excitation / gauge factor<input data-bind="test.excitation"></label>
      <label>Zero / balance time<input data-bind="test.zeroTime"></label>
      <label>Gauge length / extensions<input data-bind="test.gaugeLength" placeholder='e.g. 15" extensions'></label>
      <label>Truck direction of travel<input data-bind="test.direction" placeholder="Northbound"></label>
      <label>Traffic control<input data-bind="test.trafficControl"></label>
      <label>File naming convention<input data-bind="test.fileNaming"></label>
      <label class="wide">Purpose of test<textarea data-bind="test.purpose"></textarea></label>
    </div>
    <h3>Other test information</h3><div id="testCustom"></div>
  </div>
  <div class="card"><h2>Cross-section</h2><canvas class="diagram" id="xs"></canvas></div>`;
  const redraw = () => { const tl = $('#totLen'); if (!tl) return; tl.textContent = ftin(bridgeLength(P())); drawXS($('#xs')); };
  bindForm(main, (path, val) => {
    if (path === 'bridge.material') {
      const E = { steel: 29000, concrete: 3600, prestressed: 4700, timber: 1600 }[val];
      if (E) { P().bridge.E = E; $('[data-bind="bridge.E"]').value = E; toast(`E set to ${E} ksi — adjust if needed`); }
    }
    if (path === 'bridge.type') { $('#girderCard').hidden = val !== 'girder'; }
    redraw();
  });
  renderCustom($('#bridgeCustom'), b.custom);
  renderCustom($('#testCustom'), p.test.custom);
  $('#datumSel').onchange = async e => {
    const to = e.target.value;
    const has = (b.girders || []).length || p.gauges.some(g => g.offset !== '' || g.plannedOffset !== '') || p.loadCases.length || b.curbA !== '' || b.laneLines;
    if (has) {
      const ok = await confirmDlg(`Convert the positions already entered (girders, gauges, load paths, curbs, lane lines) to ${to === 'cl' ? 'left/right of the centerline' : 'feet from Edge A'}? This uses a centerline ${fmtPos({ bridge: { datum: 'edgeA' } }, clPos(p))} ft from Edge A — set the deck width first if it is blank.`, 'Convert');
      if (!ok) { e.target.value = b.datum || 'edgeA'; return; }
      convertDatum(p, to);
    } else b.datum = to;
    save(); renderBridge(main);
  };
  const renderGirders = () => {
    const tb = $('#girderRows');
    tb.innerHTML = (b.girders || []).map((g, i) => `<tr>
      <td><input data-bind="bridge.girders.${i}.name"></td>
      <td><input data-bind="bridge.girders.${i}.offset" data-type="pos"></td>
      <td><input data-bind="bridge.girders.${i}.desc" placeholder="Exterior, interior…"></td>
      <td><button class="btn small danger" data-del="${i}">✕</button></td></tr>`).join('') || `<tr><td colspan="4" class="muted">No girder lines yet.</td></tr>`;
    bindForm(tb, redraw);
    $$('[data-del]', tb).forEach(btn => btn.onclick = () => { b.girders.splice(Number(btn.dataset.del), 1); save(); renderGirders(); redraw(); });
  };
  $('#addGirder').onclick = () => { b.girders = b.girders || []; const last = b.girders[b.girders.length - 1]; b.girders.push({ name: 'G' + (b.girders.length + 1), offset: last && isFinite(Number(last.offset)) ? Number(last.offset) + 6 : (cl ? 0 : 3), desc: '' }); save(); renderGirders(); redraw(); };
  $('#genGirders').onclick = async () => {
    const r = await dialog({
      title: 'Generate girder lines', body: `<div class="grid"><label>Number of girders<input name="n" type="number" value="5"></label>
      <label>First (left) girder position (${posUnit(p)})<input name="a" value="${cl ? '14 L' : '3'}"></label><label>Spacing (ft)<input name="s" type="number" step="any" value="7"></label></div>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Generate', primary: true, value: d => ({ n: +$('[name=n]', d).value, a: cl ? parsePos($('[name=a]', d).value) : +$('[name=a]', d).value, s: +$('[name=s]', d).value }) }],
    });
    if (!r || !(r.n > 0) || !isFinite(r.a)) return;
    b.girders = Array.from({ length: r.n }, (_, i) => ({ name: 'G' + (i + 1), offset: +(r.a + i * r.s).toFixed(3), desc: i === 0 || i === r.n - 1 ? 'Exterior' : 'Interior' }));
    save(); renderGirders(); redraw();
  };
  $('#girderCard').hidden = b.type !== 'girder';
  renderGirders();
  requestAnimationFrame(redraw);
}

// ---------------- Gauges ----------------
export function renderGauges(main) {
  const p = P();
  const s = p.settings;
  const girderNames = (p.bridge.girders || []).map(g => g.name);
  const isGirder = p.bridge.type === 'girder';
  const isSlab = p.bridge.type === 'slab';
  main.innerHTML = `
  <div class="card">
    <div class="row"><h2 style="margin:0">Gauges</h2><span class="spacer"></span>
      <label class="row small muted">Sort <select id="sortBy" style="width:auto">${opts([['order', 'Order #'], ['serial', 'Serial'], ['girder', 'Girder'], ['span', 'Span'], ['section', 'Section'], ['location', 'Location'], ['type', 'Type']], s.sortBy)}</select></label>
      <label class="row small muted">Group <select id="groupBy" style="width:auto">${opts([['none', 'None'], ['girder', 'Girder'], ['span', 'Span'], ['section', 'Section'], ['location', 'Location'], ['type', 'Type']], s.groupBy)}</select></label>
      <button class="btn small" id="renumber">Renumber in this order</button>
      ${isGirder ? '<button class="btn small primary" id="assignGirders">Assign by girder…</button>' : ''}
      <button class="btn small" id="autoDist">Pick distribution gauges…</button>
      ${p.bridge.type === 'slab' ? '<button class="btn small" id="fillH">Fill thickness…</button>' : ''}
      <button class="btn small" id="addLine">＋ Gauge line…</button>
      <button class="btn small" id="addGauge">＋ Gauge</button>
    </div>
    <p class="muted small">Plan gauge positions before the test (<b>＋ Gauge line…</b> adds any number at a set spacing), then type each BDI serial as it is installed. Serials can be typed short (<b>2944</b> or <b>B2944</b>); importing a data file links them to the file's channels. Channels with no matching row are added automatically.
    <b>Planned</b> is the design position; <b>Measured</b> is used for plots and results (Planned is used if Measured is blank). Set status <b>Bad</b> to drop a gauge, or use <b>Replaces</b> for a swapped gauge.</p>
    <div id="girderNote"></div>
    <div class="table-wrap"><table class="data" id="gaugeTable"></table></div>
  </div>
  <div class="card"><h2>Gauge locations on cross-section</h2><canvas class="diagram" id="xs"></canvas>
    <p class="muted small">● strain gauge &nbsp; ▼ deflection transducer. Gauges without a girder or position are not drawn.</p></div>`;

  const table = $('#gaugeTable');
  const render = () => {
    const list = sortGauges(p.gauges, s.sortBy);
    const groups = new Map();
    for (const g of list) { const k = s.groupBy === 'none' ? '' : groupKey(g, s.groupBy); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
    const cols = 15;
    let html = `<thead><tr><th>#</th><th>Serial</th><th>Type</th><th>Label</th><th>Span</th>${isGirder ? '<th>Girder</th>' : ''}<th>Section</th><th title="Distance along the bridge from the start of the bridge">Along bridge (ft)</th><th>Location</th>
      <th>Planned (${posUnit(p)})</th><th>Measured</th>${isSlab ? '<th title="Slab thickness at the gauge, for the equivalent strip calculation">Slab h (in)</th>' : ''}<th title="Use for load distribution">Dist.</th><th>Status</th><th>Replaces</th><th>Notes</th><th></th></tr></thead><tbody>`;
    for (const [k, gs] of groups) {
      if (k) html += `<tr class="group-row"><td colspan="${cols}">${esc(k)} <span class="muted">(${gs.length})</span></td></tr>`;
      for (const g of gs) {
        const i = p.gauges.indexOf(g);
        const bad = BAD.includes(g.status);
        const fromFile = usedInPasses(g.serial);
        const gOff = gaugeOffset(g);
        const auto = (g.offset === '' || g.offset == null) && isFinite(gOff) ? fmtPos(p, gOff) + (g.plannedOffset !== '' && g.plannedOffset != null ? ' (planned)' : ' (girder)') : '';
        html += `<tr class="${bad ? 'bad' : ''}">
          <td style="white-space:nowrap">${s.sortBy === 'order' ? `<button class="btn small" data-mv="${i}:-1" aria-label="Move up">▲</button><button class="btn small" data-mv="${i}:1" aria-label="Move down">▼</button> ` : ''}<input data-bind="gauges.${i}.order" data-type="num" inputmode="numeric" style="width:52px"></td>
          <td>${fromFile ? `<b>${esc(g.serial)}</b>` : `<input data-serial="${i}" value="${esc(g.serial)}" placeholder="type serial" style="width:110px">`}</td>
          <td>${fromFile ? `<span class="pill ${isDefl(g) ? 'disp' : isStrain(g) ? 'strain' : ''}">${esc(isDefl(g) ? 'Deflection' : isStrain(g) ? 'Strain' : g.type)}</span>` : `<select data-bind="gauges.${i}.type" style="width:110px">${opts([['Strain', 'Strain'], ['Displacement', 'Deflection'], ['Other', 'Other']])}</select>`}</td>
          <td><input data-bind="gauges.${i}.label" style="width:70px" placeholder="G1"></td>
          <td><input data-bind="gauges.${i}.span" style="width:50px" inputmode="numeric"></td>
          ${isGirder ? `<td><select data-bind="gauges.${i}.girder" style="width:84px">${opts([['', '—'], ...girderNames])}</select></td>` : ''}
          <td><input data-bind="gauges.${i}.section" style="width:110px" placeholder="Midspan" list="sectionList"></td>
          <td><input data-bind="gauges.${i}.xLong" data-type="num" inputmode="decimal" style="width:70px"></td>
          <td><select data-bind="gauges.${i}.location" style="width:110px">${opts([['', '—'], ...LOCATIONS])}</select></td>
          <td><input data-bind="gauges.${i}.plannedOffset" data-type="pos" style="width:80px"></td>
          <td><input data-bind="gauges.${i}.offset" data-type="pos" style="width:90px" placeholder="${esc(auto)}"></td>
          ${isSlab ? `<td><input data-bind="gauges.${i}.thickness" data-type="num" inputmode="decimal" style="width:64px"></td>` : ''}
          <td><input type="checkbox" data-bind="gauges.${i}.dist"></td>
          <td><select data-bind="gauges.${i}.status" style="width:100px">${opts([['ok', 'OK'], ['bad', 'Bad'], ['replaced', 'Replaced'], ['removed', 'Removed'], ['unused', 'Unused ch.']])}</select></td>
          <td><select data-replaces="${i}" style="width:110px">${opts([['', '—'], ...p.gauges.filter(o => o !== g && o.serial).map(o => o.serial)], g.replaces)}</select></td>
          <td><input data-bind="gauges.${i}.notes" style="min-width:110px"></td>
          <td>${fromFile ? '' : `<button class="btn small danger" data-delg="${i}" aria-label="Delete gauge">✕</button>`}</td></tr>`;
      }
    }
    if (!p.gauges.length) html += `<tr><td colspan="${cols}" class="empty">No gauges yet. Use <b>＋ Gauge line…</b> to plan positions, or import a data file on <b>Data &amp; plots</b>.</td></tr>`;
    html += `</tbody>`;
    const sections = [...new Set(p.gauges.map(g => g.section).filter(Boolean)), 'Midspan', 'Near support', 'Quarter span'];
    table.innerHTML = html + `<datalist id="sectionList">${[...new Set(sections)].map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
    bindForm(table, (path) => { if (/status|girder|offset|location|order|type/i.test(path)) { if (/status|order|type/.test(path)) render(); drawXS($('#xs'), { loadCases: [] }); } });
    $$('[data-serial]', table).forEach(inp => inp.addEventListener('change', () => {
      const g = p.gauges[Number(inp.dataset.serial)];
      const v = inp.value.trim();
      const clash = v && p.gauges.find(o => o !== g && o.serial && (o.serial === v || serialKey(o.serial) === serialKey(v)));
      if (clash) { toast(`${v} is already used by ${clash.label || clash.serial}`); inp.value = g.serial; return; }
      g.serial = v; save(); drawXS($('#xs'), { loadCases: [] });
    }));
    $$('[data-delg]', table).forEach(b => b.onclick = async () => {
      const g = p.gauges[Number(b.dataset.delg)];
      if (!(await confirmDlg(`Delete gauge ${g.label || g.serial || ''}?`, 'Delete', true))) return;
      p.gauges.splice(p.gauges.indexOf(g), 1); save(); render(); drawXS($('#xs'), { loadCases: [] });
    });
    $$('[data-mv]', table).forEach(b => b.onclick = () => {
      const [i, dir] = b.dataset.mv.split(':').map(Number);
      const sorted = sortGauges(p.gauges, 'order');
      sorted.forEach((g, k) => { g.order = k + 1; });
      const k = sorted.indexOf(p.gauges[i]), j = k + dir;
      if (j < 0 || j >= sorted.length) return;
      [sorted[k].order, sorted[j].order] = [sorted[j].order, sorted[k].order];
      save(); render();
    });
    const note = $('#girderNote');
    if (isGirder && !(p.bridge.girders || []).length) {
      note.innerHTML = `<div class="warn-box">No girder lines yet, so the <b>Girder</b> column is empty. <button class="btn small" id="goBridge">Set up girder lines</button> on the Bridge tab, then use <b>Assign by girder…</b>. You can also just type each gauge's position.</div>`;
      $('#goBridge').onclick = () => document.querySelector('[data-tab=bridge]').click();
    } else note.innerHTML = '';
    $$('[data-replaces]', table).forEach(sel => sel.onchange = () => {
      const g = p.gauges[Number(sel.dataset.replaces)];
      g.replaces = sel.value;
      const old = p.gauges.find(o => o.serial === sel.value);
      if (old) {
        for (const k of ['span', 'girder', 'section', 'xLong', 'location', 'plannedOffset', 'offset', 'thickness', 'dist', 'label']) g[k] = old[k];
        g.order = old.order;
        old.status = 'replaced';
        old.notes = (old.notes ? old.notes + '; ' : '') + 'replaced by ' + (g.serial || g.label);
        toast(`${g.serial || 'New gauge'} now takes the location of ${old.serial}`);
      }
      save(); render(); drawXS($('#xs'), { loadCases: [] });
    });
  };
  $('#sortBy').onchange = e => { s.sortBy = e.target.value; save(); render(); };
  $('#groupBy').onchange = e => { s.groupBy = e.target.value; save(); render(); };
  $('#renumber').onclick = () => { sortGauges(p.gauges, s.sortBy).forEach((g, i) => { g.order = i + 1; }); s.sortBy = 'order'; $('#sortBy').value = 'order'; save(); render(); };
  const nextOrder = () => Math.max(0, ...p.gauges.map(g => Number(g.order) || 0)) + 1;
  $('#addGauge').onclick = async () => {
    const r = await dialog({ title: 'Add gauge', body: `<div class="grid"><label>Serial (optional now)<input name="s" placeholder="B1234"></label><label>Label<input name="l" placeholder="G1"></label><label>Type<select name="t">${opts([['Strain', 'Strain'], ['Displacement', 'Deflection']])}</select></label></div>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Add', primary: true, value: d => ({ s: $('[name=s]', d).value.trim(), l: $('[name=l]', d).value.trim(), t: $('[name=t]', d).value }) }] });
    if (!r) return;
    if (r.s && p.gauges.find(g => g.serial && serialKey(g.serial) === serialKey(r.s))) { toast('That serial already exists'); return; }
    p.gauges.push(newGauge({ serial: r.s, label: r.l, type: r.t, unit: r.t === 'Strain' ? 'ue' : 'in', order: nextOrder() }));
    save(); render();
  };
  $('#addLine').onclick = async () => {
    const cl = isCL(p);
    const r = await dialog({
      title: 'Add a line of gauges',
      body: `<p class="muted small">Adds planned positions across the bridge at a constant spacing. Type the serials later as gauges go on.</p>
      <div class="grid">
        <label>Number of gauges<input name="n" type="number" value="${cl ? 17 : 7}"></label>
        <label>First (leftmost) position (${posUnit(p)})<input name="a" value="${cl ? '16 L' : '2'}"></label>
        <label>Spacing (ft)<input name="sp" type="number" step="any" value="2"></label>
        <label>Label prefix and first number<div class="row" style="flex-wrap:nowrap"><input name="pre" value="G" style="width:70px"><input name="start" type="number" value="${p.gauges.length + 1}" style="width:80px"></div></label>
        <label>Type<select name="t">${opts([['Strain', 'Strain'], ['Displacement', 'Deflection']])}</select></label>
        <label>Location<select name="loc">${opts(LOCATIONS, 'Bottom')}</select></label>
        <label>Section<input name="sec" value="${esc(p.bridge.distSection || 'Midspan')}"></label>
        <label>Span<input name="span" value="1"></label>
        <label>Along bridge (ft from start)<input name="x" type="number" step="any" placeholder="e.g. 12.25"></label>
        <label class="row" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="dist" checked> Use for load distribution</label>
      </div>`,
      buttons: [{ label: 'Cancel', value: null }, {
        label: 'Add gauges', primary: true, value: d => {
          const v = n => $(`[name=${n}]`, d).value;
          return { n: +v('n'), a: cl ? parsePos(v('a')) : Number(v('a')), sp: +v('sp'), pre: v('pre'), start: +v('start') || 1, t: v('t'), loc: v('loc'), sec: v('sec').trim(), span: v('span').trim(), x: v('x') === '' ? '' : Number(v('x')), dist: $('[name=dist]', d).checked };
        },
      }],
      validate: (d) => { const n = +$('[name=n]', d).value; return n > 0 && n <= 200 ? null : 'Enter 1–200 gauges'; },
    });
    if (!r || !isFinite(r.a)) { if (r) toast('First position not recognized'); return; }
    let ord = nextOrder();
    for (let k = 0; k < r.n; k++) {
      p.gauges.push(newGauge({ label: `${r.pre}${r.start + k}`, type: r.t, unit: r.t === 'Strain' ? 'ue' : 'in', location: r.loc, section: r.sec, span: r.span, xLong: r.x, plannedOffset: +(r.a + k * r.sp).toFixed(3), dist: r.dist && r.t === 'Strain', order: ord++ }));
    }
    if (r.sec) p.bridge.distSection = r.sec;
    s.sortBy = 'order';
    save(); render(); drawXS($('#xs'), { loadCases: [] });
    toast(`${r.n} gauge positions added`);
  };
  if ($('#assignGirders')) $('#assignGirders').onclick = async () => {
    const girders = p.bridge.girders || [];
    if (!girders.length) { toast('Set up girder lines on the Bridge tab first'); return; }
    const sec0 = p.bridge.distSection || 'Midspan';
    const usable = g => !['unused', 'removed', 'replaced'].includes(g.status);
    const idx = g => String(p.gauges.indexOf(g));
    const strain = sortGauges(p.gauges.filter(g => isStrain(g) && usable(g)), 'serial');
    const defl = sortGauges(p.gauges.filter(g => isDefl(g) && usable(g)), 'serial');
    const label = g => [g.serial || '(no serial)', g.label].filter(Boolean).join(' · ') + (g.girder && g.section ? `  (now ${g.girder} ${g.location || ''})` : '');
    const current = (gname, test, list, sec) => { const g = list.find(x => x.girder === gname && test(x) && (x.section || '') === sec); return g ? idx(g) : ''; };
    const rowsHtml = sec => girders.map((gd, k) => `<tr><td><b>${esc(gd.name)}</b><div class="muted small">${fmtPos(p, gd.offset)}</div></td>
      <td><select data-role="Bottom" data-k="${k}">${opts([['', '—'], ...strain.map(g => [idx(g), label(g)])], current(gd.name, x => /bottom/i.test(x.location || ''), strain, sec))}</select></td>
      <td><select data-role="Top" data-k="${k}">${opts([['', '—'], ...strain.map(g => [idx(g), label(g)])], current(gd.name, x => /top/i.test(x.location || ''), strain, sec))}</select></td>
      <td><select data-role="Defl" data-k="${k}">${opts([['', '—'], ...defl.map(g => [idx(g), label(g)])], current(gd.name, () => true, defl, sec))}</select></td></tr>`).join('');
    const r = await dialog({
      title: 'Assign gauges to girders',
      body: `<p class="muted small">Pick the gauge on each girder at one cross-section. Bottom gauges become the load distribution gauges, and the gauge order follows the girders (${esc(girders[0].name)} first). Run this again for other sections.</p>
        <div class="grid"><label>Section<input name="sec" value="${esc(sec0)}" list="secList2"><datalist id="secList2">${[...new Set([sec0, 'Midspan', 'Near support', 'Quarter span', ...p.gauges.map(g => g.section).filter(Boolean)])].map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label>Span<input name="span" value="1" inputmode="numeric"></label>
        <label>Along bridge (ft from start)<input name="x" type="number" step="any"></label></div>
        <div class="table-wrap" style="margin-top:10px"><table class="data"><thead><tr><th>Girder</th><th>Bottom strain</th><th>Top strain</th><th>Deflection</th></tr></thead><tbody id="asgRows">${rowsHtml(sec0)}</tbody></table></div>`,
      buttons: [{ label: 'Cancel', value: null }, {
        label: 'Assign', primary: true, value: d => ({
          sec: $('[name=sec]', d).value.trim() || 'Midspan', span: $('[name=span]', d).value.trim(), x: $('[name=x]', d).value === '' ? null : Number($('[name=x]', d).value),
          picks: $$('[data-role]', d).map(sel => ({ role: sel.dataset.role, k: Number(sel.dataset.k), gi: sel.value })),
        }),
      }],
      validate: d => {
        const chosen = $$('[data-role]', d).map(s => s.value).filter(Boolean);
        const dup = chosen.find((v, i) => chosen.indexOf(v) !== i);
        return dup ? `${label(p.gauges[Number(dup)])} is picked twice` : null;
      },
      onOpen: d => { $('[name=sec]', d).addEventListener('change', e => { $('#asgRows', d).innerHTML = rowsHtml(e.target.value.trim()); }); },
    });
    if (!r) return;
    const chosen = new Set(r.picks.map(x => x.gi).filter(Boolean).map(Number));
    p.gauges.forEach((g, gi) => {
      if ((g.section || '') === r.sec && g.girder && !chosen.has(gi)) {
        const slot = r.picks.some(x => girders[x.k].name === g.girder && (x.role === 'Defl' ? isDefl(g) : new RegExp(x.role, 'i').test(g.location || '')));
        if (slot) { g.girder = ''; g.dist = false; }
      }
    });
    let order = 0;
    const assigned = [];
    for (const role of ['Bottom', 'Top', 'Defl']) {
      for (const x of r.picks.filter(q => q.role === role && q.gi).sort((a, b) => a.k - b.k)) {
        const g = p.gauges[Number(x.gi)]; if (!g) continue;
        Object.assign(g, { girder: girders[x.k].name, section: r.sec, span: r.span, location: role === 'Defl' ? 'Bottom' : role, offset: '', plannedOffset: '', dist: role === 'Bottom' && isStrain(g) });
        if (r.x != null && isFinite(r.x)) g.xLong = r.x;
        assigned.push(g);
      }
    }
    const gi = name => girders.findIndex(gd => gd.name === name);
    assigned.sort((a, b) => (isDefl(a) - isDefl(b)) || gi(a.girder) - gi(b.girder) || (a.location === 'Top') - (b.location === 'Top'));
    const rest = sortGauges(p.gauges.filter(g => !assigned.includes(g)), 'order');
    [...assigned, ...rest].forEach(g => { g.order = ++order; });
    p.bridge.distSection = r.sec;
    s.sortBy = 'order'; $('#sortBy').value = 'order';
    save(); render(); drawXS($('#xs'), { loadCases: [] });
    toast(`${assigned.length} gauges assigned at ${r.sec}`);
  };
  if ($('#fillH')) $('#fillH').onclick = async () => {
    const cl = isCL(p);
    const sections = [...new Set(p.gauges.map(g => g.section).filter(Boolean))];
    const r = await dialog({
      title: 'Fill slab thickness',
      body: `<p class="muted small">Sets the slab thickness at each strain gauge in a section. Use measured thicknesses where you have them (GPR, cores, or top-of-deck survey against the soffit) — moment varies with h², so a 10% thickness error is about a 20% moment error. You can still edit any value in the table afterwards.</p>
      <div class="grid">
        <label>Section<select name="sec">${opts(sections.length ? sections : [''], p.bridge.distSection)}</select></label>
        <label>Thickness varies<select name="mode">${opts([['const', 'Constant'], ['linear', 'Linearly, left to right'], ['crown', 'Crowned (thickest at the crown)']])}</select></label>
        <label><span data-l1>Thickness (in)</span><input name="v1" type="number" step="any" placeholder="16"></label>
        <label data-v2 hidden><span data-l2>Thickness at outer gauges (in)</span><input name="v2" type="number" step="any"></label>
        <label data-crown hidden>Crown position (${posUnit(p)})<input name="c" value="${cl ? 'CL' : fmtPos(p, clPos(p))}"></label>
      </div>`,
      buttons: [{ label: 'Cancel', value: null }, {
        label: 'Fill', primary: true, value: d => ({
          sec: $('[name=sec]', d).value, mode: $('[name=mode]', d).value, v1: Number($('[name=v1]', d).value), v2: Number($('[name=v2]', d).value),
          c: cl ? parsePos($('[name=c]', d).value) : Number($('[name=c]', d).value),
        }),
      }],
      validate: d => {
        const mode = $('[name=mode]', d).value, v1 = Number($('[name=v1]', d).value), v2 = Number($('[name=v2]', d).value);
        if (!(v1 > 0)) return 'Enter a thickness';
        if (mode !== 'const' && !(v2 > 0)) return 'Enter the second thickness';
        return null;
      },
      onOpen: d => {
        const upd = () => {
          const m = $('[name=mode]', d).value;
          $('[data-v2]', d).hidden = m === 'const'; $('[data-crown]', d).hidden = m !== 'crown';
          $('[data-l1]', d).textContent = m === 'const' ? 'Thickness (in)' : m === 'linear' ? 'Thickness at leftmost gauge (in)' : 'Thickness at the crown (in)';
          $('[data-l2]', d).textContent = m === 'linear' ? 'Thickness at rightmost gauge (in)' : 'Thickness at outer gauges (in)';
        };
        $('[name=mode]', d).onchange = upd; upd();
      },
    });
    if (!r) return;
    const gs = p.gauges.filter(g => isStrain(g) && (g.section || '') === r.sec && isFinite(gaugeOffset(g)));
    if (!gs.length) { toast('No strain gauges with positions in that section'); return; }
    const xs = gs.map(g => gaugeOffset(g)), lo = Math.min(...xs), hi = Math.max(...xs);
    gs.forEach(g => {
      const x = gaugeOffset(g);
      let h = r.v1;
      if (r.mode === 'linear') h = hi > lo ? r.v1 + (r.v2 - r.v1) * (x - lo) / (hi - lo) : r.v1;
      if (r.mode === 'crown') { const c = isFinite(r.c) ? r.c : (lo + hi) / 2; const span = x < c ? c - lo : hi - c; h = span > 0 ? r.v1 + (r.v2 - r.v1) * Math.abs(x - c) / span : r.v1; }
      g.thickness = +h.toFixed(2);
    });
    save(); render(); toast(`Thickness set for ${gs.length} gauges`);
  };
  $('#autoDist').onclick = async () => {
    const sections = [...new Set(p.gauges.map(g => g.section).filter(Boolean))];
    const r = await dialog({
      title: 'Pick distribution gauges',
      body: `<p class="muted">${p.bridge.type === 'slab' ? 'Slab bridge: selects the strain gauges on the bottom of the slab at this section (used for equivalent strip width).' : 'Selects the bottom strain gauges at this section (one per girder on a girder bridge).'}</p>
      <label class="field">Section<select name="sec">${opts(sections.length ? sections : ['Midspan'], p.bridge.distSection)}</select></label>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Select', primary: true, value: d => $('[name=sec]', d).value }],
    });
    if (!r) return;
    let n = 0;
    p.gauges.forEach(g => {
      g.dist = isStrain(g) && g.section === r && (/bottom/i.test(g.location || '') || (p.bridge.type === 'slab' && !/top|deck/i.test(g.location || ''))) && !BAD.includes(g.status);
      if (g.dist) n++;
    });
    p.bridge.distSection = r;
    save(); render(); toast(`${n} distribution gauges selected`);
  };
  render();
  requestAnimationFrame(() => drawXS($('#xs'), { loadCases: [] }));
}

// ---------------- Vehicles ----------------
const TEMPLATES = {
  tandem: { name: 'Tandem-axle dump truck', axles: [{ spacing: '', weight: '', track: 82, tireWidth: 12, dual: false }, { spacing: '', weight: '', track: 72, tireWidth: 10, dual: true, dualOut: '' }, { spacing: 54, weight: '', track: 72, tireWidth: 10, dual: true, dualOut: '' }] },
  tridem: { name: 'Tri-axle truck', axles: [{ spacing: '', weight: '', track: 82, tireWidth: 12, dual: false }, { spacing: '', weight: '', track: 72, tireWidth: 10, dual: true }, { spacing: 54, weight: '', track: 72, tireWidth: 10, dual: true }, { spacing: 54, weight: '', track: 72, tireWidth: 10, dual: true }] },
  single: { name: 'Single-axle truck', axles: [{ spacing: '', weight: '', track: 80, tireWidth: 12, dual: false }, { spacing: '', weight: '', track: 72, tireWidth: 10, dual: true }] },
  two: { name: 'Other vehicle', axles: [{ spacing: '', weight: '', track: 96, tireWidth: 20, dual: false }, { spacing: '', weight: '', track: 96, tireWidth: 20, dual: false }] },
};

export function renderVehicles(main) {
  const p = P();
  main.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Load vehicles</h2><span class="spacer"></span>
    <button class="btn" data-tpl="tandem">＋ Tandem dump truck</button><button class="btn" data-tpl="tridem">＋ Tri-axle</button><button class="btn" data-tpl="single">＋ Single-axle</button><button class="btn" data-tpl="two">＋ Other vehicle</button></div>
    <p class="muted small">Any number of axles. Spacing is from the previous axle and can be typed in inches (236) or ft-in (19'-8"). Gage / track = center-to-center of the wheel lines (center of each dual set). Weights are per axle.</p></div>
    <div id="vehList"></div>`;
  $$('[data-tpl]', main).forEach(b => b.onclick = () => {
    const t = TEMPLATES[b.dataset.tpl];
    p.vehicles.push({ id: uid(), name: `Truck ${p.vehicles.length + 1}`, description: t.name, plate: '', axles: JSON.parse(JSON.stringify(t.axles)) });
    save(); renderList();
  });
  const renderList = () => {
    const host = $('#vehList');
    if (!p.vehicles.length) { host.innerHTML = `<div class="card empty">No vehicles yet. Add one above.</div>`; return; }
    host.innerHTML = p.vehicles.map((v, vi) => `<div class="card" data-v="${vi}">
      <div class="grid">
        <label>Name<input data-bind="vehicles.${vi}.name"></label>
        <label>Description<input data-bind="vehicles.${vi}.description"></label>
        <label>Truck ID / owner<input data-bind="vehicles.${vi}.plate"></label>
        <label>Front bumper to steer axle (in or ft-in)<input data-bind="vehicles.${vi}.bumper" data-type="len"></label>
        <label>Overall width at mirrors / body (in or ft-in)<input data-bind="vehicles.${vi}.overallWidth" data-type="len"></label>
        <label>Tire pressure (psi)<input data-bind="vehicles.${vi}.tirePressure"></label>
        <label class="wide">Notes<input data-bind="vehicles.${vi}.notes" placeholder="Load, scale ticket…"></label>
      </div>
      <div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>Axle</th><th>Spacing from previous</th><th>Weight (lb)</th><th>Gage c/c (in)</th><th>Tire width (in)</th><th>Dual</th><th>Dual set out-to-out (in)</th><th></th></tr></thead><tbody>
      ${v.axles.map((a, ai) => `<tr><td>${ai + 1}</td>
        <td>${ai === 0 ? '<span class="muted">—</span>' : `<input data-bind="vehicles.${vi}.axles.${ai}.spacing" data-type="len" style="width:110px"> <span class="muted small">${a.spacing ? ftin(Number(a.spacing) / 12) : ''}</span>`}</td>
        <td><input data-bind="vehicles.${vi}.axles.${ai}.weight" data-type="num" inputmode="numeric"></td>
        <td><input data-bind="vehicles.${vi}.axles.${ai}.track" data-type="len"></td>
        <td><input data-bind="vehicles.${vi}.axles.${ai}.tireWidth" data-type="num" inputmode="decimal"></td>
        <td><input type="checkbox" data-bind="vehicles.${vi}.axles.${ai}.dual"></td>
        <td>${a.dual ? `<input data-bind="vehicles.${vi}.axles.${ai}.dualOut" data-type="len">` : '<span class="muted">—</span>'}</td>
        <td><button class="btn small danger" data-delax="${ai}">✕</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="row" style="margin-top:8px"><button class="btn small" data-addax>＋ Axle</button>
        <span class="muted small" data-sum></span><span class="spacer"></span>
        <button class="btn small" data-dup>Duplicate</button><button class="btn small danger" data-delv>Delete vehicle</button></div>
      <canvas class="diagram" style="margin-top:10px"></canvas></div>`).join('');
    $$('[data-v]', host).forEach(card => {
      const vi = Number(card.dataset.v), v = p.vehicles[vi];
      const canvas = $('canvas', card);
      const redraw = () => {
        if (!card.isConnected) return;
        drawInto(canvas, 260, (ctx, w, h, theme) => drawTruck(ctx, w, h, v, { theme }));
        const gross = v.axles.reduce((t, a) => t + (Number(a.weight) || 0), 0);
        const wb = v.axles.slice(1).reduce((t, a) => t + (Number(a.spacing) || 0), 0);
        $('[data-sum]', card).textContent = `Gross ${gross.toLocaleString()} lb · wheelbase ${wb}" (${ftin(wb / 12)})`;
      };
      bindForm(card, (path) => { if (/dual$|spacing$/.test(path)) renderList(); else redraw(); });
      $('[data-addax]', card).onclick = () => { const last = v.axles[v.axles.length - 1] || {}; v.axles.push({ spacing: '', weight: '', track: last.track || 72, tireWidth: last.tireWidth || 10, dual: !!last.dual, dualOut: last.dualOut || '' }); save(); renderList(); };
      $$('[data-delax]', card).forEach(b => b.onclick = () => { v.axles.splice(Number(b.dataset.delax), 1); save(); renderList(); });
      $('[data-dup]', card).onclick = () => { const c = JSON.parse(JSON.stringify(v)); c.id = uid(); c.name += ' copy'; p.vehicles.push(c); save(); renderList(); };
      $('[data-delv]', card).onclick = async () => { if (await confirmDlg(`Delete ${v.name}?`, 'Delete', true)) { p.vehicles.splice(vi, 1); save(); renderList(); } };
      requestAnimationFrame(redraw);
    });
  };
  renderList();
}

// ---------------- Load cases ----------------
export function renderLoadCases(main) {
  const p = P();
  const cl = isCL(p);
  main.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Load paths (load cases)</h2><span class="spacer"></span><button class="btn" id="addLC">＋ Load case</button></div>
    <p class="muted small">${cl ? `Positions are left (L) or right (R) of the roadway centerline, e.g. <b>13 L</b>. The driver's side is on the ${esc(p.bridge.driverSide || 'left')} (set on the Bridge tab).` : `Positions are feet from <b>${esc(p.bridge.edgeA || 'Edge A')}</b> edge of deck.`}
    Pick which point of the vehicle the position locates; the app works out both wheel lines from the truck's gage. Use as many load cases as the test needs, including speed runs.${p.bridge.type === 'slab' ? ' <b>M static</b> (optional) is the total moment at the gauge section from your own analysis of the truck at its critical position; it gives a statics check and a second strip width, M_static ÷ m_max.' : ''}</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Description</th><th>Vehicle(s)</th><th>Locates</th><th>Position (${posUnit(p)})</th><th>Speed</th><th>Compare to (crawl)</th><th>Marked on deck</th>${p.bridge.type === 'slab' ? '<th title="Optional: total static moment at the gauge section from your own analysis, for the statics check">M static (kip-ft)</th>' : ''}<th class="num">${sideName(p, 'A')} wheel</th><th class="num">${sideName(p, 'B')} wheel</th><th class="num">Vehicle C/L</th><th></th></tr></thead><tbody id="lcRows"></tbody></table></div></div>
    <div class="card"><h2>Load paths on cross-section</h2><canvas class="diagram" id="xs"></canvas></div>`;
  const render = () => {
    const tb = $('#lcRows');
    tb.innerHTML = p.loadCases.map((lc, i) => {
      const veh = p.vehicles.find(v => v.id === (lc.vehicleIds || [])[0]) || p.vehicles[0];
      const w = loadCaseWheels(lc, veh);
      const show = v => cl ? fmtPos(p, v, 2) : ftin(v);
      return `<tr>
      <td><input data-bind="loadCases.${i}.name" style="width:70px"></td>
      <td><input data-bind="loadCases.${i}.description" style="min-width:160px" placeholder="Driver's wheel 2 ft from left rail"></td>
      <td>${p.vehicles.length ? p.vehicles.map(v => `<label class="row small" style="gap:4px;white-space:nowrap"><input type="checkbox" data-lcveh="${i}" value="${v.id}" ${(lc.vehicleIds || []).includes(v.id) ? 'checked' : ''}>${esc(v.name)}</label>`).join('') : '<span class="muted small">Add vehicles first</span>'}</td>
      <td><select data-bind="loadCases.${i}.ref" style="width:190px">${opts([['center', 'Vehicle centerline'], ['wheelA', `${sideName(p, 'A')} wheel (c/l tire)`], ['wheelAout', `${sideName(p, 'A')} wheel (outside face)`], ['wheelB', `${sideName(p, 'B')} wheel (c/l tire)`], ['wheelBout', `${sideName(p, 'B')} wheel (outside face)`]])}</select></td>
      <td><input data-bind="loadCases.${i}.offset" data-type="pos" style="width:90px"></td>
      <td><input data-bind="loadCases.${i}.speed" style="width:90px" placeholder="crawl / 35 mph"></td>
      <td><select data-bind="loadCases.${i}.crawlRef" style="width:90px">${opts([['', '—'], ...p.loadCases.filter(o => o !== lc).map(o => [o.id, o.name])])}</select></td>
      <td><input type="checkbox" data-bind="loadCases.${i}.marked"></td>
      ${p.bridge.type === 'slab' ? `<td><input data-bind="loadCases.${i}.mStatic" data-type="num" inputmode="decimal" style="width:80px" placeholder="optional"></td>` : ''}
      <td class="num">${show(w.a)}</td><td class="num">${show(w.b)}</td><td class="num">${show(w.center)}</td>
      <td><button class="btn small danger" data-del="${i}">✕</button></td></tr>`;
    }).join('') || `<tr><td colspan="12" class="empty">No load cases yet.</td></tr>`;
    bindForm(tb, (path) => { if (/offset|ref/.test(path)) render(); drawXS($('#xs')); });
    $$('[data-lcveh]', tb).forEach(cb => cb.onchange = () => {
      const lc = p.loadCases[Number(cb.dataset.lcveh)];
      lc.vehicleIds = $$(`[data-lcveh="${cb.dataset.lcveh}"]`, tb).filter(x => x.checked).map(x => x.value);
      save(); render(); drawXS($('#xs'));
    });
    $$('[data-del]', tb).forEach(b => b.onclick = async () => { const lc = p.loadCases[Number(b.dataset.del)]; if (await confirmDlg(`Delete ${lc.name}?`, 'Delete', true)) { p.loadCases.splice(Number(b.dataset.del), 1); save(); render(); drawXS($('#xs')); } });
  };
  $('#addLC').onclick = () => {
    const n = p.loadCases.length + 1;
    const prev = p.loadCases[p.loadCases.length - 1];
    p.loadCases.push({ id: uid(), name: 'LC' + n, description: '', vehicleIds: prev ? [...(prev.vehicleIds || [])] : p.vehicles.slice(0, 1).map(v => v.id), ref: 'center', offset: cl ? 0 : (Number(p.bridge.deckWidth) || 30) / 2, speed: 'crawl', crawlRef: '', marked: false });
    save(); render(); drawXS($('#xs'));
  };
  render();
  requestAnimationFrame(() => drawXS($('#xs')));
}
