/* ==========================================================================
 * cp-ui.js — 自定义户型的界面集成：户型库入口、管理菜单、导入导出、分享扩展
 * ========================================================================== */
(function () {
'use strict';
const CP = window.CP;

/* ------------------------------------------------------------------ 样式 */
const css = `
.cp-drop{border:2px dashed var(--line,#c9c2b4);border-radius:12px;padding:26px 18px;text-align:center;color:var(--ink2,#6b6459)}
.cp-drop.on{border-color:#ef5a24;background:rgba(239,90,36,.06)}
.cp-drop p{margin:0 0 12px}.cp-drop small{display:block;margin-top:10px;opacity:.7}
.cp-sec{margin:14px 0 8px;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cp-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}
.cp-row label{font-size:12px;opacity:.75}
.cp-row input,.cp-row select{padding:5px 8px;border:1px solid var(--line,#c9c2b4);border-radius:6px;background:var(--card,#fff);color:var(--ink,#2a2622);font-size:13px}
.cp-row input[type=number]{width:78px}
.cp-layers{max-height:190px;overflow:auto;border:1px solid var(--line,#c9c2b4);border-radius:8px;padding:6px}
.cp-lay{display:flex;align-items:center;gap:8px;padding:4px 6px;font-size:13px;border-radius:6px}
.cp-lay:nth-child(odd){background:rgba(128,128,128,.06)}
.cp-lay span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cp-lay small{opacity:.6;font-size:11px}
.cp-prev{margin:10px 0;text-align:center}
.cp-stat{font-size:13px;margin:6px 0}
.cp-iss{font-size:12px;padding:3px 0}
.cp-iss.warn{color:#a35a10}.cp-iss.err{color:#b3302a}.cp-iss.ok{color:#2f7a4f}
.cp-warn{color:#a35a10}
.cp-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}
.cp-bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.cp-bar label{font-size:12px;opacity:.75}
.cp-bar input[type=number]{width:64px;padding:4px 6px;border:1px solid var(--line,#c9c2b4);border-radius:6px;background:var(--card,#fff);color:var(--ink,#2a2622)}
.cp-sep{width:1px;height:20px;background:var(--line,#c9c2b4);margin:0 4px}
.cp-hint{font-size:12px;opacity:.7;margin-top:6px;min-height:18px}
#cpCv{background:#efece4;border:1px solid var(--line,#c9c2b4);border-radius:8px;touch-action:none;cursor:crosshair}
#cpCv .on{stroke:#ef5a24;stroke-width:3;vector-effect:non-scaling-stroke}
.cp-new .gthumb{display:flex;align-items:center;justify-content:center;font-size:34px;color:#ef5a24;background:rgba(239,90,36,.07)}
.cp-badge{position:absolute;top:6px;left:6px;background:#ef5a24;color:#fff;font-size:10px;padding:2px 6px;border-radius:999px}
.gcard{position:relative}
.cp-menu{position:fixed;z-index:9999;background:var(--card,#fff);border:1px solid var(--line,#c9c2b4);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;min-width:150px}
.cp-menu button{display:block;width:100%;text-align:left;padding:7px 10px;border:0;background:none;border-radius:6px;font-size:13px;color:var(--ink,#2a2622);cursor:pointer}
.cp-menu button:hover{background:rgba(128,128,128,.12)}
.cp-menu button.danger{color:#b3302a}
`;
const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);

/* -------------------------------------------------- 户型库：注入新建卡片 */
const _gallery = renderGallery;
window.renderGallery = function () {
  _gallery();
  const el = document.querySelector('#gallery'); if (!el) return;
  const grid = el.querySelector('.ggrid'); if (!grid) return;
  const add = document.createElement('button');
  add.className = 'gcard cp-new';
  add.innerHTML = `<div class="gthumb">＋</div><b>新建户型</b><div class="gtags"><span>图片 / DXF</span></div><small>导入你自己的房子</small>`;
  add.onclick = () => CP.openNew();
  grid.prepend(add);
  el.querySelectorAll('[data-plan]').forEach(b => {
    const id = b.dataset.plan;
    const custom = CP.isCustom(id), preset = (CP.presets || []).some(p => p.id === id);
    if (!custom && !preset) return;
    const th = b.querySelector('.gthumb');
    if (th) th.insertAdjacentHTML('beforeend', `<i class="cp-badge">${custom ? '自定义' : 'CAD 导入'}</i>`);
    b.addEventListener('contextmenu', e => { e.preventDefault(); menu(e.clientX, e.clientY, id, { custom, preset }); });
    let timer = null;
    b.addEventListener('touchstart', () => { timer = setTimeout(() => menu(120, 200, id, { custom, preset }), 550); }, { passive: true });
    b.addEventListener('touchend', () => clearTimeout(timer));
  });
};

function menu(x, y, id, kind) {
  const K = kind || { custom: CP.isCustom(id), preset: (CP.presets || []).some(p => p.id === id) };
  document.querySelectorAll('.cp-menu').forEach(m => m.remove());
  const plan = PLANS.find(p => p.id === id);
  const d = document.createElement('div');
  d.className = 'cp-menu';
  d.innerHTML = `<button data-a="edit">编辑户型结构</button>` +
    (K.custom
      ? `<button data-a="ren">重命名</button><button data-a="dup">复制一份</button><button data-a="exp">导出户型 JSON</button><button data-a="del" class="danger">删除</button>`
      : `<button data-a="dup">复制一份（在副本上改）</button><button data-a="exp">导出户型 JSON</button>`);
  d.style.left = Math.min(x, innerWidth - 170) + 'px';
  d.style.top = Math.min(y, innerHeight - 200) + 'px';
  document.body.appendChild(d);
  d.onclick = e => {
    const a = e.target.dataset?.a; if (!a) return;
    d.remove();
    if (a === 'edit') { closeDialog(); CP.openTrace(plan); }
    else if (a === 'ren') rename(plan);
    else if (a === 'exp') exportPlan(plan);
    else if (a === 'dup') dup(plan);
    else if (a === 'del') del(plan);
  };
  setTimeout(() => document.addEventListener('pointerdown', function h() { d.remove(); document.removeEventListener('pointerdown', h); }), 10);
}

function rename(plan) {
  const n = prompt('户型名称：', plan.name); if (!n) return;
  plan.name = n.trim(); plan.en = plan.name;
  CP.update(plan); buildPlanList(); updateHeader();
  toast('已重命名');
}
function dup(plan) {
  const p = JSON.parse(JSON.stringify(plan));
  p.id = CP.newId(); p.name = plan.name + ' 副本'; p.en = p.name; p._ts = Date.now();
  CP.register(p); buildPlanList();
  toast('已复制');
}
function del(plan) {
  if (!confirm(`删除户型「${plan.name}」？该户型下的布置与方案也会一并删除。`)) return;
  CP.unregister(plan.id); closeDialog();
  toast('已删除');
}
function exportPlan(plan) {
  const blob = new Blob([JSON.stringify(plan, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (plan.name || 'plan').replace(/[\\/:*?"<>|]/g, '_') + '.furnish-plan.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('已导出（底图只存本机，不随文件带走）');
}

/* ------------------------------------------------------------ 新建入口 */
CP.openNew = function () {
  openDialog({
    title: '新建户型',
    body: `<div class="opts">
      <button class="btn wide" id="cpNewDxf" style="justify-content:flex-start;padding:12px"><b>导入 CAD（DXF）</b><small>推荐：自动识别墙体、门窗、房间</small></button>
      <button class="btn wide" id="cpNewImg" style="justify-content:flex-start;padding:12px"><b>上传户型图描图</b><small>图片作底图，手动描墙与房间</small></button>
      <button class="btn wide" id="cpNewJson" style="justify-content:flex-start;padding:12px"><b>导入户型 JSON</b><small>恢复之前导出的户型</small></button>
      <button class="btn wide" id="cpNewBlank" style="justify-content:flex-start;padding:12px"><b>空白画布</b><small>从零手动画墙</small></button>
    </div>`,
    onOpen: () => {
      document.querySelector('#cpNewDxf').onclick = () => { $('#dlgBody').innerHTML = ''; CP.openDXF(); };
      document.querySelector('#cpNewImg').onclick = () => { $('#dlgBody').innerHTML = ''; CP.openTrace(null); };
      document.querySelector('#cpNewJson').onclick = importPlan;
      document.querySelector('#cpNewBlank').onclick = () => { $('#dlgBody').innerHTML = ''; CP.openTrace(null); };
    },
  });
};

function importPlan() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      let p;
      try { p = JSON.parse(String(fr.result)); } catch (e) { toast('不是合法的 JSON'); return; }
      if (!p || !Array.isArray(p.walls)) { toast('不是户型文件'); return; }
      p.id = CP.newId(); p._custom = true; p._img = null; p._src = p._src || 'json';
      p.name = p.name || '导入的户型'; p.en = p.name;
      p.rooms = (p.rooms || []).map((r, i) => ({ ...r, id: r.id || ('cr' + i), mat: r.mat || 'wood', at: r.at || CP.centroid(r.poly).map(Math.round) }));
      const iss = CP.validate(p);
      if (iss.some(i => i.lv === 'err')) { toast('导入的户型有问题：' + iss.find(i => i.lv === 'err').msg); }
      CP.register(p); CP.switchTo(p.id); closeDialog();
      toast('已导入「' + p.name + '」');
    };
    fr.readAsText(f);
  };
  inp.click();
}

/* --------------------------------------------- 分享链接：自定义户型带户型数据 */
const shareBtn = document.querySelector('#shareLink');
if (shareBtn) shareBtn.onclick = async () => {
  const v = await compressJSON(JSON.stringify(state));
  let url = location.href.split('#')[0] + '#pp=' + PLAN.id + '&v=' + v;
  if (CP.isCustom(PLAN.id)) {
    const pl = await compressJSON(JSON.stringify({
      name: PLAN.name, walls: PLAN.walls, wins: PLAN.wins, doors: PLAN.doors,
      rooms: PLAN.rooms, bounds: PLAN.bounds, defaults: [], dims: [], slides: [],
    }));
    url += '&pl=' + pl;
    if (url.length > 12000) toast('户型较大，分享链接可能超长；建议改用「导出户型 JSON」');
  }
  try { await navigator.clipboard.writeText(url); toast('分享链接已复制（自定义户型会连同户型数据一起带上）'); }
  catch (e) { prompt('复制分享链接：', url); }
  const fm = document.querySelector('#fileMenu'); if (fm) fm.open = false;
  snapshot(true);
};

/* 自定义户型的分享链接用 #pp= 前缀（避开内置 #p= 的解析，避免误报无效） */
const loadCPHash = async () => {
  const m = location.hash.match(/^#pp=(\w+)&v=([^&]+)(?:&pl=(.+))?$/);
  if (!m) return;
  try {
    let plan = PLANS.find(p => p.id === m[1]);
    if (!plan && m[3]) {
      const d = JSON.parse(await decompressJSON(m[3]));
      plan = CP.finalize({ ...d, id: m[1], name: d.name || '分享的户型', src: 'share' });
      CP.register(plan);                       // 落在本机，之后可继续编辑
    }
    const work = JSON.parse(await decompressJSON(m[2]));
    if (!plan || !Array.isArray(work.furniture)) throw 0;
    const before = state && Array.isArray(state.furniture) ? snap() : null;
    PLAN = plan; applyPlanData(); store.planId = plan.id;
    state = fixWork(work, plan); store.work[plan.id] = state; save();
    if (before) commit(before); else { undoStack.length = 0; redoStack.length = 0; }
    ui.sel = null;
    buildDefs(); buildLib(); renderOpenings(); renderDims(); fitView(); renderAll(); buildPlanList(); renderDesigns();
    window.View3D?.replan();
    history.replaceState(null, '', location.pathname + location.search);
    toast('已载入分享的户型与布置');
  } catch (e) { toast('分享链接无效'); }
};
window.addEventListener('hashchange', loadCPHash);

/* ------------------------------------------------------------------ 启动 */
const n = CP.boot();
if (n) { buildPlanList(); }
loadCPHash();
})();
