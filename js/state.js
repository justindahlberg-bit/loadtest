// App state, project model, persistence.
import { db } from './db.js';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const PHOTO_TAGS = ['Bridge overview', 'Elevation', 'Deck / roadway', 'Underside', 'Gauge installation', 'Deflection transducer', 'Data acquisition', 'Load vehicle', 'Vehicle weighing', 'Load path / marks', 'Deterioration / damage', 'Traffic control', 'Other'];
export const NOTE_TAGS = ['General', 'Pass start', 'Pass end', 'Truck stopped', 'Gauge issue', 'Traffic', 'Weather', 'Observation'];
export const LOCATIONS = ['Bottom', 'Top', 'Web', 'Deck', 'Other'];

export function newProject(name) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: uid(), name: name || 'New bridge test', created: Date.now(), updated: Date.now(), schema: 1,
    bridge: {
      structureNo: '', name: '', location: '', route: '', featureCrossed: '', county: '', owner: '', yearBuilt: '',
      testDate: today, type: 'girder', girderType: '', material: 'steel', E: 29000, spans: [], skew: 0,
      deckWidth: '', curbA: '', curbB: '', laneLines: '', edgeA: 'West', edgeB: 'East', lookDir: 'north',
      girders: [], distSection: 'Midspan', notes: '',
    },
    test: { crew: '', weather: '', temperature: '', gaugeLength: '', dataSystem: 'BDI STS-Wifi / STS-Live', purpose: '' },
    marks: { first: -20, spacing: 20, custom: '' },
    gauges: [], vehicles: [], loadCases: [], passes: [], log: [],
    settings: { zeroMode: 'linear', zeroN: 10, distMethod: 'maxGauge', stressUnit: 'ksi', groupBy: 'girder', sortBy: 'order' },
    report: { title: 'Bridge Load Test Report', author: '', company: '', client: '', date: today, intro: '', conclusions: '', groupBy: 'girder', sections: {} },
  };
}

export const state = {
  projects: [], // [{id,name,updated}]
  project: null,
  tab: 'bridge',
  passId: null,
  passCache: new Map(), // passId -> {time, channels}
  photoUrlCache: new Map(),
};

let saveTimer = null;
const listeners = new Set();
export const onSaved = fn => listeners.add(fn);

export function save(immediate = false) {
  const p = state.project;
  if (!p) return Promise.resolve();
  p.updated = Date.now();
  clearTimeout(saveTimer);
  const doSave = async () => {
    try {
      await db.put('projects', p);
      const meta = state.projects.find(x => x.id === p.id);
      if (meta) { meta.name = p.name; meta.updated = p.updated; }
      listeners.forEach(fn => fn());
    } catch (e) { console.error(e); alert('Could not save: ' + e.message); }
  };
  if (immediate) return doSave();
  saveTimer = setTimeout(doSave, 300);
  return Promise.resolve();
}

export async function loadProjects() {
  const all = await db.all('projects');
  all.sort((a, b) => b.updated - a.updated);
  state.projects = all.map(p => ({ id: p.id, name: p.name, updated: p.updated }));
  return all;
}

export async function openProject(id) {
  const p = await db.get('projects', id);
  if (!p) return null;
  migrate(p);
  state.project = p;
  state.passCache.clear();
  state.passId = p.passes.length ? p.passes[0].id : null;
  try { localStorage.setItem('loadtest.lastProject', id); } catch { }
  return p;
}

function migrate(p) {
  const d = newProject();
  for (const k of Object.keys(d)) if (p[k] === undefined) p[k] = d[k];
  for (const k of ['bridge', 'test', 'settings', 'report', 'marks']) p[k] = { ...d[k], ...p[k] };
}

export async function getPassData(passId) {
  if (state.passCache.has(passId)) return state.passCache.get(passId);
  const d = await db.get('passData', passId);
  if (d) state.passCache.set(passId, d);
  return d;
}

// ---- model helpers ----
export const vehicleById = id => (state.project.vehicles || []).find(v => v.id === id);
export const loadCaseById = id => (state.project.loadCases || []).find(l => l.id === id);
export const gaugeBySerial = s => state.project.gauges.find(g => g.serial === s);

export function gaugeOffset(g) {
  if (g.offset !== '' && g.offset != null && isFinite(Number(g.offset))) return Number(g.offset);
  const gi = (state.project.bridge.girders || []).find(x => x.name === g.girder);
  return gi ? Number(gi.offset) : NaN;
}

export function groupKey(g, by) {
  switch (by) {
    case 'girder': return g.girder || 'No girder';
    case 'span': return g.span ? 'Span ' + g.span : 'No span';
    case 'section': return g.section || 'No section';
    case 'location': return g.location || 'No location';
    case 'type': return /displ/i.test(g.type) ? 'Deflection' : /strain/i.test(g.type) ? 'Strain' : 'Other';
    default: return 'All gauges';
  }
}

export function sortGauges(list, by) {
  const girderIdx = name => { const i = (state.project.bridge.girders || []).findIndex(g => g.name === name); return i < 0 ? 999 : i; };
  const num = v => (v === '' || v == null || !isFinite(Number(v))) ? Infinity : Number(v);
  const cmp = {
    order: (a, b) => num(a.order) - num(b.order) || a.serial.localeCompare(b.serial),
    serial: (a, b) => a.serial.localeCompare(b.serial, undefined, { numeric: true }),
    girder: (a, b) => girderIdx(a.girder) - girderIdx(b.girder) || (a.location || '').localeCompare(b.location || '') || num(a.order) - num(b.order),
    span: (a, b) => num(a.span) - num(b.span) || girderIdx(a.girder) - girderIdx(b.girder),
    section: (a, b) => (a.section || '').localeCompare(b.section || '') || girderIdx(a.girder) - girderIdx(b.girder),
    location: (a, b) => (a.location || '').localeCompare(b.location || '') || girderIdx(a.girder) - girderIdx(b.girder),
    type: (a, b) => (a.type || '').localeCompare(b.type || '') || num(a.order) - num(b.order),
  }[by] || ((a, b) => 0);
  return [...list].sort(cmp);
}

export const isStrain = g => /strain/i.test(g.type || '');
export const isDefl = g => /displ/i.test(g.type || '');
export const shortSerial = s => String(s).replace(/_\d+[A-Z]?$/i, '');
export const gaugeName = g => g.label ? `${g.label} (${shortSerial(g.serial)})` : shortSerial(g.serial);

// Ensure every channel from a pass exists in the gauge map
export function registerChannels(channels) {
  const p = state.project;
  let maxOrder = Math.max(0, ...p.gauges.map(g => Number(g.order) || 0));
  for (const c of channels) {
    if (p.gauges.find(g => g.serial === c.serial)) continue;
    p.gauges.push({ serial: c.serial, type: c.type, unit: c.unit, label: '', span: '', girder: '', section: '', location: /displ/i.test(c.type) ? 'Bottom' : '', offset: '', dist: false, status: /unknown/i.test(c.type) ? 'unused' : 'ok', replaces: '', notes: '', order: ++maxOrder });
  }
}
