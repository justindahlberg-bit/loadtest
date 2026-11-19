// Data processing: drift zeroing, truck position from marks, peaks, load distribution.

export const mean = (a, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += a[i]; return s / Math.max(1, i1 - i0); };

// Zero a channel. mode: 'linear' (line between average of first and last n readings),
// 'initial' (subtract average of first n readings), 'none'.
export function zeroChannel(time, y, mode = 'linear', n = 10) {
  const N = y.length;
  const out = new Float64Array(N);
  if (!N) return out;
  n = Math.max(1, Math.min(n, Math.floor(N / 4) || 1));
  if (mode === 'none') { out.set(y); return out; }
  const a = mean(y, 0, n), ta = mean(time, 0, n);
  if (mode === 'initial') { for (let i = 0; i < N; i++) out[i] = y[i] - a; return out; }
  const b = mean(y, N - n, N), tb = mean(time, N - n, N);
  const slope = tb > ta ? (b - a) / (tb - ta) : 0;
  for (let i = 0; i < N; i++) out[i] = y[i] - (a + slope * (time[i] - ta));
  return out;
}

// Mark positions (ft, relative to start of bridge; negative = on approach).
export function markPositions(marks, count) {
  if (marks.custom && marks.custom.trim()) {
    const list = marks.custom.split(/[,\s;]+/).map(Number).filter(v => isFinite(v));
    if (list.length) {
      const out = list.slice(0, count);
      const step = list.length > 1 ? list[list.length - 1] - list[list.length - 2] : (marks.spacing || 20);
      while (out.length < count) out.push(out[out.length - 1] + step);
      return out;
    }
  }
  const first = Number(marks.first ?? -20), sp = Number(marks.spacing || 20);
  return Array.from({ length: count }, (_, k) => first + k * sp);
}

// Build the list of vehicle windows for a pass: each has t0..t1 (time range), and
// knots [{t, x}] mapping time to front-axle position.
export function vehicleWindows(pass, project, time) {
  const tEnd = time.length ? time[time.length - 1] : 0, tStart = time.length ? time[0] : 0;
  const clicks = (pass.clicks || []).map(c => c.t);
  const marks = pass.marksOverride && pass.marks ? pass.marks : project.marks || { first: -20, spacing: 20 };
  const assigns = pass.vehicles && pass.vehicles.length ? pass.vehicles : [{ vehicleId: (project.vehicles[0] || {}).id, from: 1, to: clicks.length }];
  const wins = assigns.map(a => {
    let knots = [];
    const num = v => v !== '' && v != null && isFinite(v);
    if (a.manual) {
      if (num(a.tOn) && num(a.tOff) && Number(a.tOff) > Number(a.tOn)) knots = [{ t: Number(a.tOn), x: 0 }, { t: Number(a.tOff), x: bridgeLength(project) }];
    } else if (clicks.length) {
      const from = Math.max(1, a.from || 1), to = Math.min(clicks.length, a.to || clicks.length);
      const ts = clicks.slice(from - 1, to);
      const xs = markPositions(marks, ts.length);
      knots = ts.map((t, k) => ({ t, x: xs[k] }));
    }
    return { ...a, knots };
  });
  // time limits: halfway between consecutive vehicles' knot ranges
  wins.forEach((w, i) => {
    const first = w.knots.length ? w.knots[0].t : tStart;
    const last = w.knots.length ? w.knots[w.knots.length - 1].t : tEnd;
    const prev = wins[i - 1], next = wins[i + 1];
    const prevLast = prev && prev.knots.length ? prev.knots[prev.knots.length - 1].t : null;
    const nextFirst = next && next.knots.length ? next.knots[0].t : null;
    w.t0 = prevLast != null ? (prevLast + first) / 2 : tStart;
    w.t1 = nextFirst != null ? (last + nextFirst) / 2 : tEnd;
  });
  return wins;
}

// Interpolate front-axle position at time t from knots (linear, extrapolated at ends).
export function positionAt(knots, t) {
  const n = knots.length;
  if (n === 0) return NaN;
  if (n === 1) return knots[0].x;
  let i = 0;
  if (t <= knots[0].t) i = 0;
  else if (t >= knots[n - 1].t) i = n - 2;
  else { while (i < n - 2 && knots[i + 1].t < t) i++; }
  const a = knots[i], b = knots[i + 1];
  const dt = b.t - a.t;
  return dt === 0 ? a.x : a.x + (b.x - a.x) * (t - a.t) / dt;
}

export function speedMph(knots) {
  if (knots.length < 2) return NaN;
  const a = knots[0], b = knots[knots.length - 1];
  return Math.abs(b.x - a.x) / (b.t - a.t) * 3600 / 5280;
}

export const bridgeLength = p => (p.bridge.spans || []).reduce((s, v) => s + (Number(v) || 0), 0);

export const indexRange = (time, t0, t1) => {
  let i0 = 0; while (i0 < time.length && time[i0] < t0) i0++;
  let i1 = time.length; while (i1 > i0 && time[i1 - 1] > t1) i1--;
  return [i0, i1];
};

// Peak values per channel within [i0,i1)
export function channelPeaks(y, i0, i1) {
  let max = -Infinity, min = Infinity, iMax = i0, iMin = i0;
  for (let i = i0; i < i1; i++) { const v = y[i]; if (v > max) { max = v; iMax = i; } if (v < min) { min = v; iMin = i; } }
  return { max, min, iMax, iMin };
}

// Load distribution for one vehicle window.
// gauges: [{serial, offset, label}] distribution gauges (bottom of girder at one section, or slab gauges)
// method: 'maxGauge' (time of the largest single-gauge strain) or 'maxSum' (time of largest total strain)
// Tributary width of each gauge across the slab: half the distance to each neighbour, with the
// outer gauges given the same half-spacing outward but not past the deck edges (edges = [a, b], ft).
export function tributaryWidths(xs, edges) {
  const idx = xs.map((x, k) => ({ k, x })).filter(o => isFinite(o.x)).sort((a, b) => a.x - b.x);
  const out = xs.map(() => NaN);
  idx.forEach((o, j) => {
    const prev = idx[j - 1], next = idx[j + 1];
    const left = prev ? (o.x - prev.x) / 2 : next ? (next.x - o.x) / 2 : 0.5;
    const right = next ? (next.x - o.x) / 2 : prev ? (o.x - prev.x) / 2 : 0.5;
    let a = o.x - left, b = o.x + right;
    if (edges && isFinite(edges[0])) a = Math.max(a, edges[0]);
    if (edges && isFinite(edges[1])) b = Math.min(b, edges[1]);
    out[o.k] = Math.max(0, b - a);
  });
  return out;
}

// Load distribution for one vehicle window.
// gauges: [{serial, name, offset, x (ft from Edge A), h (slab thickness, in)}] distribution gauges
// method: 'maxGauge' (time of the largest single-gauge value) or 'maxSum' (time of the largest total)
// Girder bridges: distribution = εᵢ / Σε at that instant.
// Slab bridges (equivalent strip method): each gauge carries moment per unit width
//   mᵢ = E·εᵢ·hᵢ²/6 (uncracked, neutral axis at mid-depth, gauge on the bottom face),
//   M = Σ mᵢ·Δxᵢ over tributary widths Δxᵢ, and strip width = Σ(εᵢhᵢ²Δxᵢ) / max(εh²).
//   Without thicknesses h cancels out (uniform slab) and strains are used directly.
export function distribution(gauges, series, i0, i1, method = 'maxGauge', bridgeType = 'girder', opt = {}) {
  const list = gauges.filter(g => series[g.serial]);
  if (!list.length || i1 <= i0) return null;
  const slab = bridgeType === 'slab';
  const useH = slab && list.every(g => Number(g.h) > 0);
  const h2 = list.map(g => useH ? Number(g.h) ** 2 : 1);
  const trib = slab ? tributaryWidths(list.map(g => g.x ?? g.offset), opt.edges) : list.map(() => 1);
  const tw = trib.map(t => isFinite(t) ? t : 0);
  let iPeak = i0, best = -Infinity;
  for (let i = i0; i < i1; i++) {
    let v;
    if (method === 'maxSum') { v = 0; list.forEach((g, k) => { v += series[g.serial][i] * h2[k] * (slab ? tw[k] : 1); }); }
    else { v = -Infinity; list.forEach((g, k) => { const s = series[g.serial][i] * h2[k]; if (s > v) v = s; }); }
    if (v > best) { best = v; iPeak = i; }
  }
  const rows = list.map((g, k) => ({ ...g, strain: series[g.serial][iPeak], h: useH ? Number(g.h) : g.h, trib: trib[k] }));
  const sum = rows.reduce((s, r) => s + r.strain, 0);
  const result = { iPeak, rows, sum, method, slab, useH };
  if (!slab) {
    rows.forEach(r => { r.df = sum !== 0 ? r.strain / sum : NaN; });
    return result;
  }
  const E = Number(opt.E) || 0;
  rows.forEach((r, k) => {
    r.w = r.strain * h2[k];                         // ε·h² (µε·in²), or ε when no thickness
    r.contrib = isFinite(r.trib) ? r.w * r.trib : NaN;
    if (useH && E) r.m = E * r.strain * 1e-6 * h2[k] / 6; // kip-ft per ft (= kip-in per in)
  });
  const total = rows.reduce((s, r) => s + (isFinite(r.contrib) ? r.contrib : 0), 0);
  rows.forEach(r => { r.df = total !== 0 && isFinite(r.contrib) ? r.contrib / total : NaN; });
  const gov = rows.filter(r => isFinite(r.trib)).reduce((a, r) => (!a || r.w > a.w ? r : a), null);
  result.governing = gov;
  result.wMax = gov ? gov.w : NaN;
  result.peakStrain = gov ? gov.strain : NaN;
  result.stripWidth = gov && gov.w > 0 ? total / gov.w : NaN;
  result.weightedTotal = total;
  if (useH && E) {
    result.mMax = gov ? gov.m : NaN;
    result.mTotal = rows.reduce((s, r) => s + (isFinite(r.m) && isFinite(r.trib) ? r.m * r.trib : 0), 0);
    if (Number(opt.mStatic) > 0 && result.mMax > 0) {
      result.mStatic = Number(opt.mStatic);
      result.stripWidthStatic = result.mStatic / result.mMax;
      result.staticRatio = result.mTotal / result.mStatic;
    }
  }
  return result;
}

// ---- Transverse position datum ----
// Each test picks how transverse positions are entered and stored:
//   'edgeA' – feet from Edge A (left edge of the cross-section drawing)
//   'cl'    – feet left (−) / right (+) of the roadway centerline
// Values are stored exactly as entered (in the test's datum); drawings convert with toEdge().
export const isCL = p => p.bridge.datum === 'cl';
export function clPos(p) {
  const c = p.bridge.clOffset;
  if (c !== '' && c != null && isFinite(Number(c))) return Number(c);
  return (Number(p.bridge.deckWidth) || 0) / 2;
}
export function toEdge(p, v) {
  if (v === '' || v == null) return NaN;
  const n = Number(v);
  if (!isFinite(n)) return NaN;
  return isCL(p) ? clPos(p) + n : n;
}
// "16 L" → -16, "2R" → 2, "CL" → 0, "-3.5" → -3.5 ; returns '' for blank, NaN if unreadable
export function parsePos(s) {
  const t = String(s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!t) return '';
  if (t === 'CL' || t === 'C' || t === '0 CL') return 0;
  const m = /^([+-]?\d*\.?\d+)\s*(L|R|LT|RT|LEFT|RIGHT)?$/.exec(t);
  if (!m) return NaN;
  let v = Number(m[1]);
  if (m[2]) v = m[2][0] === 'L' ? -Math.abs(v) : Math.abs(v);
  return v;
}
export function fmtPos(p, v, d = 2) {
  if (v === '' || v == null || !isFinite(Number(v))) return '';
  const n = Number(v);
  if (!isCL(p)) return String(+n.toFixed(d));
  if (Math.abs(n) < 1e-9) return 'CL';
  return `${+Math.abs(n).toFixed(d)} ${n < 0 ? 'L' : 'R'}`;
}
export const posUnit = p => isCL(p) ? 'ft L/R of CL' : 'ft from Edge A';
// List of positions typed as "8 L, CL, 8 R" or "3.2, 15, 26.8"
export const parsePosList = (p, s) => String(s || '').split(/[,;]+/).map(x => isCL(p) ? parsePos(x) : (x.trim() === '' ? '' : Number(x))).filter(x => x !== '' && isFinite(x));

// Lengths in inches; accepts 236, 236", 19'-8", 19' 8", 19-8, 19.5'
export function parseLen(s) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  let m = /^(\d+(?:\.\d+)?)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*"?$/.exec(t);
  if (m) return Number(m[1]) * 12 + (Number(m[2]) || 0);
  m = /^(\d+)\s*-\s*(\d+(?:\.\d+)?)\s*"?$/.exec(t);
  if (m) return Number(m[1]) * 12 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)\s*"?$/.exec(t);
  if (m) return Number(m[1]);
  return NaN;
}

export const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? '–' : Number(v).toFixed(d);
export const ftin = ft => {
  if (!isFinite(ft)) return '–';
  const s = ft < 0 ? '-' : ''; ft = Math.abs(ft);
  let f = Math.floor(ft), i = Math.round((ft - f) * 12);
  if (i === 12) { f++; i = 0; }
  return `${s}${f}'-${i}"`;
};
