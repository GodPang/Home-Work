/* 诊断：打印识别出的窗，以及原始 细线/窗外 图层上的线段（按包围盒坐标） */
const fs = require('fs');
global.window = {};
const CP = require('./cp-core.js');
require('./cp-dxf.js');
const dxf = CP.parseDXF(fs.readFileSync('文昌.utf8.dxf', 'utf8'));
const prims = CP.toPrims(dxf);
const guess = CP.guessLayers(prims), map = {};
for (const [n] of Object.entries(dxf.layers)) { const c = CP.classifyLayer(n); map[n] = c === '?' ? (guess[n] || 'ignore') : c; }
console.log('图层归类:'); for (const [n, c] of Object.entries(map)) console.log('   ', JSON.stringify(n), '->', c);
const d = CP.buildDraft(prims, map, { scale: 1, thickness: 200, gapDoor: true, textDoor: true });
const plan = CP.finalize({ ...d, id: 'x', name: 'x', src: 'dxf' });
const R = r => r.map(Math.round).join(',');
console.log('\n=== 原始 细线 / 窗外 线段（仅长>200）===');
for (const p of prims) {
  if (!/细线|窗外/.test(p.layer || '')) continue;
  if (p.t !== 'line') continue;
  const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
  if (len < 200) continue;
  console.log('  [' + (p.layer === '细线' ? '细线' : '窗外') + ']', R([p.x1, p.y1, p.x2, p.y2]), 'len=' + Math.round(len));
}
console.log('\n=== 识别出的窗 ===');
plan.wins.forEach((w, i) => console.log('  #' + i, R(w.rect), 'w=' + Math.round(Math.max(w.rect[2] - w.rect[0], w.rect[3] - w.rect[1])), 'sill=' + w.sill));
console.log('\n=== 识别出的墙（含坐标）===');
plan.walls.forEach((w, i) => console.log('  #' + i, R(w.slice(0, 4)), 't=' + Math.round(Math.min(w[2] - w[0], w[3] - w[1]))));
console.log('\n=== 门 ===');
plan.doors.forEach((d2, i) => console.log('  #' + i, d2.name, R(d2.rect)));
