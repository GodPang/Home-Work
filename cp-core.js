/* ==========================================================================
 * cp-core.js — 自定义户型：存储 / 几何引擎 / 校验 / 注册
 * 依赖 Furnish 主脚本暴露的全局：PLANS PLAN setPlan store save toast tr nm area
 * 说明：本文件为经典脚本（非 module），与主脚本共享全局词法作用域。
 * ========================================================================== */
(function () {
'use strict';

const CP = (window.CP = window.CP || {});

CP.KEY = 'huxing-plans-custom-v1';
CP.DEF = { tExt: 200, tIn: 100, wallCell: 25, roomCell: 50, minRoom: 0.8, snap: 60 };
CP.custom = [];                                   // 运行时自定义户型（与内置户型同构）

/* ---------------------------------------------------------------- 小工具 */
const { abs, min, max, hypot } = Math;
const rnd = (v, n = 0) => { const k = 10 ** n; return Math.round(v * k) / k; };
CP.rnd = rnd;

CP.newId = () => 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);

CP.bbox = pts => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  return { x0, y0, x1, y1 };
};
CP.rectsBBox = rects => rects.length
  ? { x0: Math.min(...rects.map(r => r[0])), y0: Math.min(...rects.map(r => r[1])), x1: Math.max(...rects.map(r => r[2])), y1: Math.max(...rects.map(r => r[3])) }
  : { x0: 0, y0: 0, x1: 1000, y1: 1000 };

const normRect = r => [min(r[0], r[2]), min(r[1], r[3]), max(r[0], r[2]), max(r[1], r[3])].map(v => Math.round(v));
CP.normRect = normRect;

CP.rectHit = (a, b) => !(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]);
CP.rectArea = r => (r[2] - r[0]) * (r[3] - r[1]);

/* 矩形减去若干洞（用于门窗在墙上开洞）*/
CP.rectSub = (rect, holes) => {
  let pieces = [rect];
  for (const h of holes) {
    const out = [];
    for (const p of pieces) {
      const ix0 = max(p[0], h[0]), iy0 = max(p[1], h[1]), ix1 = min(p[2], h[2]), iy1 = min(p[3], h[3]);
      if (ix0 >= ix1 || iy0 >= iy1) { out.push(p); continue; }
      if (p[1] < iy0) out.push([p[0], p[1], p[2], iy0]);
      if (iy1 < p[3]) out.push([p[0], iy1, p[2], p[3]]);
      if (p[0] < ix0) out.push([p[0], iy0, ix0, iy1]);
      if (ix1 < p[2]) out.push([ix1, iy0, p[2], iy1]);
    }
    pieces = out;
  }
  return pieces.filter(p => p[2] - p[0] > 2 && p[3] - p[1] > 2);
};

/* 合并相邻的等高/等宽矩形，减少碎片 */
CP.mergeRects = list => {
  let out = list.map(normRect), changed = true, guard = 0;
  while (changed && guard++ < 8) {
    changed = false;
    for (let i = 0; i < out.length && !changed; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        if (a[1] === b[1] && a[3] === b[3] && abs(a[2] - b[0]) <= 1) { out[i] = [a[0], a[1], b[2], a[3]]; out.splice(j, 1); changed = true; break; }
        if (a[0] === b[0] && a[2] === b[2] && abs(a[3] - b[1]) <= 1) { out[i] = [a[0], a[1], a[2], b[3]]; out.splice(j, 1); changed = true; break; }
      }
    }
  }
  return out;
};

/* ------------------------------------------------------------ 栅格与墙提取 */
function Grid(x0, y0, x1, y1, cell) {
  this.cell = cell; this.x0 = x0; this.y0 = y0;
  this.w = max(2, Math.ceil((x1 - x0) / cell) + 1);
  this.h = max(2, Math.ceil((y1 - y0) / cell) + 1);
  this.g = new Uint8Array(this.w * this.h);
}
Grid.prototype.markRect = function (rx0, ry0, rx1, ry1) {
  const c0 = max(0, Math.floor((rx0 - this.x0) / this.cell));
  const c1 = min(this.w - 1, Math.ceil((rx1 - this.x0) / this.cell));
  const r0 = max(0, Math.floor((ry0 - this.y0) / this.cell));
  const r1 = min(this.h - 1, Math.ceil((ry1 - this.y0) / this.cell));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.g[r * this.w + c] = 1;
};
/* 线段（可斜）+ 厚度 → 栅格。轴对齐时精确标记，不产生端点外扩 */
Grid.prototype.markSeg = function (x0, y0, x1, y1, t) {
  const hh = t / 2;
  if (abs(y1 - y0) < 1) { this.markRect(min(x0, x1), min(y0, y1) - hh, max(x0, x1), max(y0, y1) + hh); return; }
  if (abs(x1 - x0) < 1) { this.markRect(min(x0, x1) - hh, min(y0, y1), max(x0, x1) + hh, max(y0, y1)); return; }
  const len = hypot(x1 - x0, y1 - y0), n = max(1, Math.ceil(len / (this.cell * 0.5)));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
    this.markRect(x - hh, y - hh, x + hh, y + hh);
  }
};
CP.Grid = Grid;

/* 贪心矩形化：把占用的栅格切成尽量少的轴对齐矩形 */
CP.mesh = grid => {
  const used = new Uint8Array(grid.w * grid.h), out = [];
  for (let r = 0; r < grid.h; r++) for (let c = 0; c < grid.w; c++) {
    const i = r * grid.w + c;
    if (!grid.g[i] || used[i]) continue;
    let w = 1; while (c + w < grid.w && grid.g[i + w] && !used[i + w]) w++;
    let h = 1;
    grow: while (r + h < grid.h) {
      for (let k = 0; k < w; k++) { const j = (r + h) * grid.w + c + k; if (!grid.g[j] || used[j]) break grow; }
      h++;
    }
    for (let rr = r; rr < r + h; rr++) for (let cc = c; cc < c + w; cc++) used[rr * grid.w + cc] = 1;
    out.push([grid.x0 + c * grid.cell, grid.y0 + r * grid.cell, grid.x0 + (c + w) * grid.cell, grid.y0 + (r + h) * grid.cell]);
  }
  return CP.mergeRects(out).map(r => r.map(Math.round));
};

/* ------------------------------------------------- 双线墙重建（CAD 平面图）
 * CAD 平面图的墙体多画成两条平行线，线间距 = 墙厚（外墙 240 / 内墙 200 / 隔墙 120）。
 * 本函数把平行线按区间配对合并成墙矩形，墙厚直接来自配对间距（不再假设单一厚度）；
 * 未被配对的孤立长线用兜底厚度补墙。seg: {a:[x,y], b:[x,y]} 或 {x0,y0,x1,y1}
 */
function mergeIv(arr, tol2) {
  const a = arr.slice().sort((m, n) => m[0] - n[0]), o = [];
  for (const iv of a) {
    const last = o[o.length - 1];
    if (last && iv[0] <= last[1] + tol2) last[1] = max(last[1], iv[1]);
    else o.push([iv[0], iv[1]]);
  }
  return o;
}

CP.wallsFromLines = function (segs, opt = {}) {
  const tol = opt.tol ?? 8;           // 共线归并容差
  const minGap = opt.minGap ?? 70;    // 最小墙厚
  const maxGap = opt.maxGap ?? 460;   // 最大墙厚
  const minLen = opt.minLen ?? 110;   // 配对所需最小重叠长度
  const solid = opt.solid ?? 500;     // 孤立单线成墙的最小长度
  const defT = opt.defT ?? 200;       // 兜底墙厚
  const list = segs.map(s => s.a
    ? { x0: min(s.a[0], s.b[0]), y0: min(s.a[1], s.b[1]), x1: max(s.a[0], s.b[0]), y1: max(s.a[1], s.b[1]) }
    : s);
  const out = [];

  const pass = horiz => {
    const raw = [];
    for (const s of list) {
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
      if (horiz ? dy > tol : dx > tol) continue;               // 只收轴对齐
      const p = horiz ? (s.y0 + s.y1) / 2 : (s.x0 + s.x1) / 2;
      raw.push({ p, a0: horiz ? s.x0 : s.y0, a1: horiz ? s.x1 : s.y1 });
    }
    raw.sort((m, n) => m.p - n.p);
    const lines = [];                                          // 共线聚类（锚定首条）
    for (const s of raw) {
      const g = lines.find(g => abs(g.p - s.p) <= tol);
      if (g) g.items.push(s); else lines.push({ p: s.p, items: [s] });
    }
    const L = lines.map(g => ({ p: g.p, free: mergeIv(g.items.map(s => [s.a0, s.a1]), tol) }));
    const cut = (l, a0, a1) => {                               // 从剩余区间扣掉 [a0,a1]
      const nf = [];
      for (const [s, e] of l.free) {
        if (e <= a0 + 0.5 || s >= a1 - 0.5) { nf.push([s, e]); continue; }
        if (s < a0 - 0.5) nf.push([s, a0]);
        if (e > a1 + 0.5) nf.push([a1, e]);
      }
      l.free = nf;
    };
    const local = [];
    for (let guard = 0; guard < 600; guard++) {                // 贪心：每次取重叠最长的一对
      let best = null;
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
        const gap = abs(L[i].p - L[j].p);
        if (gap < minGap || gap > maxGap) continue;
        for (const fa of L[i].free) for (const fb of L[j].free) {
          const ov = min(fa[1], fb[1]) - max(fa[0], fb[0]);
          if (ov < minLen) continue;
          if (!best || ov > best.ov) best = { i, j, ov, a0: max(fa[0], fb[0]), a1: min(fa[1], fb[1]) };
        }
      }
      if (!best) break;
      const p0 = min(L[best.i].p, L[best.j].p), p1 = max(L[best.i].p, L[best.j].p);
      local.push(horiz ? [best.a0, p0, best.a1, p1] : [p0, best.a0, p1, best.a1]);
      cut(L[best.i], best.a0, best.a1);
      cut(L[best.j], best.a0, best.a1);
    }
    /* 残余单线兜底：只有确实没被配对墙覆盖、且靠近已有墙的才补（挡住标注线/图框）*/
    /* cover：额外的参考矩形（如已识别的窗），用于判断单线是否只是「墙的一部分」。
       没有它的话，被窗断开的外墙只剩两小段，覆盖率算不过阈值，旁边的参考线就会被误补成墙。*/
    const ref = local.concat((opt.cover || []).filter(r => horiz ? (r[2] - r[0]) >= (r[3] - r[1]) : (r[3] - r[1]) > (r[2] - r[0])));
    const covered = (p, s, e) => ref.some(r => {
      const rp = horiz ? (r[1] + r[3]) / 2 : (r[0] + r[2]) / 2;
      if (abs(rp - p) > maxGap + 60) return false;
      const r0 = horiz ? r[0] : r[1], r1 = horiz ? r[2] : r[3];
      return min(r1, e) - max(r0, s) > (e - s) * 0.7;
    });
    /* 贴墙的平行单线：与某道成对墙平行、间距小于 adjacent、且重叠过半
       → 判定为「拆改前原墙位置 / 梁 / 天棚线」一类的参考线，不补成墙。
       （拆改图里这类线很常见，若补成墙会把房间和它的窗隔开，还会留下一条无法使用的窄条）*/
    const adjacent = opt.adjacent ?? 0;
    const beside = (p, s, e) => adjacent > 0 && ref.some(r => {
      const rp = horiz ? (r[1] + r[3]) / 2 : (r[0] + r[2]) / 2;
      if (abs(rp - p) > adjacent) return false;
      const r0 = horiz ? r[0] : r[1], r1 = horiz ? r[2] : r[3];
      return min(r1, e) - max(r0, s) > (e - s) * 0.5;
    });
    const near = opt.near;
    for (const l of L) for (const [s, e] of l.free) {
      if (e - s < solid) continue;
      if (covered(l.p, s, e)) continue;
      if (beside(l.p, s, e)) continue;
      if (near != null && !local.some(r => horiz
        ? !(r[0] - near > e || s - near > r[2] || r[1] - near > l.p || l.p - near > r[3])
        : !(r[1] - near > e || s - near > r[3] || r[0] - near > l.p || l.p - near > r[2]))) continue;
      local.push(horiz ? [s, l.p - defT / 2, e, l.p + defT / 2] : [l.p - defT / 2, s, l.p + defT / 2, e]);
    }
    out.push(...local);
  };
  pass(true); pass(false);
  return out.map(r => r.map(Math.round)).filter(r => (r[2] - r[0]) > 30 && (r[3] - r[1]) > 30);
};

/* --------------------------------------------- 多线窗识别（窗画成 3~5 条平行线）
 * 把平行线按「间距小 + 长度方向重叠」聚成簇，每簇 = 一个窗；不同位置的窗不会混在一起 */
CP.windowsFromLines = function (segs, opt = {}) {
  const tol = opt.tol ?? 12, maxSpan = opt.maxSpan ?? 380;
  const minCov = opt.minCov ?? 3, minW = opt.minW ?? 300;
  const list = segs.map(s => s.a
    ? { x0: min(s.a[0], s.b[0]), y0: min(s.a[1], s.b[1]), x1: max(s.a[0], s.b[0]), y1: max(s.a[1], s.b[1]) }
    : s);
  const out = [];
  const pass = horiz => {
    const raw = [];
    for (const s of list) {
      const dx = s.x1 - s.x0, dy = s.y1 - s.y0;
      if (horiz ? dy > tol : dx > tol) continue;
      raw.push({ p: horiz ? (s.y0 + s.y1) / 2 : (s.x0 + s.x1) / 2, a0: horiz ? s.x0 : s.y0, a1: horiz ? s.x1 : s.y1 });
    }
    const n = raw.length;
    if (n < minCov) return;
    const par = raw.map((_, i) => i);
    const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (abs(raw[i].p - raw[j].p) > maxSpan) continue;
      if (min(raw[i].a1, raw[j].a1) - max(raw[i].a0, raw[j].a0) < 80) continue;
      let a = find(i), b = find(j); if (a !== b) par[a] = b;
    }
    const gs = {};
    for (let i = 0; i < n; i++) { const r = find(i); (gs[r] || (gs[r] = [])).push(raw[i]); }
    for (const g of Object.values(gs)) {
      if (g.length < minCov) continue;
      const ps = g.map(s => s.p), p0 = min(...ps), p1 = max(...ps);
      if (p1 - p0 > maxSpan || p1 - p0 < 40) continue;
      const a0 = min(...g.map(s => s.a0)), a1 = max(...g.map(s => s.a1));
      if (a1 - a0 < minW) continue;
      out.push(horiz ? [a0, p0, a1, p1] : [p0, a0, p1, a1]);
    }
  };
  pass(true); pass(false);
  return out.map(r => r.map(Math.round));
};

/* ------------------------------------------------- 墙段缺口 → 门洞（推断）
 * 同一道墙上两段墙之间的空隙，宽度在门洞合理范围内 → 判为门 */
CP.doorsFromGaps = function (walls, opt = {}) {
  const minGap = opt.minGap ?? 550, maxGap = opt.maxGap ?? 1700;
  const minWall = opt.minWall ?? 250, minOv = opt.minOv ?? 60;
  const out = [], seen = new Set();
  const pass = horiz => {
    const arr = walls.filter(r => horiz ? (r[2] - r[0]) > (r[3] - r[1]) : (r[3] - r[1]) > (r[2] - r[0]))
      .map(r => horiz ? { p0: r[1], p1: r[3], a0: r[0], a1: r[2] } : { p0: r[0], p1: r[2], a0: r[1], a1: r[3] })
      .filter(s => s.a1 - s.a0 >= minWall);
    for (let i = 0; i < arr.length; i++) for (let j = 0; j < arr.length; j++) {
      if (i === j) continue;
      const A = arr[i], B = arr[j], gap = B.a0 - A.a1;
      if (gap < minGap || gap > maxGap) continue;
      const ov = min(A.p1, B.p1) - max(A.p0, B.p0);
      if (ov < minOv || ov < min(A.p1 - A.p0, B.p1 - B.p0) * 0.5) continue;
      const p0 = min(A.p0, B.p0), p1 = max(A.p1, B.p1);
      /* 空隙里若还夹着别的墙段，就不是一个门洞（避免把窗与窗之间的墙误判成门）*/
      if (arr.some(C => C !== A && C !== B && C.a0 < B.a0 - 1 && C.a1 > A.a1 + 1 &&
        min(C.p1, p1) - max(C.p0, p0) >= minOv * 0.5)) continue;
      const key = [Math.round(A.a1 / 10), Math.round(B.a0 / 10), Math.round(p0 / 10), Math.round(p1 / 10)].join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(horiz ? [A.a1, p0, B.a0, p1] : [p0, A.a1, p1, B.a0]);
    }
  };
  pass(true); pass(false);
  return out.map(r => r.map(Math.round));
};

/* ------------------------------------------------- 连通性剪枝（去标注/图例/图框）
 * 把相互靠近的墙连成连通分量，丢掉面积占比过小的孤立分量。
 * extra：只参与连通性判断、不计入面积也不输出的矩形（如窗洞，它把墙隔开但仍是同一道墙） */
CP.pruneWalls = function (rects, opt = {}) {
  const link = opt.link ?? 320, minArea = opt.minArea ?? 2, ratio = opt.ratio ?? 0.1;
  if (rects.length < 2) return rects.slice();
  const extra = opt.extra || [], nodes = [...rects, ...extra], n = nodes.length;
  const par = nodes.map((_, i) => i);
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = nodes[i], b = nodes[j];
    if (a[0] - link > b[2] || b[0] - link > a[2] || a[1] - link > b[3] || b[1] - link > a[3]) continue;
    const x = find(i), y = find(j); if (x !== y) par[x] = y;
  }
  const keys = [...new Set(rects.map((_, i) => find(i)))];
  const groups = keys.map(k => rects.filter((_, i) => find(i) === k));
  const areas = groups.map(g => g.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0) / 1e6);
  const maxA = max(...areas);
  return groups.filter((g, i) => areas[i] >= max(minArea, maxA * ratio)).flat();
};

/* 去掉被其他矩形完全包含的小矩形（配对与兜底可能重复产出） */
CP.dropContained = function (rects) {
  return rects.filter((a, i) => !rects.some((b, j) =>
    j !== i && b[0] <= a[0] && b[1] <= a[1] && b[2] >= a[2] && b[3] >= a[3] &&
    (b[2] - b[0]) * (b[3] - b[1]) > (a[2] - a[0]) * (a[3] - a[1])));
};

/* ------------------------------------------------------ 房间提取（洪水填充） */
/* 一维滑动窗口膨胀 / 腐蚀（正方形结构元可分离实现） */
function morph1D(src, w, h, r, dil) {
  const dst = new Uint8Array(w * h), k = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const o = y * w;
    let cnt = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) cnt += src[o + x];
    for (let x = 0; x < w; x++) {
      dst[o + x] = dil ? (cnt > 0 ? 1 : 0) : (cnt === k ? 1 : 0);
      if (x + r + 1 < w) cnt += src[o + x + r + 1];
      if (x - r >= 0) cnt -= src[o + x - r];
    }
  }
  return dst;
}
function morph2D(src, w, h, r, dil) {
  const t = morph1D(src, w, h, r, dil);
  const tt = new Uint8Array(w * h), u = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) tt[x * h + y] = t[y * w + x];
  const uu = morph1D(tt, h, w, r, dil);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = uu[x * h + y];
  return out;
}
/* 闭运算：先膨胀后腐蚀，把 ≤2r 的小缝连上但不改变墙厚 */
CP.closeMask = (g, r) => morph2D(morph2D(g.g, g.w, g.h, r, true), g.w, g.h, r, false);

CP.extractRooms = (wallRects, opt = {}) => {
  const cell = opt.cell || CP.DEF.roomCell, minA = opt.minRoom ?? CP.DEF.minRoom;
  if (!wallRects.length) return { rooms: [], openCount: 1 };
  const grow = opt.grow || 0;                    // 洪水填充时把墙加厚，堵住墙角的小缝隙
  const r = opt.close ? max(1, Math.round(opt.close / cell)) : 0;
  const b = CP.rectsBBox(wallRects), pad = max(cell * 3, r * cell + cell * 2) + grow;
  const grid = new Grid(b.x0 - pad, b.y0 - pad, b.x1 + pad, b.y1 + pad, cell);
  wallRects.forEach(x => grid.markRect(x[0] - grow, x[1] - grow, x[2] + grow, x[3] + grow));
  if (r) grid.g = CP.closeMask(grid, r);
  const { w, h } = grid, lab = new Int32Array(w * h).fill(0);
  const comps = [];
  let id = 0;
  for (let s = 0; s < w * h; s++) {
    if (grid.g[s] || lab[s]) continue;
    id++;
    const q = [s], cells = [];
    lab[s] = id;
    let touch = false;
    while (q.length) {
      const i = q.pop(), r = (i / w) | 0, c = i % w;
      cells.push(i);
      if (r === 0 || c === 0 || r === h - 1 || c === w - 1) touch = true;
      const nb = [i - 1, i + 1, i - w, i + w];
      if (c === 0) nb[0] = -1; if (c === w - 1) nb[1] = -1;
      for (const j of nb) if (j >= 0 && j < w * h && !grid.g[j] && !lab[j]) { lab[j] = id; q.push(j); }
    }
    comps.push({ id, cells, touch, area: cells.length * cell * cell / 1e6 });
  }
  const openCount = comps.filter(c => c.touch).length;
  const rooms = [];
  for (const c of comps) {
    if (c.touch || c.area < minA || c.area > 5000) continue;
    const poly = tracePoly(grid, lab, c.id, c.cells);
    if (poly && poly.length >= 4 && Math.abs(shoelace(poly)) / 2 / 1e6 > 0.3) rooms.push(snapPoly(poly, wallRects, opt.snapTol ?? cell * 1.6));
  }
  return opt.debug
    ? { rooms, openCount, comps: comps.map(c => ({ area: +c.area.toFixed(2), touch: c.touch })).sort((a, b) => b.area - a.area) }
    : { rooms, openCount };
};

/* 栅格量化会让房间边界比真实墙内皮内缩半格左右，把顶点吸回最近的墙面 */
function snapPoly(poly, walls, tol) {
  const candX = [], candY = [];
  for (const w of walls) {
    candX.push({ v: w[0], y0: w[1], y1: w[3] }, { v: w[2], y0: w[1], y1: w[3] });
    candY.push({ v: w[1], x0: w[0], x1: w[2] }, { v: w[3], x0: w[0], x1: w[2] });
  }
  return poly.map(([x, y]) => {
    let nx = x, ny = y, bd = tol, bd2 = tol;
    for (const c of candX) {
      const d = Math.abs(x - c.v);
      if (d < bd && y > c.y0 - tol && y < c.y1 + tol) { bd = d; nx = c.v; }
    }
    for (const c of candY) {
      const d = Math.abs(y - c.v);
      if (d < bd2 && nx > c.x0 - tol && nx < c.x1 + tol) { bd2 = d; ny = c.v; }
    }
    return [nx, ny];
  });
}

const shoelace = p => p.reduce((a, q, i) => { const n = p[(i + 1) % p.length]; return a + q[0] * n[1] - n[0] * q[1]; }, 0);

/* 边界追踪：有向边配消 → 串成环 → 合并共线 → 抽稀 */
function tracePoly(grid, lab, id, cells) {
  const { w, cell, x0, y0 } = grid;
  const E = new Map();
  const key = (x1, y1, x2, y2) => x1 + ',' + y1 + '>' + x2 + ',' + y2;
  for (const i of cells) {
    const r = (i / w) | 0, c = i % w;
    const e = [[c, r, c + 1, r], [c + 1, r, c + 1, r + 1], [c + 1, r + 1, c, r + 1], [c, r + 1, c, r]];
    for (const [a, b, cc, d] of e) {
      const k = key(a, b, cc, d), rk = key(cc, d, a, b);
      if (E.has(rk)) E.delete(rk); else E.set(k, [a, b, cc, d]);
    }
  }
  if (!E.size) return null;
  const next = new Map();
  for (const v of E.values()) next.set(v[0] + ',' + v[1], [v[2], v[3]]);
  const start = E.keys().next().value.split('>')[0];
  const pts = [];
  let cur = start, guard = 0;
  while (guard++ < 200000) {
    const [cx, cy] = cur.split(',').map(Number);
    pts.push([cx, cy]);
    const nx = next.get(cur);
    if (!nx) break;
    cur = nx[0] + ',' + nx[1];
    if (cur === start) break;
  }
  if (pts.length < 4) return null;
  const mm = pts.map(p => [x0 + p[0] * cell, y0 + p[1] * cell]);
  return CP.simplify(collinear(mm), cell * 1.05);
}
const collinear = p => {
  const out = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[(i - 1 + p.length) % p.length], b = p[i], c = p[(i + 1) % p.length];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (abs(cross) > 1 && dot > -1) out.push(b);      // 只去掉同向共线点，保留角点
  }
  return out.length >= 3 ? out : p;
};
/* Douglas-Peucker：抹掉栅格阶梯 */
CP.simplify = (p, eps) => {
  if (p.length < 5 || !eps) return p;
  const keep = new Array(p.length).fill(false);
  keep[0] = keep[p.length - 1] = true;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1, fd = 0;
    for (let i = a + 1; i < b; i++) {
      const d = distSeg(p[i], p[a], p[b]);
      if (d > fd) { fd = d; far = i; }
    }
    if (fd > eps && far > 0) { keep[far] = true; stack.push([a, far], [far, b]); }
  }
  return p.filter((_, i) => keep[i]);
};
function distSeg(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy;
  const t = L ? max(0, min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L)) : 0;
  return hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t);
}

CP.centroid = poly => {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const q = poly[i], n = poly[(i + 1) % poly.length], f = q[0] * n[1] - n[0] * q[1];
    a += f; cx += (q[0] + n[0]) * f; cy += (q[1] + n[1]) * f;
  }
  if (abs(a) < 1e-6) { const b = CP.bbox(poly); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }
  return [cx / (3 * a), cy / (3 * a)];
};

/* ------------------------------------------------------------------ 校验 */
CP.validate = p => {
  const iss = [];
  const add = (lv, msg, at) => iss.push({ lv, msg, at });
  const walls = p.walls || [];
  if (!walls.length) add('err', '没有任何墙体，无法编辑');
  walls.forEach((w, i) => {
    if (!(w[2] - w[0] > 0 && w[3] - w[1] > 0)) add('err', `第 ${i + 1} 段墙坐标非法（宽高必须为正）`);
    const t = min(w[2] - w[0], w[3] - w[1]);
    if (t > 600) add('warn', `第 ${i + 1} 段墙厚 ${Math.round(t)} mm，看起来偏厚`);
  });
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i], b = walls[j];
    const ox = min(a[2], b[2]) - max(a[0], b[0]), oy = min(a[3], b[3]) - max(a[1], b[1]);
    if (ox > 2 && oy > 2) {   // 转角交叉属正常，只有大面积叠在一起才提示
      const ov = ox * oy, small = min(CP.rectArea(a), CP.rectArea(b));
      if (ov > small * 0.4) { add('warn', `第 ${i + 1} 与第 ${j + 1} 段墙大面积重叠`, [max(a[0], b[0]) + ox / 2, max(a[1], b[1]) + oy / 2]); i = walls.length; break; }
    }
  }
  const rooms = p.rooms || [];
  if (!rooms.length) add('err', '没有识别到任何房间，报价与地面估算会为空');
  rooms.forEach((r, i) => {
    const a = Math.abs(shoelace(r.poly)) / 2 / 1e6;
    if (a < 0.3) add('warn', `房间「${r.name}」面积只有 ${a.toFixed(2)} m²，可能是误识别`);
    if (a > 200) add('warn', `房间「${r.name}」面积 ${a.toFixed(1)} m² 异常大，检查外墙是否闭合`);
  });
  const doors = p.doors || [];
  if (!doors.some(d => d.entry)) add('warn', '没有入户门（3D 漫游将从最大的门进入）');
  if (doors.filter(d => d.entry).length > 1) add('warn', '有多个入户门');
  doors.forEach((d, i) => { if (!d.rect || d.rect[2] <= d.rect[0] && d.rect[3] <= d.rect[1]) add('warn', `门 ${i + 1} 的洞口尺寸异常`); });
  const b = p.bounds;
  const wb = CP.rectsBBox(walls);
  if (b && (wb.x0 < b.x - 1 || wb.y0 < b.y - 1 || wb.x1 > b.x + b.w + 1 || wb.y1 > b.y + b.h + 1)) add('warn', '有墙体超出画布范围');
  return iss;
};

/* ------------------------------------------------------- 户型对象最终化 */
/* draft: {name, walls, doors, wins, rooms:[{poly,name}], imageId, src} */
CP.finalize = draft => {
  const walls = CP.mergeRects((draft.walls || []).map(normRect));
  const bb = CP.rectsBBox(walls);
  const pad = 1200;
  const rooms = (draft.rooms || []).map((r, i) => {
    const poly = r.poly.map(p => [Math.round(p[0]), Math.round(p[1])]);
    let a = 0;                                   // 统一成内置户型的多边形绕向（y 向下时顺时针）
    for (let k = 0; k < poly.length; k++) { const q = poly[k], n = poly[(k + 1) % poly.length]; a += q[0] * n[1] - n[0] * q[1]; }
    if (a < 0) poly.reverse();
    return {
      id: 'cr' + i + '-' + Math.random().toString(36).slice(2, 5),
      name: (r.name || ('房间 ' + (i + 1))).trim(),
      poly, mat: r.mat || 'wood', at: CP.centroid(poly).map(Math.round), counted: r.counted !== false,
    };
  });
  const wins = (draft.wins || []).map(w => ({ rect: normRect(w.rect).map(Math.round), sill: w.sill ?? 0.9 }));
  const doors = (draft.doors || []).map(d => ({
    name: d.name || '门', rect: normRect(d.rect).map(Math.round),
    h: (d.h || [d.rect[0], d.rect[1]]).map(Math.round),
    c: d.c || [1, 0], o: d.o || [0, 1], len: Math.round(d.len || 800), entry: !!d.entry,
  }));
  if (doors.length && !doors.some(d => d.entry)) doors[0].entry = true;
  const isOuter = r => abs(r[0] - bb.x0) < 2 || abs(r[1] - bb.y0) < 2 || abs(r[2] - bb.x1) < 2 || abs(r[3] - bb.y1) < 2;
  const p = {
    id: draft.id || CP.newId(), name: draft.name || '我的户型', en: draft.name || 'My plan',
    note: draft.note || '', noteEn: '',
    walls: walls.map(r => [r[0], r[1], r[2], r[3], draft.kind || (isOuter(r) ? 'e' : 'n')]),
    wins, doors, slides: [], rooms,
    dims: [], defaults: [],
    bounds: { x: Math.round(bb.x0 - pad), y: Math.round(bb.y0 - pad), w: Math.round(bb.x1 - bb.x0 + pad * 2), h: Math.round(bb.y1 - bb.y0 + pad * 2) },
  };
  p._custom = true;
  p._img = draft.imageId || null;
  p._src = draft.src || '';
  p._ts = Date.now();
  return p;
};

/* ------------------------------------------------------------------ 存储 */
CP.all = () => { try { const a = JSON.parse(localStorage.getItem(CP.KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
CP.persist = list => {
  try { localStorage.setItem(CP.KEY, JSON.stringify(list)); return true; }
  catch (e) { try { localStorage.removeItem('huxing-history'); localStorage.setItem(CP.KEY, JSON.stringify(list)); return true; } catch (e2) { toast && toast('自定义户型保存失败：本地存储空间不足'); return false; } }
};
CP.isCustom = id => CP.all().some(p => p.id === id);

/* 底图：IndexedDB（本机可见，不进导出/分享）*/
let _db = null;
function idb() {
  return new Promise((res, rej) => {
    if (_db) return res(_db);
    const q = indexedDB.open('furnish-ul', 1);
    q.onupgradeneeded = () => { const d = q.result; if (!d.objectStoreNames.contains('images')) d.createObjectStore('images', { keyPath: 'id' }); };
    q.onsuccess = () => { _db = q.result; res(_db); };
    q.onerror = () => rej(q.error);
  });
}
CP.ul = {
  async put(id, blob, meta) {
    const db = await idb();
    return new Promise((res, rej) => {
      const t = db.transaction('images', 'readwrite');
      t.objectStore('images').put({ id, blob, meta: meta || {}, ts: Date.now() });
      t.oncomplete = () => res(id); t.onerror = () => rej(t.error);
    });
  },
  async get(id) {
    if (!id) return null;
    const db = await idb();
    return new Promise((res) => {
      const t = db.transaction('images', 'readonly'), q = t.objectStore('images').get(id);
      q.onsuccess = () => res(q.result || null); q.onerror = () => res(null);
    });
  },
  async del(id) {
    if (!id) return;
    const db = await idb();
    return new Promise(res => { const t = db.transaction('images', 'readwrite'); t.objectStore('images').delete(id); t.oncomplete = () => res(); t.onerror = () => res(); });
  },
};

/* -------------------------------------------------------- 注册 / 注销 / 切换 */
CP.register = plan => {
  const list = CP.all().filter(p => p.id !== plan.id);
  list.push(plan);
  if (!CP.persist(list)) return null;
  if (!PLANS.some(p => p.id === plan.id)) PLANS.push(plan);
  CP.custom = CP.all();
  return plan;
};
CP.update = plan => {
  const list = CP.all().map(p => (p.id === plan.id ? plan : p));
  CP.persist(list);
  const i = PLANS.findIndex(p => p.id === plan.id);
  if (i >= 0) PLANS[i] = plan; else PLANS.push(plan);
  CP.custom = CP.all();
};
CP.unregister = id => {
  const p = PLANS.find(q => q.id === id);
  CP.persist(CP.all().filter(q => q.id !== id));
  CP.custom = CP.all();
  const i = PLANS.findIndex(q => q.id === id);
  if (i >= 0) PLANS.splice(i, 1);
  try {
    delete store.work[id];
    store.designs = (store.designs || []).filter(d => d.planId !== id);
    save();
  } catch (e) {}
  if (p && p._img) CP.ul.del(p._img);
  if (typeof PLAN !== 'undefined' && PLAN && PLAN.id === id) setPlan(PLANS[0].id);
  if (typeof buildPlanList === 'function') buildPlanList();
};
CP.switchTo = id => setPlan(id);

/* 启动时把自定义户型并入 PLANS */
CP.boot = () => {
  CP.custom = CP.all();
  for (const p of CP.custom) if (!PLANS.some(q => q.id === p.id)) PLANS.push(p);
  return CP.custom.length;
};

if (typeof module !== 'undefined' && module.exports) module.exports = CP;   // 供 node 单测
})();
