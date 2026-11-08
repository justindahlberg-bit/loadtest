// Reader for National Instruments TDMS files as written by BDI STS-Live.
// Parses every segment, collects channel data, properties, and SoftClick markers.

const TOC_META = 1 << 1, TOC_NEWOBJ = 1 << 2, TOC_RAW = 1 << 3, TOC_INTERLEAVED = 1 << 5, TOC_BIGENDIAN = 1 << 6, TOC_DAQMX = 1 << 7;

const TYPE_SIZE = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 1, 6: 2, 7: 4, 8: 8, 9: 4, 10: 8, 0x19: 4, 0x1A: 8, 0x21: 1, 0x44: 16 };
const TDMS_EPOCH_MS = Date.UTC(1904, 0, 1);

function readValue(view, off, type, le) {
  switch (type) {
    case 1: return [view.getInt8(off), 1];
    case 2: return [view.getInt16(off, le), 2];
    case 3: return [view.getInt32(off, le), 4];
    case 4: return [Number(view.getBigInt64(off, le)), 8];
    case 5: return [view.getUint8(off), 1];
    case 6: return [view.getUint16(off, le), 2];
    case 7: return [view.getUint32(off, le), 4];
    case 8: return [Number(view.getBigUint64(off, le)), 8];
    case 9: case 0x19: return [view.getFloat32(off, le), 4];
    case 10: case 0x1A: return [view.getFloat64(off, le), 8];
    case 0x21: return [view.getUint8(off) !== 0, 1];
    case 0x44: {
      // fractions (uint64, units of 2^-64 s) then seconds since 1904 (int64), little-endian
      const frac = Number(view.getBigUint64(off, le)) / 2 ** 64;
      const sec = Number(view.getBigInt64(off + 8, le));
      return [new Date(TDMS_EPOCH_MS + (sec + frac) * 1000), 16];
    }
    default: throw new Error('Unsupported TDMS data type 0x' + type.toString(16));
  }
}

function parsePath(path) {
  // "/" -> root, "/'Group'" -> group, "/'Group'/'Channel'" -> channel. Quotes inside names are doubled.
  const parts = [];
  const re = /\/'((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(path))) parts.push(m[1].replace(/''/g, "'"));
  return parts;
}

export function parseTdms(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const dec = new TextDecoder('utf-8');
  const objects = new Map(); // path -> {path, props, index, chunks: []}
  let active = []; // ordered list of paths with raw data in current segment
  let pos = 0;
  const total = buffer.byteLength;
  if (total < 28) throw new Error('File is empty or too short to be a TDMS file.');

  while (pos + 28 <= total) {
    const tag = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    if (tag !== 'TDSm') {
      if (pos === 0) throw new Error('Not a TDMS file (missing TDSm header).');
      break;
    }
    const toc = view.getUint32(pos + 4, true);
    const le = !(toc & TOC_BIGENDIAN);
    let nextOff = view.getBigUint64(pos + 12, le);
    const rawOff = Number(view.getBigUint64(pos + 20, le));
    const segStart = pos + 28;
    let segEnd = nextOff === 0xFFFFFFFFFFFFFFFFn ? total : segStart + Number(nextOff);
    if (segEnd > total) segEnd = total; // truncated file (e.g. recording interrupted)
    if (toc & TOC_DAQMX) throw new Error('DAQmx raw data segments are not supported.');

    if (toc & TOC_NEWOBJ) active = [];
    let o = segStart;
    if (toc & TOC_META) {
      const nObj = view.getUint32(o, le); o += 4;
      for (let i = 0; i < nObj; i++) {
        const plen = view.getUint32(o, le); o += 4;
        const path = dec.decode(bytes.subarray(o, o + plen)); o += plen;
        let obj = objects.get(path);
        if (!obj) { obj = { path, props: {}, index: null, chunks: [], count: 0 }; objects.set(path, obj); }
        const idxLen = view.getUint32(o, le); o += 4;
        if (idxLen === 0xFFFFFFFF) {
          active = active.filter(p => p !== path);
        } else if (idxLen === 0) {
          if (!active.includes(path)) active.push(path);
        } else {
          const dtype = view.getUint32(o, le);
          const dim = view.getUint32(o + 4, le);
          const nvals = Number(view.getBigUint64(o + 8, le));
          let size = null;
          if (dtype === 0x20) size = Number(view.getBigUint64(o + 16, le));
          obj.index = { dtype, dim, nvals, size };
          o += idxLen - 4;
          if (!active.includes(path)) active.push(path);
        }
        const nProps = view.getUint32(o, le); o += 4;
        for (let j = 0; j < nProps; j++) {
          const nlen = view.getUint32(o, le); o += 4;
          const name = dec.decode(bytes.subarray(o, o + nlen)); o += nlen;
          const ptype = view.getUint32(o, le); o += 4;
          let val;
          if (ptype === 0x20) {
            const slen = view.getUint32(o, le); o += 4;
            val = dec.decode(bytes.subarray(o, o + slen)); o += slen;
          } else {
            const [v, n] = readValue(view, o, ptype, le); val = v; o += n;
          }
          obj.props[name] = val;
        }
      }
    }

    if ((toc & TOC_RAW) && active.length) {
      const dataStart = segStart + rawOff;
      const chans = active.map(p => objects.get(p)).filter(ob => ob.index && ob.index.nvals > 0);
      let chunkSize = 0;
      for (const ch of chans) {
        if (ch.index.dtype === 0x20) throw new Error('String channel data is not supported.');
        chunkSize += ch.index.nvals * TYPE_SIZE[ch.index.dtype];
      }
      if (chunkSize > 0) {
        const nChunks = Math.floor((segEnd - dataStart) / chunkSize);
        let d = dataStart;
        for (let c = 0; c < nChunks; c++) {
          if (toc & TOC_INTERLEAVED) {
            const n = chans[0].index.nvals;
            const arrs = chans.map(ch => new Float64Array(n));
            for (let k = 0; k < n; k++) {
              chans.forEach((ch, ci) => { const [v, s] = readValue(view, d, ch.index.dtype, le); arrs[ci][k] = v; d += s; });
            }
            chans.forEach((ch, ci) => { ch.chunks.push(arrs[ci]); ch.count += n; });
          } else {
            for (const ch of chans) {
              const n = ch.index.nvals, t = ch.index.dtype, sz = TYPE_SIZE[t];
              const arr = new Float64Array(n);
              if (t === 10 && le) { for (let k = 0; k < n; k++) arr[k] = view.getFloat64(d + k * 8, true); }
              else { for (let k = 0; k < n; k++) arr[k] = readValue(view, d + k * sz, t, le)[0]; }
              d += n * sz;
              ch.chunks.push(arr); ch.count += n;
            }
          }
        }
      }
    }
    if (segEnd <= pos) break;
    pos = segEnd;
  }

  // Assemble output
  const result = { props: {}, groups: [], channels: [] };
  for (const obj of objects.values()) {
    const parts = parsePath(obj.path);
    if (obj.path === '/') { result.props = obj.props; continue; }
    if (parts.length === 1) { result.groups.push({ name: parts[0], props: obj.props }); continue; }
    if (parts.length === 2) {
      const data = new Float64Array(obj.count);
      let k = 0;
      for (const c of obj.chunks) { data.set(c, k); k += c.length; }
      result.channels.push({ group: parts[0], name: parts[1], props: obj.props, data });
    }
  }
  return result;
}

// Convert a parsed BDI STS-Live file into a pass record used by the app.
export function toPass(parsed, fileName) {
  const p = parsed.props;
  const sensorGroup = parsed.groups.find(g => /^Sensors/i.test(g.name)) || parsed.groups.find(g => parsed.channels.some(c => c.group === g.name && c.data.length));
  if (!sensorGroup) throw new Error('No sensor data group found in file.');
  const chans = parsed.channels.filter(c => c.group === sensorGroup.name);
  const timeCh = chans.find(c => /^time$/i.test(c.name));
  const rate = Number(sensorGroup.props['SampleRate[s/s]'] || p['SampleRate[s/s]'] || 0);
  const sensors = chans.filter(c => c !== timeCh);
  let n = Math.min(...sensors.map(c => c.data.length), timeCh ? timeCh.data.length : Infinity);
  if (!isFinite(n)) n = 0;
  let time;
  if (timeCh && timeCh.data.length >= n) time = timeCh.data.slice(0, n);
  else { time = new Float64Array(n); for (let i = 0; i < n; i++) time[i] = i / (rate || 1); }

  const clicks = parsed.channels
    .filter(c => /softclick/i.test(c.group))
    .map(c => ({ t: Number(c.props.TestTime), label: c.props.Description || '' }))
    .filter(c => isFinite(c.t))
    .sort((a, b) => a.t - b.t);

  let start = p.ActualStartTime instanceof Date ? p.ActualStartTime : null;
  const m = /@\s*(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(sensorGroup.name);
  const fm = /_(\d{2})_(\d{2})_(\d{4})_(\d{2})_(\d{2})_(\d{2})/.exec(fileName || p.name || '');
  const startText = m ? `${m[1]}:${m[2]}:${m[3]}` : '';

  return {
    fileName,
    title: p.Title || '',
    description: p.Description || '',
    projectName: p.PROJECTNAME || '',
    location: p.LOCATION || '',
    author: p.Author || '',
    sampleRate: rate,
    // Local wall-clock start from the file name (MM_DD_YYYY_HH_MM_SS), else ActualStartTime
    startLocal: fm ? `${fm[3]}-${fm[1]}-${fm[2]}T${fm[4]}:${fm[5]}:${fm[6]}` : (start ? start.toISOString() : ''),
    startText,
    time,
    channels: sensors.map(c => ({
      serial: c.props.SensorName || c.name,
      type: c.props.Type || 'Unknown',
      unit: c.props.unit_string || '',
      node: c.props.Location || '',
      data: c.data.slice(0, n),
    })),
    clicks,
  };
}
