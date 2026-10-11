/* DXF → PNG 预览：自绘栅格化 + 手写 PNG 编码，零依赖，仅用于探查图纸结构 */
const fs = require('fs');
const zlib = require('zlib');

function parseDXF(text) {
  const lines = text.split(/\r\n|\n/);
  const ents = [];
  let inEnt = false, cur = null;
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = lines[i].trim(), val = lines[i + 1];
    if (code === '2' && val === 'ENTITIES') { inEnt = true; continue; }
    if (code === '0' && val === 'ENDSEC') { inEnt = false; continue; }
    if (code === '0' && val === 'EOF') break;
    if (!inEnt) continue;
    if (code === '0') { cur = { type: val, layer: '0', verts: [] }; ents.push(cur); continue; }
    if (!cur) continue;
    if (cur.type === 'HATCH') {
      if (code === '92') { cur.paths = cur.paths || []; cur.paths.push({ flag: +val, verts: [], closed: false }); cur.poly = !!(+val & 2); cur.buf = null; }
      else if (code === '73' && cur.poly && cur.paths && cur.paths.length) { cur.paths[cur.paths.length - 1].closed = !!+val; }
      else if (code === '10' && cur.poly && cur.paths && cur.paths.length) { cur.buf = +val; }
      else if (code === '20' && cur.poly && cur.buf != null && cur.paths && cur.paths.length) { cur.paths[cur.paths.length - 1].verts.push([cur.buf, +val]); cur.buf = null; }
      else if (code === '97') { cur.poly = false; cur.buf = null; }
      continue;
    }
    switch (code) {
      case '8': cur.layer = val; break;
      case '10': cur.x = +val; cur.pending = [cur.x]; break;
      case '20': cur.y = +val; if (cur.pending) cur.verts.push([cur.pending[0], cur.y]); break;
      case '11': cur.x1 = +val; break;
      case '21': cur.y1 = +val; break;
      case '40': cur.r = +val; break;
      case '1': case '3': cur.text = (cur.text || '') + val; break;
      case '70': cur.flags = +val; break;
      case '42': cur.bulge = +val; break;
    }
  }
  return ents;
}

function render(ents, opts) {
  const W = opts.W || 1000, H = opts.H || 1000, pad = opts.pad || 40;
  const cols = opts.colors || {};
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const use = ents.filter(e => !opts.layers || opts.layers.includes(e.layer));
  if (opts.crop) { [x0, y0, x1, y1] = opts.crop; }
  const expand = e => {
    if (opts.crop) return;
    const ps = [];
    if (e.type === 'LINE') ps.push([e.x, e.y], [e.x1, e.y1]);
    else if (e.type === 'LWPOLYLINE') ps.push(...e.verts);
    else if (e.type === 'HATCH' && e.paths) e.paths.forEach(p => ps.push(...p.verts));
    else if (e.type === 'CIRCLE') ps.push([e.x - e.r, e.y - e.r], [e.x + e.r, e.y + e.r]);
    else if (e.type === 'INSERT' || e.type === 'TEXT' || e.type === 'MTEXT') ps.push([e.x, e.y]);
    ps.forEach(p => { if (isFinite(p[0]) && isFinite(p[1])) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } });
  };
  use.forEach(expand);
  const sc = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1));
  const ox = pad + ((W - pad * 2) - (x1 - x0) * sc) / 2, oy = pad + ((H - pad * 2) - (y1 - y0) * sc) / 2;
  const px = x => ox + (x - x0) * sc, py = opts.yDown ? (y => oy + (y - y0) * sc) : (y => H - (oy + (y - y0) * sc));
  const buf = Buffer.alloc(W * H * 3, 0xff);
  const put = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
  };
  const line = (a, b, c, w) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.7));
    for (let i = 0; i <= n; i++) put(a[0] + dx * i / n, a[1] + dy * i / n, c);
  };
  use.forEach(e => {
    const c = cols[e.layer] || [120, 120, 120];
    if (e.type === 'LINE') line([px(e.x), py(e.y)], [px(e.x1), py(e.y1)], c);
    else if (e.type === 'LWPOLYLINE') {
      for (let i = 0; i + 1 < e.verts.length; i++) line([px(e.verts[i][0]), py(e.verts[i][1])], [px(e.verts[i + 1][0]), py(e.verts[i + 1][1])], c);
      if (e.flags & 1 && e.verts.length > 2) line([px(e.verts[e.verts.length - 1][0]), py(e.verts[e.verts.length - 1][1])], [px(e.verts[0][0]), py(e.verts[0][1])], c);
    } else if (e.type === 'HATCH' && e.paths) {
      e.paths.forEach(p => {
        for (let i = 0; i + 1 < p.verts.length; i++) line([px(p.verts[i][0]), py(p.verts[i][1])], [px(p.verts[i + 1][0]), py(p.verts[i + 1][1])], c);
        if (p.closed && p.verts.length > 2) line([px(p.verts[p.verts.length - 1][0]), py(p.verts[p.verts.length - 1][1])], [px(p.verts[0][0]), py(p.verts[0][1])], c);
        if (opts.fill) {
          const xs = p.verts.map(v => v[0]), ys = p.verts.map(v => v[1]);
          for (let yy = Math.min(...ys); yy <= Math.max(...ys); yy += (y1 - y0) / 900) {
            let hit = [];
            for (let i = 0; i < p.verts.length; i++) {
              const a = p.verts[i], b = p.verts[(i + 1) % p.verts.length];
              if ((a[1] > yy) !== (b[1] > yy)) hit.push(a[0] + (yy - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
            }
            hit.sort((m, n) => m - n);
            for (let k = 0; k + 1 < hit.length; k += 2) line([px(hit[k]), py(yy)], [px(hit[k + 1]), py(yy)], c);
          }
        }
      });
    } else if (e.type === 'CIRCLE') {
      for (let a = 0; a < 360; a += 3) {
        const t = a * Math.PI / 180;
        put(px(e.x) + e.r * sc * Math.cos(t), py(e.y) + e.r * sc * Math.sin(t), c);
      }
    } else if (e.type === 'INSERT') {
      for (let i = -3; i <= 3; i++) { put(px(e.x) + i, py(e.y), c); put(px(e.x), py(e.y) + i, c); }
    } else if ((e.type === 'TEXT' || e.type === 'MTEXT') && opts.texts) {
      put(px(e.x), py(e.y), c); put(px(e.x) + 1, py(e.y), c); put(px(e.x), py(e.y) + 1, c);
    }
  });
  // PNG 编码
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; buf.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const crcT = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, cr]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { parseDXF, render };

if (require.main === module) {
  const file = process.argv[2] || '文昌.utf8.dxf';
  const ents = parseDXF(fs.readFileSync(file, 'utf8'));
  const layers = [...new Set(ents.map(e => e.layer))];
  const palette = [[220, 40, 40], [40, 120, 220], [40, 170, 70], [240, 160, 20], [150, 60, 200], [20, 160, 170], [200, 100, 120], [100, 100, 100], [240, 90, 200], [90, 190, 90], [180, 140, 40], [60, 80, 200]];
  const cols = {}; layers.forEach((l, i) => cols[l] = palette[i % palette.length]);
  console.log('图层配色:');
  layers.forEach((l, i) => console.log('  ' + JSON.stringify(l) + ' -> rgb(' + cols[l].join(',') + ')'));
  fs.writeFileSync('preview-all.png', render(ents, { colors: cols, texts: true }));
  console.log('written preview-all.png');
}
