// Setup tabs: Bridge, Gauges, Vehicles, Load paths
import { state, save, uid, LOCATIONS, gaugeOffset, groupKey, sortGauges, isDefl, isStrain, shortSerial } from './state.js';
import { esc, $, $$, bindForm, opts, dialog, confirmDlg, toast } from './ui.js';
import { drawCrossSection, drawTruck, drawInto, loadCaseWheels } from './draw.js';
import { ftin, bridgeLength } from './calc.js';

const P = () => state.project;

function crossSectionGauges() {
  return P().gauges.filter(g => g.status !== 'unused' && g.status !== 'removed' && g.status !== 'replaced')
    .map(g => ({ serial: g.serial, short: g.label || shortSerial(g.serial), type: g.type, location: g.location, offset: gaugeOffset(g) }));
}

export function drawXS(canvas, extra = {}) {
  const lcs = extra.loadCases ?? P().loadCases;
  const h = Math.max(220, 190 + lcs.length * 30 + (P().bridge.type === 'slab' ? 0 : 80));
  drawInto(canvas, h, (ctx, w, hh, theme) => drawCrossSection(ctx, w, hh, P(), { theme, gauges: crossSectionGauges(), loadCases: lcs, ...extra }));
}

// ---------------- Bridge ----------------
export function renderBridge(main) {
  const b = P().bridge;
  main.innerHTML = `
  <div class="card"><h2>Bridge</h2>
    <div class="grid">
      <label>Structure number<input data-bind="bridge.structureNo"></label>
      <label>Bridge name<input data-bind="bridge.name"></label>
      <label>Location<input data-bind="bridge.location"></label>
      <label>County<input data-bind="bridge.county"></label>
      <label>Route / feature carried<input data-bind="bridge.route"></label>
      <label>Feature crossed<input data-bind="bridge.featureCrossed"></label>
      <label>Owner<input data-bind="bridge.owner"></label>
      <label>Year built<input data-bind="bridge.yearBuilt" inputmode="numeric"></label>
      <label>Test date<input type="date" data-bind="bridge.testDate"></label>
    </div>
  </div>
  <div class="card"><h2>Structure</h2>
    <div class="grid">
      <label>Bridge type<select data-bind="bridge.type">${opts([['girder', 'Girder bridge'], ['slab', 'Slab bridge']])}</select></label>
      <label>Girder / slab description<input data-bind="bridge.girderType" placeholder="e.g. W36x150 steel, PPCB, RC slab"></label>
      <label>Material<select data-bind="bridge.material" id="matSel">${opts([['steel', 'Steel'], ['concrete', 'Reinforced concrete'], ['prestressed', 'Prestressed concrete'], ['timber', 'Timber'], ['other', 'Other']])}</select></label>
      <label>Modulus E (ksi)<input data-bind="bridge.E" data-type="num" inputmode="decimal"></label>
      <label>Span lengths (ft, comma separated)<input data-bind="bridge.spans" data-type="list" placeholder="40, 52, 40"></label>
      <label>Skew (deg)<input data-bind="bridge.skew" data-type="num" inputmode="decimal"></label>
      <label>Deck width, out-to-out (ft)<input data-bind="bridge.deckWidth" data-type="num" inputmode="decimal"></label>
      <label>Curb/barrier line on Edge A side (ft from Edge A)<input data-bind="bridge.curbA" data-type="num" inputmode="decimal"></label>
      <label>Curb/barrier line on Edge B side (ft from Edge A)<input data-bind="bridge.curbB" data-type="num" inputmode="decimal"></label>
      <label>Lane / white lines (ft from Edge A)<input data-bind="bridge.laneLines" placeholder="3.2, 15, 26.8"></label>
      <label>Edge A label (left side of section)<input data-bind="bridge.edgeA"></label>
      <label>Edge B label (right side)<input data-bind="bridge.edgeB"></label>
      <label>Section viewed looking<input data-bind="bridge.lookDir" placeholder="north"></label>
      <label>Section used for load distribution<input data-bind="bridge.distSection" placeholder="Midspan"></label>
      <label class="wide">Notes<textarea data-bind="bridge.notes" placeholder="Condition, deck, bearings, approach…"></textarea></label>
    </div>
    <p class="muted small">Total length: <b id="totLen">${ftin(bridgeLength(P()))}</b>. All transverse positions are measured from Edge A.</p>
  </div>
  <div class="card" id="girderCard"><div class="row"><h2 style="margin:0">Girder lines</h2><span class="spacer"></span>
      <button class="btn small" id="genGirders">Generate evenly spaced…</button><button class="btn small" id="addGirder">＋ Girder</button></div>
    <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Offset from Edge A (ft)</th><th>Description</th><th></th></tr></thead><tbody id="girderRows"></tbody></table></div>
  </div>
  <div class="card"><h2>Test details</h2>
    <div class="grid">
      <label>Crew<input data-bind="test.crew"></label>
      <label>Weather<input data-bind="test.weather"></label>
      <label>Temperature<input data-bind="test.temperature"></label>
      <label>Gauge length / extensions<input data-bind="test.gaugeLength" placeholder='e.g. 15" extensions'></label>
      <label>Data acquisition<input data-bind="test.dataSystem"></label>
      <label class="wide">Purpose of test<textarea data-bind="test.purpose"></textarea></label>
    </div>
  </div>
  <div class="card"><h2>Cross-section</h2><canvas class="diagram" id="xs"></canvas></div>`;
  const redraw = () => { const tl = $('#totLen'); if (!tl) return; tl.textContent = ftin(bridgeLength(P())); drawXS($('#xs')); };
  bindForm(main, (path, val) => {
    if (path === 'bridge.material') {
      const E = { steel: 29000, concrete: 3600, prestressed: 4700, timber: 1600 }[val];
      if (E) { P().bridge.E = E; $('[data-bind="bridge.E"]').value = E; toast(`E set to ${E} ksi — adjust if needed`); }
    }
    redraw();
  });
  const renderGirders = () => {
    const tb = $('#girderRows');
    tb.innerHTML = (b.girders || []).map((g, i) => `<tr>
      <td><input data-bind="bridge.girders.${i}.name"></td>
      <td><input data-bind="bridge.girders.${i}.offset" data-type="num" inputmode="decimal"></td>
      <td><input data-bind="bridge.girders.${i}.desc" placeholder="Exterior, interior…"></td>
      <td><button class="btn small danger" data-del="${i}">✕</button></td></tr>`).join('') || `<tr><td colspan="4" class="muted">No girder lines yet.</td></tr>`;
    bindForm(tb, redraw);
    $$('[data-del]', tb).forEach(btn => btn.onclick = () => { b.girders.splice(Number(btn.dataset.del), 1); save(); renderGirders(); redraw(); });
  };
  $('#addGirder').onclick = () => { b.girders = b.girders || []; const last = b.girders[b.girders.length - 1]; b.girders.push({ name: 'G' + (b.girders.length + 1), offset: last ? Number(last.offset) + 6 : 3, desc: '' }); save(); renderGirders(); redraw(); };
  $('#genGirders').onclick = async () => {
    const r = await dialog({
      title: 'Generate girder lines', body: `<div class="grid"><label>Number of girders<input name="n" type="number" value="5"></label>
      <label>First girder offset (ft)<input name="a" type="number" step="any" value="3"></label><label>Spacing (ft)<input name="s" type="number" step="any" value="7"></label></div>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Generate', primary: true, value: d => ({ n: +$('[name=n]', d).value, a: +$('[name=a]', d).value, s: +$('[name=s]', d).value }) }],
    });
    if (!r || !(r.n > 0)) return;
    b.girders = Array.from({ length: r.n }, (_, i) => ({ name: 'G' + (i + 1), offset: +(r.a + i * r.s).toFixed(3), desc: i === 0 || i === r.n - 1 ? 'Exterior' : 'Interior' }));
    save(); renderGirders(); redraw();
  };
  $('#girderCard').hidden = b.type === 'slab';
  $('[data-bind="bridge.type"]').addEventListener('change', e => { $('#girderCard').hidden = e.target.value === 'slab'; });
  renderGirders();
  requestAnimationFrame(redraw);
}

// ---------------- Gauges ----------------
export function renderGauges(main) {
  const p = P();
  const s = p.settings;
  const girderNames = (p.bridge.girders || []).map(g => g.name);
  main.innerHTML = `
  <div class="card">
    <div class="row"><h2 style="margin:0">Gauge map</h2><span class="spacer"></span>
      <label class="row small muted">Sort <select id="sortBy" style="width:auto">${opts([['order', 'Order #'], ['serial', 'Serial'], ['girder', 'Girder'], ['span', 'Span'], ['section', 'Section'], ['location', 'Location'], ['type', 'Type']], s.sortBy)}</select></label>
      <label class="row small muted">Group <select id="groupBy" style="width:auto">${opts([['none', 'None'], ['girder', 'Girder'], ['span', 'Span'], ['section', 'Section'], ['location', 'Location'], ['type', 'Type']], s.groupBy)}</select></label>
      <button class="btn small" id="renumber">Renumber in this order</button>
      <button class="btn small primary" id="assignGirders">Assign by girder…</button>
      <button class="btn small" id="autoDist">Pick distribution gauges…</button>
      <button class="btn small" id="addGauge">＋ Gauge</button>
    </div>
    <p class="muted small">Gauges are added automatically when you import a data file. BDI serial numbers are the IDs. Set status to <b>Bad</b> to drop a gauge from plots and results, or use <b>Replaces</b> when a gauge was swapped: the new one takes over the old one's location.</p>
    <div id="girderNote"></div>
    <div class="table-wrap"><table class="data" id="gaugeTable"></table></div>
  </div>
  <div class="card"><h2>Gauge locations on cross-section</h2><canvas class="diagram" id="xs"></canvas>
    <p class="muted small">● strain gauge &nbsp; ▼ deflection transducer. Gauges without a girder or offset are not drawn.</p></div>`;

  const table = $('#gaugeTable');
  const render = () => {
    const list = sortGauges(p.gauges, s.sortBy);
    const groups = new Map();
    for (const g of list) { const k = s.groupBy === 'none' ? '' : groupKey(g, s.groupBy); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(g); }
    let html = `<thead><tr><th>#</th><th>Serial</th><th>Type</th><th>Label</th><th>Span</th><th>Girder</th><th>Section</th><th>Location</th><th>Offset (ft)</th><th title="Use for load distribution">Dist.</th><th>Status</th><th>Replaces</th><th>Notes</th></tr></thead><tbody>`;
    for (const [k, gs] of groups) {
      if (k) html += `<tr class="group-row"><td colspan="13">${esc(k)} <span class="muted">(${gs.length})</span></td></tr>`;
      for (const g of gs) {
        const i = p.gauges.indexOf(g);
        const bad = ['bad', 'unused', 'removed', 'replaced'].includes(g.status);
        const autoOff = (g.offset === '' || g.offset == null) && isFinite(gaugeOffset(g)) ? gaugeOffset(g) : '';
        html += `<tr class="${bad ? 'bad' : ''}">
          <td style="white-space:nowrap">${s.sortBy === 'order' ? `<button class="btn small" data-mv="${i}:-1" title="Move up" aria-label="Move up">▲</button><button class="btn small" data-mv="${i}:1" title="Move down" aria-label="Move down">▼</button> ` : ''}<input data-bind="gauges.${i}.order" data-type="num" inputmode="numeric" style="width:52px"></td>
          <td><b>${esc(g.serial)}</b></td>
          <td><span class="pill ${isDefl(g) ? 'disp' : isStrain(g) ? 'strain' : ''}">${esc(isDefl(g) ? 'Deflection' : isStrain(g) ? 'Strain' : g.type)}</span></td>
          <td><input data-bind="gauges.${i}.label" style="width:80px" placeholder="e.g. 7"></td>
          <td><input data-bind="gauges.${i}.span" style="width:56px" inputmode="numeric"></td>
          <td><select data-bind="gauges.${i}.girder" style="width:90px">${opts([['', '—'], ...girderNames])}</select></td>
          <td><input data-bind="gauges.${i}.section" style="width:110px" placeholder="Midspan" list="sectionList"></td>
          <td><select data-bind="gauges.${i}.location" style="width:100px">${opts([['', '—'], ...LOCATIONS])}</select></td>
          <td><input data-bind="gauges.${i}.offset" data-type="num" inputmode="decimal" style="width:80px" placeholder="${autoOff !== '' ? autoOff + ' (girder)' : ''}"></td>
          <td><input type="checkbox" data-bind="gauges.${i}.dist"></td>
          <td><select data-bind="gauges.${i}.status" style="width:100px">${opts([['ok', 'OK'], ['bad', 'Bad'], ['replaced', 'Replaced'], ['removed', 'Removed'], ['unused', 'Unused ch.']])}</select></td>
          <td><select data-replaces="${i}" style="width:120px">${opts([['', '—'], ...p.gauges.filter(o => o !== g).map(o => o.serial)], g.replaces)}</select></td>
          <td><input data-bind="gauges.${i}.notes" style="min-width:120px"></td></tr>`;
      }
    }
    if (!p.gauges.length) html += `<tr><td colspan="13" class="empty">No gauges yet. Import a data file on the <b>Data &amp; plots</b> tab, or add gauges by hand.</td></tr>`;
    html += `</tbody>`;
    const sections = [...new Set(p.gauges.map(g => g.section).filter(Boolean)), 'Midspan', 'Near support', 'Quarter span'];
    table.innerHTML = html + `<datalist id="sectionList">${[...new Set(sections)].map(x => `<option value="${esc(x)}">`).join('')}</datalist>`;
    bindForm(table, (path) => { if (/status|girder|offset|location|order/.test(path)) { if (/status|order/.test(path)) render(); drawXS($('#xs'), { loadCases: [] }); } });
    $$('[data-mv]', table).forEach(b => b.onclick = () => {
      const [i, dir] = b.dataset.mv.split(':').map(Number);
      const sorted = sortGauges(p.gauges, 'order');
      sorted.forEach((g, k) => { g.order = k + 1; }); // make the numbering clean first
      const k = sorted.indexOf(p.gauges[i]), j = k + dir;
      if (j < 0 || j >= sorted.length) return;
      [sorted[k].order, sorted[j].order] = [sorted[j].order, sorted[k].order];
      save(); render();
    });
    const note = $('#girderNote');
    if (p.bridge.type !== 'slab' && !(p.bridge.girders || []).length) {
      note.innerHTML = `<div class="warn-box">No girder lines yet, so the <b>Girder</b> column is empty. <button class="btn small" id="goBridge">Set up girder lines</button> on the Bridge tab (or use <b>Generate evenly spaced…</b> there), then come back and use <b>Assign by girder…</b>.</div>`;
      $('#goBridge').onclick = () => document.querySelector('[data-tab=bridge]').click();
    } else if (p.bridge.type === 'slab') {
      note.innerHTML = `<p class="muted small">Slab bridge: enter each gauge's <b>Offset</b> from ${esc(p.bridge.edgeA || 'Edge A')} so the distribution plot can place it across the deck.</p>`;
    } else note.innerHTML = '';
    $$('[data-replaces]', table).forEach(sel => sel.onchange = () => {
      const g = p.gauges[Number(sel.dataset.replaces)];
      g.replaces = sel.value;
      const old = p.gauges.find(o => o.serial === sel.value);
      if (old) {
        for (const k of ['span', 'girder', 'section', 'location', 'offset', 'dist', 'label']) g[k] = old[k];
        g.order = old.order;
        old.status = 'replaced';
        old.notes = (old.notes ? old.notes + '; ' : '') + 'replaced by ' + g.serial;
        toast(`${g.serial} now takes the location of ${old.serial}`);
      }
      save(); render(); drawXS($('#xs'), { loadCases: [] });
    });
  };
  $('#sortBy').onchange = e => { s.sortBy = e.target.value; save(); render(); };
  $('#groupBy').onchange = e => { s.groupBy = e.target.value; save(); render(); };
  $('#renumber').onclick = () => { sortGauges(p.gauges, s.sortBy).forEach((g, i) => { g.order = i + 1; }); s.sortBy = 'order'; $('#sortBy').value = 'order'; save(); render(); };
  $('#addGauge').onclick = async () => {
    const r = await dialog({ title: 'Add gauge', body: `<div class="grid"><label>Serial number<input name="s" placeholder="B1234"></label><label>Type<select name="t">${opts([['Strain', 'Strain'], ['Displacement', 'Deflection']])}</select></label></div>`, buttons: [{ label: 'Cancel', value: null }, { label: 'Add', primary: true, value: d => ({ s: $('[name=s]', d).value.trim(), t: $('[name=t]', d).value }) }] });
    if (!r || !r.s) return;
    if (p.gauges.find(g => g.serial === r.s)) { toast('That serial already exists'); return; }
    p.gauges.push({ serial: r.s, type: r.t, unit: r.t === 'Strain' ? 'ue' : 'in', label: '', span: '', girder: '', section: '', location: '', offset: '', dist: false, status: 'ok', replaces: '', notes: '', order: p.gauges.length + 1 });
    save(); render();
  };
  $('#assignGirders').onclick = async () => {
    const girders = p.bridge.girders || [];
    if (p.bridge.type === 'slab' || !girders.length) {
      toast(p.bridge.type === 'slab' ? 'Slab bridge – enter gauge offsets in the table instead' : 'Set up girder lines on the Bridge tab first');
      return;
    }
    const sec0 = p.bridge.distSection || 'Midspan';
    const usable = g => !['unused', 'removed', 'replaced'].includes(g.status);
    const strain = sortGauges(p.gauges.filter(g => isStrain(g) && usable(g)), 'serial');
    const defl = sortGauges(p.gauges.filter(g => isDefl(g) && usable(g)), 'serial');
    const label = g => g.serial + (g.girder && g.section ? `  (now ${g.girder} ${g.location || ''})` : '');
    const current = (gname, loc, list, sec) => (list.find(g => g.girder === gname && g.location === loc && (g.section || '') === sec) || {}).serial || '';
    const rowsHtml = sec => girders.map((gd, k) => `<tr><td><b>${esc(gd.name)}</b><div class="muted small">${ftin(Number(gd.offset))}</div></td>
      <td><select data-role="Bottom" data-k="${k}">${opts([['', '—'], ...strain.map(g => [g.serial, label(g)])], current(gd.name, 'Bottom', strain, sec))}</select></td>
      <td><select data-role="Top" data-k="${k}">${opts([['', '—'], ...strain.map(g => [g.serial, label(g)])], current(gd.name, 'Top', strain, sec))}</select></td>
      <td><select data-role="Defl" data-k="${k}">${opts([['', '—'], ...defl.map(g => [g.serial, label(g)])], (defl.find(g => g.girder === gd.name && (g.section || '') === sec) || {}).serial || '')}</select></td></tr>`).join('');
    const r = await dialog({
      title: 'Assign gauges to girders',
      body: `<p class="muted small">Pick the gauge on each girder at one cross-section. Bottom gauges become the load distribution gauges, and the gauge order follows the girders (${esc(girders[0].name)} first). Run this again for other sections.</p>
        <div class="grid"><label>Section<input name="sec" value="${esc(sec0)}" list="secList2"><datalist id="secList2">${[...new Set([sec0, 'Midspan', 'Near support', 'Quarter span', ...p.gauges.map(g => g.section).filter(Boolean)])].map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label>Span<input name="span" value="1" inputmode="numeric"></label></div>
        <div class="table-wrap" style="margin-top:10px"><table class="data"><thead><tr><th>Girder</th><th>Bottom strain</th><th>Top strain</th><th>Deflection</th></tr></thead><tbody id="asgRows">${rowsHtml(sec0)}</tbody></table></div>`,
      buttons: [{ label: 'Cancel', value: null }, {
        label: 'Assign', primary: true, value: d => ({
          sec: $('[name=sec]', d).value.trim() || 'Midspan', span: $('[name=span]', d).value.trim(),
          picks: $$('[data-role]', d).map(sel => ({ role: sel.dataset.role, k: Number(sel.dataset.k), serial: sel.value })),
        }),
      }],
      validate: d => {
        const chosen = $$('[data-role]', d).map(s => s.value).filter(Boolean);
        const dup = chosen.find((v, i) => chosen.indexOf(v) !== i);
        return dup ? `${dup} is picked twice` : null;
      },
      onOpen: d => { $('[name=sec]', d).addEventListener('change', e => { $('#asgRows', d).innerHTML = rowsHtml(e.target.value.trim()); }); },
    });
    if (!r) return;
    const chosen = new Set(r.picks.map(x => x.serial).filter(Boolean));
    // Clear gauges previously assigned at this section but no longer picked
    p.gauges.forEach(g => {
      if ((g.section || '') === r.sec && g.girder && !chosen.has(g.serial)) {
        const wasPicked = r.picks.some(x => girders[x.k].name === g.girder && (x.role === 'Defl' ? isDefl(g) : x.role === g.location));
        if (wasPicked) { g.girder = ''; g.dist = false; }
      }
    });
    let order = 0;
    const assigned = [];
    for (const role of ['Bottom', 'Top', 'Defl']) {
      for (const x of r.picks.filter(q => q.role === role && q.serial).sort((a, b) => a.k - b.k)) {
        const g = p.gauges.find(q => q.serial === x.serial); if (!g) continue;
        Object.assign(g, { girder: girders[x.k].name, section: r.sec, span: r.span, location: role === 'Defl' ? 'Bottom' : role, offset: '', dist: role === 'Bottom' && isStrain(g) });
        assigned.push(g);
      }
    }
    // Order: girder by girder (bottom then top), then deflections, then everything else
    const gi = name => girders.findIndex(gd => gd.name === name);
    assigned.sort((a, b) => (isDefl(a) - isDefl(b)) || gi(a.girder) - gi(b.girder) || (a.location === 'Top') - (b.location === 'Top'));
    const rest = sortGauges(p.gauges.filter(g => !assigned.includes(g)), 'order');
    [...assigned, ...rest].forEach(g => { g.order = ++order; });
    p.bridge.distSection = r.sec;
    s.sortBy = 'order'; $('#sortBy').value = 'order';
    save(); render(); drawXS($('#xs'), { loadCases: [] });
    toast(`${assigned.length} gauges assigned at ${r.sec}`);
  };
  $('#autoDist').onclick = async () => {
    const sections = [...new Set(p.gauges.map(g => g.section).filter(Boolean))];
    const r = await dialog({
      title: 'Pick distribution gauges',
      body: `<p class="muted">${p.bridge.type === 'slab' ? 'Slab bridge: selects all strain gauges on the bottom of the slab at this section (used for equivalent strip width).' : 'Girder bridge: selects the bottom-flange strain gauges at this section, one per girder.'}</p>
      <label class="field">Section<select name="sec">${opts(sections.length ? sections : ['Midspan'], p.bridge.distSection)}</select></label>`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Select', primary: true, value: d => $('[name=sec]', d).value }],
    });
    if (!r) return;
    let n = 0;
    p.gauges.forEach(g => {
      g.dist = isStrain(g) && g.section === r && (g.location === 'Bottom' || (p.bridge.type === 'slab' && g.location !== 'Top')) && !['bad', 'unused', 'removed', 'replaced'].includes(g.status);
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
  tandem: { name: 'Tandem-axle dump truck', axles: [{ spacing: '', weight: '', track: 82, tireWidth: 12, dual: false }, { spacing: '', weight: '', track: 72, tireWidth: 10, dual: true }, { spacing: 54, weight: '', track: 72, tireWidth: 10, dual: true }] },
  single: { name: 'Single-axle truck', axles: [{ spacing: '', weight: '', track: 80, tireWidth: 12, dual: false }, { spacing: '', weight: '', track: 72, tireWidth: 10, dual: true }] },
  two: { name: 'Two-axle vehicle', axles: [{ spacing: '', weight: '', track: 96, tireWidth: 20, dual: false }, { spacing: '', weight: '', track: 96, tireWidth: 20, dual: false }] },
};

export function renderVehicles(main) {
  const p = P();
  main.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Load vehicles</h2><span class="spacer"></span>
    <button class="btn" data-tpl="tandem">＋ Tandem dump truck</button><button class="btn" data-tpl="single">＋ Single-axle truck</button><button class="btn" data-tpl="two">＋ Other vehicle</button></div>
    <p class="muted small">Axle spacing is measured from the previous axle. Track width is center-to-center of the tires (or dual sets) on that axle. Weights are per axle.</p></div>
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
        <label>Truck no. / plate<input data-bind="vehicles.${vi}.plate"></label>
        <label>Notes<input data-bind="vehicles.${vi}.notes" placeholder="Load, scale ticket…"></label>
      </div>
      <div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>Axle</th><th>Spacing from previous (in)</th><th>Weight (lb)</th><th>Track c/c (in)</th><th>Tire width (in)</th><th>Dual tires</th><th></th></tr></thead><tbody>
      ${v.axles.map((a, ai) => `<tr><td>${ai + 1}</td>
        <td>${ai === 0 ? '<span class="muted">—</span>' : `<input data-bind="vehicles.${vi}.axles.${ai}.spacing" data-type="num" inputmode="decimal">`}</td>
        <td><input data-bind="vehicles.${vi}.axles.${ai}.weight" data-type="num" inputmode="numeric"></td>
        <td><input data-bind="vehicles.${vi}.axles.${ai}.track" data-type="num" inputmode="decimal"></td>
        <td><input data-bind="vehicles.${vi}.axles.${ai}.tireWidth" data-type="num" inputmode="decimal"></td>
        <td><input type="checkbox" data-bind="vehicles.${vi}.axles.${ai}.dual"></td>
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
      bindForm(card, redraw);
      $('[data-addax]', card).onclick = () => { const last = v.axles[v.axles.length - 1] || {}; v.axles.push({ spacing: '', weight: '', track: last.track || 72, tireWidth: last.tireWidth || 10, dual: !!last.dual }); save(); renderList(); };
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
  main.innerHTML = `<div class="card"><div class="row"><h2 style="margin:0">Load paths (load cases)</h2><span class="spacer"></span><button class="btn" id="addLC">＋ Load case</button></div>
    <p class="muted small">Transverse position is measured from <b>${esc(p.bridge.edgeA || 'Edge A')}</b> edge of deck. Choose which point of the vehicle the dimension locates. "Edge A side wheel" is the wheel nearest ${esc(p.bridge.edgeA || 'Edge A')}.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Description</th><th>Vehicle(s)</th><th>Locates</th><th>Distance from Edge A (ft)</th><th>Speed</th><th>Compare to (crawl)</th><th>Vehicle C/L</th><th></th></tr></thead><tbody id="lcRows"></tbody></table></div></div>
    <div class="card"><h2>Load paths on cross-section</h2><canvas class="diagram" id="xs"></canvas></div>`;
  const render = () => {
    const tb = $('#lcRows');
    tb.innerHTML = p.loadCases.map((lc, i) => {
      const veh = p.vehicles.find(v => v.id === (lc.vehicleIds || [])[0]) || p.vehicles[0];
      const w = loadCaseWheels(lc, veh);
      return `<tr>
      <td><input data-bind="loadCases.${i}.name" style="width:70px"></td>
      <td><input data-bind="loadCases.${i}.description" style="min-width:160px" placeholder="Passenger wheel on white line"></td>
      <td>${p.vehicles.length ? p.vehicles.map(v => `<label class="row small" style="gap:4px;white-space:nowrap"><input type="checkbox" data-lcveh="${i}" value="${v.id}" ${(lc.vehicleIds || []).includes(v.id) ? 'checked' : ''}>${esc(v.name)}</label>`).join('') : '<span class="muted small">Add vehicles first</span>'}</td>
      <td><select data-bind="loadCases.${i}.ref" style="width:170px">${opts([['center', 'Vehicle centerline'], ['wheelA', 'Edge A side wheel (c/l tire)'], ['wheelAout', 'Edge A side wheel (outside face)'], ['wheelB', 'Edge B side wheel (c/l tire)'], ['wheelBout', 'Edge B side wheel (outside face)']])}</select></td>
      <td><input data-bind="loadCases.${i}.offset" data-type="num" inputmode="decimal" style="width:90px"></td>
      <td><input data-bind="loadCases.${i}.speed" style="width:90px" placeholder="crawl / 35 mph"></td>
      <td><select data-bind="loadCases.${i}.crawlRef" style="width:90px">${opts([['', '—'], ...p.loadCases.filter(o => o !== lc).map(o => [o.id, o.name])])}</select></td>
      <td class="num">${ftin(w.center)}</td>
      <td><button class="btn small danger" data-del="${i}">✕</button></td></tr>`;
    }).join('') || `<tr><td colspan="9" class="empty">No load cases yet.</td></tr>`;
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
    p.loadCases.push({ id: uid(), name: 'LC' + n, description: '', vehicleIds: prev ? [...(prev.vehicleIds || [])] : p.vehicles.slice(0, 1).map(v => v.id), ref: 'center', offset: (Number(p.bridge.deckWidth) || 30) / 2, speed: 'crawl', crawlRef: '' });
    save(); render(); drawXS($('#xs'));
  };
  render();
  requestAnimationFrame(() => drawXS($('#xs')));
}
