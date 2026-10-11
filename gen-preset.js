/* 生成 cp-preset.js：把一份 CAD 图纸转成内置户型 */
const fs = require('fs');
global.window = {};
const CP = require('./cp-core.js');
require('./cp-dxf.js');

const dxf = CP.parseDXF(fs.readFileSync('文昌.utf8.dxf', 'utf8'));
const prims = CP.toPrims(dxf);
const guess = CP.guessLayers(prims), map = {};
for (const [n] of Object.entries(dxf.layers)) { const c = CP.classifyLayer(n); map[n] = c === '?' ? (guess[n] || 'ignore') : c; }

const d = CP.buildDraft(prims, map, { scale: 1, thickness: 200, gapDoor: true, textDoor: true });
const area = r => Math.abs(r.poly.reduce((s, q, i) => { const n = r.poly[(i + 1) % r.poly.length]; return s + q[0] * n[1] - n[0] * q[1]; }, 0)) / 2;

/* 按面积给房间起个通用名，用户可在界面里改。
   mat 必须用内置材质表的键：wood / walnut / tile800 / tile600 / marble / antislip / terrazzo / carpet */
let nBed = 0;
[...d.rooms].sort((a, b) => area(b) - area(a)).forEach(r => {
  const a = area(r) / 1e6;
  if (a >= 35) { r.name = '客餐厅'; r.mat = 'tile800'; }
  else if (a >= 12) { r.name = nBed++ ? '次卧' : '主卧'; r.mat = 'wood'; }
  else if (a >= 6) { r.name = '次卧'; r.mat = 'wood'; }
  else { r.name = '卫生间'; r.mat = 'antislip'; }
});

/* 户型名/说明：仓库是公开的，所以这里不带楼盘名和房号。
   本地自用想改回真实名字，直接改下面三行再跑一次本脚本即可。 */
const NAME = process.env.CP_NAME || '示例户型 · CAD 导入';
const NOTE = process.env.CP_NOTE || '由一份 CAD 户型图（双线墙 + 多线窗）导入生成，可自行调整墙与门窗';

const plan = CP.finalize({ ...d, id: 'cad-sample', name: NAME, src: 'dxf', note: NOTE });
plan.en = 'Sample CAD Plan';
delete plan._custom; delete plan._img; delete plan._ts;

console.log('墙', plan.walls.length, '门', plan.doors.length, '窗', plan.wins.length, '房间', plan.rooms.length);
console.log('房间:', plan.rooms.map(r => `${r.name} ${(area({ poly: r.poly }) / 1e6).toFixed(2)}㎡`).join(' / '));
console.log('校验:', JSON.stringify(CP.validate(plan)));
console.log('bounds:', JSON.stringify(plan.bounds));

const js = `/* ==========================================================================
 * cp-preset.js — 预置户型：由一份 CAD 户型图导入生成（示例）
 * 说明：只是内置一份可编辑的户型；你的改动会另存为自定义户型，不会覆盖它。
 * ========================================================================== */
(function () {
'use strict';
const CP = window.CP;
const PRESETS = ${JSON.stringify([plan], null, 0)};

CP.presets = PRESETS;
const inject = () => {
  let added = 0;
  for (const p of PRESETS) {
    if (!PLANS.some(x => x.id === p.id)) { PLANS.push(p); added++; }
  }
  if (added && typeof buildPlanList === 'function') buildPlanList();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
else inject();
})();
`;
fs.writeFileSync('cp-preset.js', js);
console.log('cp-preset.js 已生成，', (js.length / 1024).toFixed(1), 'KB');
