// Run plan: the planned sequence of runs, Start/Stop buttons in the field, and links to data files.
import { state, save, uid, loadCaseById } from './state.js';
import { esc, $, $$, bindForm, opts, dialog, confirmDlg, toast, fmtTime } from './ui.js';
import { matchRuns, linkRun } from './passes.js';

const P = () => state.project;
const nextRun = () => (P().runs || []).find(r => !r.tStop);

function logEvent(tag, run) {
  P().log.push({ id: uid(), kind: 'note', ts: new Date().toISOString(), tag, loadCaseId: run.loadCaseId, text: `Run ${run.no}`, runId: run.id });
}

export function renderRuns(main) {
  const p = P();
  p.runs = p.runs || [];
  main.innerHTML = `
  <div class="card" id="nextCard"></div>
  <div class="card"><div class="row"><h2 style="margin:0">Run plan</h2><span class="spacer"></span>
      <button class="btn" id="buildRuns">Build from load paths…</button><button class="btn" id="addRun">＋ Run</button></div>
    <p class="muted small">Plan every run before the test (any number, any order). In the field tap <b>Start</b> when recording begins and <b>Stop</b> when it ends; the times go in the field log too. When you import the data files, each file is matched to the run whose Start time is closest to the file's start (within 5 minutes). Without Start times, files are matched in order.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Run</th><th>Load case</th><th>Speed</th><th>Start</th><th>Stop</th><th>Data file</th><th>Notes</th><th></th></tr></thead><tbody id="runRows"></tbody></table></div>
    <div class="row" style="margin-top:8px"><button class="btn small" id="rematch">Re-match files</button><span class="muted small" id="runCount"></span></div>
  </div>`;
  const renderNext = () => {
    const host = $('#nextCard'); if (!host) return;
    const r = nextRun();
    if (!p.runs.length) { host.innerHTML = `<h2 style="margin:0">Next run</h2><p class="muted">No runs planned yet. Use <b>Build from load paths…</b> below.</p>`; return; }
    if (!r) { host.innerHTML = `<h2 style="margin:0">All ${p.runs.length} runs done ✓</h2><p class="muted">Add a run if you need to repeat one.</p>`; return; }
    const lc = loadCaseById(r.loadCaseId);
    host.innerHTML = `<div class="row"><div><div class="muted small">${r.tStart ? 'Recording' : 'Next run'}</div>
      <h2 style="margin:2px 0">Run ${esc(r.no)} · ${esc(lc ? lc.name : 'no load case')} · ${esc(r.speed || lc?.speed || 'crawl')}</h2>
      <div class="muted">${esc(lc?.description || '')}${r.tStart ? ` · started ${fmtTime(r.tStart)}` : ''}</div></div><span class="spacer"></span>
      ${r.tStart ? `<button class="btn primary" style="min-height:56px;padding:10px 28px;background:#c0392b;border-color:#c0392b" id="bigStop">■ Stop</button>` : `<button class="btn primary" style="min-height:56px;padding:10px 28px" id="bigStart">▶ Start</button>`}
      <button class="btn" id="bigSkip">Skip</button></div>`;
    if ($('#bigStart')) $('#bigStart').onclick = () => { r.tStart = new Date().toISOString(); logEvent('Pass start', r); save(); toast(`Run ${r.no} started ${fmtTime(r.tStart)}`); renderAll(); };
    if ($('#bigStop')) $('#bigStop').onclick = () => { r.tStop = new Date().toISOString(); logEvent('Pass end', r); save(); toast(`Run ${r.no} stopped`); renderAll(); };
    $('#bigSkip').onclick = async () => { if (await confirmDlg(`Mark run ${r.no} as skipped?`, 'Skip')) { r.tStop = r.tStop || 'skipped'; r.notes = (r.notes ? r.notes + '; ' : '') + 'skipped'; save(); renderAll(); } };
  };
  const renderRows = () => {
    const tb = $('#runRows');
    tb.innerHTML = p.runs.map((r, i) => {
      const pass = p.passes.find(x => x.id === r.passId);
      const lc = loadCaseById(r.loadCaseId);
      const time = t => t === 'skipped' ? '<span class="muted">skipped</span>' : fmtTime(t);
      return `<tr class="${r === nextRun() ? 'group-row' : ''}">
        <td><input data-bind="runs.${i}.no" style="width:56px"></td>
        <td><select data-bind="runs.${i}.loadCaseId" style="min-width:110px">${opts([['', '—'], ...p.loadCases.map(l => [l.id, `${l.name}${l.description ? ' – ' + l.description : ''}`])])}</select></td>
        <td><input data-bind="runs.${i}.speed" style="width:90px" placeholder="${esc(lc?.speed || 'crawl')}"></td>
        <td>${r.tStart ? `${time(r.tStart)} <button class="btn small" data-clr="${i}:tStart" aria-label="Clear start">↺</button>` : `<button class="btn small primary" data-start="${i}">▶ Start</button>`}</td>
        <td>${r.tStop ? `${time(r.tStop)} <button class="btn small" data-clr="${i}:tStop" aria-label="Clear stop">↺</button>` : r.tStart ? `<button class="btn small" data-stop="${i}">■ Stop</button>` : ''}</td>
        <td>${pass ? `${esc(pass.name)} <button class="btn small" data-unlink="${i}" aria-label="Unlink file">✕</button>` : '<span class="muted small">—</span>'}</td>
        <td><input data-bind="runs.${i}.notes" style="min-width:140px"></td>
        <td style="white-space:nowrap"><button class="btn small" data-mv="${i}:-1" aria-label="Move up">▲</button><button class="btn small" data-mv="${i}:1" aria-label="Move down">▼</button><button class="btn small danger" data-del="${i}" aria-label="Delete run">✕</button></td></tr>`;
    }).join('') || `<tr><td colspan="8" class="empty">No runs planned.</td></tr>`;
    $('#runCount').textContent = p.runs.length ? `${p.runs.filter(r => r.tStop).length} of ${p.runs.length} done · ${p.runs.filter(r => r.passId).length} with data files` : '';
    bindForm(tb, (path) => { if (/loadCaseId/.test(path)) { const r = p.runs[Number(path.split('.')[1])]; const ps = p.passes.find(x => x.id === r.passId); if (ps) linkRun(ps, r); save(); } renderNext(); });
    $$('[data-start]', tb).forEach(b => b.onclick = () => { const r = p.runs[+b.dataset.start]; r.tStart = new Date().toISOString(); logEvent('Pass start', r); save(); renderAll(); });
    $$('[data-stop]', tb).forEach(b => b.onclick = () => { const r = p.runs[+b.dataset.stop]; r.tStop = new Date().toISOString(); logEvent('Pass end', r); save(); renderAll(); });
    $$('[data-clr]', tb).forEach(b => b.onclick = () => { const [i, k] = b.dataset.clr.split(':'); p.runs[+i][k] = ''; save(); renderAll(); });
    $$('[data-unlink]', tb).forEach(b => b.onclick = () => { const r = p.runs[+b.dataset.unlink]; const ps = p.passes.find(x => x.id === r.passId); if (ps) linkRun(ps, null); else r.passId = ''; save(); renderAll(); });
    $$('[data-mv]', tb).forEach(b => b.onclick = () => { const [i, d] = b.dataset.mv.split(':').map(Number); const j = i + d; if (j < 0 || j >= p.runs.length) return; [p.runs[i], p.runs[j]] = [p.runs[j], p.runs[i]]; save(); renderAll(); });
    $$('[data-del]', tb).forEach(b => b.onclick = async () => { const r = p.runs[+b.dataset.del]; if (!(await confirmDlg(`Delete run ${r.no}?`, 'Delete', true))) return; const ps = p.passes.find(x => x.id === r.passId); if (ps) ps.runId = ''; p.runs.splice(+b.dataset.del, 1); save(); renderAll(); });
  };
  const renderAll = () => { renderNext(); renderRows(); };
  $('#addRun').onclick = () => {
    const last = p.runs[p.runs.length - 1];
    p.runs.push({ id: uid(), no: String(p.runs.length + 1), loadCaseId: last ? last.loadCaseId : (p.loadCases[0]?.id || ''), speed: '', tStart: '', tStop: '', passId: '', notes: '' });
    save(); renderAll();
  };
  $('#buildRuns').onclick = async () => {
    if (!p.loadCases.length) { toast('Add load paths first'); return; }
    const r = await dialog({
      title: 'Build run plan from load paths',
      body: `<p class="muted small">Creates runs in load-path order. Set how many times each load path is run.</p>
        <div class="table-wrap"><table class="data"><thead><tr><th>Load case</th><th>Speed</th><th>Runs</th></tr></thead><tbody>
        ${p.loadCases.map((l, i) => `<tr><td>${esc(l.name)} <span class="muted small">${esc(l.description || '')}</span></td><td>${esc(l.speed || 'crawl')}</td><td><input type="number" min="0" name="n${i}" value="${/crawl|static|^$/i.test(l.speed || '') ? 2 : 1}" style="width:70px"></td></tr>`).join('')}
        </tbody></table></div>
        ${p.runs.length ? `<label class="row" style="flex-direction:row;align-items:center;gap:8px;margin-top:10px"><input type="checkbox" name="replace"> Replace the existing ${p.runs.length} runs (otherwise they are added to the end)</label>` : ''}`,
      buttons: [{ label: 'Cancel', value: null }, { label: 'Build', primary: true, value: d => ({ counts: p.loadCases.map((_, i) => Math.max(0, +$(`[name=n${i}]`, d).value || 0)), replace: !!$('[name=replace]', d)?.checked }) }],
    });
    if (!r) return;
    if (r.replace) { p.passes.forEach(ps => { ps.runId = ''; }); p.runs = []; }
    let no = p.runs.length;
    p.loadCases.forEach((l, i) => { for (let k = 0; k < r.counts[i]; k++) p.runs.push({ id: uid(), no: String(++no), loadCaseId: l.id, speed: '', tStart: '', tStop: '', passId: '', notes: '' }); });
    matchRuns();
    save(); renderAll(); toast(`${no} runs planned`);
  };
  $('#rematch').onclick = () => { const n = matchRuns(); save(); renderAll(); toast(n ? `${n} file${n > 1 ? 's' : ''} matched` : 'No unmatched files to match'); };
  renderAll();
}
