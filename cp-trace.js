/* ==========================================================================
 * cp-trace.js — 图片底图描图编辑器：标定 → 画墙 / 房间 / 门窗 → 生成户型
 * 也用于「编辑已有自定义户型的结构」（保留已摆好的家具）
 * ========================================================================== */
(function () {
'use strict';
const CP = window.CP;
const { min, max, abs, hypot, round } = Math;

CP.openTrace = function (existing) {
  const st = {
    tool: 'wall', walls: [], rooms: [], doors: [], wins: [], sel: null,
    img: null, url: null, k: 1, rot: 0, pw: 0, ph: 0, imageId: null,
    thk: 200, view: null, undo: [], draft: null, editing: existing || null,
    doorLen: 800, winLen: 1200,
  };
  if (existing && existing._img) {
    CP.ul.get(existing._img).then(rec => {
      if (rec) { loadImage(rec.blob, rec.meta); }
    });
  } else if (existing) {
    st.walls = existing.walls.map(w => [w[0], w[1], w[2], w[3]]);
    st.rooms = existing.rooms.map(r => ({ poly: r.poly.map(p => [...p]), name: r.name }));
    st.doors = existing.doors.map(d => ({ ...d, rect: [...d.rect], h: [...d.h], c: [...d.c], o: [...d.o] }));
    st.wins = existing.wins.map(w => ({ rect: [...w.rect], sill: w.sill }));
    render();
  }

  openDialog({
    title: existing ? '编辑户型结构：' + existing.name : '上传图片描图', wide: true,
    body: `<div id="cptr">
      <div class="cp-bar">
        <button class="btn chip" data-t="cal">标定</button>
        <button class="btn chip on" data-t="wall">画墙</button>
        <button class="btn chip" data-t="room">画房间</button>
        <button class="btn chip" data-t="door">门</button>
        <button class="btn chip" data-t="win">窗</button>
        <button class="btn chip" data-t="sel">选择</button>
        <span class="cp-sep"></span>
        <label>墙厚</label><input id="cpThk2" type="number" value="200" min="60" max="500" step="20">
        <label>门宽</label><input id="cpDL" type="number" value="800" min="500" max="1500" step="50">
        <label>窗宽</label><input id="cpWL" type="number" value="1200" min="300" max="4000" step="100">
        <span class="cp-sep"></span>
        <button class="btn" id="cpImgBtn">上传底图</button>
        <button class="btn" id="cpClrImg">隐藏底图</button>
        <button class="btn" id="cpUndo">撤销</button>
        <button class="btn" id="cpFit">适应</button>
        <button class="btn" id="cpDel">删除所选</button>
        <span class="cp-sep"></span>
        <button class="btn primary" id="cpDone">完成</button>
        <button class="btn" id="cpCancel2">取消</button>
      </div>
      <svg id="cpCv" width="100%" height="520"></svg>
      <div class="cp-hint" id="cpHint">先「上传底图」→「标定」（拖一条已知长度的线）→ 用「画墙」描墙 → 「画房间」点轮廓 → 「门 / 窗」在墙上点一下 → 完成</div>
      <input type="file" id="cpImgIn" accept="image/*" hidden>
    </div>`,
    onOpen: () => {
      const svg = document.querySelector('#cpCv');
      st.svg = svg;
      bind(svg, st);
      render();
    },
  });

  /* ------------------------------------------------------------- 图片 */
  function loadImage(blob, meta) {
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => {
      st.img = im; st.pw = im.naturalWidth; st.ph = im.naturalHeight;
      if (meta && meta.k) { st.k = meta.k; st.rot = meta.rot || 0; }
      else { st.k = 1; st.rot = 0; }
      fit(); render();
    };
    im.src = st.url;
  }

  function shrink(file) {                     // 长边压到 2048，转 JPEG/WebP
    return new Promise(res => {
      const fr = new FileReader();
      fr.onload = () => {
        const im = new Image();
        im.onload = () => {
          const cap = 2048, s = Math.min(1, cap / Math.max(im.naturalWidth, im.naturalHeight));
          if (s === 1 && file.size < 1.2e6) { res(file); return; }
          const cv = document.createElement('canvas');
          cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
          cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
          cv.toBlob(b => res(b || file), 'image/webp', 0.82);
        };
        im.onerror = () => res(file);
        im.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  /* --------------------------------------------------------- 视口与坐标 */
  function fit() {
    const r = [...st.walls, ...st.rooms.map(r2 => { const b = CP.bbox(r2.poly); return [b.x0, b.y0, b.x1, b.y1]; })];
    let bb = r.length ? CP.rectsBBox(r) : null;
    if (st.img && !bb) bb = { x0: 0, y0: 0, x1: st.pw * st.k, y1: st.ph * st.k };
    if (st.img && bb) {
      const g = CP.rectsBBox([[0, 0, st.pw * st.k, st.ph * st.k]]);
      bb = { x0: min(bb.x0, g.x0), y0: min(bb.y0, g.y0), x1: max(bb.x1, g.x1), y1: max(bb.y1, g.y1) };
    }
    if (!bb) { st.view = { x: 0, y: 0, w: 12000, h: 9000 }; return; }
    const pad = max(bb.x1 - bb.x0, bb.y1 - bb.y0) * 0.08 + 500;
    st.view = { x: bb.x0 - pad, y: bb.y0 - pad, w: bb.x1 - bb.x0 + pad * 2, h: bb.y1 - bb.y0 + pad * 2 };
  }
  function toWorld(ev) {
    const p = st.svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY;
    const q = p.matrixTransform(st.svg.getScreenCTM().inverse());
    return [q.x, q.y];
  }
  function toImg(p) {                          // 世界 mm → 图片像素（用于标定）
    const a = -st.rot * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [(p[0] * c - p[1] * s) / st.k, (p[0] * s + p[1] * c) / st.k];
  }
  const snapPt = p => {
    const tol = st.view.w / st.svg.clientWidth * 10;
    let best = [round(p[0] / 50) * 50, round(p[1] / 50) * 50], bd = tol;
    for (const w of st.walls) for (const x of [[w[0], w[1]], [w[2], w[1]], [w[0], w[3]], [w[2], w[3]]]) {
      const d = hypot(x[0] - p[0], x[1] - p[1]); if (d < bd) { bd = d; best = [...x]; }
    }
    for (const r of st.rooms) for (const q of r.poly) {
      const d = hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = [...q]; }
    }
    return best;
  };

  /* ---------------------------------------------------------------- 渲染 */
  function render() {
    const svg = st.svg; if (!svg) return;
    if (!st.view) fit();
    const v = st.view;
    svg.setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    const sw = v.w / (svg.clientWidth || 800) * 1.2;
    const img = st.img && st.showImg !== false
      ? `<g transform="rotate(${st.rot}) scale(${st.k})"><image href="${st.url}" x="0" y="0" width="${st.pw}" height="${st.ph}" opacity=".45" style="pointer-events:none"/></g>` : '';
    const rooms = st.rooms.map((r, i) => `<polygon points="${r.poly.map(p => p.join(',')).join(' ')}" fill="#d9cdb8" opacity=".5" stroke="#8a8172" stroke-width="${sw}" data-k="room" data-i="${i}" class="${st.sel && st.sel.k === 'room' && st.sel.i === i ? 'on' : ''}"/>`).join('');
    const walls = st.walls.map((w, i) => `<rect x="${w[0]}" y="${w[1]}" width="${w[2] - w[0]}" height="${w[3] - w[1]}" fill="#57514a" data-k="wall" data-i="${i}" class="${st.sel && st.sel.k === 'wall' && st.sel.i === i ? 'on' : ''}"/>`).join('');
    const wins = st.wins.map((w, i) => `<rect x="${w.rect[0]}" y="${w.rect[1]}" width="${w.rect[2] - w.rect[0]}" height="${w.rect[3] - w.rect[1]}" fill="#7fb2d9" data-k="win" data-i="${i}"/>`).join('');
    const doors = st.doors.map((d, i) => `<rect x="${d.rect[0]}" y="${d.rect[1]}" width="${d.rect[2] - d.rect[0]}" height="${d.rect[3] - d.rect[1]}" fill="#e0a35c" data-k="door" data-i="${i}"/>`).join('');
    const lb = st.rooms.map(r => { const c = CP.centroid(r.poly); return `<text x="${c[0]}" y="${c[1]}" font-size="${max(180, v.w * 0.012)}" text-anchor="middle" fill="#3a352e" style="pointer-events:none">${esc(r.name || '')}</text>`; }).join('');
    const grid = `<defs><pattern id="cpg" width="1000" height="1000" patternUnits="userSpaceOnUse"><path d="M1000 0H0V1000" fill="none" stroke="#cfc9be" stroke-width="${sw / 2}"/></pattern></defs><rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="url(#cpg)" opacity=".5"/>`;
    svg.innerHTML = `<rect x="${v.x}" y="${v.y}" width="${v.w}" height="${v.h}" fill="#f7f4ee"/>${grid}${img}${rooms}${walls}${wins}${doors}${lb}${st.tmp || ''}`;
  }

  /* ---------------------------------------------------------------- 交互 */
  function bind(svg, st) {
    let dragging = null, pan = null, calStart = null;
    const hint = document.querySelector('#cpHint');
    const setTool = t => {
      st.tool = t;
      document.querySelectorAll('.cp-bar [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === t));
      hint.textContent = {
        cal: '标定：在底图上拖一条你已知实际长度的线，松手后输入长度（mm）并选择它该是水平还是垂直',
        wall: '画墙：点一下起点、再点一下终点（自动正交，端点会吸附）',
        room: '画房间：沿房间轮廓逐点点击，双击或回车闭合',
        door: '门：在墙上点一下，按门宽开一个门洞',
        win: '窗：在外墙上点一下，按窗宽开窗洞',
        sel: '选择：点图元选中，按 Delete 或「删除所选」删除；滚轮缩放，空白处拖动平移',
      }[t] || '';
    };
    document.querySelectorAll('.cp-bar [data-t]').forEach(b => b.onclick = () => setTool(b.dataset.t));
    document.querySelector('#cpThk2').oninput = e => st.thk = +e.target.value || 200;
    document.querySelector('#cpDL').oninput = e => st.doorLen = +e.target.value || 800;
    document.querySelector('#cpWL').oninput = e => st.winLen = +e.target.value || 1200;
    document.querySelector('#cpFit').onclick = () => { fit(); render(); };
    document.querySelector('#cpCancel2').onclick = closeDialog;
    document.querySelector('#cpClrImg').onclick = () => { st.showImg = !st.showImg; render(); };
    document.querySelector('#cpUndo').onclick = undo;
    document.querySelector('#cpDel').onclick = delSel;
    document.querySelector('#cpImgBtn').onclick = () => document.querySelector('#cpImgIn').click();
    document.querySelector('#cpImgIn').onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const blob = await shrink(f);
      loadImage(blob);
    };
    document.querySelector('#cpDone').onclick = done;

    svg.addEventListener('wheel', e => {
      e.preventDefault();
      const p = toWorld(e), k = e.deltaY > 0 ? 1.15 : 1 / 1.15;
      st.view = { x: p[0] - (p[0] - st.view.x) * k, y: p[1] - (p[1] - st.view.y) * k, w: st.view.w * k, h: st.view.h * k };
      render();
    }, { passive: false });

    svg.addEventListener('pointerdown', e => {
      if (e.button === 1 || e.button === 2 || e.shiftKey) { pan = { p: toWorld(e), v: { ...st.view } }; svg.setPointerCapture(e.pointerId); return; }
      const p = toWorld(e), hit = e.target.dataset;
      if (st.tool === 'sel') {
        st.sel = hit.k ? { k: hit.k, i: +hit.i } : null; render(); return;
      }
      if (st.tool === 'cal') { calStart = p; svg.setPointerCapture(e.pointerId); return; }
      if (st.tool === 'wall') { dragging = { a: snapPt(p) }; svg.setPointerCapture(e.pointerId); return; }
      if (st.tool === 'room') {
        if (st.poly) st.poly.push(snapPt(p)); else { push(); st.poly = [snapPt(p)]; }
        render();
        return;
      }
      if (st.tool === 'door' || st.tool === 'win') { push(); opening(p, st.tool); render(); }
    });

    svg.addEventListener('pointermove', e => {
      if (pan) {
        const p = toWorld(e);
        st.view = { ...pan.v, x: pan.v.x + (pan.p[0] - p[0]), y: pan.v.y + (pan.p[1] - p[1]) };
        render(); return;
      }
      const p = toWorld(e);
      if (calStart) { st.tmp = line(calStart, p, '#ef5a24'); render(); return; }
      if (dragging) {
        const b = snapPt(p);
        const h = abs(b[0] - dragging.a[0]) > abs(b[1] - dragging.a[1]) ? [b[0], dragging.a[1]] : [dragging.a[0], b[1]];
        const t = st.thk / 2;
        const r = [min(dragging.a[0], h[0]) - (h[1] === dragging.a[1] ? 0 : t), min(dragging.a[1], h[1]) - (h[1] === dragging.a[1] ? t : 0),
                   max(dragging.a[0], h[0]) + (h[1] === dragging.a[1] ? 0 : t), max(dragging.a[1], h[1]) + (h[1] === dragging.a[1] ? t : 0)];
        st.tmp = `<rect x="${r[0]}" y="${r[1]}" width="${r[2] - r[0]}" height="${r[3] - r[1]}" fill="#57514a" opacity=".5"/>` + dot(h);
        render();
      }
    });

    svg.addEventListener('pointerup', e => {
      if (pan) { pan = null; return; }
      const p = toWorld(e);
      if (calStart) { const a = toImg(calStart), b = toImg(p); st.tmp = null; render(); askCal(a, b, calStart, p); calStart = null; return; }
      if (dragging) {
        const A = dragging.a, B = snapPt(p);
        const h = abs(B[0] - A[0]) > abs(B[1] - A[1]) ? [B[0], A[1]] : [A[0], B[1]];
        push();
        const t = st.thk / 2, hz = h[1] === A[1];
        st.walls.push([min(A[0], h[0]) - (hz ? 0 : t), min(A[1], h[1]) - (hz ? t : 0), max(A[0], h[0]) + (hz ? 0 : t), max(A[1], h[1]) + (hz ? t : 0)].map(Math.round));
        dragging = null; st.tmp = null; render();
      }
    });

    svg.addEventListener('dblclick', () => { if (st.tool === 'room' && st.poly && st.poly.length >= 3) { st.rooms.push({ poly: st.poly, name: '房间 ' + (st.rooms.length + 1) }); st.poly = null; st.tmp = null; render(); } });
    document.addEventListener('keydown', function h(e) {
      if (!document.querySelector('#cptr')) { document.removeEventListener('keydown', h); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { delSel(); e.preventDefault(); }
      else if (e.key === 'Enter' && st.tool === 'room' && st.poly && st.poly.length >= 3) { st.rooms.push({ poly: st.poly, name: '房间 ' + (st.rooms.length + 1) }); st.poly = null; render(); }
      else if (e.key === 'Escape') { st.poly = null; st.tmp = null; render(); }
    });
    setTool('wall');
  }

  const line = (a, b, c) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="${c}" stroke-width="${st.view.w / 400}" stroke-dasharray="200 120"/>`;
  const dot = p => `<circle cx="${p[0]}" cy="${p[1]}" r="${st.view.w / 300}" fill="#ef5a24"/>`;

  function opening(p, kind) {
    let best = null, bd = Infinity;
    for (let i = 0; i < st.walls.length; i++) {
      const w = st.walls[i];
      if (p[0] < w[0] - 400 || p[0] > w[2] + 400 || p[1] < w[1] - 400 || p[1] > w[3] + 400) continue;
      const cx = max(w[0], min(p[0], w[2])), cy = max(w[1], min(p[1], w[3]));
      const d = hypot(cx - p[0], cy - p[1]);
      if (d < bd) { bd = d; best = { w, i }; }
    }
    if (!best) { toast('请点在墙上'); return; }
    const w = best.w, hz = (w[2] - w[0]) > (w[3] - w[1]);
    const L = kind === 'door' ? st.doorLen : st.winLen;
    const cx = max(w[0] + L / 2, min(p[0], w[2] - L / 2)), cy = max(w[1] + L / 2, min(p[1], w[3] - L / 2));
    const rect = hz ? [cx - L / 2, (w[1] + w[3]) / 2 - (w[3] - w[1]) / 2, cx + L / 2, (w[1] + w[3]) / 2 + (w[3] - w[1]) / 2]
                    : [(w[0] + w[2]) / 2 - (w[2] - w[0]) / 2, cy - L / 2, (w[0] + w[2]) / 2 + (w[2] - w[0]) / 2, cy + L / 2];
    if (kind === 'door') {
      const o = [0, -1];
      st.doors.push({ name: '门', len: L, rect: rect.map(Math.round), h: [rect[0], (rect[1] + rect[3]) / 2].map(Math.round), c: [1, 0], o, entry: !st.doors.length });
    } else st.wins.push({ rect: rect.map(Math.round), sill: 0.9 });
    const e = max(150, st.thk);
    const hole = hz ? [rect[0], rect[1] - e, rect[2], rect[3] + e] : [rect[0] - e, rect[1], rect[2] + e, rect[3]];
    st.walls = st.walls.flatMap(x => CP.rectSub(x, [hole])).filter(r => CP.rectArea(r) > st.thk * st.thk * 0.8);
  }

  function askCal(a, b, pa, pb) {
    const pxLen = hypot(b[0] - a[0], b[1] - a[1]);
    if (pxLen < 4) { toast('线太短了'); return; }
    openDialog({
      title: '标定比例',
      body: `<p>这条线在图上长 ${pxLen.toFixed(1)} px。</p><div class="cp-row"><label>实际长度 mm</label><input id="cpCalL" type="number" value="3000" autofocus>
        <label>这条线应该是</label><select id="cpCalD"><option value="h">水平</option><option value="v">垂直</option><option value="f">不校正角度</option></select></div>`,
      actions: [{ label: '确定', cls: 'primary', fn: async () => {
        const L = +document.querySelector('#cpCalL').value || 0, dir = document.querySelector('#cpCalD').value;
        if (L <= 0) return false;
        st.k = L / pxLen;
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
        st.rot = dir === 'h' ? -ang : dir === 'v' ? 90 - ang : st.rot;
        if (st.img) {
          const id = st.imageId || CP.newId();
          st.imageId = id;
          const blob = await dataURLToBlob(st.img.src);
          CP.ul.put(id, blob, { k: st.k, rot: st.rot, name: 'trace' });
        }
        fit(); render();
        toast('比例：1 px = ' + st.k.toFixed(3) + ' mm');
      } }, { label: '取消' }],
    });
  }
  function dataURLToBlob(u) {
    if (u.startsWith('blob:')) return fetch(u).then(r => r.blob());
    const [h, d] = u.split(','), bin = atob(d), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: (h.match(/:(.*?);/) || [])[1] || 'image/png' });
  }

  function snap() { st.undo.push(JSON.stringify({ walls: st.walls, rooms: st.rooms, doors: st.doors, wins: st.wins })); if (st.undo.length > 60) st.undo.shift(); }
  const push = snap;
  function undo() {
    const s = st.undo.pop(); if (!s) return;
    const o = JSON.parse(s);
    st.walls = o.walls; st.rooms = o.rooms; st.doors = o.doors; st.wins = o.wins; st.sel = null; render();
  }
  function delSel() {
    if (!st.sel) return;
    push();
    const { k, i } = st.sel;
    if (k === 'wall') st.walls.splice(i, 1);
    else if (k === 'room') st.rooms.splice(i, 1);
    else if (k === 'door') st.doors.splice(i, 1);
    else if (k === 'win') st.wins.splice(i, 1);
    st.sel = null; render();
  }

  function done() {
    if (!st.walls.length) { toast('还没有画任何墙'); return; }
    let rooms = st.rooms;
    if (!rooms.length) {
      const r = CP.extractRooms(st.walls, { cell: CP.DEF.roomCell });
      rooms = r.rooms.map((poly, i) => ({ poly, name: '房间 ' + (i + 1) }));
    }
    for (let i = 0; i < rooms.length; i++) if (!rooms[i].name) rooms[i].name = '房间 ' + (i + 1);
    const name = st.editing ? st.editing.name : prompt('户型名称：', '我的户型') || '我的户型';
    const draft = { walls: st.walls, doors: st.doors, wins: st.wins, rooms, imageId: st.imageId, src: st.editing ? st.editing._src : 'trace' };
    const plan = CP.finalize(draft);
    if (st.editing) {
      plan.id = st.editing.id; plan._img = st.imageId || st.editing._img;
      CP.update(plan);
      /* 结构变了：门窗下标会漂移，清掉旧的门窗调整与拆改记录 */
      try { state.open = { d: {}, w: {} }; state.demolished = []; save(); } catch (e) {}
      closeDialog();
      setPlan(PLANS[0].id);            // 先切走，再切回来，强制重建
      setPlan(plan.id);
      toast('户型结构已更新');
    } else {
      CP.register(plan); closeDialog(); setPlan(plan.id);
      toast('已创建「' + name + '」，共 ' + plan.rooms.length + ' 个房间');
    }
  }
}
})();
