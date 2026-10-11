/* 把生成的户型渲染成 PNG，用于肉眼核对（墙=深灰实心，窗=蓝，门=红，房间=淡色填充+名字点位） */
const fs = require('fs');
const zlib = require('zlib');
global.window = {};
const CP = require('./cp-core.js');
require('./cp-dxf.js');

/* ---- 1. 走一遍完整管线 ---- */
const dxf = CP.parseDXF(fs.readFileSync('文昌.utf8.dxf', 'utf8'));
const prims = CP.toPrims(dxf);
const guess = CP.guessLayers(prims), map = {};
for (const [n] of Object.entries(dxf.layers)) { const c = CP.classifyLayer(n); map[n] = c === '?' ? (guess[n] || 'ignore') : c; }
const d = CP.buildDraft(prims, map, { scale: 1, thickness: 200, gapDoor: true, textDoor: true });
const area = r => Math.abs(r.poly.reduce((s, q, i) => { const n = r.poly[(i + 1) % r.poly.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;
d.rooms.forEach((r, i) => { r.name = 'R' + (i + 1); });
const plan = CP.finalize({ ...d, id: 'x', name: 'x', src: 'dxf' });
fs.writeFileSync('plan-wenchang.json', JSON.stringify(plan, null, 1));

/* ---- 2. 栅格化 ---- */
const B = plan.bounds;
const W = 1100, pad = 30;
const sc = (W - pad * 2) / B.w, H = Math.round(B.h * sc) + pad * 2;
const px = x => pad + (x - B.x) * sc, py = y => pad + (y - B.y) * sc;   // Furnish: Y 向下
const buf = Buffer.alloc(W * H * 3, 0xf2);
const put = (x, y, c) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
};
const box = (r, c) => {
  for (let y = py(r[1]); y <= py(r[3]); y++) for (let x = px(r[0]); x <= px(r[2]); x++) put(x, y, c);
};
const polyFill = (poly, c) => {
  const ys = poly.map(p => p[1]), xs = poly.map(p => p[0]);
  for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.5) {
    const hit = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      if ((a[1] > y) !== (b[1] > y)) hit.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
    }
    hit.sort((m, n) => m - n);
    for (let k = 0; k + 1 < hit.length; k += 2) for (let x = hit[k]; x <= hit[k + 1]; x += 0.5) put(px(x), py(y), c);
  }
};
const polyLine = (poly, c) => {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(px(b[0]) - px(a[0]), py(b[1]) - py(a[1]))));
    for (let k = 0; k <= n; k++) put(px(a[0]) + (b[0] - a[0]) * k / n, py(a[1]) + (b[1] - a[1]) * k / n, c);
  }
};
const RC = [[255, 236, 200], [206, 232, 255], [220, 255, 220], [255, 220, 235], [235, 225, 255]];
plan.rooms.forEach((r, i) => polyFill(r.poly, RC[i % RC.length]));
plan.walls.forEach(w => box(w.slice(0, 4), [70, 70, 78]));
plan.wins.forEach(w => box(w.rect, [30, 130, 235]));
plan.doors.forEach(o => box(o.rect, [225, 60, 60]));
plan.rooms.forEach(r => { polyLine(r.poly, [150, 90, 60]); for (let i = -4; i <= 4; i++) { put(px(r.at[0]) + i, py(r.at[1]), [200, 30, 30]); put(px(r.at[0]), py(r.at[1]) + i, [200, 30, 30]); } });

/* ---- 3. PNG ---- */
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; buf.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync('plan-final.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log('plan-final.png', W + 'x' + H, ' 房间', plan.rooms.length, ' 窗宽:', plan.wins.map(w => Math.round(Math.max(w.rect[2] - w.rect[0], w.rect[3] - w.rect[1]))).join(','));
