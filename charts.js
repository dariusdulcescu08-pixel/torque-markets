// Grafice pe canvas, desenate la rezoluția reală a ecranului.
const COL = { up: '#22C38E', dn: '#FF5A6E', grid: '#1C3050', mut: '#8AA0B8', ink: '#E8F0FA', sky: '#4FB3E8', or: '#FF7A1A' };

function setup(cv) {
  const W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (!W || !H) return null;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, W, H };
}
const label = (g, txt, x, y, bg, fg) => {
  g.font = '600 11px Inter, system-ui'; const w = g.measureText(txt).width + 10;
  g.fillStyle = bg; g.beginPath(); g.roundRect ? g.roundRect(x, y - 9, w, 18, 5) : g.rect(x, y - 9, w, 18); g.fill();
  g.fillStyle = fg; g.fillText(txt, x + 5, y + 4);
};

// opts: {cs:[{t,o,h,l,c,v}], plan:{entry,stop,target}|null, emas:[{v:[...],c}], fmt, intraday}
export function candleChart(cv, getOpts, tip) {
  let hx = null;
  const draw = () => {
    const s = setup(cv); if (!s) return; const { g, W, H } = s, o = getOpts(); const cs = o.cs || [];
    g.clearRect(0, 0, W, H); if (cs.length < 2) return;
    const padR = 64, volH = Math.round(H * 0.13), pTop = 8, pBot = H - volH - 12, n = cs.length, slot = (W - padR) / n;
    let mn = Infinity, mx = -Infinity;
    for (const k of cs) { mn = Math.min(mn, k.l); mx = Math.max(mx, k.h); }
    if (o.plan) { mn = Math.min(mn, o.plan.stop); mx = Math.max(mx, o.plan.target); }
    const pad = (mx - mn) * 0.04; mn -= pad; mx += pad;
    const Y = (v) => pTop + (1 - (v - mn) / (mx - mn)) * (pBot - pTop), X = (i) => i * slot + slot / 2;
    g.lineWidth = 1; g.font = '11px Inter, system-ui';
    for (let k = 0; k <= 4; k++) { const v = mn + ((mx - mn) * k) / 4, y = Y(v); g.strokeStyle = COL.grid; g.beginPath(); g.moveTo(0, y); g.lineTo(W - padR, y); g.stroke(); g.fillStyle = COL.mut; g.fillText(o.fmt(v), W - padR + 6, y + 4); }
    const vmax = Math.max(...cs.map((k) => k.v || 0)) || 1;
    cs.forEach((k, i) => { const h = ((k.v || 0) / vmax) * volH; g.fillStyle = k.c >= k.o ? 'rgba(34,195,142,.25)' : 'rgba(255,90,110,.25)'; g.fillRect(X(i) - slot * 0.32, H - h, Math.max(1, slot * 0.64), h); });
    for (const e of o.emas || []) { g.beginPath(); g.strokeStyle = e.c; g.lineWidth = 1.4; let st = false; e.v.forEach((v, i) => { if (v == null) return; st ? g.lineTo(X(i), Y(v)) : (g.moveTo(X(i), Y(v)), (st = true)); }); g.stroke(); }
    const bw = Math.max(1, slot * 0.64);
    cs.forEach((k, i) => {
      const col = k.c >= k.o ? COL.up : COL.dn, x = X(i); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, Y(k.h)); g.lineTo(x, Y(k.l)); g.stroke();
      const y0 = Math.min(Y(k.o), Y(k.c)), y1 = Math.max(Y(k.o), Y(k.c)); g.fillRect(x - bw / 2, y0, bw, Math.max(1.2, y1 - y0));
    });
    if (o.plan) for (const [v, c, t] of [[o.plan.target, COL.sky, 'Țintă'], [o.plan.entry, COL.ink, 'Intrare'], [o.plan.stop, COL.or, 'Stop']]) {
      const y = Y(v); g.setLineDash([4, 4]); g.strokeStyle = c; g.beginPath(); g.moveTo(0, y); g.lineTo(W - padR, y); g.stroke(); g.setLineDash([]);
      g.font = '600 10px Inter, system-ui'; g.fillStyle = c; const tw = g.measureText(t).width; g.fillText(t, W - padR - tw - 4, y - 4);
    }
    const last = cs[n - 1], up = last.c >= cs[0].o;
    label(g, o.fmt(last.c), W - padR + 2, Y(last.c), up ? COL.up : COL.dn, '#04121F');
    if (hx != null) {
      const i = Math.max(0, Math.min(n - 1, Math.floor(hx / slot))), k = cs[i];
      g.strokeStyle = 'rgba(232,240,250,.45)'; g.beginPath(); g.moveTo(X(i), 0); g.lineTo(X(i), H); g.stroke();
      const d = new Date(k.t);
      tip.textContent = `${o.intraday ? d.toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: '2-digit' })} · D ${o.fmt(k.o)} · M ${o.fmt(k.h)} · m ${o.fmt(k.l)} · Î ${o.fmt(k.c)}`;
    } else tip.textContent = '';
  };
  const mv = (e) => { const r = cv.getBoundingClientRect(); hx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; draw(); };
  const end = () => { hx = null; draw(); };
  cv.ontouchstart = mv; cv.ontouchmove = (e) => { e.preventDefault(); mv(e); }; cv.ontouchend = end; cv.onmousemove = mv; cv.onmouseleave = end;
  const ro = new ResizeObserver(() => draw()); ro.observe(cv); draw();
  return { draw, stop: () => ro.disconnect() };
}

export function lineChart(cv, pts, fmt) {
  const draw = () => {
    const s = setup(cv); if (!s) return; const { g, W, H } = s; g.clearRect(0, 0, W, H);
    if (pts.length < 2) { g.fillStyle = COL.mut; g.font = '13px Inter'; g.fillText('Graficul apare după primele tranzacții.', 4, H / 2); return; }
    const vs = pts.map((p) => p.v), mn = Math.min(...vs), mx = Math.max(...vs), r = mx - mn || 1;
    const X = (i) => (i / (pts.length - 1)) * W, Y = (v) => 6 + (1 - (v - mn) / r) * (H - 12);
    const up = vs[vs.length - 1] >= vs[0], c = up ? COL.up : COL.dn;
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, up ? 'rgba(34,195,142,.25)' : 'rgba(255,90,110,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.v)) : g.moveTo(X(i), Y(p.v)))); g.lineTo(W, H); g.lineTo(0, H); g.closePath(); g.fillStyle = gr; g.fill();
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.v)) : g.moveTo(X(i), Y(p.v)))); g.strokeStyle = c; g.lineWidth = 2; g.stroke();
  };
  const ro = new ResizeObserver(() => draw()); ro.observe(cv); draw();
  return { draw, stop: () => ro.disconnect() };
}

export function spark(closes, w = 64, h = 24) {
  if (!closes || closes.length < 2) return `<svg class="spark" width="${w}" height="${h}"></svg>`;
  const mn = Math.min(...closes), mx = Math.max(...closes), r = mx - mn || 1;
  const pts = closes.map((v, i) => `${((i / (closes.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / r) * (h - 4)).toFixed(1)}`).join(' ');
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${closes[closes.length - 1] >= closes[0] ? COL.up : COL.dn}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

// Grafic profesional: pinch zoom, pan cu degetul, apăsare lungă pentru crosshair, dublu-tap pentru reset.
// getOpts() → {cs, ind:{e20,e50,e200,bbU,bbL,rsi}, show:{ema,bb,rsi,vol}, lines:[{v,c,t}], fmt, intraday, onNeedMore}
export function proChart(cv, getOpts, tip) {
  const V = { n: 90, off: -4 }; let cross = null, lastTap = 0, lp = null, drag = null, pinch = null;
  const clampV = (len) => { V.n = Math.max(12, Math.min(Math.max(20, len + 10), V.n)); V.off = Math.max(-Math.floor(V.n * 0.4), Math.min(len - 8, V.off)); };
  const draw = () => {
    const s = setup(cv); if (!s) return; const { g, W, H } = s, o = getOpts(), cs = o.cs || [], len = cs.length;
    g.clearRect(0, 0, W, H); if (len < 2) { g.fillStyle = COL.mut; g.font = '14px Inter'; g.fillText('Se încarcă graficul…', 12, H / 2); return; }
    clampV(len);
    const padR = 62, padB = 18, rsiH = o.show.rsi ? Math.round((H - padB) * 0.2) : 0, pTop = 8, pBot = H - padB - rsiH - (rsiH ? 10 : 4);
    const right = len - 1 - V.off, left = right - V.n + 1, slot = (W - padR) / V.n;
    const X = (i) => (i - left) * slot + slot / 2, i0 = Math.max(0, Math.floor(left)), i1 = Math.min(len - 1, Math.ceil(right));
    if (i0 < 25 && o.onNeedMore) o.onNeedMore();
    let mn = Infinity, mx = -Infinity;
    for (let i = i0; i <= i1; i++) { mn = Math.min(mn, cs[i].l); mx = Math.max(mx, cs[i].h); if (o.show.bb && o.ind.bbU[i] != null) { mn = Math.min(mn, o.ind.bbL[i]); mx = Math.max(mx, o.ind.bbU[i]); } }
    const rng0 = mx - mn || mx * 0.01;
    for (const l of o.lines || []) if (l.v > mn - rng0 * 0.6 && l.v < mx + rng0 * 0.6) { mn = Math.min(mn, l.v); mx = Math.max(mx, l.v); }
    const pad = (mx - mn) * 0.06 || 1; mn -= pad; mx += pad;
    const Y = (v) => pTop + (1 - (v - mn) / (mx - mn)) * (pBot - pTop);
    g.font = '11px Inter, system-ui'; g.lineWidth = 1;
    const ly0 = Y(cs[len - 1].c); for (let k = 0; k <= 5; k++) { const v = mn + ((mx - mn) * k) / 5, y = Y(v); g.strokeStyle = COL.grid; g.beginPath(); g.moveTo(0, y); g.lineTo(W - padR, y); g.stroke(); if (Math.abs(y - ly0) > 16) { g.fillStyle = COL.mut; g.fillText(o.fmt(v), W - padR + 6, y + 4); } }
    const nT = W < 500 ? 3 : 5; g.fillStyle = COL.mut;
    for (let k = 1; k <= nT; k++) { const i = Math.round(left + (V.n * k) / (nT + 1)); if (i < 0 || i >= len) continue; const d = new Date(cs[i].t);
      const t = o.intraday ? d.toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: '2-digit' });
      g.fillText(t, Math.max(0, X(i) - g.measureText(t).width / 2), H - 4); }
    g.save(); g.beginPath(); g.rect(0, 0, W - padR, pBot + 2); g.clip();
    if (o.show.vol) { let vm = 0; for (let i = i0; i <= i1; i++) vm = Math.max(vm, cs[i].v || 0); const vh = (pBot - pTop) * 0.18;
      for (let i = i0; i <= i1; i++) { const h = ((cs[i].v || 0) / (vm || 1)) * vh; g.fillStyle = cs[i].c >= cs[i].o ? 'rgba(34,195,142,.22)' : 'rgba(255,90,110,.22)'; g.fillRect(X(i) - slot * 0.35, pBot - h, Math.max(1, slot * 0.7), h); } }
    const path = (arr, c, w = 1.4) => { g.beginPath(); g.strokeStyle = c; g.lineWidth = w; let st = false; for (let i = i0; i <= i1; i++) { const v = arr[i]; if (v == null) continue; st ? g.lineTo(X(i), Y(v)) : (g.moveTo(X(i), Y(v)), (st = true)); } g.stroke(); };
    if (o.show.bb) { g.beginPath(); let st = false; for (let i = i0; i <= i1; i++) { const v = o.ind.bbU[i]; if (v == null) continue; st ? g.lineTo(X(i), Y(v)) : (g.moveTo(X(i), Y(v)), (st = true)); } for (let i = i1; i >= i0; i--) { const v = o.ind.bbL[i]; if (v != null) g.lineTo(X(i), Y(v)); } g.fillStyle = 'rgba(185,162,255,.08)'; g.fill(); path(o.ind.bbU, 'rgba(185,162,255,.45)', 1); path(o.ind.bbL, 'rgba(185,162,255,.45)', 1); }
    if (o.show.ema) { path(o.ind.e20, '#FFD166', 1.2); path(o.ind.e50, COL.or); path(o.ind.e200, COL.sky); }
    const bw = Math.max(1, slot * 0.68);
    for (let i = i0; i <= i1; i++) { const k = cs[i], col = k.c >= k.o ? COL.up : COL.dn, x = X(i); g.strokeStyle = col; g.fillStyle = col; g.lineWidth = Math.max(1, Math.min(1.5, slot * 0.12));
      g.beginPath(); g.moveTo(x, Y(k.h)); g.lineTo(x, Y(k.l)); g.stroke(); const y0 = Math.min(Y(k.o), Y(k.c)), y1 = Math.max(Y(k.o), Y(k.c)); g.fillRect(x - bw / 2, y0, bw, Math.max(1.2, y1 - y0)); }
    g.restore();
    for (const l of o.lines || []) { const y = Y(l.v); if (y < pTop - 2 || y > pBot + 2) continue; g.setLineDash(l.solid ? [] : [5, 4]); g.strokeStyle = l.c; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y); g.lineTo(W - padR, y); g.stroke(); g.setLineDash([]);
      g.font = '600 10px Inter, system-ui'; const tw = g.measureText(l.t).width; g.fillStyle = 'rgba(11,23,38,.85)'; g.fillRect(4, y - 15, tw + 8, 14); g.fillStyle = l.c; g.fillText(l.t, 8, y - 5); }
    const last = cs[len - 1], up = last.c >= last.o; if (Y(last.c) >= pTop && Y(last.c) <= pBot) { g.setLineDash([2, 3]); g.strokeStyle = up ? COL.up : COL.dn; g.beginPath(); g.moveTo(0, Y(last.c)); g.lineTo(W - padR, Y(last.c)); g.stroke(); g.setLineDash([]); label(g, o.fmt(last.c), W - padR + 2, Y(last.c), up ? COL.up : COL.dn, '#04121F'); }
    if (rsiH) { const rT = pBot + 10, RY = (v) => rT + (1 - v / 100) * rsiH; g.strokeStyle = COL.grid; [30, 70].forEach((v) => { g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, RY(v)); g.lineTo(W - padR, RY(v)); g.stroke(); }); g.setLineDash([]);
      g.fillStyle = 'rgba(185,162,255,.06)'; g.fillRect(0, RY(70), W - padR, RY(30) - RY(70)); g.fillStyle = COL.mut; g.font = '10px Inter'; g.fillText('RSI ' + (o.ind.rsi[len - 1]?.toFixed(0) ?? ''), W - padR + 6, rT + 10);
      g.save(); g.beginPath(); g.rect(0, rT - 2, W - padR, rsiH + 4); g.clip(); g.beginPath(); g.strokeStyle = '#B9A2FF'; g.lineWidth = 1.3; let st = false; for (let i = i0; i <= i1; i++) { const v = o.ind.rsi[i]; if (v == null) continue; st ? g.lineTo(X(i), RY(v)) : (g.moveTo(X(i), RY(v)), (st = true)); } g.stroke(); g.restore(); }
    if (cross) { const i = Math.max(i0, Math.min(i1, Math.round(left + (cross.x - slot / 2) / slot))), k = cs[i], cy = Math.max(pTop, Math.min(pBot, cross.y));
      g.strokeStyle = 'rgba(232,240,250,.5)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(i), 0); g.lineTo(X(i), H - padB); g.moveTo(0, cy); g.lineTo(W - padR, cy); g.stroke(); g.setLineDash([]);
      label(g, o.fmt(mn + (1 - (cy - pTop) / (pBot - pTop)) * (mx - mn)), W - padR + 2, cy, '#E8F0FA', '#04121F');
      const d = new Date(k.t), ch = (k.c / k.o - 1) * 100;
      tip.innerHTML = `${o.intraday ? d.toLocaleString('ro-RO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' })} &nbsp;D <b>${o.fmt(k.o)}</b> M <b>${o.fmt(k.h)}</b> m <b>${o.fmt(k.l)}</b> Î <b>${o.fmt(k.c)}</b> <span style="color:${ch >= 0 ? COL.up : COL.dn}">${ch >= 0 ? '+' : ''}${ch.toFixed(2)}%</span>`;
      tip.style.opacity = 1; } else tip.style.opacity = 0;
    V.slot = slot;
  };
  const pt = (e, i = 0) => { const r = cv.getBoundingClientRect(), t = e.touches ? e.touches[i] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
  const dist = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  cv.addEventListener('touchstart', (e) => {
    e.preventDefault(); clearTimeout(lp);
    if (e.touches.length === 2) { pinch = { d: dist(e), n: V.n }; drag = null; cross = null; return; }
    const p = pt(e), now = Date.now();
    if (now - lastTap < 280) { V.n = 90; V.off = -4; cross = null; draw(); lastTap = 0; return; } lastTap = now;
    drag = { x: p.x, off: V.off, moved: false }; lp = setTimeout(() => { if (drag && !drag.moved) { cross = p; drag = null; draw(); } }, 320);
  }, { passive: false });
  cv.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (pinch && e.touches.length === 2) { V.n = Math.round(pinch.n * (pinch.d / dist(e))); draw(); return; }
    const p = pt(e);
    if (cross) { cross = p; draw(); return; }
    if (drag) { const dx = p.x - drag.x; if (Math.abs(dx) > 4) { drag.moved = true; clearTimeout(lp); } V.off = Math.round(drag.off + dx / (V.slot || 6)); draw(); }
  }, { passive: false });
  cv.addEventListener('touchend', (e) => { clearTimeout(lp); if (e.touches.length === 0) { pinch = null; drag = null; if (cross) { cross = null; draw(); } } else if (e.touches.length === 1) pinch = null; });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); V.n = Math.round(V.n * (e.deltaY > 0 ? 1.12 : 0.89)); draw(); }, { passive: false });
  cv.addEventListener('mousedown', (e) => { drag = { x: pt(e).x, off: V.off }; });
  addEventListener('mouseup', () => { drag = null; });
  cv.addEventListener('mousemove', (e) => { const p = pt(e); if (drag) { V.off = Math.round(drag.off + (p.x - drag.x) / (V.slot || 6)); cross = null; } else cross = p; draw(); });
  cv.addEventListener('mouseleave', () => { cross = null; draw(); });
  const ro = new ResizeObserver(() => draw()); ro.observe(cv); draw();
  return { draw, view: V, reset: () => { V.n = 90; V.off = -4; draw(); }, stop: () => ro.disconnect() };
}
