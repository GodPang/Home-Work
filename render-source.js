/* 用同一坐标框把原始 DXF 画出来（yDown），与 plan-final.png 对照 */
const fs = require('fs');
const { parseDXF, render } = require('./peek-dxf.js');
const plan = require('./plan-wenchang.json');
const B = plan.bounds;
const ents = parseDXF(fs.readFileSync('文昌.utf8.dxf', 'utf8'));
const W = 1100, pad = 30, sc = (W - pad * 2) / B.w;
const cols = {};
const palette = { '墙体线': [20, 20, 20], '新建墙体': [200, 60, 30], '细线': [30, 130, 235], '窗外': [120, 200, 250], '0': [160, 160, 160], 'WINDOW_TEXT': [0, 160, 90], '添充': [230, 200, 120], '4体标注': [220, 120, 200], 'FF-TEXT': [140, 60, 200], '空调机电': [255, 150, 0], '6金属，其他主要构成元素（硬质）': [150, 150, 150] };
for (const e of ents) if (!cols[e.layer]) cols[e.layer] = palette[e.layer] || [190, 190, 190];
const buf = render(ents, { W, H: Math.round(B.h * sc) + pad * 2, pad, colors: cols, yDown: true, crop: [B.x, B.y, B.x + B.w, B.y + B.h], texts: true, fill: true });
fs.writeFileSync('plan-source.png', buf);
console.log('plan-source.png', B.x, B.y, B.w, B.h);
