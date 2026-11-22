// Simulator demo: long și short, levier 1–10×, lichidare, stop/țintă automate. Comision 0,1% pe valoarea poziției la intrare și ieșire.
export function newSim(cash = 10000) {
  return { v: 3, start: cash, cash, pos: [], hist: [], eq: [{ t: Date.now(), v: cash }], auto: false, fee: 0.1, created: Date.now() };
}
export function migrate(sim) {
  for (const p of sim.pos) if (!p.side) { p.side = 'long'; p.lev = 1; p.margin = p.usd; p.liq = liqPrice('long', p.entry, 1); }
  for (const h of sim.hist) if (!h.side) { h.side = 'long'; h.lev = 1; h.margin = h.usd; }
  sim.v = 3; return sim;
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const dir = (p) => (p.side === 'short' ? -1 : 1);
export const liqPrice = (side, entry, lev) => (side === 'short' ? entry * (1 + 0.95 / lev) : entry * (1 - 0.95 / lev));
export const pnlAt = (p, price) => dir(p) * p.qty * (price - p.entry);
export const valueAt = (p, price) => p.margin + pnlAt(p, price);

export function openPos(sim, { sym, side = 'long', price, margin, lev = 1, sl = null, tp = null, src = 'manual', note = '', maxH = null }) {
  if (!(price > 0) || !(margin > 0)) throw new Error('Preț sau sumă invalidă');
  lev = Math.max(1, Math.min(10, Math.round(lev)));
  const notional = margin * lev, fee = (notional * sim.fee) / 100;
  if (margin + fee > sim.cash + 1e-9) throw new Error('Nu ai destui bani virtuali');
  const d = side === 'short' ? -1 : 1;
  if (sl != null && d * (sl - price) >= 0) throw new Error(side === 'short' ? 'La short, stopul e peste prețul de intrare' : 'La long, stopul e sub prețul de intrare');
  if (tp != null && d * (tp - price) <= 0) throw new Error(side === 'short' ? 'La short, ținta e sub prețul de intrare' : 'La long, ținta e peste prețul de intrare');
  const p = { id: uid(), sym, side, lev, margin, usd: margin, qty: notional / price, entry: price, t: Date.now(), sl, tp, src, note, fees: fee, maxH, liq: liqPrice(side, price, lev) };
  sim.cash -= margin + fee; sim.pos.push(p); return p;
}
export function closePos(sim, id, price, reason = 'manual', t = Date.now()) {
  const i = sim.pos.findIndex((p) => p.id === id); if (i < 0) return null;
  const p = sim.pos[i], fee = ((p.qty * price) * sim.fee) / 100;
  let pl = pnlAt(p, price); if (pl < -p.margin) pl = -p.margin;
  sim.cash += Math.max(0, p.margin + pl - fee); sim.pos.splice(i, 1);
  const pnl = pl - fee - p.fees;
  const h = { ...p, exit: price, exitT: t, reason, pnl, pnlPct: (pnl / p.margin) * 100 };
  sim.hist.unshift(h); sim.hist = sim.hist.slice(0, 300); return h;
}
export const equity = (sim, px) => sim.cash + sim.pos.reduce((a, p) => a + valueAt(p, px(p.sym) ?? p.entry), 0);

function hit(p, lo, hi) { // ce s-a atins în intervalul [lo, hi]: lichidare > stop > țintă (conservator)
  const L = p.side === 'long';
  if (L ? lo <= p.liq : hi >= p.liq) return ['lichidare', p.liq];
  if (p.sl != null && (L ? lo <= p.sl : hi >= p.sl)) return ['stop', p.sl];
  if (p.tp != null && (L ? hi >= p.tp : lo <= p.tp)) return ['țintă', p.tp];
  return null;
}
export function checkLive(sim, px, now = Date.now()) {
  const out = [];
  for (const p of [...sim.pos]) {
    const c = px(p.sym); if (c == null) continue;
    const h = hit(p, c, c);
    if (h) out.push(closePos(sim, p.id, h[1], h[0], now));
    else if (p.maxH && now - p.t >= p.maxH) out.push(closePos(sim, p.id, c, 'timp', now));
  }
  return out;
}
export async function reconcile(sim, getH1) {
  const out = [];
  for (const p of [...sim.pos]) {
    let cs; try { cs = await getH1(p.sym, p.t); } catch { continue; }
    for (const k of cs) {
      if (k.t + 36e5 <= p.t) continue;
      const h = hit(p, k.l, k.h);
      if (h) { out.push(closePos(sim, p.id, h[1], h[0], k.t)); break; }
      if (p.maxH && k.t - p.t >= p.maxH) { out.push(closePos(sim, p.id, k.c, 'timp', k.t)); break; }
    }
  }
  return out;
}
export function recordEq(sim, v, now = Date.now()) {
  const last = sim.eq[sim.eq.length - 1];
  if (!last || now - last.t > 5 * 60e3) sim.eq.push({ t: now, v }); else last.v = v;
  if (sim.eq.length > 800) sim.eq = sim.eq.filter((_, i) => i % 2 === 0 || i > 600);
}
export function simStats(hist) {
  const n = hist.length, w = hist.filter((h) => h.pnl > 0), l = hist.filter((h) => h.pnl <= 0);
  const sw = w.reduce((a, h) => a + h.pnl, 0), sl = -l.reduce((a, h) => a + h.pnl, 0);
  return { n, win: n ? w.length / n : null, pnl: sw - sl, avgW: w.length ? sw / w.length : null, avgL: l.length ? -sl / l.length : null,
    pf: sl > 0 ? sw / sl : w.length ? Infinity : null, best: n ? Math.max(...hist.map((h) => h.pnlPct)) : null, worst: n ? Math.min(...hist.map((h) => h.pnlPct)) : null };
}
export function maxDD(eq) { let pk = -Infinity, dd = 0; for (const e of eq) { pk = Math.max(pk, e.v); dd = Math.min(dd, e.v / pk - 1); } return dd * 100; }
