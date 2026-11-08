// Canvas line plots: one renderer used for the interactive screen view and for report images.

export const PALETTE = ['#1f6fb4', '#d62728', '#2a9d3a', '#ef7f0e', '#8b5cc4', '#8c564b', '#d9469f', '#13a8b8', '#a8a51c', '#6b6b6b', '#2f3a8f', '#b5464b'];
export const DASHES = [[], [8, 4], [2, 3], [10, 3, 2, 3]];
export const seriesStyle = i => ({ color: PALETTE[i % PALETTE.length], dash: DASHES[Math.floor(i / PALETTE.length) % DASHES.length] });

export function niceTicks(min, max, count = 6) {
  if (!isFinite(min) || !isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

const LIGHT = { bg: '#ffffff', fg: '#1d2430', grid: '#e3e7ee', axis: '#5b6573', sel: 'rgba(31,111,180,0.15)' };

export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = n => cs.getPropertyValue(n).trim();
  return { bg: v('--plot-bg') || LIGHT.bg, fg: v('--fg') || LIGHT.fg, grid: v('--plot-grid') || LIGHT.grid, axis: v('--muted') || LIGHT.axis, sel: LIGHT.sel };
}

// Compute data extents for visible series within an x range
function extents(spec, xr) {
  let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const s of spec.series) {
    if (s.hidden) continue;
    const x = s.x || spec.x, y = s.y;
    for (let i = 0; i < y.length; i++) {
      const xv = x[i], yv = y[i];
      if (!isFinite(xv) || !isFinite(yv)) continue;
      if (xr && (xv < xr[0] || xv > xr[1])) continue;
      if (xv < xmin) xmin = xv; if (xv > xmax) xmax = xv;
      if (yv < ymin) ymin = yv; if (yv > ymax) ymax = yv;
    }
  }
  if (spec.yIncludeZero !== false) { ymin = Math.min(ymin, 0); ymax = Math.max(ymax, 0); }
  if (!isFinite(xmin)) { xmin = 0; xmax = 1; ymin = -1; ymax = 1; }
  const pad = (ymax - ymin) * 0.06 || 1;
  return { xmin: xr ? xr[0] : xmin, xmax: xr ? xr[1] : xmax, ymin: ymin - pad, ymax: ymax + pad };
}

// Draw plot. Returns layout {L,T,W,H,sx,sy,ix,xmin,xmax,ymin,ymax} for hit-testing.
export function drawPlot(ctx, width, height, spec, opt = {}) {
  const th = opt.theme || LIGHT;
  const scale = opt.fontScale || 1;
  const f = px => `${Math.round(px * scale)}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  ctx.save();
  ctx.fillStyle = th.bg; ctx.fillRect(0, 0, width, height);
  const e = extents(spec, opt.xRange);
  if (opt.yRange) { e.ymin = opt.yRange[0]; e.ymax = opt.yRange[1]; }
  const L = 64 * scale, R = 14 * scale, T = (spec.title ? 30 : 12) * scale, B = 44 * scale;
  const W = Math.max(10, width - L - R), H = Math.max(10, height - T - B);
  const sx = x => L + (x - e.xmin) / (e.xmax - e.xmin || 1) * W;
  const sy = y => T + H - (y - e.ymin) / (e.ymax - e.ymin || 1) * H;
  const ix = px => e.xmin + (px - L) / W * (e.xmax - e.xmin);

  if (spec.title) { ctx.fillStyle = th.fg; ctx.font = 'bold ' + f(14); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(spec.title, L, 7 * scale); }

  // bands
  for (const b of spec.vbands || []) {
    const x0 = Math.max(L, sx(b.x0)), x1 = Math.min(L + W, sx(b.x1));
    if (x1 > x0) { ctx.fillStyle = b.color || 'rgba(120,120,120,0.08)'; ctx.fillRect(x0, T, x1 - x0, H); }
  }
  // grid + ticks
  ctx.strokeStyle = th.grid; ctx.lineWidth = 1; ctx.fillStyle = th.axis; ctx.font = f(11);
  const xt = niceTicks(e.xmin, e.xmax, Math.max(3, Math.round(W / (90 * scale))));
  const yt = niceTicks(e.ymin, e.ymax, Math.max(3, Math.round(H / (50 * scale))));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const t of xt) { const x = Math.round(sx(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + H); ctx.stroke(); ctx.fillText(fmtTick(t), x, T + H + 5 * scale); }
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const t of yt) { const y = Math.round(sy(t)) + 0.5; ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + W, y); ctx.stroke(); ctx.fillText(fmtTick(t), L - 6 * scale, y); }
  // zero line
  if (e.ymin < 0 && e.ymax > 0) { ctx.strokeStyle = th.axis; ctx.beginPath(); const y = Math.round(sy(0)) + 0.5; ctx.moveTo(L, y); ctx.lineTo(L + W, y); ctx.stroke(); }
  // axis labels
  ctx.fillStyle = th.fg; ctx.font = f(12);
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(spec.xLabel || '', L + W / 2, height - 4 * scale);
  ctx.save(); ctx.translate(14 * scale, T + H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = 'middle'; ctx.fillText(spec.yLabel || '', 0, 0); ctx.restore();

  // clip to plot area
  ctx.save(); ctx.beginPath(); ctx.rect(L, T, W, H); ctx.clip();
  for (const v of spec.vlines || []) {
    const x = sx(v.x); if (x < L - 1 || x > L + W + 1) continue;
    ctx.strokeStyle = v.color || th.axis; ctx.setLineDash(v.dash || [4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + H); ctx.stroke();
    if (v.label) { ctx.setLineDash([]); ctx.fillStyle = v.color || th.axis; ctx.font = f(10); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText(v.label, x + 3, T + 3 + (v.row || 0) * 12 * scale); }
  }
  ctx.setLineDash([]);
  const lw = (opt.lineWidth || 1.5) * scale;
  for (const s of spec.series) {
    if (s.hidden) continue;
    const x = s.x || spec.x, y = s.y;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width ? s.width * scale : lw; ctx.setLineDash((s.dash || []).map(d => d * scale));
    ctx.beginPath();
    let pen = false;
    // simple decimation: at most ~2 points per pixel column using min/max
    const n = y.length;
    const stride = Math.max(1, Math.floor(n / (W * 2)));
    for (let i = 0; i < n; i += stride) {
      let yi = y[i], xi = x[i];
      if (stride > 1) {
        let mn = Infinity, mx = -Infinity;
        for (let k = i; k < Math.min(n, i + stride); k++) { if (y[k] < mn) mn = y[k]; if (y[k] > mx) mx = y[k]; }
        if (!isFinite(xi)) { pen = false; continue; }
        const px = sx(xi);
        if (pen) ctx.lineTo(px, sy(mn)); else { ctx.moveTo(px, sy(mn)); pen = true; }
        ctx.lineTo(px, sy(mx));
        continue;
      }
      if (!isFinite(yi) || !isFinite(xi)) { pen = false; continue; }
      const px = sx(xi), py = sy(yi);
      if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; }
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const p of spec.points || []) {
    ctx.fillStyle = p.color || th.fg; ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), 4 * scale, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
  ctx.strokeStyle = th.axis; ctx.lineWidth = 1; ctx.strokeRect(L + 0.5, T + 0.5, W, H);

  // legend inside plot (report images only)
  if (opt.legend) {
    const items = spec.series.filter(s => !s.hidden && s.name);
    ctx.font = f(11);
    const colW = Math.max(...items.map(s => ctx.measureText(s.name).width), 30) + 34 * scale;
    const cols = Math.max(1, Math.min(items.length, Math.floor((W - 10) / colW)));
    const rows = Math.ceil(items.length / cols);
    const lh = 15 * scale;
    const bx = L + 6 * scale, by = T + 6 * scale;
    ctx.fillStyle = th.bg === '#ffffff' ? 'rgba(255,255,255,0.85)' : th.bg; ctx.fillRect(bx, by, cols * colW + 6 * scale, rows * lh + 6 * scale);
    items.forEach((s, k) => {
      const c = k % cols, r = Math.floor(k / cols);
      const x = bx + 4 * scale + c * colW, y = by + 3 * scale + r * lh + lh / 2;
      ctx.strokeStyle = s.color; ctx.lineWidth = 2 * scale; ctx.setLineDash((s.dash || []).map(d => d * scale));
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 22 * scale, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = th.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(s.name, x + 26 * scale, y);
    });
  }
  ctx.restore();
  return { L, T, W, H, sx, sy, ix, ...e };
}

function fmtTick(v) {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1000 || a < 0.001) return v.toPrecision(3);
  return String(Number(v.toPrecision(4)));
}

// Render a plot to PNG bytes (for the Word report)
export async function plotPng(spec, width = 1600, height = 820) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  drawPlot(c.getContext('2d'), width, height, spec, { legend: true, fontScale: 2.4, lineWidth: 1.6 });
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

// Interactive plot: drag to zoom on x, tap/hover for values, legend toggles series.
export class PlotView {
  constructor(host, { height = 360, onXClick } = {}) {
    this.host = host;
    host.classList.add('plotview');
    host.innerHTML = `<div class="plot-tools"><span class="plot-hint">Drag to zoom · tap for values</span>
      <button class="btn small" data-act="reset">Reset zoom</button></div>
      <div class="plot-canvas-wrap" style="height:${height}px"><canvas></canvas><div class="plot-tip" hidden></div></div>
      <div class="plot-legend"></div>`;
    this.canvas = host.querySelector('canvas');
    this.tip = host.querySelector('.plot-tip');
    this.legend = host.querySelector('.plot-legend');
    this.wrap = host.querySelector('.plot-canvas-wrap');
    this.xRange = null; this.spec = null; this.drag = null; this.onXClick = onXClick;
    host.querySelector('[data-act=reset]').onclick = () => { this.xRange = null; this.draw(); };
    const c = this.canvas;
    c.addEventListener('pointerdown', ev => { c.setPointerCapture(ev.pointerId); this.drag = { x0: ev.offsetX, x1: ev.offsetX, moved: false }; });
    c.addEventListener('pointermove', ev => {
      if (this.drag) { this.drag.x1 = ev.offsetX; if (Math.abs(this.drag.x1 - this.drag.x0) > 6) this.drag.moved = true; this.draw(); }
      else if (ev.pointerType === 'mouse') this.showTip(ev.offsetX, ev.offsetY);
    });
    c.addEventListener('pointerup', ev => {
      const d = this.drag; this.drag = null;
      if (!d || !this.layout) return;
      if (d.moved) {
        const a = this.layout.ix(Math.min(d.x0, d.x1)), b = this.layout.ix(Math.max(d.x0, d.x1));
        if (b > a) this.xRange = [a, b];
        this.tip.hidden = true;
        this.draw();
      } else {
        this.showTip(ev.offsetX, ev.offsetY);
        if (this.onXClick) this.onXClick(this.layout.ix(ev.offsetX));
      }
    });
    c.addEventListener('pointerleave', ev => { if (ev.pointerType === 'mouse' && !this.drag) { this.tip.hidden = true; this.draw(); } });
    c.addEventListener('dblclick', () => { this.xRange = null; this.draw(); });
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.wrap);
  }
  set(spec, keepZoom = false) {
    this.spec = spec;
    if (!keepZoom) this.xRange = null;
    this.renderLegend();
    this.draw();
  }
  renderLegend() {
    const s = this.spec;
    this.legend.innerHTML = '';
    if (!s) return;
    s.series.forEach(se => {
      if (!se.name) return;
      const b = document.createElement('button');
      b.className = 'legend-item' + (se.hidden ? ' off' : '');
      b.innerHTML = `<span class="swatch" style="background:${se.color}"></span>${escapeHtml(se.name)}`;
      b.onclick = () => { se.hidden = !se.hidden; b.classList.toggle('off', se.hidden); this.draw(); };
      this.legend.appendChild(b);
    });
  }
  draw(cursorX) {
    if (!this.spec) return;
    const r = this.wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(50, r.width), h = Math.max(50, r.height);
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
    }
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const th = themeColors();
    this.layout = drawPlot(ctx, w, h, this.spec, { xRange: this.xRange, theme: th });
    const lay = this.layout;
    if (this.drag && this.drag.moved) {
      ctx.fillStyle = th.sel; ctx.fillRect(Math.min(this.drag.x0, this.drag.x1), lay.T, Math.abs(this.drag.x1 - this.drag.x0), lay.H);
    }
    if (cursorX != null) {
      ctx.strokeStyle = th.fg; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.moveTo(cursorX + 0.5, lay.T); ctx.lineTo(cursorX + 0.5, lay.T + lay.H); ctx.stroke(); ctx.globalAlpha = 1;
    }
  }
  showTip(px, py) {
    const lay = this.layout, s = this.spec;
    if (!lay || px < lay.L || px > lay.L + lay.W) { this.tip.hidden = true; return; }
    const xv = lay.ix(px);
    const rows = [];
    for (const se of s.series) {
      if (se.hidden) continue;
      const x = se.x || s.x;
      const i = nearestIndex(x, xv);
      if (i < 0) continue;
      rows.push({ name: se.name, color: se.color, v: se.y[i], x: x[i] });
    }
    rows.sort((a, b) => b.v - a.v);
    const xLab = (s.xLabel || 'x').replace(/\s*\(.*\)/, '');
    this.tip.innerHTML = `<b>${escapeHtml(xLab)}: ${fmtNum(rows.length ? rows[0].x : xv)}</b>` +
      rows.slice(0, 14).map(r => `<div><span class="swatch" style="background:${r.color}"></span>${escapeHtml(r.name)} <b>${fmtNum(r.v)}</b></div>`).join('') +
      (rows.length > 14 ? `<div class="muted">+${rows.length - 14} more</div>` : '');
    this.tip.hidden = false;
    const wr = this.wrap.clientWidth;
    this.tip.style.left = (px > wr / 2 ? Math.max(0, px - this.tip.offsetWidth - 12) : px + 12) + 'px';
    this.tip.style.top = Math.max(0, Math.min(py - 20, this.wrap.clientHeight - this.tip.offsetHeight)) + 'px';
    this.draw(px);
  }
}

function nearestIndex(x, v) {
  let lo = 0, hi = x.length - 1;
  if (hi < 0) return -1;
  // x may be non-monotonic (position); fall back to linear search if needed
  if (x[hi] < x[0]) { let best = 0, bd = Infinity; for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - v); if (d < bd) { bd = d; best = i; } } return best; }
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (x[m] < v) lo = m; else hi = m; }
  return Math.abs(x[lo] - v) <= Math.abs(x[hi] - v) ? lo : hi;
}
const fmtNum = v => !isFinite(v) ? '–' : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4);
export const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
