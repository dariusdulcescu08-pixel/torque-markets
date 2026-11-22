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
