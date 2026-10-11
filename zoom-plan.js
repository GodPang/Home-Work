/* 放大渲染某个区域，检查墙是否闭合。用法: node zoom-plan.js x0 y0 x1 y1 out.png */
const fs = require('fs');
const zlib = require('zlib');
const plan = require('./plan-wenchang.json');

const [X0, Y0, X1, Y1] = process.argv.slice(2, 6).map(Number);
const OUT = process.argv[6] || 'zoom.png';
const W = 1000, pad = 24;
const sc = (W - pad * 2) / (X1 - X0), H = Math.round((Y1 - Y0) * sc) + pad * 2;
const px = x => pad + (x - X0) * sc, py = y => pad + (y - Y0) * sc;
const buf = Buffer.alloc(W * H * 3, 0xf4);
const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; };
const box = (r, c) => { for (let y = py(r[1]); y <= py(r[3]); y++) for (let x = px(r[0]); x <= px(r[2]); x++) put(x, y, c); };
const RC = [[255, 236, 200], [206, 232, 255], [220, 255, 220], [255, 220, 235], [235, 225, 255]];
plan.rooms.forEach((r, i) => {
  const poly = r.poly;
  for (let y = Math.min(...poly.map(p => p[1])); y <= Math.max(...poly.map(p => p[1])); y += 1) {
    const hit = [];
    for (let k = 0; k < poly.length; k++) { const a = poly[k], b = poly[(k + 1) % poly.length]; if ((a[1] > y) !== (b[1] > y)) hit.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    hit.sort((m, n) => m - n);
    for (let k = 0; k + 1 < hit.length; k += 2) for (let x = hit[k]; x <= hit[k + 1]; x += 1) put(px(x), py(y), RC[i % RC.length]);
  }
});
plan.wins.forEach(w => box(w.rect, [30, 130, 235]));
plan.doors.forEach(o => box(o.rect, [225, 60, 60]));
plan.walls.forEach(w => box(w.slice(0, 4), [60, 60, 68]));
plan.rooms.forEach(r => { const p = r.poly; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; const n = Math.max(1, Math.ceil(Math.hypot(px(b[0]) - px(a[0]), py(b[1]) - py(a[1])))); for (let k = 0; k <= n; k++) put(px(a[0]) + (b[0] - a[0]) * k / n, py(a[1]) + (b[1] - a[1]) * k / n, [150, 90, 60]); } });
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; buf.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(OUT, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(OUT, W + 'x' + H, '区域', X0, Y0, X1, Y1);
