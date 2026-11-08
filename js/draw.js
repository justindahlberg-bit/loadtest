// Diagrams: bridge cross-section with gauges and load paths, and load-vehicle plan view.
import { PALETTE, niceTicks } from './plot.js';
import { ftin } from './calc.js';

const LIGHT = { bg: '#ffffff', fg: '#1d2430', muted: '#5b6573', deck: '#c9ced6', steel: '#7b8594', wheel: '#1d2430', accent: '#1f6fb4' };

export function diagramTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  return { bg: v('--plot-bg', LIGHT.bg), fg: v('--fg', LIGHT.fg), muted: v('--muted', LIGHT.muted), deck: v('--deck', LIGHT.deck), steel: v('--steel', LIGHT.steel), wheel: v('--fg', LIGHT.wheel), accent: v('--accent', LIGHT.accent) };
}

// Vehicle wheel-line positions (ft from Edge A) for a load case
export function loadCaseWheels(lc, vehicle) {
  const ax = (vehicle && vehicle.axles) || [];
  const track = Math.max(...ax.map(a => Number(a.track) || 0), 72) / 12; // ft, c/c of tires
  const tire = Math.max(...ax.map(a => (Number(a.tireWidth) || 10) * (a.dual ? 2.3 : 1)), 10) / 12;
  const off = Number(lc.offset) || 0;
  let c;
  switch (lc.ref) {
    case 'wheelA': c = off + track / 2; break;
    case 'wheelAout': c = off + tire / 2 + track / 2; break;
    case 'wheelB': c = off - track / 2; break;
    case 'wheelBout': c = off - tire / 2 - track / 2; break;
    default: c = off;
  }
  return { center: c, a: c - track / 2, b: c + track / 2, track, tire };
}

export function drawCrossSection(ctx, w, h, project, opt = {}) {
  const th = opt.theme || LIGHT, s = opt.fontScale || 1;
  const br = project.bridge;
  const f = px => `${Math.round(px * s)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.save();
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
  const width = Number(br.deckWidth) || Math.max(30, ...(br.girders || []).map(g => Number(g.offset) + 3));
  const lcs = opt.loadCases || project.loadCases || [];
  const pad = 40 * s;
  const kx = (w - 2 * pad) / width;
  const X = ft => pad + ft * kx;
  const rowH = 30 * s;
  const lcTop = 16 * s;
  const deckY = lcTop + Math.max(1, lcs.length) * rowH + 24 * s;
  const deckT = Math.max(8 * s, Math.min(18 * s, 0.75 * kx));
  const girderH = br.type === 'slab' ? 0 : Math.max(36 * s, Math.min(70 * s, (h - deckY) * 0.4));

  // Load cases (above deck)
  ctx.textBaseline = 'middle';
  lcs.forEach((lc, i) => {
    const veh = (project.vehicles || []).find(v => v.id === (lc.vehicleIds || [])[0]) || (project.vehicles || [])[0];
    const wpos = loadCaseWheels(lc, veh);
    const y = lcTop + i * rowH + rowH / 2;
    const col = PALETTE[i % PALETTE.length];
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.5 * s;
    // axle line and tires
    ctx.beginPath(); ctx.moveTo(X(wpos.a), y); ctx.lineTo(X(wpos.b), y); ctx.stroke();
    for (const wx of [wpos.a, wpos.b]) {
      const tw = Math.max(4 * s, wpos.tire * kx);
      ctx.fillRect(X(wx) - tw / 2, y - 8 * s, tw, 16 * s);
    }
    // centerline arrow down to deck
    ctx.setLineDash([4 * s, 3 * s]); ctx.beginPath(); ctx.moveTo(X(wpos.center), y + 9 * s); ctx.lineTo(X(wpos.center), deckY - 3 * s); ctx.stroke(); ctx.setLineDash([]);
    const half = Math.max(4 * s, wpos.tire * kx) / 2 + 8 * s;
    ctx.font = 'bold ' + f(12); ctx.textAlign = X(wpos.b) + half + 150 * s < w ? 'left' : 'right';
    const lx = ctx.textAlign === 'left' ? X(wpos.b) + half : X(wpos.a) - half;
    ctx.fillText(`${lc.name || 'LC' + (i + 1)}  ${ftin(wpos.center)} to C/L`, lx, y);
  });

  // Deck
  ctx.fillStyle = th.deck; ctx.fillRect(X(0), deckY, width * kx, deckT);
  ctx.strokeStyle = th.fg; ctx.lineWidth = 1 * s; ctx.strokeRect(X(0), deckY, width * kx, deckT);
  // Barriers at curb lines
  const curbA = Number(br.curbA) || 0, curbB = br.curbB !== '' && br.curbB != null ? Number(br.curbB) : width;
  ctx.fillStyle = th.steel;
  if (curbA > 0.1) ctx.fillRect(X(0), deckY - 14 * s, Math.max(3 * s, curbA * kx), 14 * s);
  if (curbB < width - 0.1) ctx.fillRect(X(curbB), deckY - 14 * s, Math.max(3 * s, (width - curbB) * kx), 14 * s);
  // Lane lines
  ctx.fillStyle = '#d4a017';
  for (const ll of String(br.laneLines || '').split(/[,\s;]+/).map(Number).filter(isFinite)) {
    ctx.fillRect(X(ll) - 2 * s, deckY - 3 * s, 4 * s, 3 * s);
  }
  // Girders
  const girders = br.type === 'slab' ? [] : (br.girders || []);
  ctx.font = f(11); ctx.textAlign = 'center';
  for (const g of girders) {
    const gx = X(Number(g.offset));
    const fw = Math.max(8 * s, Math.min(26 * s, 1.2 * kx));
    const top = deckY + deckT, bot = top + girderH;
    ctx.fillStyle = th.steel;
    ctx.fillRect(gx - fw / 2, top, fw, 4 * s);
    ctx.fillRect(gx - 2 * s, top, 4 * s, girderH);
    ctx.fillRect(gx - fw / 2, bot - 4 * s, fw, 4 * s);
    ctx.fillStyle = th.fg; ctx.textBaseline = 'top';
    ctx.fillText(g.name || '', gx, bot + 4 * s);
  }
  // Gauges
  const gauges = opt.gauges || [];
  const yFor = loc => {
    if (br.type === 'slab') return deckY + deckT + 4 * s;
    if (loc === 'Top') return deckY + deckT + 6 * s;
    if (loc === 'Web') return deckY + deckT + girderH / 2;
    return deckY + deckT + girderH - 2 * s;
  };
  const labelRowBase = deckY + deckT + girderH + 22 * s;
  gauges.forEach(gg => {
    if (!isFinite(gg.offset)) return;
    const gx = X(gg.offset), gy = yFor(gg.location);
    const isDefl = /displ/i.test(gg.type);
    ctx.fillStyle = isDefl ? '#d62728' : th.accent;
    ctx.beginPath();
    if (isDefl) { ctx.moveTo(gx, gy + 5 * s); ctx.lineTo(gx - 5 * s, gy - 4 * s); ctx.lineTo(gx + 5 * s, gy - 4 * s); ctx.closePath(); }
    else ctx.arc(gx, gy, 4 * s, 0, Math.PI * 2);
    ctx.fill();
  });
  // gauge labels: stacked under each offset
  if (opt.labels !== false) {
    const byX = new Map();
    gauges.forEach(gg => { if (!isFinite(gg.offset)) return; const k = Math.round(gg.offset * 10); if (!byX.has(k)) byX.set(k, []); byX.get(k).push(gg); });
    ctx.font = f(10); ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    for (const list of byX.values()) {
      list.forEach((gg, k) => {
        ctx.fillStyle = /displ/i.test(gg.type) ? '#d62728' : th.muted;
        ctx.fillText(gg.short || gg.serial, X(gg.offset), labelRowBase + k * 12 * s);
      });
    }
  }
  // Edge labels and width
  ctx.fillStyle = th.muted; ctx.font = f(11); ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left'; ctx.fillText(br.edgeA || 'Edge A', X(0), h - 4 * s);
  ctx.textAlign = 'right'; ctx.fillText(br.edgeB || 'Edge B', X(width), h - 4 * s);
  ctx.textAlign = 'center'; ctx.fillText(`Deck width ${ftin(width)} · looking ${br.lookDir || 'up-station'}`, w / 2, h - 4 * s);
  ctx.restore();
}

export function drawTruck(ctx, w, h, veh, opt = {}) {
  const th = opt.theme || LIGHT, s = opt.fontScale || 1;
  const f = px => `${Math.round(px * s)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.save();
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
  const ax = (veh.axles || []).map(a => ({ ...a, spacing: Number(a.spacing) || 0, track: Number(a.track) || 72, tireWidth: Number(a.tireWidth) || 10, weight: Number(a.weight) || 0 }));
  if (!ax.length) { ctx.fillStyle = th.muted; ctx.font = f(13); ctx.textAlign = 'center'; ctx.fillText('Add axles to see the diagram', w / 2, h / 2); ctx.restore(); return; }
  const xs = []; let acc = 0;
  ax.forEach((a, i) => { if (i > 0) acc += a.spacing; xs.push(acc); });
  const L = acc || 1;
  const maxTrack = Math.max(...ax.map(a => a.track + a.tireWidth * (a.dual ? 2.3 : 1)));
  const padX = 70 * s, padTop = 34 * s, padBot = 70 * s;
  const k = Math.min((w - 2 * padX) / Math.max(L, 60), (h - padTop - padBot) / maxTrack);
  const ox = (w - L * k) / 2, cy = padTop + (h - padTop - padBot) / 2;
  const X = inch => ox + inch * k, Y = inch => cy + inch * k;
  // frame
  ctx.strokeStyle = th.muted; ctx.lineWidth = 2 * s;
  ctx.beginPath(); ctx.moveTo(X(0), cy); ctx.lineTo(X(L), cy); ctx.stroke();
  // axles & tires
  ax.forEach((a, i) => {
    const x = X(xs[i]);
    ctx.strokeStyle = th.fg; ctx.lineWidth = 2 * s;
    ctx.beginPath(); ctx.moveTo(x, Y(-a.track / 2)); ctx.lineTo(x, Y(a.track / 2)); ctx.stroke();
    const tl = Math.max(30, Math.min(44, (a.tireWidth || 10) * 1.5)) * k; // tire length along travel (schematic)
    ctx.fillStyle = th.wheel;
    for (const side of [-1, 1]) {
      const n = a.dual ? 2 : 1;
      for (let d = 0; d < n; d++) {
        const tw = a.tireWidth * k;
        const yc = a.dual ? Y(side * a.track / 2) + (d === 0 ? -1 : 1) * (tw * 0.6) : Y(side * a.track / 2);
        ctx.fillRect(x - tl / 2, yc - tw / 2, tl, tw);
      }
    }
    // weight label
    ctx.fillStyle = th.fg; ctx.font = 'bold ' + f(12); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(a.weight ? `${a.weight.toLocaleString()} lb` : '', x, Y(maxTrack / 2) + 8 * s);
    ctx.font = f(11); ctx.fillStyle = th.muted;
    ctx.fillText(`Axle ${i + 1}`, x, Y(maxTrack / 2) + 24 * s);
  });
  // spacing dimensions
  const dimY = padTop - 14 * s;
  ctx.strokeStyle = th.muted; ctx.fillStyle = th.fg; ctx.lineWidth = 1 * s; ctx.font = f(11); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  for (let i = 1; i < ax.length; i++) {
    const x0 = X(xs[i - 1]), x1 = X(xs[i]);
    ctx.beginPath(); ctx.moveTo(x0, dimY); ctx.lineTo(x1, dimY); ctx.moveTo(x0, dimY - 5 * s); ctx.lineTo(x0, dimY + 5 * s); ctx.moveTo(x1, dimY - 5 * s); ctx.lineTo(x1, dimY + 5 * s); ctx.stroke();
    ctx.fillText(`${ax[i].spacing}" (${ftin(ax[i].spacing / 12)})`, (x0 + x1) / 2, dimY - 3 * s);
  }
  // track dimension at first axle
  const a0 = ax[0], tx = X(0) - 26 * s;
  ctx.beginPath(); ctx.moveTo(tx, Y(-a0.track / 2)); ctx.lineTo(tx, Y(a0.track / 2)); ctx.stroke();
  ctx.save(); ctx.translate(tx - 4 * s, cy); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'bottom'; ctx.fillText(`${a0.track}" c/c`, 0, 0); ctx.restore();
  // direction arrow + gross
  ctx.fillStyle = th.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.font = f(11);
  ctx.fillText('◀ direction of travel', 8 * s, h - 6 * s);
  const gross = ax.reduce((t, a) => t + a.weight, 0);
  ctx.textAlign = 'right'; ctx.font = 'bold ' + f(12); ctx.fillStyle = th.fg;
  ctx.fillText(`${veh.name || 'Vehicle'} · Gross ${gross.toLocaleString()} lb · ${ftin(L / 12)} wheelbase`, w - 8 * s, h - 6 * s);
  ctx.restore();
}

// Load distribution across the bridge, drawn on the same horizontal scale as the cross-section below it.
// series: [{name, color, rows:[{offset, df, strain, name}], loadCase}]  opt.metric: 'df' (%) or 'strain' (µε)
export function drawDistribution(ctx, w, h, project, series, opt = {}) {
  const th = opt.theme || LIGHT, s = opt.fontScale || 1, metric = opt.metric || 'df';
  const br = project.bridge;
  const f = px => `${Math.round(px * s)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.save();
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, w, h);
  const girders = br.type === 'slab' ? [] : (br.girders || []);
  const offs = series.flatMap(se => se.rows.map(r => r.offset)).filter(isFinite);
  const width = Number(br.deckWidth) || Math.max(20, ...offs.map(o => o + 3), ...girders.map(g => Number(g.offset) + 3));
  const L = 62 * s, R = 16 * s;
  const kx = (w - L - R) / width, X = ft => L + ft * kx;
  const legendH = series.length > 1 || opt.title ? 22 * s * Math.ceil(series.length / Math.max(1, Math.floor((w - L) / (170 * s)))) : 0;
  const T = 12 * s + legendH + (opt.title ? 18 * s : 0);
  const xsH = (girders.length ? 92 : 46) * s;
  const lcH = opt.showLoadCase !== false && series.some(se => se.loadCase) ? 26 * s : 0;
  const plotB = h - xsH - lcH - 28 * s;
  const H = Math.max(40 * s, plotB - T);
  const val = r => metric === 'df' ? r.df * 100 : r.strain;
  const vals = series.flatMap(se => se.rows.map(val)).filter(isFinite);
  let ymin = Math.min(0, ...vals), ymax = Math.max(1, ...vals) * 1.12;
  const sy = v => T + H - (v - ymin) / (ymax - ymin) * H;
  // title + legend
  ctx.textBaseline = 'middle';
  if (opt.title) { ctx.fillStyle = th.fg; ctx.font = 'bold ' + f(13); ctx.textAlign = 'left'; ctx.fillText(opt.title, L, 12 * s); }
  if (legendH) {
    const perRow = Math.max(1, Math.floor((w - L) / (170 * s)));
    series.forEach((se, i) => {
      const lx = L + (i % perRow) * 170 * s, ly = (opt.title ? 30 : 12) * s + Math.floor(i / perRow) * 22 * s;
      ctx.strokeStyle = se.color; ctx.fillStyle = se.color; ctx.lineWidth = 2 * s;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(lx + 22 * s, ly); ctx.stroke();
      ctx.beginPath(); ctx.arc(lx + 11 * s, ly, 3.5 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = th.fg; ctx.font = f(11); ctx.textAlign = 'left'; ctx.fillText(se.name, lx + 28 * s, ly);
    });
  }
  // grid + y axis
  ctx.strokeStyle = th.muted; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
  const yt = niceTicks(ymin, ymax, Math.max(3, Math.round(H / (40 * s))));
  for (const t of yt) { const y = Math.round(sy(t)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(X(width), y); ctx.stroke(); }
  ctx.globalAlpha = 1;
  ctx.fillStyle = th.muted; ctx.font = f(11); ctx.textAlign = 'right';
  for (const t of yt) ctx.fillText(String(Number(t.toPrecision(4))), L - 6 * s, sy(t));
  ctx.save(); ctx.translate(14 * s, T + H / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.fillStyle = th.fg; ctx.font = f(12);
  ctx.fillText(metric === 'df' ? 'Load distribution (%)' : 'Strain at peak (µε)', 0, 0); ctx.restore();
  ctx.strokeStyle = th.muted; ctx.beginPath(); ctx.moveTo(L + 0.5, T); ctx.lineTo(L + 0.5, T + H); ctx.lineTo(X(width), T + H); ctx.stroke();
  // girder guide lines from plot down to the girders
  const deckY = h - xsH - 10 * s;
  ctx.setLineDash([3 * s, 4 * s]); ctx.strokeStyle = th.muted; ctx.globalAlpha = 0.45;
  for (const g of girders) { const gx = Math.round(X(Number(g.offset))) + 0.5; ctx.beginPath(); ctx.moveTo(gx, T); ctx.lineTo(gx, deckY); ctx.stroke(); }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  // series
  series.forEach(se => {
    const pts = se.rows.filter(r => isFinite(r.offset) && isFinite(val(r))).sort((a, b) => a.offset - b.offset);
    ctx.strokeStyle = se.color; ctx.fillStyle = se.color; ctx.lineWidth = 2 * s;
    ctx.beginPath(); pts.forEach((r, k) => { const x = X(r.offset), y = sy(val(r)); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
    pts.forEach(r => { ctx.beginPath(); ctx.arc(X(r.offset), sy(val(r)), 4 * s, 0, Math.PI * 2); ctx.fill(); });
    if (series.length === 1 && opt.valueLabels !== false) {
      ctx.fillStyle = th.fg; ctx.font = f(10); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      pts.forEach(r => ctx.fillText(metric === 'df' ? r.df * 100 >= 0 ? (r.df * 100).toFixed(1) : '' : r.strain.toFixed(0), X(r.offset), sy(val(r)) - 6 * s));
      ctx.textBaseline = 'middle';
    }
  });
  // load case wheels (above the deck)
  if (lcH) {
    const lcs = [...new Map(series.filter(se => se.loadCase).map(se => [se.loadCase.id, se])).values()];
    lcs.forEach((se, i) => {
      const veh = (project.vehicles || []).find(v => v.id === (se.loadCase.vehicleIds || [])[0]) || project.vehicles[0];
      const wp = loadCaseWheels(se.loadCase, veh);
      const y = deckY - 12 * s - i * 2 * s;
      ctx.fillStyle = th.fg; ctx.globalAlpha = 0.75;
      for (const wx of [wp.a, wp.b]) { const tw = Math.max(4 * s, wp.tire * kx); ctx.fillRect(X(wx) - tw / 2, y - 6 * s, tw, 12 * s); }
      ctx.globalAlpha = 1; ctx.font = f(10); ctx.textAlign = 'left';
      ctx.fillText(se.loadCase.name, X(wp.b) + Math.max(4 * s, wp.tire * kx) / 2 + 4 * s, y);
    });
  }
  // cross-section
  const deckT = Math.max(6 * s, Math.min(14 * s, 0.6 * kx));
  ctx.fillStyle = th.deck; ctx.fillRect(X(0), deckY, width * kx, deckT);
  ctx.strokeStyle = th.fg; ctx.lineWidth = 1; ctx.strokeRect(X(0), deckY, width * kx, deckT);
  const curbA = Number(br.curbA) || 0, curbB = br.curbB !== '' && br.curbB != null ? Number(br.curbB) : width;
  ctx.fillStyle = th.steel;
  if (curbA > 0.1) ctx.fillRect(X(0), deckY - 10 * s, Math.max(3 * s, curbA * kx), 10 * s);
  if (curbB < width - 0.1) ctx.fillRect(X(curbB), deckY - 10 * s, Math.max(3 * s, (width - curbB) * kx), 10 * s);
  const gH = 48 * s;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.font = f(11);
  for (const g of girders) {
    const gx = X(Number(g.offset)), top = deckY + deckT, fw = Math.max(8 * s, Math.min(24 * s, 1.1 * kx));
    ctx.fillStyle = th.steel;
    ctx.fillRect(gx - fw / 2, top, fw, 3 * s); ctx.fillRect(gx - 1.5 * s, top, 3 * s, gH); ctx.fillRect(gx - fw / 2, top + gH - 3 * s, fw, 3 * s);
    ctx.fillStyle = th.fg; ctx.fillText(g.name, gx, top + gH + 4 * s);
  }
  if (!girders.length) {
    // slab: mark gauge positions under the deck
    ctx.fillStyle = th.accent;
    for (const o of [...new Set(offs)]) { ctx.beginPath(); ctx.arc(X(o), deckY + deckT + 5 * s, 3 * s, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.fillStyle = th.muted; ctx.font = f(10); ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left'; ctx.fillText(br.edgeA || 'Edge A', X(0), h - 2 * s);
  ctx.textAlign = 'right'; ctx.fillText(br.edgeB || 'Edge B', X(width), h - 2 * s);
  ctx.restore();
}

export async function canvasPng(drawFn, width, height) {
  const c = document.createElement('canvas'); c.width = width; c.height = height;
  drawFn(c.getContext('2d'), width, height);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// Draw to a visible canvas at device pixel ratio
export function drawInto(canvas, height, fn) {
  if (!canvas || !canvas.isConnected) return; // screen changed before a deferred redraw
  const w = canvas.parentElement.clientWidth || 600;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(height * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fn(ctx, w, height, diagramTheme());
}
