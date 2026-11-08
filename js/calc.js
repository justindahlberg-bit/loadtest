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
export function distribution(gauges, series, i0, i1, method = 'maxGauge', bridgeType = 'girder') {
  const list = gauges.filter(g => series[g.serial]);
  if (!list.length || i1 <= i0) return null;
  let iPeak = i0, best = -Infinity;
  for (let i = i0; i < i1; i++) {
    let v;
    if (method === 'maxSum') { v = 0; for (const g of list) v += series[g.serial][i]; }
    else { v = -Infinity; for (const g of list) { const s = series[g.serial][i]; if (s > v) v = s; } }
    if (v > best) { best = v; iPeak = i; }
  }
  const rows = list.map(g => ({ ...g, strain: series[g.serial][iPeak] }));
  const sum = rows.reduce((s, r) => s + r.strain, 0);
  rows.forEach(r => { r.df = sum !== 0 ? r.strain / sum : NaN; });
  const result = { iPeak, rows, sum, method };
  if (bridgeType === 'slab') {
    // Equivalent strip width = area under the transverse strain profile / peak strain
    const pts = rows.filter(r => isFinite(r.offset)).sort((a, b) => a.offset - b.offset);
    let area = 0;
    for (let k = 1; k < pts.length; k++) area += (pts[k].offset - pts[k - 1].offset) * (pts[k].strain + pts[k - 1].strain) / 2;
    const peak = Math.max(...pts.map(p => p.strain));
    result.stripWidth = peak > 0 ? area / peak : NaN;
    result.peakStrain = peak;
    result.profileArea = area;
  }
  return result;
}

export const fmt = (v, d = 1) => (v == null || !isFinite(v)) ? '–' : Number(v).toFixed(d);
export const ftin = ft => {
  if (!isFinite(ft)) return '–';
  const s = ft < 0 ? '-' : ''; ft = Math.abs(ft);
  let f = Math.floor(ft), i = Math.round((ft - f) * 12);
  if (i === 12) { f++; i = 0; }
  return `${s}${f}'-${i}"`;
};
