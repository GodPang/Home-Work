/* 校验 cp-preset.js：字段完整性、门窗是否贴在墙上、房间是否闭合、数据是否与内置户型同构 */
const fs = require('fs');
global.window = {};
const CP = require('./cp-core.js');

// 模拟浏览器环境加载 cp-preset.js
const PLANS = [];
global.PLANS = PLANS;
global.buildPlanList = () => {};
global.document = { readyState: 'complete', addEventListener() {} };
const src = fs.readFileSync('cp-preset.js', 'utf8');
new Function('window', 'CP', 'PLANS', 'buildPlanList', 'document', src)
  (global.window, CP, PLANS, global.buildPlanList, global.document);

console.log('注入数量:', PLANS.length);
const p = PLANS[0];
if (!p) { console.log('❌ 未注入'); process.exit(1); }

/* 与内置户型对比字段 */
const BUILTIN = ['id', 'name', 'en', 'note', 'noteEn', 'walls', 'wins', 'doors', 'slides', 'rooms', 'dims', 'defaults', 'bounds'];
const missing = BUILTIN.filter(k => !(k in p));
console.log('字段缺失:', missing.length ? missing.join(',') : '无 ✓');
console.log('walls 元素格式:', JSON.stringify(p.walls[0]));
console.log('wins 元素格式:', JSON.stringify(p.wins[0]));
console.log('doors 元素格式:', JSON.stringify(p.doors[0]));
console.log('rooms 元素字段:', Object.keys(p.rooms[0]).join(','));
console.log('rooms 多边形方向:', p.rooms.map(r => {
  let a = 0; for (let k = 0; k < r.poly.length; k++) { const q = r.poly[k], n = r.poly[(k + 1) % r.poly.length]; a += q[0] * n[1] - n[0] * q[1]; }
  return a > 0 ? '顺时针' : '逆时针✗';
}).join(' '));

/* 几何检查 */
const b = CP.rectsBBox(p.walls);
const insideBB = r => r[0] >= b.x0 - 1 && r[1] >= b.y0 - 1 && r[2] <= b.x1 + 1 && r[3] <= b.y1 + 1;
const wp = p.walls.map(w => [w[0], w[1], w[2], w[3]]);
// 窗/门应嵌在某面同向墙上（沿墙长方向相邻或重叠，沿墙厚方向重合）
const nearWall = r => {
  const hz = (r[2] - r[0]) > (r[3] - r[1]);
  return wp.some(w => {
    const whz = (w[2] - w[0]) > (w[3] - w[1]);
    if (hz !== whz) return false;
    return hz
      ? (Math.min(r[2], w[2]) - Math.max(r[0], w[0]) > -60) && (Math.min(r[3], w[3]) - Math.max(r[1], w[1]) > 100)
      : (Math.min(r[3], w[3]) - Math.max(r[1], w[1]) > -60) && (Math.min(r[2], w[2]) - Math.max(r[0], w[0]) > 100);
  });
};
const inPoly = (x, y, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi) c = !c;
  }
  return c;
};
console.log('窗都贴在墙上:', p.wins.every(w => nearWall(w.rect)) ? '✓' : '✗');
console.log('门都贴在墙上:', p.doors.every(d => nearWall(d.rect)) ? '✓' : '✗');
console.log('全部在图内:', [...p.walls.map(w => [w[0], w[1], w[2], w[3]]), ...p.wins.map(w => w.rect), ...p.doors.map(d => d.rect)].every(insideBB) ? '✓' : '✗');

const area = poly => Math.abs(poly.reduce((s, q, i) => { const n = poly[(i + 1) % poly.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2 / 1e6;
console.log('房间:', p.rooms.map(r => `${r.name}(${r.mat}) ${area(r.poly).toFixed(2)}㎡ 标签[${r.at}]`).join('  '));
console.log('房间总面积:', p.rooms.reduce((s, r) => s + area(r.poly), 0).toFixed(2), '㎡');
console.log('户型外框:', ((b.x1 - b.x0) / 1000).toFixed(2), '×', ((b.y1 - b.y0) / 1000).toFixed(2), 'm');
console.log('bounds:', JSON.stringify(p.bounds));
console.log('校验(validate):', JSON.stringify(CP.validate(p)));

/* 房间标签必须落在自己的多边形内 */
console.log('标签都在房间内:', p.rooms.every(r => inPoly(r.at[0], r.at[1], r.poly)) ? '✓' : '✗');
/* 门窗尺寸合理性 */
console.log('窗宽范围:', Math.min(...p.wins.map(w => Math.max(w.rect[2] - w.rect[0], w.rect[3] - w.rect[1]))), '~', Math.max(...p.wins.map(w => Math.max(w.rect[2] - w.rect[0], w.rect[3] - w.rect[1]))));
console.log('门宽范围:', Math.min(...p.doors.map(d => d.len)), '~', Math.max(...p.doors.map(d => d.len)));

/* 材质键必须是 index.html 里 MATS 的合法键，否则成本面板会读到 undefined */
const MATS = ['wood', 'walnut', 'tile800', 'tile600', 'marble', 'antislip', 'terrazzo', 'carpet'];
const badMat = p.rooms.filter(r => !MATS.includes(r.mat)).map(r => r.name + '=' + r.mat);
console.log('材质键合法:', badMat.length ? '✗ ' + badMat.join(', ') : '✓');
/* 门窗数量与长度不能为 0，否则 Furnish 的渲染会出问题 */
console.log('至少有 1 面墙/1 个房间:', p.walls.length > 0 && p.rooms.length > 0 ? '✓' : '✗');
console.log('恰好一个入户门:', p.doors.filter(d => d.entry).length === 1 ? '✓' : '✗');
