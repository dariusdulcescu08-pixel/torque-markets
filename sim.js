// Simulator demo (paper trading, doar long, ca pe spot). Toată starea e un obiect simplu salvat local.
export function newSim(cash = 10000) {
  return { start: cash, cash, pos: [], hist: [], eq: [{ t: Date.now(), v: cash }], auto: false, fee: 0.1, created: Date.now() };
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function openPos(sim, { sym, price, usd, sl = null, tp = null, src = 'manual', note = '', maxH = null }) {
  if (!(price > 0) || !(usd > 0)) throw new Error('Preț sau sumă invalidă');
  const fee = (usd * sim.fee) / 100;
  if (usd + fee > sim.cash + 1e-9) throw new Error('Nu ai destui bani virtuali');
  if (sl != null && sl >= price) throw new Error('Stopul trebuie să fie sub prețul de intrare');
  if (tp != null && tp <= price) throw new Error('Ținta trebuie să fie peste prețul de intrare');
  const p = { id: uid(), sym, qty: usd / price, entry: price, usd, t: Date.now(), sl, tp, src, note, fees: fee, maxH };
  sim.cash -= usd + fee; sim.pos.push(p); return p;
}
export function closePos(sim, id, price, reason = 'manual', t = Date.now()) {
  const i = sim.pos.findIndex((p) => p.id === id); if (i < 0) return null;
  const p = sim.pos[i], gross = p.qty * price, fee = (gross * sim.fee) / 100;
  sim.cash += gross - fee; sim.pos.splice(i, 1);
  const pnl = gross - fee - p.usd - p.fees;
  const h = { ...p, exit: price, exitT: t, reason, pnl, pnlPct: (pnl / p.usd) * 100 };
  sim.hist.unshift(h); sim.hist = sim.hist.slice(0, 300); return h;
}
export const equity = (sim, px) => sim.cash + sim.pos.reduce((a, p) => a + p.qty * (px(p.sym) ?? p.entry), 0);

// verificare live la fiecare tick
export function checkLive(sim, px, now = Date.now()) {
  const out = [];
  for (const p of [...sim.pos]) {
    const c = px(p.sym); if (c == null) continue;
    if (p.sl != null && c <= p.sl) out.push(closePos(sim, p.id, p.sl, 'stop', now));
    else if (p.tp != null && c >= p.tp) out.push(closePos(sim, p.id, p.tp, 'țintă', now));
    else if (p.maxH && now - p.t >= p.maxH) out.push(closePos(sim, p.id, c, 'timp', now));
  }
  return out;
}
// la redeschidere: verifică ce s-a întâmplat cât app-ul a fost închis, pe lumânări de 1h (stop-ul are prioritate, conservator)
export async function reconcile(sim, getH1) {
  const out = [];
  for (const p of [...sim.pos]) {
    if (p.sl == null && p.tp == null && !p.maxH) continue;
    let cs; try { cs = await getH1(p.sym, p.t); } catch { continue; }
    for (const k of cs) {
      if (k.t + 36e5 <= p.t) continue;
      if (p.sl != null && k.l <= p.sl) { out.push(closePos(sim, p.id, p.sl, 'stop', k.t)); break; }
      if (p.tp != null && k.h >= p.tp) { out.push(closePos(sim, p.id, p.tp, 'țintă', k.t)); break; }
      if (p.maxH && k.t - p.t >= p.maxH) { out.push(closePos(sim, p.id, k.c, 'timp', k.t)); break; }
    }
  }
  return out;
}
export function recordEq(sim, v, now = Date.now()) {
  const last = sim.eq[sim.eq.length - 1];
  if (!last || now - last.t > 10 * 60e3) sim.eq.push({ t: now, v }); else last.v = v;
  if (sim.eq.length > 600) sim.eq = sim.eq.filter((_, i) => i % 2 === 0 || i > 500);
}
export function simStats(hist) {
  const n = hist.length, w = hist.filter((h) => h.pnl > 0), l = hist.filter((h) => h.pnl <= 0);
  const sw = w.reduce((a, h) => a + h.pnl, 0), sl = -l.reduce((a, h) => a + h.pnl, 0);
  return { n, win: n ? w.length / n : null, pnl: sw - sl, avgW: w.length ? sw / w.length : null, avgL: l.length ? -sl / l.length : null,
    pf: sl > 0 ? sw / sl : w.length ? Infinity : null, best: n ? Math.max(...hist.map((h) => h.pnlPct)) : null, worst: n ? Math.min(...hist.map((h) => h.pnlPct)) : null };
}
export function maxDD(eq) {
  let pk = -Infinity, dd = 0; for (const e of eq) { pk = Math.max(pk, e.v); dd = Math.min(dd, e.v / pk - 1); } return dd * 100;
}
