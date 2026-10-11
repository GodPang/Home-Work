/* ==========================================================================
 * cp-dxf.js — DXF 导入：解析 → 图层分类 → 几何清洗 → 户型对象 + 导入向导
 * ========================================================================== */
(function () {
'use strict';
const CP = window.CP;
const { min, max, abs, cos, sin, PI, hypot } = Math;
const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };

/* ------------------------------------------------------------ DXF 文本解析 */
function pairs(text) {
  const L = text.split(/\r\n|\r|\n/), out = [];
  for (let i = 0; i + 1 < L.length; i += 2) {
    const c = parseInt(L[i], 10);
    if (!isFinite(c)) { i--; continue; }
    out.push([c, L[i + 1]]);
  }
  return out;
}

function readProps(P, i, ent) {                     // 读到下一个 code 0 为止
  while (i < P.length && P[i][0] !== 0) {
    const [c, v] = P[i];
    switch (c) {
      case 8: ent.layer = String(v).trim(); break;
      case 62: ent.color = parseInt(v, 10); break;
      case 10:
        if (ent.type === 'LWPOLYLINE') { ent._last = [num(v), 0]; (ent.pts || (ent.pts = [])).push(ent._last); }
        else ent.x = num(v);
        break;
      case 20:
        if (ent.type === 'LWPOLYLINE') { if (ent._last) ent._last[1] = num(v); }
        else ent.y = num(v);
        break;
      case 11: ent.x1 = num(v); break;
      case 21: ent.y1 = num(v); break;
      case 40: ent.r = num(v); break;
      case 50: ent.a0 = num(v); break;
      case 51: ent.a1 = num(v); break;
      case 41: ent.sx = num(v); break;
      case 42: ent.sy = num(v); break;
      case 43: ent.sz = num(v); break;
      case 70: ent.flags = parseInt(v, 10) || 0; break;
      case 90: ent.nv = parseInt(v, 10) || 0; break;
      case 1: ent.text = (ent.text || '') + String(v); break;
      case 3: ent.text = (ent.text || '') + String(v); break;
      case 2: ent.bname = String(v).trim(); break;
      default: break;
    }
    i++;
  }
  delete ent._last;
  return i;
}

CP.parseDXF = function (text) {
  const P = pairs(text);
  const res = { insunits: null, ents: [], blocks: {}, layers: {} };
  let i = 0, sec = '', block = null;
  while (i < P.length) {
    const [c, v] = P[i], t = String(v).trim();
    if (c === 9 && t.toUpperCase() === '$INSUNITS') {       // HEADER 里的图形单位
      let j = i + 1;
      while (j < P.length && P[j][0] !== 70 && P[j][0] !== 0) j++;
      if (P[j] && P[j][0] === 70) res.insunits = parseInt(P[j][1], 10);
      i = j + 1; continue;
    }
    if (c !== 0) { i++; continue; }
    if (t === 'SECTION') { i += 2; sec = String(P[i - 1]?.[1] || '').trim(); continue; }
    if (t === 'ENDSEC') { sec = ''; block = null; i++; continue; }
    if (sec === 'BLOCKS') {
      if (t === 'BLOCK') {
        let j = i + 1, name = '';
        while (j < P.length && P[j][0] !== 0) { if (P[j][0] === 2) name = String(P[j][1]).trim(); j++; }
        block = (name && !name.startsWith('*')) ? name : null;
        if (block) res.blocks[block] = [];
        i = j; continue;
      }
      if (t === 'ENDBLK') { block = null; i++; continue; }
    }
    if (sec === 'ENTITIES' || (sec === 'BLOCKS' && block)) {
      const ent = { type: t, layer: '0' };
      i = readProps(P, i + 1, ent);
      if (sec === 'BLOCKS' && block) { if (t !== 'ENDBLK') res.blocks[block].push(ent); continue; }
      res.ents.push(ent);
      res.layers[ent.layer] = (res.layers[ent.layer] || 0) + 1;
      continue;
    }
    i++;
  }
  return res;
};

/* -------------------------------------------------------- 实体 → 几何图元 */
function toPrims(dxf) {
  const out = [];
  let poly = null;
  const pushPoly = () => {
    if (poly && poly.pts.length > 1) {
      const pts = poly.pts;
      for (let k = 0; k < pts.length - 1; k++) out.push({ k: 'seg', layer: poly.layer, a: pts[k], b: pts[k + 1] });
      if (poly.closed && pts.length > 2) out.push({ k: 'seg', layer: poly.layer, a: pts[pts.length - 1], b: pts[0] });
    }
    poly = null;
  };
  const arcOut = (layer, c, r, a0, a1) => out.push({ k: 'arc', layer, c, r, a0, a1 });
  for (const e of dxf.ents) {
    const layer = e.layer || '0';
    switch (e.type) {
      case 'LINE':
        pushPoly();
        out.push({ k: 'seg', layer, a: [e.x || 0, e.y || 0], b: [(e.x1 ?? e.x) || 0, (e.y1 ?? e.y) || 0] });
        break;
      case 'POLYLINE': pushPoly(); poly = { layer, pts: [], closed: !!(e.flags & 1) }; break;
      case 'VERTEX':
        if (poly) poly.pts.push([e.x || 0, e.y || 0]);
        else out.push({ k: 'seg', layer, a: [e.x || 0, e.y || 0], b: [e.x || 0, e.y || 0] });
        break;
      case 'SEQEND': pushPoly(); break;
      case 'LWPOLYLINE': {
        pushPoly();
        const pts = e.pts || [];
        for (let k = 0; k + 1 < pts.length; k++) out.push({ k: 'seg', layer, a: pts[k], b: pts[k + 1] });
        if (e.flags & 1 && pts.length > 2) out.push({ k: 'seg', layer, a: pts[pts.length - 1], b: pts[0] });
        break;
      }
      case 'CIRCLE': pushPoly(); out.push({ k: 'circle', layer, c: [e.x || 0, e.y || 0], r: e.r || 0 }); break;
      case 'ARC': pushPoly(); arcOut(layer, [e.x || 0, e.y || 0], e.r || 0, (e.a0 || 0) * PI / 180, (e.a1 || 0) * PI / 180); break;
      case 'INSERT': {                                    // 展开块（门窗块、家具块）
        pushPoly();
        const bx = dxf.blocks[e.bname];
        if (!bx || bx.length > 60) break;
        const sx = e.sx || 1, sy = e.sy || 1, rot = (e.a0 || 0) * PI / 180;
        const cs = cos(rot), sn = sin(rot);
        const tx = p => { const x = (p[0] || 0) * sx, y = (p[1] || 0) * sy; return [(e.x || 0) + x * cs - y * sn, (e.y || 0) + x * sn + y * cs]; };
        for (const b of bx) {
          const lay = (!b.layer || b.layer === '0') ? layer : b.layer;
          if (b.type === 'LINE') out.push({ k: 'seg', layer: lay, a: tx([b.x, b.y]), b: tx([b.x1 ?? b.x, b.y1 ?? b.y]) });
          else if (b.type === 'ARC') { const c0 = tx([b.x, b.y]); arcOut(lay, c0, (b.r || 0) * sx, (b.a0 || 0) * PI / 180 + rot, (b.a1 || 0) * PI / 180 + rot); }
          else if (b.type === 'CIRCLE') { const c0 = tx([b.x, b.y]); out.push({ k: 'circle', layer: lay, c: c0, r: (b.r || 0) * sx }); }
          else if (b.type === 'LWPOLYLINE' && b.pts) {
            for (let k = 0; k + 1 < b.pts.length; k++) out.push({ k: 'seg', layer: lay, a: tx(b.pts[k]), b: tx(b.pts[k + 1]) });
            if (b.flags & 1 && b.pts.length > 2) out.push({ k: 'seg', layer: lay, a: tx(b.pts[b.pts.length - 1]), b: tx(b.pts[0]) });
          } else if ((b.type === 'TEXT' || b.type === 'MTEXT') && b.text) out.push({ k: 'text', layer: lay, pos: tx([b.x, b.y]), text: b.text });
        }
        break;
      }
      case 'TEXT': case 'MTEXT':
        if (e.text) out.push({ k: 'text', layer, pos: [e.x || 0, e.y || 0], text: e.text });
        break;
      default: break;
    }
  }
  pushPoly();
  return out;
}
CP.toPrims = toPrims;

/* ------------------------------------------------------------------ 单位 */
const UNIT_MM = { 1: 25.4, 2: 304.8, 3: 1e6, 4: 1, 5: 10, 6: 1000, 7: 1000, 8: 0.001, 9: 0.0254, 10: 914.4, 11: 5e-6, 12: 1e-9, 13: 1e-9, 14: 1e-6 };
CP.unitMM = u => UNIT_MM[u] ?? null;

/* ------------------------------------------------------------ 图层分类 */
const RULES = [
  [/(房间|房名|room|名称|标注文字|说明)/i, 'text'],
  [/(dim|尺寸|标注|轴|axis|hatch|填充|添充|图案|家具|洁具|厨具|图框|title|轴线|设备|机电|空调|text|文字|注释|编号|name|note)/i, 'ignore'],
  [/(细线|窗外|win(dow)?|窗洞|凸窗|飘窗|窗)/i, 'win'],
  [/(door|门|入户|门扇)/i, 'door'],
  [/(wall|墙|承重|剪力|柱)/i, 'wall'],
];
CP.classifyLayer = name => { for (const [re, to] of RULES) if (re.test(name)) return to; return '?'; };

function guessUnknown(prims) {                     // 未匹配层：能形成双线墙结构的当墙
  const by = {};
  for (const p of prims) {
    if (p.k !== 'seg') continue;
    (by[p.layer] || (by[p.layer] = [])).push({ a: p.a, b: p.b });
  }
  const out = {};
  for (const [lay, segs] of Object.entries(by)) {
    const walls = CP.pruneWalls(CP.wallsFromLines(segs, { solid: Infinity }));
    const area = walls.reduce((s, r) => s + (r[2] - r[0]) * (r[3] - r[1]), 0) / 1e6;
    const len = segs.reduce((s, x) => s + hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]), 0) / 1000;
    out[lay] = (walls.length >= 3 && area >= 1 && area / max(1, len) > 0.04) ? 'wall' : 'ignore';
  }
  return out;
}

CP.guessLayers = guessUnknown;

/* ------------------------------------------------------- 墙厚推断（众数） */
CP.inferThickness = segs => {
  const H = segs.filter(s => abs(s.b[1] - s.a[1]) < 1).map(s => ({ v: s.a[1], x0: min(s.a[0], s.b[0]), x1: max(s.a[0], s.b[0]) }));
  const V = segs.filter(s => abs(s.b[0] - s.a[0]) < 1).map(s => ({ v: s.a[0], y0: min(s.a[1], s.b[1]), y1: max(s.a[1], s.b[1]) }));
  const gaps = [];
  for (const a of H) for (const b of H) { const g = abs(a.v - b.v); if (g > 40 && g < 500 && min(a.x1, b.x1) - max(a.x0, b.x0) > 100) gaps.push(Math.round(g / 10) * 10); }
  for (const a of V) for (const b of V) { const g = abs(a.v - b.v); if (g > 40 && g < 500 && min(a.y1, b.y1) - max(a.y0, b.y0) > 100) gaps.push(Math.round(g / 10) * 10); }
  if (!gaps.length) return 200;
  const cnt = {};
  for (const g of gaps) cnt[g] = (cnt[g] || 0) + 1;
  return Math.max(60, Math.min(400, +Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0] || 200));
};

/* --------------------------------------------------------- 图元 → 户型草稿 */
/* 单线墙退化路径：按固定厚度把线铺成墙（旧算法，用于只画单线的图） */
function gridWalls(segs, T) {
  if (!segs.length) return [];
  const bb = segs.reduce((o, s) => ({
    x0: min(o.x0, s.a[0], s.b[0]), y0: min(o.y0, s.a[1], s.b[1]),
    x1: max(o.x1, s.a[0], s.b[0]), y1: max(o.y1, s.a[1], s.b[1]),
  }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const g = new CP.Grid(bb.x0 - 400, bb.y0 - 400, bb.x1 + 400, bb.y1 + 400, CP.DEF.wallCell);
  segs.forEach(s => g.markSeg(s.a[0], s.a[1], s.b[0], s.b[1], T));
  return CP.mesh(g).filter(r => (r[2] - r[0]) > T * 0.6 && (r[3] - r[1]) > T * 0.6);
}

CP.buildDraft = (prims, map, opt = {}) => {
  const scl = opt.scale || 1;
  const S = p => [p[0] * scl, p[1] * scl];
  const segsIn = kind => prims.filter(p => p.k === 'seg' && map[p.layer] === kind)
    .map(p => ({ a: S(p.a), b: S(p.b) })).filter(s => hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 20);

  const wallSegs = segsIn('wall');
  const T = opt.thickness || 200;

  /* 1) 窗：细线/窗图层里的多线簇（3~5 条平行线 = 一个窗）。先算出来，剪枝时要靠它把被窗隔断的墙连起来 */
  const wins = CP.windowsFromLines([...segsIn('win'), ...segsIn('detail')], {})
    .map(rect => ({ rect, sill: 0.9 }));
  const winRects = wins.map(w => w.rect);

  /* 2) 墙：优先「双线配对」（CAD 墙常画成两条平行线，间距即墙厚）；
        图里若只有单线，退回按固定厚度铺线 */
  let walls = CP.wallsFromLines(wallSegs, { defT: T, near: 500, adjacent: 900, cover: winRects });
  let mode = 'dual';
  walls = CP.dropContained(CP.pruneWalls(walls, { extra: winRects }));
  if (walls.length < 3 && wallSegs.length) { mode = 'single'; walls = CP.pruneWalls(gridWalls(wallSegs, T)); }
  /* 用极小的「缺口补齐」把墙角/门垛/窗边之间的小缝封上，保证房间能闭合 */
  if (walls.length) {
    const uniq = a => { const m = new Map(); a.forEach(x => m.set(x.join(','), x)); return [...m.values()]; };
    walls = uniq(CP.dropContained([...walls,
      ...CP.doorsFromGaps([...walls, ...winRects], { minGap: 20, maxGap: 340, minWall: 80, minOv: 40 })]));
  }

  /* 3) 门：先由 ARC（圆心=铰点，半径=门宽）推断，再由墙段缺口推断 */
  const rawDoors = [];
  for (const a of prims) {
    if ((a.k !== 'arc' && a.k !== 'circle') || map[a.layer] !== 'door') continue;
    const c = S(a.c), r = (a.r || 0) * scl;
    if (r < 300 || r > 1600) continue;
    let u = a.k === 'arc' ? [cos(a.a0), sin(a.a0)] : [1, 0];
    u = abs(u[0]) >= abs(u[1]) ? [u[0] >= 0 ? 1 : -1, 0] : [0, u[1] >= 0 ? 1 : -1];
    const p2 = [c[0] + u[0] * r, c[1] + u[1] * r];
    const ex = abs(u[1]) ? T / 2 : 0, ey = abs(u[0]) ? T / 2 : 0;
    rawDoors.push({
      name: '门', len: Math.round(r), h: [Math.round(c[0]), Math.round(c[1])], c: u, o: [-u[1], u[0]],
      rect: [min(c[0], p2[0]) - ex, min(c[1], p2[1]) - ey, max(c[0], p2[0]) + ex, max(c[1], p2[1]) + ey],
    });
  }
  if (opt.gapDoor !== false) {
    /* 把窗也当作墙段参与判断，否则"门"会跨过中间的窗 */
    for (const r of CP.doorsFromGaps([...walls, ...winRects])) {
      if (wins.some(w => max(0, min(r[2], w.rect[2]) - max(r[0], w.rect[0])) * max(0, min(r[3], w.rect[3]) - max(r[1], w.rect[1])) > 20000)) continue;
      const hz = (r[2] - r[0]) > (r[3] - r[1]);
      rawDoors.push({
        name: '门', len: Math.round(hz ? r[2] - r[0] : r[3] - r[1]), _gap: true,
        h: (hz ? [r[0], (r[1] + r[3]) / 2] : [(r[0] + r[2]) / 2, r[1]]).map(Math.round),
        c: hz ? [1, 0] : [0, 1], o: hz ? [0, -1] : [-1, 0], rect: r,
      });
    }
  }
  /* 门图层只有线段、没有弧：把线段栅格化成洞口矩形 */
  if (!rawDoors.length) {
    const ss = segsIn('door').filter(s => hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 100);
    if (ss.length) {
      const bb = ss.reduce((o, s) => ({ x0: min(o.x0, s.a[0], s.b[0]), y0: min(o.y0, s.a[1], s.b[1]), x1: max(o.x1, s.a[0], s.b[0]), y1: max(o.y1, s.a[1], s.b[1]) }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
      const g = new CP.Grid(bb.x0 - 200, bb.y0 - 200, bb.x1 + 200, bb.y1 + 200, CP.DEF.wallCell);
      ss.forEach(s => g.markSeg(s.a[0], s.a[1], s.b[0], s.b[1], T));
      for (const r of CP.mesh(g).filter(r => max(r[2] - r[0], r[3] - r[1]) > 300 && min(r[2] - r[0], r[3] - r[1]) <= T * 2.5)) {
        const hz = (r[2] - r[0]) > (r[3] - r[1]);
        rawDoors.push({
          name: '门', len: Math.round(hz ? r[2] - r[0] : r[3] - r[1]),
          h: (hz ? [r[0], (r[1] + r[3]) / 2] : [(r[0] + r[2]) / 2, r[1]]).map(Math.round),
          c: hz ? [1, 0] : [0, 1], o: hz ? [0, -1] : [-1, 0], rect: r,
        });
      }
    }
  }
  /* 3c) MH:xxxx 文字标注 → 门（CAD 常只在文字里标门洞高，墙上不留缺口）*/
  if (opt.textDoor !== false && walls.length) {
    const cl = (v, a, b) => max(a, min(b, v));
    for (const p of prims) {
      if (p.k !== 'text' || !/MH\s*[:：]?\s*\d/i.test(p.text || '')) continue;
      const q = S(p.pos), W = 800;
      if (rawDoors.some(d => hypot((d.rect[0] + d.rect[2]) / 2 - q[0], (d.rect[1] + d.rect[3]) / 2 - q[1]) < 900)) continue;
      let best = null, bd = Infinity;
      for (const r of walls) {
        const cx = cl(q[0], r[0], r[2]), cy = cl(q[1], r[1], r[3]), dd = hypot(q[0] - cx, q[1] - cy);
        if (dd < bd) { bd = dd; best = r; }
      }
      if (!best || bd > 1500) continue;
      const hz = (best[2] - best[0]) > (best[3] - best[1]);
      const rect = hz ? [q[0] - W / 2, best[1], q[0] + W / 2, best[3]] : [best[0], q[1] - W / 2, best[2], q[1] + W / 2];
      if (winRects.some(w => max(0, min(rect[2], w[2]) - max(rect[0], w[0])) * max(0, min(rect[3], w[3]) - max(rect[1], w[1])) > W * (rect[3] - rect[1]) * 0.5)) continue;
      rawDoors.push({ name: '门', len: W, _text: true, rect, h: [rect[0], rect[1]], c: hz ? [1, 0] : [0, 1], o: hz ? [0, 1] : [1, 0] });
    }
  }

  const overlap = (a, b) => max(0, min(a[2], b[2]) - max(a[0], b[0])) * max(0, min(a[3], b[3]) - max(a[1], b[1]));
  const doors = rawDoors.filter(d => !wins.some(w => overlap(d.rect, w.rect) > CP.rectArea(d.rect) * 0.25));

  /* 4) 房间提取：用「墙 + 填上的门窗洞」才闭合，否则房间会和室外连通 */
  const wallsSolid = [...walls, ...doors.map(d => d.rect), ...wins.map(w => w.rect)];
  const { rooms: polys, openCount } = CP.extractRooms(wallsSolid, { cell: CP.DEF.roomCell, close: 280, snapTol: 320 });

  /* 5) 从墙里挖掉门窗洞（沿短边方向扩一点，保证贯穿墙厚；碎片丢弃） */
  const holes = [...doors.map(d => d.rect), ...wins.map(w => w.rect)].map(r => {
    const hz = (r[2] - r[0]) > (r[3] - r[1]), e = max(150, T);
    return hz ? [r[0], r[1] - e, r[2], r[3] + e] : [r[0] - e, r[1], r[2] + e, r[3]];
  });
  let cut = walls;
  if (holes.length) cut = walls.flatMap(w => CP.rectSub(w, holes)).filter(r => CP.rectArea(r) > T * T * 0.5);

  const texts = prims.filter(p => p.k === 'text' && map[p.layer] === 'text')
    .map(p => ({ pos: S(p.pos), text: (p.text || '').replace(/\\P|\^I|\{\\.*?\}/g, '').trim() }));
  const rooms = polys.map(poly => {
    let name = '';
    for (const t of texts) {
      if (!t.text || t.text.length > 12 || /^[\d.\s×x*+\-mm]+$/i.test(t.text)) continue;
      if (CP.inPoly(t.pos[0], t.pos[1], poly)) { name = t.text; break; }
    }
    return { poly, name };
  });

  /* 门朝向：铰点取门洞一端，开门方向指向最近房间的内侧 */
  const ctr = rooms.length ? CP.centroid(rooms[0].poly) : [0, 0];
  let entryDoor = null, entryD = -1;
  for (const d of doors) {
    const mp = [(d.rect[0] + d.rect[2]) / 2, (d.rect[1] + d.rect[3]) / 2];
    let best = null, bd = Infinity;
    for (const r of rooms) { const c = CP.centroid(r.poly), dd = hypot(c[0] - mp[0], c[1] - mp[1]); if (dd < bd) { bd = dd; best = c; } }
    if (best) {
      const hz = (d.rect[2] - d.rect[0]) > (d.rect[3] - d.rect[1]);
      if (hz) {
        const y = (d.rect[1] + d.rect[3]) / 2;
        d.h = [d.rect[0], y].map(Math.round); d.c = [1, 0]; d.o = [0, best[1] >= y ? 1 : -1];
      } else {
        const x = (d.rect[0] + d.rect[2]) / 2;
        d.h = [x, d.rect[1]].map(Math.round); d.c = [0, 1]; d.o = [best[0] >= x ? 1 : -1, 0];
      }
    }
    const dd = hypot(mp[0] - ctr[0], mp[1] - ctr[1]);
    if (dd > entryD) { entryD = dd; entryDoor = d; }
  }
  if (entryDoor) { for (const d of doors) d.entry = false; entryDoor.entry = true; }

  /* 6) DXF 的 Y 轴向上、Furnish 的坐标 Y 轴向下 → 整体镜像，避免户型上下颠倒 */
  let outWalls = cut, outWin = wins, outDoor = doors, outRooms = rooms, outRaw = walls;
  if (opt.flipY !== false && walls.length) {
    const ys = [];
    walls.forEach(r => ys.push(r[1], r[3]));
    wins.forEach(w => ys.push(w.rect[1], w.rect[3]));
    doors.forEach(d => ys.push(d.rect[1], d.rect[3]));
    const y0 = min(...ys), y1 = max(...ys), F = y => y0 + y1 - y;
    const RR = r => [r[0], F(r[3]), r[2], F(r[1])];
    const PP = p => [p[0], F(p[1])];
    const VV = v => [v[0], -v[1]];
    outWalls = cut.map(RR); outRaw = walls.map(RR);
    outWin = wins.map(w => ({ ...w, rect: RR(w.rect) }));
    outDoor = doors.map(d => ({ ...d, rect: RR(d.rect), h: PP(d.h), c: VV(d.c), o: VV(d.o) }));
    outRooms = rooms.map(r => ({ ...r, poly: r.poly.map(PP) }));
  }
  return { walls: outWalls, doors: outDoor, wins: outWin, rooms: outRooms, thickness: T, openCount, texts, mode, wallsRaw: outRaw };
};

CP.inPoly = (x, y, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi) c = !c;
  }
  return c;
};

/* -------------------------------------------------------------- 预览 SVG */
CP.previewSVG = (draft, W = 560, H = 320) => {
  const rects = draft.walls || [], rooms = draft.rooms || [];
  const bb = rects.length ? CP.rectsBBox(rects) : CP.rectsBBox(rooms.map(r => { const b = CP.bbox(r.poly); return [b.x0, b.y0, b.x1, b.y1]; }));
  const pad = max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.06 + 200;
  const x0 = bb.x0 - pad, y0 = bb.y0 - pad, w = bb.x1 - bb.x0 + pad * 2, h = bb.y1 - bb.y0 + pad * 2;
  const roomsS = rooms.map(r => `<polygon points="${r.poly.map(p => p.map(Math.round).join(',')).join(' ')}" fill="#d9cdb8" opacity=".55" stroke="#8a8172" stroke-width="8"/>`).join('');
  const wallS = rects.map(r => `<rect x="${r[0]}" y="${r[1]}" width="${r[2] - r[0]}" height="${r[3] - r[1]}" fill="#57514a"/>`).join('');
  const winS = (draft.wins || []).map(x => `<rect x="${x.rect[0]}" y="${x.rect[1]}" width="${x.rect[2] - x.rect[0]}" height="${x.rect[3] - x.rect[1]}" fill="#7fb2d9"/>`).join('');
  const doorS = (draft.doors || []).map(x => `<rect x="${x.rect[0]}" y="${x.rect[1]}" width="${x.rect[2] - x.rect[0]}" height="${x.rect[3] - x.rect[1]}" fill="#e0a35c"/>`).join('');
  const lbS = rooms.map(r => { const c = CP.centroid(r.poly); return `<text x="${c[0]}" y="${c[1]}" font-size="${max(180, w * 0.012)}" text-anchor="middle" fill="#3a352e">${(r.name || '').replace(/[<>&]/g, '')}</text>`; }).join('');
  return `<svg viewBox="${x0} ${y0} ${w} ${h}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet" style="background:#f7f4ee;border-radius:8px">${roomsS}${wallS}${winS}${doorS}${lbS}</svg>`;
};

/* ============================================================== 导入向导 */
CP.openDXF = function () {
  openDialog({
    title: '导入 CAD（DXF）', wide: true,
    body: `<div id="cpdxf"><div class="cp-drop" id="cpDrop">
        <p>选择 .dxf 文件（ASCII / R12 及以上，中文图层名会自动按 GBK 解码）</p>
        <label class="btn primary">选择文件<input type="file" id="cpFile" accept=".dxf,.dwg,application/dxf" hidden></label>
        <small>DWG 是压缩的二进制格式，浏览器读不了：请在 CAD 里「另存为 → DXF」再拖进来</small></div></div>`,
    onOpen: () => {
      const f = document.querySelector('#cpFile'), drop = document.querySelector('#cpDrop');
      f.onchange = () => f.files[0] && readFile(f.files[0]);
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('on'); };
      drop.ondragleave = () => drop.classList.remove('on');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('on'); e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]); };
    },
  });
};

function readFile(file) {
  if (/\.dwg$/i.test(file.name)) {
    toast('DWG 请先在 CAD 里「另存为 → DXF」，再把这个 DXF 拖进来');
    return;
  }
  const fr = new FileReader();
  fr.onload = () => {
    let text = '';
    try {                                            // DXF 多为本地代码页（中文图 = GBK/ANSI_936）
      const buf = fr.result;
      text = new TextDecoder('utf-8').decode(buf);
      if (text.indexOf('\uFFFD') >= 0) text = new TextDecoder('gb18030').decode(buf);
    } catch (e) { text = String(fr.result); }
    let dxf;
    try { dxf = CP.parseDXF(text); } catch (e) { toast('DXF 解析失败：' + e.message); return; }
    if (!dxf.ents.length) { toast('没读到图元，可能是二进制格式，请另存为 ASCII DXF'); return; }
    wizard(dxf, file.name.replace(/\.dxf$/i, ''));
  };
  fr.onerror = () => toast('文件读取失败');
  fr.readAsArrayBuffer(file);
}

function wizard(dxf, defaultName) {
  const host = document.querySelector('#cpdxf');
  const dxfPrims = CP.toPrims(dxf);
  const guess = guessUnknown(dxfPrims);
  const layers = Object.entries(dxf.layers).sort((a, b) => b[1] - a[1]);
  const cls = {};
  for (const [n] of layers) { const c = CP.classifyLayer(n); cls[n] = c === '?' ? (guess[n] || 'ignore') : c; }
  const um = CP.unitMM(dxf.insunits);
  const st = { map: cls, scale: um || 1, thickness: CP.inferThickness(dxfPrims.filter(p => p.k === 'seg' && cls[p.layer] === 'wall')), name: defaultName, gapDoor: true };
  const UNIT = [[1, 'mm'], [10, 'cm'], [1000, 'm'], [25.4, 'in'], [304.8, 'ft']];
  const KIND = { wall: '墙', door: '门', win: '窗', text: '文字', ignore: '忽略' };

  host.innerHTML = `
    <div class="cp-sec"><b>${esc(defaultName)}</b> · ${dxf.ents.length} 图元 · ${layers.length} 图层
      ${um ? ` · 推断单位 <b>1 = ${um} mm</b>` : ' · <span class="cp-warn">文件未标注单位，请确认</span>'}</div>
    <div class="cp-row">
      <label>单位</label><select id="cpUnit">${UNIT.map(([v, t]) => `<option value="${v}" ${v === st.scale ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label>墙厚 mm</label><input id="cpThk" type="number" value="${st.thickness}" min="60" max="500" step="10">
      <label>户型名</label><input id="cpName" value="${esc(defaultName)}">
      <label title="CAD 只画墙不画门时，由墙段缺口推断门洞">缺口推门</label><input id="cpGapDoor" type="checkbox" checked>
    </div>
    <div class="cp-sec"><b>图层映射</b>
      <button class="btn" id="cpAllWall">未知层全设为墙</button>
      <button class="btn" id="cpAllOff">全部忽略</button></div>
    <div class="cp-layers">${layers.map(([n, c]) => `<div class="cp-lay"><span title="${esc(n)}">${esc(n)}</span><small>${c}</small>
      <select data-lay="${esc(n)}">${Object.keys(KIND).map(k => `<option value="${k}" ${cls[n] === k ? 'selected' : ''}>${KIND[k]}</option>`).join('')}</select></div>`).join('')}</div>
    <div id="cpPrev" class="cp-prev"></div><div id="cpMsg" class="cp-msg"></div>
    <div class="cp-actions"><button class="btn primary" id="cpGo">生成户型</button><button class="btn" id="cpCancel">取消</button></div>`;

  const refresh = () => {
    st.scale = +document.querySelector('#cpUnit').value || 1;
    st.thickness = +document.querySelector('#cpThk').value || 200;
    st.gapDoor = document.querySelector('#cpGapDoor').checked;
    const d = CP.buildDraft(CP.toPrims(dxf), st.map, { scale: st.scale, thickness: st.thickness, gapDoor: st.gapDoor });
    st.draft = d;
    document.querySelector('#cpPrev').innerHTML = CP.previewSVG(d);
    const iss = CP.validate(CP.finalize({ ...d, name: document.querySelector('#cpName').value || '我的户型' }));
    document.querySelector('#cpMsg').innerHTML =
      `<div class="cp-stat">墙 ${d.walls.length} · 门 ${d.doors.length} · 窗 ${d.wins.length} · 房间 ${d.rooms.length}` +
      ` · 识别模式 <b>${d.mode === 'dual' ? '双线墙' : '单线墙'}</b>` +
      `${d.openCount > 1 ? ' · <span class="cp-warn">外墙有缺口</span>' : ''}</div>` +
      (iss.length ? iss.map(i => `<div class="cp-iss ${i.lv}">${esc(i.msg)}</div>`).join('') : '<div class="cp-iss ok">校验通过</div>');
  };
  host.querySelectorAll('[data-lay]').forEach(s => s.onchange = () => { st.map[s.dataset.lay] = s.value; refresh(); });
  ['#cpUnit', '#cpThk'].forEach(k => document.querySelector(k).oninput = refresh);
  document.querySelector('#cpGapDoor').onchange = refresh;
  document.querySelector('#cpAllWall').onclick = () => {
    for (const [n] of layers) if (st.map[n] === 'ignore') { st.map[n] = 'wall'; host.querySelector(`[data-lay="${CSS.escape(n)}"]`).value = 'wall'; }
    refresh();
  };
  document.querySelector('#cpAllOff').onclick = () => {
    for (const [n] of layers) { st.map[n] = 'ignore'; host.querySelector(`[data-lay="${CSS.escape(n)}"]`).value = 'ignore'; }
    refresh();
  };
  document.querySelector('#cpCancel').onclick = closeDialog;
  document.querySelector('#cpGo').onclick = () => {
    refresh();
    const name = (document.querySelector('#cpName').value || '').trim() || '我的户型';
    const plan = CP.finalize({ ...st.draft, name, src: 'dxf' });
    if (!plan.walls.length) { toast('没有生成任何墙体，检查图层映射'); return; }
    CP.register(plan); CP.switchTo(plan.id); closeDialog();
    toast('已导入「' + name + '」，共 ' + plan.rooms.length + ' 个房间');
  };
  refresh();
}
})();
