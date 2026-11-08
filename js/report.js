// Word (.docx) report generator. Uses the docx library loaded as window.docx.
import { state, getPassData, gaugeOffset, groupKey, sortGauges, isStrain, isDefl, gaugeName, loadCaseById, vehicleById, shortSerial } from './state.js';
import { db } from './db.js';
import { processPass, buildSpec, passStart, passLabel } from './passes.js';
import { plotPng } from './plot.js';
import { drawCrossSection, drawTruck, canvasPng, loadCaseWheels } from './draw.js';
import { fmt, ftin, bridgeLength } from './calc.js';

export const REPORT_SECTIONS = [
  ['intro', 'Introduction'], ['bridge', 'Bridge description'], ['instr', 'Instrumentation'], ['vehicles', 'Load vehicles'],
  ['procedure', 'Load test procedure'], ['processing', 'Data processing'], ['results', 'Test results (plots & tables per pass)'],
  ['summary', 'Summary of results'], ['observations', 'Field observations'], ['conclusions', 'Conclusions'], ['photos', 'Appendix – Photographs'], ['files', 'Appendix – Data files'],
];

export async function buildReport(onProgress = () => { }) {
  const D = window.docx;
  if (!D) throw new Error('Word library failed to load.');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell, WidthType, ImageRun, PageBreak, Footer, Header, PageNumber, TableOfContents, ShadingType, BorderStyle } = D;
  const p = state.project, br = p.bridge, rep = p.report, set = p.settings;
  const on = k => rep.sections?.[k] !== false;
  const children = [];
  let fig = 0, tab = 0;
  const bridgeName = [br.name, br.structureNo && `Structure No. ${br.structureNo}`].filter(Boolean).join(' – ') || p.name;

  // ---- helpers ----
  const para = (text, o = {}) => new Paragraph({ spacing: { after: 120 }, alignment: o.align, children: runs(text, o) });
  function runs(text, o = {}) {
    // [bracketed] text becomes a highlighted placeholder for the engineer to edit
    const parts = String(text ?? '').split(/(\[[^\]]+\])/);
    return parts.filter(Boolean).map(t => new TextRun({ text: t, bold: o.bold, italics: o.italics, size: o.size, highlight: /^\[.*\]$/.test(t) ? 'yellow' : undefined, color: o.color }));
  }
  const multi = text => String(text || '').split(/\n+/).map(t => para(t));
  const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: false, spacing: { before: 240, after: 120 }, children: [new TextRun(t)] });
  const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 }, keepNext: true, children: [new TextRun(t)] });
  const h3 = t => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 }, keepNext: true, children: [new TextRun(t)] });
  const caption = (kind, text) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, keepNext: kind === 'Table', children: [new TextRun({ text: `${kind} ${kind === 'Figure' ? ++fig : ++tab}. `, bold: true, size: 20 }), new TextRun({ text, size: 20 })] });
  const image = (data, w, h) => new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [new ImageRun({ data, transformation: { width: w, height: h } })] });
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'A0A7B4' };
  const cell = (t, o = {}) => new TableCell({
    shading: o.head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'DCE6F2' } : undefined,
    borders: { top: border, bottom: border, left: border, right: border },
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ alignment: o.num ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: String(t ?? ''), bold: o.head || o.bold, size: 18 })] })],
  });
  const table = (head, rows, numCols = []) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, { head: true, num: numCols.includes(i) })) }),
      ...rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c, { num: numCols.includes(i) })) }))],
  });
  const spacer = () => new Paragraph({ text: '' });

  const strainG = sortGauges(p.gauges.filter(g => isStrain(g) && g.status !== 'unused'), set.sortBy);
  const deflG = sortGauges(p.gauges.filter(g => isDefl(g) && g.status !== 'unused'), set.sortBy);
  const L = bridgeLength(p);
  const XS_W = 1800, XS_FONT = 2.4;
  const xsHeight = nLc => Math.round(XS_FONT * (200 + Math.max(1, nLc) * 30 + (br.type === 'slab' ? 0 : 80)));

  // ---- title page ----
  onProgress('Title page');
  children.push(new Paragraph({ spacing: { before: 2400, after: 400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: rep.title || 'Bridge Load Test Report', bold: true, size: 48 })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: bridgeName, size: 32 })] }));
  if (br.location || br.county) children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: [br.route, br.location, br.county && br.county + ' County'].filter(Boolean).join(', '), size: 26 })] }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new TextRun({ text: `Load test date: ${br.testDate || '[date]'}`, size: 24 })] }));
  children.push(new Paragraph({ spacing: { before: 1600 }, alignment: AlignmentType.CENTER, children: runs(`Prepared for: ${rep.client || '[client]'}`, { size: 24 }) }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: runs(`Prepared by: ${[rep.author, rep.company].filter(Boolean).join(', ') || '[author, company]'}`, { size: 24 }) }));
  children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Report date: ${rep.date || ''}`, size: 24 })] }));
  children.push(new Paragraph({ children: [new PageBreak()] }));
  children.push(new Paragraph({ children: [new TextRun({ text: 'Table of Contents', bold: true, size: 32 })] }));
  children.push(new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-2' }));
  children.push(para('(If the table of contents is empty, right-click it in Word and choose Update Field.)', { italics: true, size: 18, color: '777777' }));
  children.push(new Paragraph({ children: [new PageBreak()] }));

  let sec = 0;
  // ---- 1 Introduction ----
  if (on('intro')) {
    children.push(h1(`${++sec}. Introduction`));
    const intro = rep.intro || `A diagnostic live-load test was performed on ${bridgeName}${br.location ? ' in ' + br.location : ''} on ${br.testDate || '[date]'}. ${p.test.purpose || '[Describe the purpose of the test, e.g. to measure girder strains and lateral load distribution under known truck loads for load rating.]'}`;
    children.push(...multi(intro));
    children.push(para(`This report describes the structure, instrumentation, load vehicles and test procedure, and presents the measured strains${deflG.length ? ', deflections' : ''} and load distribution.`));
  }

  // ---- 2 Bridge ----
  if (on('bridge')) {
    children.push(h1(`${++sec}. Bridge Description`));
    const spans = (br.spans || []).filter(Boolean);
    children.push(para(`${bridgeName} is a ${spans.length ? spans.length + '-span ' : ''}${br.type === 'slab' ? 'slab' : 'girder'} bridge${br.girderType ? ' (' + br.girderType + ')' : ''}${br.featureCrossed ? ' carrying ' + (br.route || '[route]') + ' over ' + br.featureCrossed : ''}. ${spans.length ? `Span lengths are ${spans.map(s => s + ' ft').join(', ')} for a total length of ${fmt(L, 1)} ft. ` : ''}${br.deckWidth ? `The deck is ${fmt(br.deckWidth, 1)} ft wide out-to-out. ` : ''}${Number(br.skew) ? `The bridge has a skew of ${br.skew}°. ` : ''}${br.yearBuilt ? `It was built in ${br.yearBuilt}.` : ''}`));
    if (br.notes) children.push(...multi(br.notes));
    const rows = [['Structure number', br.structureNo], ['Bridge name', br.name], ['Location', [br.location, br.county && br.county + ' County'].filter(Boolean).join(', ')], ['Route / feature carried', br.route], ['Feature crossed', br.featureCrossed], ['Owner', br.owner], ['Year built', br.yearBuilt], ['Bridge type', br.type === 'slab' ? 'Slab' : 'Girder'], ['Superstructure', br.girderType], ['Span lengths (ft)', spans.join(', ')], ['Skew (deg)', br.skew], ['Deck width (ft)', br.deckWidth], ['Number of girders', br.type === 'slab' ? '' : (br.girders || []).length || ''], ['Girder spacing', (br.girders || []).length > 1 ? (br.girders || []).slice(1).map((g, i) => ftin(Number(g.offset) - Number(br.girders[i].offset))).join(', ') : '']].filter(r => r[1] !== '' && r[1] != null);
    children.push(caption('Table', 'Bridge data'));
    children.push(table(['Item', 'Value'], rows));
  }

  // ---- 3 Instrumentation ----
  if (on('instr')) {
    onProgress('Instrumentation');
    children.push(h1(`${++sec}. Instrumentation`));
    const okS = strainG.filter(g => !['unused', 'removed'].includes(g.status)), okD = deflG.filter(g => !['unused', 'removed'].includes(g.status));
    const rate = p.passes[0]?.sampleRate;
    children.push(para(`The bridge was instrumented with ${okS.length} BDI strain transducers${okD.length ? ` and ${okD.length} deflection transducers` : ''}. ${p.test.gaugeLength ? `Strain transducers were installed with ${p.test.gaugeLength}. ` : ''}Data were recorded with the ${p.test.dataSystem || 'BDI STS'} system${rate ? ` at ${rate} samples per second` : ''}. Gauges are identified by their BDI serial numbers. Transverse positions are measured from the ${br.edgeA || 'Edge A'} edge of the deck, with the cross-section viewed looking ${br.lookDir || 'up-station'}.`));
    const rows = [...okS, ...okD].map(g => [g.order ?? '', g.serial, isDefl(g) ? 'Deflection' : 'Strain', g.span, g.girder, g.section, g.location, isFinite(gaugeOffset(g)) ? fmt(gaugeOffset(g), 2) : '', g.dist ? 'Yes' : '', [g.status !== 'ok' ? g.status : '', g.replaces ? 'replaces ' + g.replaces : '', g.notes].filter(Boolean).join('; ')]);
    children.push(caption('Table', 'Gauge locations'));
    children.push(table(['#', 'Serial', 'Type', 'Span', 'Girder', 'Section', 'Location', 'Offset (ft)', 'Dist.', 'Notes'], rows, [0, 7]));
    const gaugesXs = p.gauges.filter(g => !['unused', 'removed', 'replaced'].includes(g.status)).map(g => ({ serial: g.serial, short: g.label || shortSerial(g.serial), type: g.type, location: g.location, offset: gaugeOffset(g) }));
    const xh = xsHeight(0);
    const png = await canvasPng((ctx, w, h) => drawCrossSection(ctx, w, h, p, { gauges: gaugesXs, loadCases: [], fontScale: XS_FONT }), XS_W, xh);
    children.push(spacer(), image(png, 620, Math.round(620 * xh / XS_W)), caption('Figure', `Cross-section showing gauge locations (looking ${br.lookDir || 'up-station'}). Circles are strain gauges, triangles are deflection transducers.`));
  }

  // ---- 4 Vehicles ----
  if (on('vehicles') && p.vehicles.length) {
    onProgress('Vehicles');
    children.push(h1(`${++sec}. Load Vehicles`));
    children.push(para(`${p.vehicles.length === 1 ? 'One loaded vehicle was' : p.vehicles.length + ' loaded vehicles were'} used for the test. Axle weights, axle spacings, track widths and tire widths are given below.`));
    for (const v of p.vehicles) {
      const gross = v.axles.reduce((t, a) => t + (Number(a.weight) || 0), 0);
      children.push(h2(`${v.name}${v.description ? ' – ' + v.description : ''}`));
      if (v.plate || v.notes) children.push(para([v.plate && `Truck/plate: ${v.plate}.`, v.notes].filter(Boolean).join(' ')));
      children.push(caption('Table', `${v.name} axle data (gross weight ${gross.toLocaleString()} lb)`));
      children.push(table(['Axle', 'Spacing from previous (in)', 'Weight (lb)', 'Track c/c (in)', 'Tire width (in)', 'Dual'],
        v.axles.map((a, i) => [i + 1, i ? a.spacing : '–', a.weight !== '' ? Number(a.weight).toLocaleString() : '', a.track, a.tireWidth, a.dual ? 'Yes' : 'No']).concat([['Total', '', gross.toLocaleString(), '', '', '']]), [1, 2, 3, 4]));
      const png = await canvasPng((ctx, w, h) => drawTruck(ctx, w, h, v, { fontScale: 2 }), 1600, 640);
      children.push(spacer(), image(png, 600, 240), caption('Figure', `${v.name} axle configuration`));
    }
  }

  // ---- 5 Procedure ----
  if (on('procedure')) {
    onProgress('Procedure');
    children.push(h1(`${++sec}. Load Test Procedure`));
    const marks = p.marks.custom ? `at ${p.marks.custom} ft` : `starting ${Math.abs(p.marks.first)} ft ${p.marks.first < 0 ? 'before' : 'after'} the start of the bridge and every ${p.marks.spacing} ft thereafter`;
    children.push(para(`The vehicles crossed the bridge along ${p.loadCases.length} transverse load paths. Crawl-speed passes were used to measure quasi-static response${p.loadCases.some(l => /mph/i.test(l.speed || '') && !/crawl/i.test(l.speed)) ? ', and higher-speed passes were made to evaluate dynamic response' : ''}. Truck position along the bridge was recorded by marking the data file as the front axle crossed reference lines on the deck ${marks}. Each pass was recorded in a separate data file.`));
    if (p.loadCases.length) {
      children.push(caption('Table', 'Load cases'));
      children.push(table(['Load case', 'Description', 'Vehicle(s)', 'Vehicle C/L from ' + (br.edgeA || 'Edge A') + ' (ft)', 'Speed', 'Passes'],
        p.loadCases.map(lc => {
          const veh = vehicleById((lc.vehicleIds || [])[0]) || p.vehicles[0];
          return [lc.name, lc.description, (lc.vehicleIds || []).map(id => vehicleById(id)?.name).filter(Boolean).join(', '), fmt(loadCaseWheels(lc, veh).center, 2), lc.speed || 'crawl', p.passes.filter(ps => ps.loadCaseId === lc.id).length];
        }), [3, 5]));
      const lh = xsHeight(p.loadCases.length);
      const png = await canvasPng((ctx, w, h) => drawCrossSection(ctx, w, h, p, { gauges: [], labels: false, fontScale: XS_FONT }), XS_W, lh);
      children.push(spacer(), image(png, 620, Math.round(620 * lh / XS_W)), caption('Figure', `Transverse load paths (looking ${br.lookDir || 'up-station'})`));
    }
    if (p.passes.length) {
      children.push(caption('Table', 'Test passes'));
      children.push(table(['Pass', 'Load case', 'Data file', 'Start time', 'Duration (s)', 'Vehicles'],
        p.passes.map(ps => [ps.name, loadCaseById(ps.loadCaseId)?.name || '', ps.fileName, passStart(ps) ? passStart(ps).toLocaleTimeString() : '', fmt(ps.duration, 0), (ps.vehicles || []).map(v => vehicleById(v.vehicleId)?.name).filter(Boolean).join(', ')]), [4]));
    }
  }

  // ---- 6 Processing ----
  if (on('processing')) {
    children.push(h1(`${++sec}. Data Processing`));
    const zm = set.zeroMode === 'linear' ? `Each record was zeroed by subtracting a straight line drawn between the average of the first ${set.zeroN} readings and the average of the last ${set.zeroN} readings. This removes the initial offset and any linear drift (for example from temperature change) during the pass.`
      : set.zeroMode === 'initial' ? `Each record was zeroed by subtracting the average of the first ${set.zeroN} readings.` : 'Raw readings were used without zeroing.';
    children.push(para(zm));
    children.push(para(`Truck position was obtained by linear interpolation between the time marks recorded as the front axle crossed each reference line. Positions are given for the front axle, measured from the start of the bridge.`));
    children.push(para(br.type === 'slab'
      ? `Load distribution was evaluated with the equivalent strip width method: the area under the transverse profile of bottom-of-slab strains at ${br.distSection || 'the critical section'} divided by the peak strain, at the time the vehicle produced the maximum response.`
      : `Load distribution was calculated from the bottom-flange strains of all girders at ${br.distSection || 'a single cross-section'}, taken at the instant of ${set.distMethod === 'maxSum' ? 'the largest total strain' : 'peak strain'}. The distribution factor for each girder is its strain divided by the sum of all girder strains at that instant. A separate distribution was calculated for each vehicle.`));
    children.push(para(`Stresses were calculated as σ = E·ε with E = ${Number(br.E).toLocaleString()} ksi. Tensile strain is positive.`));
  }

  // ---- 7 Results ----
  const allResults = [];
  if (on('results') || on('summary')) {
    if (on('results')) children.push(h1(`${++sec}. Test Results`));
    const lcOrder = [...p.loadCases.map(l => l.id), ''];
    const passes = [...p.passes].sort((a, b) => lcOrder.indexOf(a.loadCaseId) - lcOrder.indexOf(b.loadCaseId) || String(a.startLocal).localeCompare(String(b.startLocal)));
    for (const [pi, pass] of passes.entries()) {
      onProgress(`Pass ${pi + 1} of ${passes.length}`);
      const r = await processPass(pass);
      if (!r) continue;
      allResults.push({ pass, r });
      if (!on('results')) continue;
      const lc = loadCaseById(pass.loadCaseId);
      children.push(h2(`${passLabel(pass)}${lc && lc.description ? ' – ' + lc.description : ''}${lc && lc.speed && !/crawl/i.test(lc.speed) ? ' (' + lc.speed + ')' : ''}`));
      if (pass.notes) children.push(para(pass.notes, { italics: true }));
      for (const [vi, res] of r.results.entries()) {
        const vname = res.vehicle ? res.vehicle.name : `Vehicle ${vi + 1}`;
        if (r.results.length > 1) children.push(h3(vname));
        const usePos = res.win.knots.length > 0;
        const x = usePos ? 'pos' : 'time';
        const strainSet = r.gauges.filter(isStrain);
        let groups;
        const mode = rep.plotMode || 'group';
        if (mode === 'dist') groups = [['__dist', 'distribution gauges']];
        else if (mode === 'all' || strainSet.length <= 10) groups = [['__all', 'all strain gauges']];
        else groups = [...new Set(strainSet.map(g => groupKey(g, set.groupBy)))].map(g => [g, g]);
        for (const [gkey, gname] of groups) {
          const spec = buildSpec(pass, r, { x, vehicle: vi, qty: 'strain', group: gkey }, { noLog: true, noClickLabels: true });
          if (!spec.series.length) continue;
          if (!usePos) spec.series.forEach(s => { s.y = s.y.subarray(res.i0, res.i1); }), spec.x = r.time.subarray(res.i0, res.i1);
          const png = await plotPng(spec);
          children.push(image(png, 620, 318), caption('Figure', `${passLabel(pass)}, ${vname}: strain vs ${usePos ? 'front axle position' : 'time'} – ${gname}`));
        }
        if (rep.includeDefl !== false && r.gauges.some(isDefl)) {
          const spec = buildSpec(pass, r, { x, vehicle: vi, qty: 'defl', group: '__all' }, { noLog: true, noClickLabels: true });
          if (!usePos) spec.series.forEach(s => { s.y = s.y.subarray(res.i0, res.i1); }), spec.x = r.time.subarray(res.i0, res.i1);
          const png = await plotPng(spec);
          children.push(image(png, 620, 318), caption('Figure', `${passLabel(pass)}, ${vname}: deflection vs ${usePos ? 'front axle position' : 'time'}`));
        }
        if (res.dist) {
          const d = res.dist;
          children.push(caption('Table', `${passLabel(pass)}, ${vname}: load distribution at ${br.distSection || 'section'} (t = ${fmt(d.tPeak, 2)} s${isFinite(d.xPeak) ? ', front axle at ' + fmt(d.xPeak, 1) + ' ft' : ''})`));
          children.push(table(['Gauge', 'Girder', 'Offset (ft)', 'Strain (µε)', 'Distribution (%)'],
            d.rows.map(x => [x.name, x.girder || '', fmt(x.offset, 2), fmt(x.strain, 1), fmt(x.df * 100, 1)]).concat([['Sum', '', '', fmt(d.sum, 1), '100.0']]), [2, 3, 4]));
          if (br.type === 'slab') children.push(para(`Equivalent strip width = ${fmt(d.stripWidth, 2)} ft.`, { bold: true }));
        }
        const pkRows = strainSet.map(g => { const pk = res.peaks[g.serial]; return pk ? [gaugeName(g), [g.girder, g.location].filter(Boolean).join(' '), fmt(pk.max, 1), fmt(pk.min, 1), fmt(Math.max(Math.abs(pk.max), Math.abs(pk.min)) * r.E * 1e-6, 2)] : null; }).filter(Boolean);
        if (pkRows.length && rep.includePeakTables !== false) {
          children.push(caption('Table', `${passLabel(pass)}, ${vname}: peak strains`));
          children.push(table(['Gauge', 'Location', 'Max (µε)', 'Min (µε)', '|σ| max (ksi)'], pkRows, [2, 3, 4]));
        }
        const dRows = r.gauges.filter(isDefl).map(g => { const pk = res.peaks[g.serial]; return pk ? [gaugeName(g), [g.girder, g.location].filter(Boolean).join(' '), fmt(pk.max, 4), fmt(pk.min, 4)] : null; }).filter(Boolean);
        if (dRows.length && rep.includePeakTables !== false) {
          children.push(caption('Table', `${passLabel(pass)}, ${vname}: peak deflections`));
          children.push(table(['Transducer', 'Location', 'Max (in)', 'Min (in)'], dRows, [2, 3]));
        }
      }
    }
  }

  // ---- 8 Summary ----
  if (on('summary') && allResults.length) {
    onProgress('Summary');
    children.push(h1(`${++sec}. Summary of Results`));
    // Envelope of peak strain per gauge
    const env = new Map();
    for (const { pass, r } of allResults) for (const res of r.results) for (const g of r.gauges) {
      const pk = res.peaks[g.serial]; if (!pk) continue;
      const e = env.get(g.serial) || { g, max: -Infinity, min: Infinity, maxAt: '', minAt: '' };
      const who = `${passLabel(pass)}${r.results.length > 1 && res.vehicle ? ' / ' + res.vehicle.name : ''}`;
      if (pk.max > e.max) { e.max = pk.max; e.maxAt = who; }
      if (pk.min < e.min) { e.min = pk.min; e.minAt = who; }
      env.set(g.serial, e);
    }
    const envS = [...env.values()].filter(e => isStrain(e.g));
    if (envS.length) {
      children.push(caption('Table', 'Maximum and minimum measured strain for each gauge (all passes)'));
      children.push(table(['Gauge', 'Location', 'Max (µε)', 'Pass', 'Min (µε)', 'Pass'], sortGauges(envS.map(e => e.g), set.sortBy).map(g => { const e = env.get(g.serial); return [gaugeName(g), [g.girder, g.location, g.section].filter(Boolean).join(' '), fmt(e.max, 1), e.maxAt, fmt(e.min, 1), e.minAt]; }), [2, 4]));
    }
    const envD = [...env.values()].filter(e => isDefl(e.g));
    if (envD.length) {
      children.push(caption('Table', 'Maximum and minimum measured deflection (all passes)'));
      children.push(table(['Transducer', 'Location', 'Max (in)', 'Pass', 'Min (in)', 'Pass'], envD.map(e => [gaugeName(e.g), [e.g.girder, e.g.location].filter(Boolean).join(' '), fmt(e.max, 4), e.maxAt, fmt(e.min, 4), e.minAt]), [2, 4]));
    }
    // Distribution summary
    const distRows = [];
    let distCols = null;
    for (const { pass, r } of allResults) for (const res of r.results) {
      if (!res.dist) continue;
      if (!distCols) distCols = res.dist.rows.map(x => x.girder || x.name);
      distRows.push([passLabel(pass), res.vehicle ? res.vehicle.name : '', ...res.dist.rows.map(x => fmt(x.df * 100, 1)), ...(br.type === 'slab' ? [fmt(res.dist.stripWidth, 2)] : [])]);
    }
    if (distRows.length) {
      children.push(caption('Table', br.type === 'slab' ? 'Load distribution (%) and equivalent strip width for each pass and vehicle' : 'Girder load distribution (%) for each pass and vehicle'));
      const head = ['Pass', 'Vehicle', ...distCols, ...(br.type === 'slab' ? ['Strip width (ft)'] : [])];
      children.push(table(head, distRows.map(r => r.concat(Array(Math.max(0, head.length - r.length)).fill(''))).map(r => r.slice(0, head.length)), head.map((_, i) => i).filter(i => i >= 2)));
    }
    // Dynamic amplification
    const dynRows = [];
    for (const lc of p.loadCases.filter(l => l.crawlRef)) {
      const ref = loadCaseById(lc.crawlRef); if (!ref) continue;
      const maxFor = (lcId, vehId) => {
        let m = -Infinity;
        for (const { pass, r } of allResults) if (pass.loadCaseId === lcId) for (const res of r.results) if (!vehId || res.win.vehicleId === vehId) for (const g of r.gauges) if (g.dist && res.peaks[g.serial]) m = Math.max(m, res.peaks[g.serial].max);
        return m;
      };
      for (const vid of (lc.vehicleIds || [''])) {
        const dyn = maxFor(lc.id, vid), st = maxFor(ref.id, vid);
        if (isFinite(dyn) && isFinite(st) && st > 0) dynRows.push([lc.name + (lc.speed ? ` (${lc.speed})` : ''), ref.name, vehicleById(vid)?.name || '', fmt(st, 1), fmt(dyn, 1), fmt((dyn / st - 1) * 100, 1)]);
      }
    }
    if (dynRows.length) {
      children.push(caption('Table', 'Dynamic amplification (maximum distribution-gauge strain, speed pass vs crawl pass)'));
      children.push(table(['Speed pass', 'Crawl pass', 'Vehicle', 'Crawl max (µε)', 'Speed max (µε)', 'Amplification (%)'], dynRows, [3, 4, 5]));
    }
  }

  // ---- 9 Observations ----
  if (on('observations')) {
    const notes = [...p.log].filter(e => e.kind !== 'photo').sort((a, b) => new Date(a.ts) - new Date(b.ts));
    children.push(h1(`${++sec}. Field Observations`));
    if (notes.length) {
      children.push(caption('Table', 'Field log'));
      children.push(table(['Time', 'Type', 'Load case', 'Note'], notes.map(e => [new Date(e.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }), e.tag, loadCaseById(e.loadCaseId)?.name || '', [e.gauge ? `[${e.gauge}]` : '', e.text].filter(Boolean).join(' ')])));
    } else children.push(para('[No field notes were recorded.]'));
    for (const ps of p.passes.filter(x => x.notes)) children.push(para(`${ps.name}: ${ps.notes}`));
  }

  // ---- 10 Conclusions ----
  if (on('conclusions')) {
    children.push(h1(`${++sec}. Conclusions`));
    children.push(...multi(rep.conclusions || '[Summarize the measured response, load distribution, comparison with design/rating assumptions, and recommendations.]'));
  }

  // ---- Appendix photos ----
  const photos = p.log.filter(e => e.kind === 'photo').sort((a, b) => new Date(a.ts) - new Date(b.ts));
  if (on('photos') && photos.length) {
    onProgress('Photographs');
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(h1('Appendix A – Photographs'));
    const cellsOut = [];
    for (const e of photos) {
      const rec = await db.get('photos', e.photoId); if (!rec) continue;
      const data = new Uint8Array(await rec.blob.arrayBuffer());
      const w = rec.w || 4, h = rec.h || 3;
      const maxW = 300, maxH = 230; const sc = Math.min(maxW / w, maxH / h);
      const capText = [e.tag, e.gauge && `gauge ${e.gauge}`, loadCaseById(e.loadCaseId)?.name, e.text].filter(Boolean).join(' – ');
      fig++;
      cellsOut.push(new TableCell({
        borders: { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } },
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data, transformation: { width: Math.round(w * sc), height: Math.round(h * sc) } })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Figure ${fig}. `, bold: true, size: 18 }), new TextRun({ text: `${capText} (${new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`, size: 18 })] })],
      }));
    }
    const rows = [];
    for (let i = 0; i < cellsOut.length; i += 2) rows.push(new TableRow({ cantSplit: true, children: [cellsOut[i], cellsOut[i + 1] || new TableCell({ borders: { top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } }, children: [new Paragraph('')] })] }));
    if (rows.length) children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows }));
  }

  // ---- Appendix files ----
  if (on('files') && p.passes.length) {
    children.push(h1(`Appendix ${on('photos') && photos.length ? 'B' : 'A'} – Data Files`));
    children.push(table(['Pass', 'File', 'Samples', 'Rate (Hz)', 'Marks', 'Channels'], p.passes.map(ps => [ps.name, ps.fileName, ps.nSamples, ps.sampleRate, ps.clicks.length, ps.channels.length]), [2, 3, 4, 5]));
  }

  onProgress('Building document');
  const doc = new Document({
    creator: rep.author || 'Bridge Load Test app', title: rep.title, description: bridgeName,
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: 'Calibri', size: 22 } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 32, bold: true, color: '1F4E79' }, paragraph: { spacing: { before: 240, after: 120 } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 26, bold: true, color: '1F4E79' }, paragraph: { spacing: { before: 200, after: 100 } } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 23, bold: true, color: '404040' } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: bridgeName, size: 16, color: '777777' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 18, color: '777777' })] })] }) },
      children,
    }],
  });
  return Packer.toBlob(doc);
}
