import * as C from './core.js';
import * as SIM from './sim.js';
import { Live, binanceBalances } from './live.js';
import { lineChart, proChart } from './charts.js';

/* ================= stare ================= */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const DEF = { name: '', crypto: C.CONFIG.crypto, stocks: C.CONFIG.stocks, th: { ...C.CONFIG.th }, notif: true, quiet: true, qFrom: 23, qTo: 8,
  kA: '', kM: 'claude-sonnet-5-5', kT: '', kF: '', binK: '', binS: '', simCap: 10000, onb: false, show: { ema: true, bb: false, rsi: true, vol: true } };
const st = {
  set: { ...DEF, ...load('tm_set', {}) }, tick: {}, daily: {}, h1: {}, S: {}, an: {}, bt: {}, prob: {}, model: {}, fngMap: null, fng: [], glob: null, news: [], cc: {},
  alerts: load('tm_alerts', []), seen: load('tm_seen', {}), chat: load('tm_chat', []), journal: load('tm_journal', []), palerts: load('tm_palerts', []),
  sim: load('tm_sim', null), port: load('tm_port', { hold: [], binAt: 0 }), err: {}, busy: 0, kind: 'crypto', nf: 'all', atab: 'rec', itab: 'chat', sheet: null,
  sym: load('tm_sym', 'BTC'), tf: load('tm_tf', '4h'), liveUp: false, valid: new Set(),
};
st.set.th = { ...DEF.th, ...st.set.th }; st.set.show = { ...DEF.show, ...st.set.show };
st.sim = st.sim ? SIM.migrate(st.sim) : SIM.newSim(st.set.simCap);
const firstRun = !Object.keys(st.seen).length;
const saveSim = () => save('tm_sim', st.sim), savePort = () => save('tm_port', st.port), saveSet = () => save('tm_set', st.set);

/* ================= formatare ================= */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (x, d) => x.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });
const fp = C.fmtP;
const usd = (v, d = 0) => (v == null || !isFinite(v) ? '—' : (v < 0 ? '−$' : '$') + nf(Math.abs(v), d));
const pc = (x, d = 1) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + nf(Math.abs(x), d) + '%');
const sgnUsd = (v) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + '$' + nf(Math.abs(v), Math.abs(v) < 100 ? 2 : 0));
const pcRaw = (x) => (x == null || !isFinite(x) ? '—' : Math.round(x * 100) + '%');
const cls = (x) => (x == null ? '' : x >= 0 ? 'up' : 'dn');
const ago = (t) => { const m = (Date.now() - t) / 6e4; return m < 1 ? 'acum' : m < 60 ? `acum ${m | 0} min` : m < 1440 ? `acum ${(m / 60) | 0} h` : `acum ${(m / 1440) | 0} z`; };
const STABLE = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'USD']);
const isStock = (s) => st.set.stocks.includes(s);
const kindOf = (s) => (isStock(s) ? 'stocks' : 'crypto');
const px = (s) => (STABLE.has(s) ? 1 : st.tick[s]?.price ?? (st.daily[s]?.length ? st.daily[s].at(-1).c : null));
const ch24 = (s) => (STABLE.has(s) ? 0 : st.tick[s]?.chg24 ?? st.an[s]?.chg1d ?? null);
const M = () => st.model.crypto;
const SIDE = { long: 'Long', short: 'Short' };

/* ================= semnalul unic pe activ ================= */
function sig(s) {
  const a = st.an[s]; if (!a) return null;
  const p = st.prob[s], m = st.model[kindOf(s)];
  if (m && p != null) {
    if (m.edgeL && p >= m.thr && a.score > -15) return { txt: 'Long', side: 'long', tone: 'p-up', strong: true, why: `AI ${pcRaw(p)} sus, peste pragul dovedit` };
    if (m.edgeS && p <= m.thrS && a.score < 15) return { txt: 'Short', side: 'short', tone: 'p-dn', strong: true, why: `AI ${pcRaw(1 - p)} jos, în zona dovedită` };
  }
  if (a.score >= 35) return { txt: 'Înclinat long', side: 'long', tone: 'p-up', why: a.reasons.filter((r) => r[0] > 0).slice(0, 2).map((r) => r[1]).join(' · ') };
  if (a.score <= -35) return { txt: 'Înclinat short', side: 'short', tone: 'p-dn', why: a.reasons.filter((r) => r[0] < 0).slice(0, 2).map((r) => r[1]).join(' · ') };
  return { txt: 'Așteaptă', side: null, tone: 'p-flat', why: 'Semnale amestecate, nimic clar' };
}
const probTxt = (s) => (st.prob[s] == null ? '' : `<span class="prob" title="Șansa să fie mai sus în 7 zile">${st.prob[s] >= 0.5 ? '<span class="up">↑</span>' : '<span class="dn">↓</span>'} ${pcRaw(st.prob[s])}</span>`);
const rank = (s) => { const g = sig(s); return g ? (g.strong ? 200 : 0) + Math.abs(st.an[s].score) + (g.side ? 50 : 0) : -1; };

/* ================= date ================= */
async function safe(name, fn) {
  st.busy++; liveStatus();
  try { await fn(); delete st.err[name]; } catch (e) { st.err[name] = e.message || String(e); console.warn(name, e); }
  finally { st.busy--; liveStatus(); }
}
const mergeC = (old, nw) => { if (!old?.length) return nw; const m = new Map(old.map((x) => [x.t, x])); nw.forEach((x) => m.set(x.t, x)); return [...m.values()].sort((a, b) => a.t - b.t); };
const extraSyms = () => [...new Set([...st.port.hold.map((h) => h.sym), ...st.sim.pos.map((p) => p.sym), ...st.palerts.map((a) => a.sym)])].filter((s) => !STABLE.has(s) && !st.set.crypto.includes(s) && !isStock(s));

async function pullTickers() {
  await safe('preț', async () => {
    try { Object.assign(st.tick, await C.cryptoTickers(st.set.crypto)); st.set.crypto.forEach((s) => st.valid.add(s)); }
    catch (e) { const r = await Promise.allSettled(st.set.crypto.map(async (s) => { Object.assign(st.tick, await C.cryptoTickers([s])); st.valid.add(s); })); if (!r.some((x) => x.status === 'fulfilled')) throw e; }
    st.lastT = Date.now();
  });
  await Promise.allSettled(extraSyms().map(async (s) => { Object.assign(st.tick, await C.cryptoTickers([s])); st.valid.add(s); }));
  live.set([...st.valid]); renderTicks(true);
}
async function pullCrypto(full = false) {
  await safe('crypto', async () => {
    const res = await Promise.allSettled(st.set.crypto.map(async (s) => {
      const need = full || !st.daily[s]; const d = await C.cryptoKlines(s, '1d', need ? 1000 : 3);
      st.daily[s] = need ? d : mergeC(st.daily[s], d).slice(-1000); st.h1[s] = await C.cryptoKlines(s, '1h', 168);
    }));
    const bad = res.filter((r) => r.status === 'rejected'); if (bad.length === res.length) throw bad[0].reason;
  });
  if (full || Date.now() - (st.model.at || 0) > 6 * 3600e3) await train();
  recompute('crypto');
}
async function pullStocks() {
  if (!st.set.kT) return;
  await safe('acțiuni', async () => Object.assign(st.daily, await C.stockSeries(st.set.stocks.slice(0, 8), st.set.kT)));
  const L = st.set.stocks.filter((s) => st.daily[s]?.length > 300).map((s) => ({ sym: s, S: C.series(st.daily[s]) }));
  if (L.length >= 2) st.model.stocks = C.buildModel(L, { fee: 0.05 });
  recompute('stocks');
}
async function pullMacro() {
  await safe('sentiment', async () => { st.fng = await C.fearGreed(30); });
  await safe('global', async () => { st.glob = await C.globalMkt(); });
  handle(C.marketAlerts({ fng: st.fng[0]?.v })); renderHome();
}
async function pullNews() {
  await safe('știri', async () => { st.news = await C.news({ finnhubKey: st.set.kF }); });
  handle(C.newsAlerts(st.news)); renderNewsMini(); if (st.sheet === 'news') openNews();
}
async function train() {
  if (!st.fngMap) await safe('istoric sentiment', async () => { st.fngMap = await C.fngHistory(); });
  await new Promise((r) => setTimeout(r, 30));
  const L = st.set.crypto.filter((s) => st.daily[s]?.length > 400).map((s) => ({ sym: s, S: C.series(st.daily[s]) }));
  const m = L.length ? C.buildModel(L, { fngMap: st.fngMap }) : null;
  if (m) { st.model.crypto = m; st.model.at = Date.now(); }
}

function recompute(kind) {
  const list = kind === 'crypto' ? st.set.crypto : st.set.stocks, m = st.model[kind], D = C.dayKey(Date.now());
  for (const s of list) {
    const d = st.daily[s]; if (!d || d.length < 60) continue;
    const S = C.series(d); st.S[s] = S;
    const a = C.analyze(S, { fng: st.fng[0]?.v, kind }); st.an[s] = a; st.bt[s] = null;
    const p = m ? C.probNow(m, S, kind === 'crypto' ? st.fngMap : null) : null; st.prob[s] = p;
    const al = C.detectAlerts({ sym: s, kind, S, a, h1: kind === 'crypto' ? st.h1[s] : null, live: kind === 'crypto' ? st.tick[s] : null, th: st.set.th });
    const g = sig(s);
    if (g?.strong) al.push({ key: `ai:${s}:${D}:${g.side}`, level: 'high', sym: s, t: Date.now(), side: g.side,
      title: g.side === 'long' ? `🧠 AI Long: ${s} are ${pcRaw(p)} șanse să urce în 7 zile` : `🧠 AI Short: ${s} are ${pcRaw(1 - p)} șanse să scadă în 7 zile`,
      body: g.side === 'long' ? `Pe date nevăzute, peste pragul ăsta a nimerit ${pcRaw(m.test.hitSel)} (bază ${pcRaw(m.test.base)}).` : `Pe date nevăzute, sub pragul ăsta prețul a scăzut în ${pcRaw(m.test.downSel)} din cazuri (bază ${pcRaw(1 - m.test.base)}).` });
    for (const x of al) if (/^(opp|ai):/.test(x.key) && !st.seen[x.key]) journalAdd(x.key.split(':')[0], s, a.price, p, a.score, x.side || 'long');
    handle(al);
    if (kind === 'crypto') autopilot(s, a, g);
  }
  evalJournal(); renderAll();
}

/* ================= învățare din greșeli ================= */
function journalAdd(type, sym, price, prob, score, side) {
  st.journal.unshift({ id: Date.now() + sym + type, type, sym, side, t: Date.now(), price, prob, score, done: false });
  st.journal = st.journal.slice(0, 400); save('tm_journal', st.journal);
}
function evalJournal() {
  let ch = false;
  for (const j of st.journal) {
    if (j.done || Date.now() - j.t < 7 * 864e5) continue;
    const d = st.daily[j.sym]; if (!d) continue;
    const k = d.find((x) => x.t >= j.t + 6.5 * 864e5); if (!k) continue;
    j.ret = (k.c / j.price - 1) * 100; j.ok = (j.side === 'short' ? -1 : 1) * j.ret > 0; j.done = true; ch = true;
  }
  if (ch) save('tm_journal', st.journal);
}
function learnStats() {
  const by = {};
  for (const j of st.journal.filter((x) => x.done)) { const k = j.type + (j.side === 'short' ? '-s' : ''); const b = (by[k] ||= { n: 0, w: 0, r: 0 }); b.n++; b.w += j.ok ? 1 : 0; b.r += (j.side === 'short' ? -1 : 1) * j.ret; }
  for (const k in by) { const b = by[k]; b.hit = b.w / b.n; b.avg = b.r / b.n; b.muted = b.n >= 8 && (b.w + 1) / (b.n + 2) < 0.45; }
  return by;
}
const muted = (key, side) => { const t = key.split(':')[0]; return learnStats()[t + (side === 'short' ? '-s' : '')]?.muted; };

/* ================= auto-pilot ================= */
function autopilot(s, a, g) {
  if (!st.sim.auto || !g?.strong || muted('ai:', g.side)) return;
  if (st.sim.pos.some((x) => x.sym === s) || st.sim.pos.filter((x) => x.src === 'auto').length >= 5) return;
  const price = px(s); if (!price || !a.atr) return;
  const d = g.side === 'short' ? -1 : 1, sl = price - d * 2 * a.atr, tp = price + d * 3 * a.atr;
  const amt = Math.min(st.sim.cash * 0.98, SIM.equity(st.sim, px) * 0.1); if (amt < 20) return;
  try {
    SIM.openPos(st.sim, { sym: s, side: g.side, price, margin: amt, lev: 1, sl, tp, src: 'auto', maxH: 7 * 864e5 }); saveSim();
    notify({ key: 'auto:' + s + Date.now(), level: 'high', sym: s, t: Date.now(), title: `🤖 Auto-pilot: ${SIDE[g.side]} ${s} (demo)`, body: `${usd(amt)} la ${fp(price)}. Stop ${fp(sl)}, țintă ${fp(tp)}, maxim 7 zile.` }, false, true);
  } catch {}
}

/* ================= alerte + notificări ================= */
function handle(list) {
  let n = 0;
  for (const al of list) {
    if (st.seen[al.key]) continue; st.seen[al.key] = Date.now();
    const mu = muted(al.key, al.side); if (mu) { al.body += ' (notificare oprită: semnalul ăsta a greșit des)'; al.level = 'med'; }
    st.alerts.unshift(al); n++;
    if (!mu && (!firstRun || al.level === 'high')) notify(al, firstRun);
  }
  if (!n) return;
  const wk = Date.now() - 8 * 864e5; for (const k in st.seen) if (st.seen[k] < wk) delete st.seen[k];
  st.alerts = st.alerts.slice(0, 200); save('tm_alerts', st.alerts); save('tm_seen', st.seen);
  save('tm_unread', load('tm_unread', 0) + n); badge(); if (cur() === 'alerte') renderAlerts();
}
function quietNow() { const h = new Date().getHours(), { qFrom: a, qTo: b } = st.set; return st.set.quiet && (a > b ? h >= a || h < b : h >= a && h < b); }
async function notify(al, silentSys = false, record = false) {
  if (record) { st.alerts.unshift(al); save('tm_alerts', st.alerts); save('tm_unread', load('tm_unread', 0) + 1); badge(); }
  toast(al);
  if (silentSys || !st.set.notif || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (quietNow() && al.level !== 'high') return;
  try { const reg = await navigator.serviceWorker?.ready; await reg.showNotification(al.title, { body: al.body, tag: al.key, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: al.url || './#alerte' } }); }
  catch { try { new Notification(al.title, { body: al.body }); } catch {} }
}
let tq = [], tOn = false;
function toast(al) { if (tq.length >= 3) return; tq.push(al); if (!tOn) nextToast(); }
function nextToast() {
  const al = tq.shift(), el = $('#toast'); if (!al) { tOn = false; return; } tOn = true;
  el.innerHTML = `<b>${esc(al.title)}</b>${al.body ? `<p>${esc(al.body)}</p>` : ''}`; el.classList.add('on');
  setTimeout(() => { el.classList.remove('on'); setTimeout(nextToast, 300); }, 3800);
}
function badge() { const u = load('tm_unread', 0), b = $('#badge'); b.hidden = !u; b.textContent = u > 99 ? '99+' : u; }

/* ================= live ================= */
const TF = { '5m': ['5m', 3e5], '15m': ['15m', 9e5], '1h': ['1h', 36e5], '4h': ['4h', 144e5], '1Z': ['1d', 864e5], '1S': ['1w', 6048e5] };
let pend = new Set(), rafOn = false;
const live = new Live((s, t) => {
  const prev = st.tick[s]?.price; st.tick[s] = { ...st.tick[s], ...t, prev }; st.lastT = Date.now(); pend.add(s);
  const d = st.daily[s]; if (d?.length) { const k = d.at(-1); k.c = t.price; k.h = Math.max(k.h, t.price); k.l = Math.min(k.l, t.price); }
  for (const tf in TF) { if (tf === '1Z') continue; const c = st.cc[s + tf]; if (!c?.cs.length) continue; const k = c.cs.at(-1), now = t.t || Date.now();
    if (now >= k.t + TF[tf][1]) c.cs.push({ t: k.t + TF[tf][1] * Math.floor((now - k.t) / TF[tf][1]), o: t.price, h: t.price, l: t.price, c: t.price, v: 0 });
    else { k.c = t.price; k.h = Math.max(k.h, t.price); k.l = Math.min(k.l, t.price); } }
  onPriceAlerts(s, t.price);
  const closed = SIM.checkLive(st.sim, px); if (closed.length) { saveSim(); closed.forEach(simClosedNote); renderPositions(); }
  if (!rafOn) { rafOn = true; setTimeout(() => { rafOn = false; renderTicks(); }, 600); }
}, (up) => { st.liveUp = up; liveStatus(); });

function renderTicks(all = false) {
  const set = all ? Object.keys(st.tick) : [...pend]; pend.clear();
  for (const s of set) {
    const t = st.tick[s]; if (!t) continue;
    for (const el of $$(`[data-p="${s}"]`)) { el.textContent = (el.dataset.u ? '$' : '') + fp(t.price); if (t.prev && t.prev !== t.price) { el.classList.remove('flash-u', 'flash-d'); void el.offsetWidth; el.classList.add(t.price > t.prev ? 'flash-u' : 'flash-d'); } }
    for (const el of $$(`[data-c="${s}"]`)) { el.textContent = pc(t.chg24); el.className = cls(t.chg24); }
  }
  renderPortCard(); liveStatus();
  if (cur() === 'trade') { renderAcct(); if (set.some((s) => st.sim.pos.some((p) => p.sym === s))) renderPositions(); }
  if (set.includes(st.sym)) { st.chart?.draw(); st.fchart?.draw(); }
}
function liveStatus() {
  const e = Object.keys(st.err), d = $('#liveDot'), t = $('#liveTxt'); if (!d) return;
  d.className = 'live' + (st.liveUp ? ' on' : e.length && !st.lastT ? ' err' : '');
  const day = new Date().toLocaleDateString('ro-RO', { weekday: 'long', day: 'numeric', month: 'short' });
  t.textContent = `${day[0].toUpperCase() + day.slice(1)} · ${st.liveUp ? 'live' : st.busy ? 'actualizez…' : e.length && !st.lastT ? 'fără conexiune: ' + e[0] : st.lastT ? 'actualizat ' + ago(st.lastT) : 'pornește…'}`;
}

/* ================= alerte de preț ================= */
function onPriceAlerts(s, p) {
  let ch = false;
  for (const a of st.palerts) {
    if (!a.on || a.sym !== s) continue;
    if ((a.op === '<' && p <= a.price) || (a.op === '>' && p >= a.price)) {
      a.on = false; a.hitAt = Date.now(); ch = true;
      notify({ key: 'pa:' + a.id, level: 'high', sym: s, t: Date.now(), title: `🎯 ${s} ${a.op === '<' ? 'a coborât sub' : 'a urcat peste'} $${fp(a.price)}`, body: `Preț acum: $${fp(p)}. Alerta s-a oprit; o reactivezi din Alerte.` }, false, true);
    }
  }
  if (ch) { save('tm_palerts', st.palerts); if (cur() === 'alerte') renderAlerts(); }
}
function simClosedNote(h) {
  if (!h) return;
  notify({ key: 'simc:' + h.id, level: 'high', sym: h.sym, t: Date.now(), title: `${h.pnl >= 0 ? '✅' : '❌'} Demo: ${SIDE[h.side]} ${h.sym} închis la ${h.reason} (${sgnUsd(h.pnl)})`, body: `Intrare ${fp(h.entry)} → ieșire ${fp(h.exit)}, ${pc(h.pnlPct)} din marjă.` }, false, true);
}

/* ================= Acasă ================= */
const cur = () => location.hash.slice(1) || 'acasa';
function verdict() {
  const f = st.fng[0]?.v, b = st.an.BTC, vals = Object.values(st.an), br = vals.length ? vals.filter((a) => a.score > 0).length / vals.length : 0.5, m = M();
  const L = st.set.crypto.filter((s) => sig(s)?.strong && sig(s).side === 'long').length, S = st.set.crypto.filter((s) => sig(s)?.strong && sig(s).side === 'short').length;
  let k = 'n', h, p;
  if (f != null && f <= 25) { k = ''; h = `Frică extremă.${b?.dd90 < -15 ? ` BTC e la ${pc(b.dd90, 0)} de maximul pe 90 de zile.` : ''}`; p = 'Istoric, zonele astea au fost mai des de acumulare decât de vânzare. Dacă intri, etapizat și fără leverage.'; }
  else if (f != null && f >= 75) { k = ''; h = 'Lăcomie în piață.'; p = 'Euforia e momentul de luat profit parțial, nu de intrat cu tot.'; }
  else if (br >= 0.6) { k = 'g'; h = 'Piața e pe verde.'; p = 'Majoritatea activelor au setup pozitiv. Caută intrări pe retrageri, cu stop clar.'; }
  else if (br <= 0.3) { k = ''; h = 'Piață slabă.'; p = 'Cele mai multe active sunt în trend negativ. Ține cash sau caută short-uri cu stop clar.'; }
  else { h = 'Piață fără direcție clară.'; p = 'Nu e grabă. Așteaptă confirmare înainte să intri.'; }
  if (m) p += L || S ? ` AI: ${L ? `${L} semnal${L > 1 ? 'e' : ''} long` : ''}${L && S ? ', ' : ''}${S ? `${S} semnal${S > 1 ? 'e' : ''} short` : ''} cu avantaj dovedit.` : ' AI: niciun semnal cu avantaj dovedit acum.';
  return { k, h, p, f };
}
function renderHome() {
  $('#hello').textContent = st.set.name ? `Bună, ${st.set.name}` : 'Bună';
  if (!Object.keys(st.an).length) return;
  const v = verdict();
  $('#verdict').className = 'verdict ' + v.k;
  $('#verdict').innerHTML = `<div class="k">VERDICTUL ZILEI</div><h2>${esc(v.h)}</h2><p>${esc(v.p)}</p>
    <div class="fg"><span>Sentiment ${v.f ?? '—'}</span><div class="fgb"><i style="left:${v.f ?? 50}%"></i></div></div>
    <div class="act"><button class="btn" data-go="piata">Vezi semnalele</button><button class="btn g" data-ask="Explică-mi verdictul zilei pe scurt și ce aș face concret azi.">De ce?</button></div>`;
  renderPortCard(); renderTopSig(); renderNewsMini(); liveStatus();
}
function portCalc() {
  let val = 0, cost = 0, costKnown = true, d24 = 0; const rows = [];
  for (const h of st.port.hold) {
    const p = px(h.sym), v = p != null ? h.qty * p : null; if (v == null) continue;
    val += v; const c = ch24(h.sym); if (c != null) d24 += v - v / (1 + c / 100);
    if (h.cost) cost += h.qty * h.cost; else costKnown = false;
    rows.push({ ...h, p, v, pnl: h.cost ? v - h.qty * h.cost : null });
  }
  rows.sort((a, b) => b.v - a.v);
  return { val, cost, pnl: cost && costKnown ? val - cost : null, d24, rows };
}
const COLS = ['#4FB3E8', '#FF7A1A', '#22C38E', '#B9A2FF', '#FFD166', '#FF5A6E', '#7FD4A8', '#8AA0B8'];
function renderPortCard() {
  const el = $('#portCard'); if (!el) return;
  if (!st.port.hold.length) { el.innerHTML = `<div class="port"><div><b style="font-size:15px">Adaugă ce deții</b><div class="sm mut" style="margin-top:2px">Manual sau din Binance. Vezi profitul și semnalele pe ce ai.</div></div><span class="btn g">Adaugă</span></div>`; return; }
  const P = portCalc();
  el.innerHTML = `<div class="port"><div><div class="big num" style="font-size:26px">${usd(P.val)}</div><span class="xs mut">Valoare totală</span></div>
    <div style="text-align:right"><b class="${cls(P.d24)}" style="font:700 20px var(--H)">${sgnUsd(P.d24)}</b><div class="xs mut">${pc((P.d24 / (P.val - P.d24 || 1)) * 100)} azi${P.pnl != null ? ` · ${sgnUsd(P.pnl)} total` : ''}</div></div></div>
    <div class="alloc">${P.rows.slice(0, 8).map((r, i) => `<i style="width:${(r.v / P.val) * 100}%;background:${COLS[i]}"></i>`).join('')}</div>`;
}
function sRow(s) {
  const g = sig(s), c = ch24(s);
  return `<div class="srow" data-sym="${s}"><div class="ic">${s[0]}</div><div class="nm"><b>${s} <span class="xs mut" style="font-weight:400">${esc(C.nameOf(s))}</span></b><span class="xs">$<span data-p="${s}">${fp(px(s))}</span> · <span data-c="${s}" class="${cls(c)}">${pc(c)}</span></span><div class="why">${esc(g?.why || '')}</div></div>${probTxt(s)}<span class="pill ${g?.tone || 'p-flat'}">${g?.txt || '…'}</span></div>`;
}
function renderTopSig() {
  const L = Object.keys(st.an).filter((s) => sig(s)?.side).sort((a, b) => rank(b) - rank(a)).slice(0, 4);
  $('#topSig').innerHTML = L.length ? L.map(sRow).join('') : '<div class="empty">Nimic clar acum. Uneori cea mai bună mișcare e să aștepți.</div>';
}
function newsHTML(x) {
  return `<a class="news" href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.title)}</b><div class="m">${x.imp >= 5 ? '<span class="pill p-or" style="padding:2px 7px;font-size:11px">IMPORTANT</span>' : ''}<span class="${x.sent > 0 ? 'up' : x.sent < 0 ? 'dn' : ''}">${x.sent > 0 ? '▲ pozitiv' : x.sent < 0 ? '▼ negativ' : '• neutru'}</span><span>${esc(x.src)}</span><span>${ago(x.t)}</span>${x.tags.map((t) => `<span class="pill p-flat" style="padding:2px 7px;font-size:11px">${t}</span>`).join('')}</div></a>`;
}
function renderNewsMini() {
  const el = $('#newsMini'); if (!el) return;
  const mine = new Set([...st.port.hold.map((h) => h.sym), ...st.set.crypto]), sc = (x) => x.imp + (x.tags.some((t) => mine.has(t)) ? 2 : 0);
  const L = st.news.filter((x) => Date.now() - x.t < 36 * 3600e3).sort((a, b) => sc(b) - sc(a) || b.t - a.t).slice(0, 3);
  el.innerHTML = L.length ? L.map(newsHTML).join('') : `<div class="empty">${st.err['știri'] ? 'Știrile nu se încarcă acum.' : 'Se încarcă…'}</div>`;
}

/* ================= Piață ================= */
function renderMkt() {
  const list = st.kind === 'crypto' ? st.set.crypto : st.kind === 'stocks' ? st.set.stocks : st.port.hold.map((h) => h.sym);
  const el = $('#mkt');
  if (st.kind === 'stocks' && !st.set.kT) { el.innerHTML = '<div class="empty">Pune cheia gratuită Twelve Data în Setări ca să analizez acțiunile.</div>'; return; }
  if (st.kind === 'port' && !list.length) { el.innerHTML = '<div class="empty">Adaugă ce deții în Portofoliu și aici vezi semnalele doar pentru ele.</div>'; return; }
  const arr = list.filter((s) => st.an[s]).sort((a, b) => rank(b) - rank(a));
  el.innerHTML = arr.length ? arr.map(sRow).join('') : '<div class="sk" style="height:300px"></div>';
}

/* ================= Trade ================= */
async function chartData(s, tf) {
  if (isStock(s)) tf = '1Z';
  const key = s + tf;
  if (tf === '1Z' && st.daily[s]?.length) { if (st.cc[key]?.cs !== st.daily[s]) st.cc[key] = { cs: st.daily[s], at: Date.now(), full: isStock(s) }; return st.cc[key]; }
  if (st.cc[key] && Date.now() - st.cc[key].at < 5 * 60e3) return st.cc[key];
  const cs = await C.cryptoKlines(s, TF[tf][0], 500);
  st.cc[key] = { cs: st.cc[key] ? mergeC(st.cc[key].cs, cs) : cs, at: Date.now() }; return st.cc[key];
}
async function loadOlder(s, tf) {
  const key = s + tf, c = st.cc[key]; if (!c || c.loading || c.full || isStock(s) || c.cs.length > 4000) return;
  c.loading = true;
  try {
    const old = await C.cryptoKlines(s, TF[tf][0], 500, c.cs[0].t - 1), add = old.filter((k) => k.t < c.cs[0].t);
    if (add.length < 2) c.full = true; else { c.cs.unshift(...add); for (const ch of [st.chart, st.fchart]) if (ch) ch.view.off += 0; st.chart?.draw(); st.fchart?.draw(); }
  } catch { c.full = true; } finally { c.loading = false; }
}
const indCache = {};
function inds(key, cs) {
  const id = cs.length + ':' + cs[0]?.t + ':' + cs.at(-1)?.c; if (indCache[key]?.id === id) return indCache[key].v;
  const cl = cs.map((k) => k.c), b = C.bollinger(cl);
  const v = { e20: C.ema(cl, 20), e50: C.ema(cl, 50), e200: C.ema(cl, 200), bbU: b.up, bbL: b.lo, rsi: C.rsi(cl) };
  indCache[key] = { id, v }; return v;
}
function chartLines(s) {
  const L = [], a = st.an[s], g = sig(s);
  for (const p of st.sim.pos.filter((x) => x.sym === s)) {
    L.push({ v: p.entry, c: p.side === 'long' ? '#22C38E' : '#FF5A6E', t: `${SIDE[p.side]} ${p.lev}× @ ${fp(p.entry)}`, solid: true });
    if (p.sl) L.push({ v: p.sl, c: '#FF7A1A', t: `Stop ${fp(p.sl)}` }); if (p.tp) L.push({ v: p.tp, c: '#4FB3E8', t: `Țintă ${fp(p.tp)}` });
    if (p.lev > 1) L.push({ v: p.liq, c: '#FF5A6E', t: `Lichidare ${fp(p.liq)}` });
  }
  if (!L.length && g?.side && a) { const pl = C.planFor(a, px(s), g.side); if (pl) L.push({ v: pl.stop, c: '#FF7A1A', t: `Stop plan ${fp(pl.stop)}` }, { v: pl.target, c: '#4FB3E8', t: `Țintă plan ${fp(pl.target)}` }); }
  for (const al of st.palerts.filter((x) => x.on && x.sym === s)) L.push({ v: al.price, c: '#FFD166', t: `Alertă ${fp(al.price)}` });
  return L;
}
function makeChart(cv, tip, s, tf) {
  return proChart(cv, () => {
    const c = st.cc[s + tf]; if (!c) return { cs: [], ind: {}, show: st.set.show, fmt: fp };
    return { cs: c.cs, ind: inds(s + tf, c.cs), show: st.set.show, lines: chartLines(s), fmt: fp, intraday: !['1Z', '1S'].includes(tf), onNeedMore: () => loadOlder(s, tf) };
  }, tip);
}
const curTf = (s) => (isStock(s) ? '1Z' : st.tf);
function tfButtons(s) {
  const tfs = isStock(s) ? ['1Z'] : Object.keys(TF);
  return tfs.map((k) => `<button data-tf="${k}" class="${curTf(s) === k ? 'on' : ''}">${k}</button>`).join('') + '<span class="sp"></span>'
    + [['ema', 'EMA'], ['bb', 'BB'], ['rsi', 'RSI'], ['vol', 'Vol']].map(([k, l]) => `<button class="ind ${st.set.show[k] ? 'on' : ''}" data-ind="${k}">${l}</button>`).join('');
}
function renderAcct() {
  const el = $('#acct'); if (!el) return;
  const eq = SIM.equity(st.sim, px), pnl = eq - st.sim.start; SIM.recordEq(st.sim, eq);
  el.innerHTML = `<div><span class="xs mut">Cont demo</span><div><b>${usd(eq, 2)}</b> <span class="sm ${cls(pnl)}">${pc((pnl / st.sim.start) * 100, 2)}</span></div></div><div style="text-align:right"><span class="xs mut">Disponibil</span><div><b style="font-size:14px">${usd(st.sim.cash)}</b></div></div>`;
}
async function renderTrade(full = true) {
  const syms = [...st.set.crypto, ...st.set.stocks.filter((s) => st.daily[s])];
  if (!syms.includes(st.sym)) st.sym = syms[0] || 'BTC';
  const s = st.sym, g = sig(s), c = ch24(s);
  renderAcct();
  $('#symBar').innerHTML = syms.map((x) => `<button data-pick="${x}" class="${x === s ? 'on' : ''}">${x}</button>`).join('');
  $('#tHead').innerHTML = `<div><div class="sm mut">${esc(C.nameOf(s))}</div><div class="big">$<span data-p="${s}">${fp(px(s))}</span></div><div class="sm"><span data-c="${s}" class="${cls(c)}">${pc(c)}</span> <span class="mut">24h</span></div></div>
    <div style="text-align:right;display:grid;gap:6px;justify-items:end">${g ? `<span class="pill ${g.tone}">${g.txt}</span>` : ''}${probTxt(s)}<button class="ib" id="goFs" aria-label="Grafic pe tot ecranul" style="width:36px;height:36px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button></div>`;
  $('#tfBar').innerHTML = tfButtons(s);
  if (full || !st.chart) {
    st.chart?.stop(); st.chart = null;
    try { await chartData(s, curTf(s)); } catch (e) { toast({ title: 'Graficul nu se încarcă', body: e.message }); }
    if (st.sym === s && cur() === 'trade') st.chart = makeChart($('#tc'), $('#ttip'), s, curTf(s));
  } else st.chart.draw();
  renderTBody(); renderPositions();
}
function renderTBody() {
  const s = st.sym, a = st.an[s], g = sig(s), p = st.prob[s], m = st.model[kindOf(s)];
  if (!a) { $('#tBody').innerHTML = '<div class="card empty">Analiza apare după ce se încarcă istoricul.</div>'; return; }
  const side = g?.side || (a.score >= 0 ? 'long' : 'short'), pl = C.planFor(a, px(s), side);
  if (!st.bt[s] && st.S[s]) st.bt[s] = C.backtest(st.S[s], kindOf(s));
  const b = st.bt[s], bk = m && p != null ? m.test.buckets.find((x) => p >= x.a && p < x.b) : null;
  const row = (r, base) => `<tr${base ? ' class="base"' : ''}><td>${esc(r.name)}</td><td>${r.n}</td><td class="${cls(r.avg7)}">${pc(r.avg7)}</td><td class="${cls(r.avg30)}">${pc(r.avg30)}</td><td>${r.win30 == null ? '—' : Math.round(r.win30) + '%'}</td></tr>`;
  $('#tBody').innerHTML = `<div class="card" style="padding:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b style="font:600 18px var(--H)">${g?.side ? `Plan ${SIDE[side]}` : `Dacă intri (${SIDE[side]})`}</b><span class="pill ${g?.tone || 'p-flat'}">${g?.txt || 'Așteaptă'}</span></div>
      <p class="sm" style="color:var(--sub);margin:6px 0 12px">${esc(g?.why || '')}</p>
      ${pl ? `<div class="pg"><div><span>Intrare</span><b>${fp(pl.entry)}</b></div><div><span>Stop</span><b style="color:var(--or)">${fp(pl.stop)}</b></div><div><span>Țintă</span><b style="color:var(--sky)">${fp(pl.target)}</b></div></div>
      <p class="xs mut" style="margin:10px 0 0">Stop la 2× mișcarea medie zilnică (${nf(pl.riskPct, 1)}%), țintă la dublul riscului (R:R 1:2).</p>` : ''}
      ${bk ? `<div class="wb" style="margin-top:12px"><span>AI ${pcRaw(p)} sus</span><div class="wbb"><i style="width:${(bk.hit ?? 0) * 100}%"></i></div><span>istoric: ${pcRaw(bk.hit)} sus, n${bk.n}</span></div>` : ''}
      <div class="act"><button class="btn g" data-palert="${s}">Alertă de preț</button><button class="btn g" data-ask="Analizează ${s} acum: long, short sau aștept? Unde intru, stop și țintă?">Întreabă AI</button></div></div>
    <div class="card"><details><summary>De ce: scor ${a.score > 0 ? '+' : ''}${a.score}, RSI ${a.rsi?.toFixed(0)}, trend ${a.trend} →</summary>
      ${a.reasons.map((r) => `<div class="rs"><b class="${r[0] > 0 ? 'up' : 'dn'}">${r[0] > 0 ? '+' : ''}${r[0]}</b><span>${esc(r[1])}</span></div>`).join('')}
      <div class="g2" style="margin-top:10px"><div><span>Suport 20z</span><b>${fp(a.support)}</b></div><div><span>Rezistență 20z</span><b>${fp(a.resistance)}</b></div><div><span>Volatilitate anuală</span><b>${a.vol30?.toFixed(0)}%</b></div><div><span>De la max 90z</span><b class="dn">${pc(a.dd90, 0)}</b></div></div></details></div>
    ${b ? `<div class="card"><details><summary>Ce a făcut ${s} istoric după fiecare semnal →</summary><div style="overflow-x:auto;margin-top:8px"><table><thead><tr><th>Semnal</th><th>n</th><th>7z</th><th>30z</th><th>Win</th></tr></thead><tbody>${b.rows.map((r) => row(r)).join('')}${row(b.base, true)}</tbody></table></div><p class="xs mut">Pe ultimele ${b.days} zile. Unde n &lt; 6, e mai mult noroc decât statistică.</p></details></div>` : ''}`;
}
function renderPositions() {
  const el = $('#positions'); if (!el) return; const P = st.sim.pos;
  el.innerHTML = P.length ? P.map((p) => { const c = px(p.sym) ?? p.entry, pnl = SIM.pnlAt(p, c), pp = (pnl / p.margin) * 100;
    return `<div class="row" data-pick="${p.sym}"><div class="ic" style="color:${p.side === 'long' ? 'var(--up)' : 'var(--dn)'}">${p.side === 'long' ? '↑' : '↓'}</div><div class="nm"><b>${SIDE[p.side]} ${p.sym} ${p.lev > 1 ? p.lev + '×' : ''} ${p.src === 'auto' ? '<span class="pill p-ai" style="padding:2px 7px;font-size:11px">auto</span>' : ''}</b><span>${usd(p.margin)} la ${fp(p.entry)}${p.sl ? ' · stop ' + fp(p.sl) : ''}${p.tp ? ' · țintă ' + fp(p.tp) : ''}</span></div>
      <div class="pr"><b class="${cls(pnl)}">${sgnUsd(pnl)}</b><span class="${cls(pp)}">${pc(pp)}</span></div><button class="btn g" style="min-height:36px;padding:8px 12px" data-close="${p.id}">Închide</button></div>`; }).join('')
    : '<div class="empty">Nicio poziție deschisă. Apasă Long sau Short deasupra.</div>';
}
function openFs() {
  const s = st.sym, tf = curTf(s); $('#fs').hidden = false;
  const c = ch24(s); $('#fsH').innerHTML = `<b style="font:700 20px var(--H)">${s}</b><b style="font:600 18px var(--H)">$<span data-p="${s}">${fp(px(s))}</span></b><span data-c="${s}" class="${cls(c)}">${pc(c)}</span>`;
  $('#fsTf').innerHTML = tfButtons(s);
  st.fchart?.stop(); st.fchart = makeChart($('#fc'), $('#ftip'), s, tf);
  if (st.chart) { st.fchart.view.n = st.chart.view.n; st.fchart.view.off = st.chart.view.off; st.fchart.draw(); }
}
function closeFs() { if ($('#fs').hidden) return; $('#fs').hidden = true; if (st.chart && st.fchart) { st.chart.view.n = st.fchart.view.n; st.chart.view.off = st.fchart.view.off; } st.fchart?.stop(); st.fchart = null; st.chart?.draw(); }

function openOrder(side) {
  const s = st.sym, a = st.an[s]; if (!px(s)) return toast({ title: 'Încă nu am prețul', body: 'Mai încearcă în câteva secunde.' });
  closeFs(); openSheet('order', `${s} · demo`);
  let lev = 1;
  $('#shB').innerHTML = `<form class="wrap" id="oF" style="margin-top:8px"><div class="side"><button type="button" class="l" data-sd="long">Long ↑</button><button type="button" class="s" data-sd="short">Short ↓</button></div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><span class="sm mut">Preț acum</span><b class="big" style="font-size:26px">$<span data-p="${s}">${fp(px(s))}</span></b></div>
    <label for="oU">Marjă (USD virtuali) · disponibil ${usd(st.sim.cash)}</label><input id="oU" type="number" step="any" inputmode="decimal" value="${Math.floor(Math.min(st.sim.cash * 0.99, SIM.equity(st.sim, px) * 0.1))}">
    <div class="qk">${[10, 25, 50, 100].map((k) => `<button type="button" data-q="${k}">${k}%</button>`).join('')}</div>
    <label>Levier</label><div class="levs">${[1, 2, 3, 5, 10].map((k) => `<button type="button" data-lev="${k}" class="${k === 1 ? 'on' : ''}">${k}×</button>`).join('')}</div>
    <div class="f2"><div><label for="oSL">Stop loss</label><input id="oSL" type="number" step="any" inputmode="decimal"></div><div><label for="oTP">Take profit</label><input id="oTP" type="number" step="any" inputmode="decimal"></div></div>
    <p id="oSum" class="sm" style="margin:14px 0 0;line-height:1.5"></p></div>
    <button class="btn w" id="oGo"></button><p class="xs mut" style="margin:0 4px">Comision simulat 0,1% la intrare și ieșire. Stopul, ținta și lichidarea se execută singure, inclusiv cât aplicația e închisă (verific la redeschidere pe lumânări de 1h).</p></form>`;
  const sum = () => {
    const p = px(s), m = +$('#oU').value, sl = +$('#oSL').value, tp = +$('#oTP').value, eq = SIM.equity(st.sim, px), d = side === 'short' ? -1 : 1;
    if (!(m > 0 && p)) { $('#oSum').textContent = ''; return; }
    const q = (m * lev) / p, risk = sl ? q * d * (p - sl) : null, gain = tp ? q * d * (tp - p) : null, liq = SIM.liqPrice(side, p, lev);
    $('#oSum').innerHTML = `Poziție de <b>${usd(m * lev)}</b> (${q.toPrecision(4)} ${s}). ${risk > 0 ? `La stop pierzi <b class="dn">${usd(risk, 2)}</b> (${nf((risk / eq) * 100, 1)}% din cont${risk / eq > 0.02 ? ', <span class="dn">peste 2%: prea mult</span>' : ''}).` : '<span class="dn">Stop invalid pentru direcția asta.</span>'} ${gain > 0 ? `La țintă câștigi <b class="up">${usd(gain, 2)}</b>${risk > 0 ? `, R:R 1:${nf(gain / risk, 1)}` : ''}.` : ''}${lev > 1 ? `<br>Lichidare la <b class="dn">$${fp(liq)}</b> (${pc((liq / p - 1) * 100)}).${sl && d * (sl - liq) <= 0 ? ' <span class="dn">Stopul e dincolo de lichidare!</span>' : ''}` : ''}`;
  };
  const setSide = (sd) => {
    side = sd; $$('[data-sd]').forEach((b) => b.classList.toggle('on', b.dataset.sd === sd));
    const pl = a && C.planFor(a, px(s), sd); $('#oSL').value = pl ? +pl.stop.toPrecision(6) : ''; $('#oTP').value = pl ? +pl.target.toPrecision(6) : '';
    $('#oGo').className = 'btn w ' + (sd === 'long' ? 'lg' : 'sh'); $('#oGo').textContent = `Deschide ${SIDE[sd]} ${s}`; sum();
  };
  $$('[data-sd]').forEach((b) => (b.onclick = () => setSide(b.dataset.sd)));
  $$('[data-lev]').forEach((b) => (b.onclick = () => { lev = +b.dataset.lev; $$('[data-lev]').forEach((x) => x.classList.toggle('on', x === b)); sum(); }));
  $$('[data-q]').forEach((b) => (b.onclick = () => { $('#oU').value = Math.floor((st.sim.cash * (+b.dataset.q / 100)) / (1 + (lev * st.sim.fee) / 100)); sum(); }));
  ['#oU', '#oSL', '#oTP'].forEach((id) => ($(id).oninput = sum));
  $('#oF').onsubmit = (e) => {
    e.preventDefault();
    try { const p = SIM.openPos(st.sim, { sym: s, side, price: px(s), margin: +$('#oU').value, lev, sl: +$('#oSL').value || null, tp: +$('#oTP').value || null }); saveSim();
      if (!isStock(s)) live.set([...st.valid, s]); toast({ title: `${SIDE[side]} ${s} deschis (demo)`, body: `${usd(p.margin)} × ${lev} la ${fp(p.entry)}` }); closeSheet(); renderPositions(); renderAcct(); st.chart?.draw(); }
    catch (er) { toast({ title: 'Nu merge', body: er.message }); }
  };
  setSide(side || 'long');
}

/* ================= AI · performanță ================= */
function renderPerf() {
  const m = M(), L = learnStats(), all = SIM.simStats(st.sim.hist), as = SIM.simStats(st.sim.hist.filter((h) => h.src === 'auto'));
  const el = $('#aiPerf');
  if (!m) { el.innerHTML = `<div class="card empty">${st.err.crypto ? 'Fără date, nu pot antrena modelul.' : 'Antrenez modelul pe istoricul monedelor…'}</div>`; return; }
  const t = m.test, bk = t.buckets.filter((b) => b.n >= 10);
  const vL = m.edgeL ? `<span class="up">Avantaj dovedit.</span> Peste ${pcRaw(m.thr)}, prețul a urcat în ${pcRaw(t.hitSel)} din cazuri, față de ${pcRaw(t.base)} în orice zi.` : `<span class="dn">Fără avantaj.</span> Peste prag a urcat în ${pcRaw(t.hitSel)}, practic cât în orice zi (${pcRaw(t.base)}). Nu dau semnale long din model.`;
  const vS = t.downSel == null ? 'Prea puține cazuri ca să judec.' : m.edgeS ? `<span class="up">Avantaj dovedit.</span> Sub ${pcRaw(m.thrS)}, prețul a scăzut în ${pcRaw(t.downSel)} din cazuri, față de ${pcRaw(1 - t.base)} în orice zi.` : `<span class="dn">Fără avantaj.</span> Sub prag a scăzut în ${pcRaw(t.downSel)}, față de ${pcRaw(1 - t.base)} în orice zi.`;
  el.innerHTML = `<div class="ins"><div class="k">TEST PE DATE NEVĂZUTE · ${nf(t.n, 0)} CAZURI DIN ${new Date(t.from).toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' }).toUpperCase()} ÎNCOACE</div>
      <p><b>Long:</b> ${vL}</p><p style="margin-top:8px"><b>Short:</b> ${vS}</p>
      <p class="sm" style="color:var(--sub);margin-top:10px">Avantaj dovedit = rată mai bună decât în orice zi <b>și</b> profit după comision care trece testul statistic (pe date aleatoare, testul ăsta dă fals pozitiv în ~5% din cazuri). Primești semnale AI doar pe direcțiile care trec ambele. În test, cu comision și ținere 7 zile: long ${t.long.n} tranzacții, ${pcRaw(t.long.win)} pe plus, ${pc(t.long.avg)} medie · short ${t.short.n} tranzacții, ${pcRaw(t.short.win)} pe plus, ${pc(t.short.avg)} medie.</p></div>
    <div class="card"><b style="font:600 16px var(--H)">Cât de des a urcat prețul, pe niveluri</b><p class="xs mut" style="margin:4px 0 0">Dacă barele cresc de sus în jos, modelul știe să ordoneze. Referință: ${pcRaw(t.base)} în orice zi.</p>
      ${bk.map((b) => `<div class="wb" style="margin-top:10px"><span style="width:70px">AI ${Math.round(b.a * 100)}–${Math.min(100, Math.round(b.b * 100))}%</span><div class="wbb"><i style="width:${b.hit * 100}%;background:${b.hit >= t.base ? 'var(--up)' : 'var(--dn)'}"></i></div><span style="width:88px;text-align:right;white-space:nowrap">${pcRaw(b.hit)} · n${b.n}</span></div>`).join('')}
      <p class="xs mut" style="margin:10px 0 0">Antrenat pe ${nf(m.nRows, 0)} zile din ${m.syms.length} monede, reantrenat la 6 ore.</p></div>
    <div class="card" style="display:flex;align-items:center;gap:12px"><div class="nm"><b>Auto-pilot AI (demo)</b><span>Deschide singur long sau short doar pe semnalele cu avantaj dovedit. Stop 2×ATR, țintă 3×ATR, maxim 7 zile, 10% din cont.</span></div><button class="tg ${st.sim.auto ? 'on' : ''}" id="autoT" aria-label="Auto-pilot"></button></div>
    <div class="card"><b style="font:600 16px var(--H)">Rezultatele tale în demo</b><div style="height:80px;position:relative;margin-top:10px"><canvas id="eqC" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div>
      <div class="g2" style="margin-top:10px"><div><span>Toate tranzacțiile</span><b>${all.n ? `${pcRaw(all.win)} din ${all.n}` : '—'}</b></div><div><span>Doar auto-pilot</span><b>${as.n ? `${pcRaw(as.win)} din ${as.n}` : '—'}</b></div><div><span>Profit factor</span><b>${all.pf == null ? '—' : all.pf === Infinity ? '∞' : nf(all.pf, 2)}</b></div><div><span>Scădere maximă</span><b class="dn">${pc(SIM.maxDD(st.sim.eq))}</b></div></div>
      <button class="btn g w" id="resetSim" style="margin-top:12px">Resetează contul demo</button></div>
    <div class="card"><b style="font:600 16px var(--H)">Învățare din semnalele live</b><p class="xs mut" style="margin:4px 0 6px">Fiecare semnal primit e verificat după 7 zile. Dacă un tip greșește des (sub 45%, din minim 8), îi opresc notificările până își revine.</p>
      ${Object.keys(L).length ? Object.entries(L).map(([k, b]) => `<div class="rs"><b class="${b.hit >= 0.5 ? 'up' : 'dn'}">${pcRaw(b.hit)}</b><span>${{ ai: 'AI long', 'ai-s': 'AI short', opp: 'Oportunități din scor', 'opp-s': 'Scor short' }[k] || k}: ${b.w} din ${b.n} corecte, ${pc(b.avg)} medie${b.muted ? ' · <span class="dn">oprit</span>' : ''}</span></div>`).join('') : `<div class="empty">${st.journal.length} semnale în verificare. Primele rezultate apar la 7 zile după.</div>`}
      ${st.journal.length ? `<details style="margin-top:6px"><summary>Jurnal (${st.journal.length}) →</summary>${st.journal.slice(0, 30).map((j) => `<div class="row" data-pick="${j.sym}"><div class="ic" style="color:${!j.done ? 'var(--mut)' : j.ok ? 'var(--up)' : 'var(--dn)'}">${!j.done ? '…' : j.ok ? '✓' : '✕'}</div><div class="nm"><b>${SIDE[j.side] || 'Long'} ${j.sym}</b><span>${new Date(j.t).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })} la ${fp(j.price)}</span></div><div class="pr">${j.done ? `<b class="${j.ok ? 'up' : 'dn'}">${pc(j.ret)}</b>` : `<span class="mut xs">în ${Math.max(0, Math.ceil((j.t + 7 * 864e5 - Date.now()) / 864e5))}z</span>`}</div></div>`).join('')}</details>` : ''}</div>
    <div class="card"><details><summary>Ce urmărește modelul cel mai mult →</summary>${m.imp.slice(0, 6).map((x) => `<div class="rs"><b class="${x.w > 0 ? 'up' : 'dn'}">${x.w > 0 ? '↑' : '↓'}</b><span>${esc(x.f)} <span class="mut xs">${x.w > 0 ? 'mai mare = mai bullish' : 'mai mare = mai bearish'}</span></span></div>`).join('')}</details></div>`;
  st.eqChart?.stop(); st.eqChart = lineChart($('#eqC'), st.sim.eq, usd);
}

/* ================= Alerte ================= */
function renderAlerts() {
  const el = $('#alBody');
  if (st.atab === 'rec') {
    if (!st.alerts.length) { el.innerHTML = '<div class="wrap"><div class="card empty">Liniște deocamdată. Te anunț când se mișcă ceva.</div></div>'; return; }
    const g = {}; for (const a of st.alerts.slice(0, 120)) { const k = C.dayKey(a.t) === C.dayKey(Date.now()) ? 'AZI' : C.dayKey(a.t) === C.dayKey(Date.now() - 864e5) ? 'IERI' : new Date(a.t).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' }).toUpperCase(); (g[k] ||= []).push(a); }
    const dot = (a) => (/short|scădere|scazut|🩸|sub|❌|death|lo90|risc|lichid/i.test(a.key + a.title) ? 'var(--dn)' : /^news/.test(a.key) ? 'var(--or)' : /^(opp|ai|gc|hi90|auto|simc)|✅|🚀|long/i.test(a.key + a.title) ? 'var(--up)' : 'var(--sky)');
    el.innerHTML = Object.entries(g).map(([k, L]) => `<div class="grp">${k}</div><div class="wrap"><div class="card">${L.map((a) => `<div class="al"${a.url ? ` data-url="${esc(a.url)}"` : a.sym && (st.an[a.sym] || st.tick[a.sym]) ? ` data-pick="${a.sym}"` : ''}><div class="d" style="background:${dot(a)}"></div><div><b>${esc(a.title)}</b><span>${esc(a.body)} · ${ago(a.t)}</span></div></div>`).join('')}</div></div>`).join('')
      + '<div class="wrap" style="margin-top:12px"><button class="btn g w" id="clrA">Golește lista</button></div>';
  } else {
    el.innerHTML = `<div class="grp">ALERTELE MELE DE PREȚ</div><div class="wrap"><div class="card">${st.palerts.length ? st.palerts.map((a) => { const p = px(a.sym), dist = p ? (a.price / p - 1) * 100 : null;
      return `<div class="row" style="cursor:default"><div class="ic">${a.sym[0]}</div><div class="nm"><b>${a.sym} ${a.op === '<' ? 'sub' : 'peste'} $${fp(a.price)}</b><span>${a.on ? (dist != null ? `Mai e ${pc(dist)}` : 'Activă') : a.hitAt ? `Atinsă ${ago(a.hitAt)}` : 'Pe pauză'}</span></div><button class="tg ${a.on ? 'on' : ''}" data-pat="${a.id}" aria-label="Pornește sau oprește"></button><button class="btn g" style="min-height:36px;padding:8px 10px" data-pdel="${a.id}" aria-label="Șterge">✕</button></div>`; }).join('') : '<div class="empty">Nicio alertă de preț. Adaugă una mai jos.</div>'}</div>
      <form class="card" id="paF"><b style="font:600 16px var(--H)">Alertă nouă</b><div class="f3"><div><label for="paS">Activ</label><input id="paS" autocapitalize="characters" placeholder="BTC" required></div><div><label for="paO">Când</label><select id="paO"><option value="<">sub</option><option value=">">peste</option></select></div><div><label for="paP">Preț $</label><input id="paP" type="number" step="any" inputmode="decimal" required></div></div><button class="btn w" style="margin-top:12px">Adaugă alerta</button></form>
      <div class="card" style="display:flex;align-items:center;gap:12px"><div class="nm"><b>Liniște noaptea</b><span>${st.set.qFrom}:00 – ${st.set.qTo}:00, doar alertele critice</span></div><button class="tg ${st.set.quiet ? 'on' : ''}" id="quietT" aria-label="Liniște noaptea"></button></div>
      <p class="xs mut" style="margin:0 4px">Alertele de preț se verifică live cât aplicația e deschisă. Cu ea închisă, monitorul GitHub acoperă mișcările mari.</p></div>`;
  }
}

/* ================= Sheets ================= */
function openSheet(kind, title, right = '') { st.sheet = kind; $('#shT').innerHTML = title; $('#shR').innerHTML = right; $('#sheet').classList.add('on'); $('#sheet').scrollTop = 0; }
function closeSheet() { $('#sheet').classList.remove('on'); st.sheet = null; }
function openHistory() {
  openSheet('history', 'Istoric demo'); const H = st.sim.hist;
  $('#shB').innerHTML = `<div class="wrap" style="margin-top:8px"><div class="card">${H.length ? H.slice(0, 80).map((h) => `<div class="row" style="cursor:default"><div class="ic" style="color:${h.pnl >= 0 ? 'var(--up)' : 'var(--dn)'}">${h.pnl >= 0 ? '✓' : '✕'}</div><div class="nm"><b>${SIDE[h.side]} ${h.sym} ${h.lev > 1 ? h.lev + '×' : ''} <span class="mut xs">${h.reason}${h.src === 'auto' ? ' · auto' : ''}</span></b><span>${fp(h.entry)} → ${fp(h.exit)} · ${new Date(h.exitT).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}</span></div><div class="pr"><b class="${cls(h.pnl)}">${sgnUsd(h.pnl)}</b><span class="${cls(h.pnlPct)}">${pc(h.pnlPct)}</span></div></div>`).join('') : '<div class="empty">Istoricul apare după prima tranzacție închisă.</div>'}</div></div>`;
}
function openPortfolio() {
  openSheet('portfolio', 'Portofoliu'); const P = portCalc();
  $('#shB').innerHTML = `<div class="wrap" style="margin-top:8px">
    <div class="card"><span class="xs mut">Valoare totală</span><div class="big">${usd(P.val)}</div><div class="sm"><span class="${cls(P.d24)}">${sgnUsd(P.d24)} azi</span>${P.pnl != null ? ` · <span class="${cls(P.pnl)}">${sgnUsd(P.pnl)} față de cost</span>` : ''}</div>
      <div class="alloc">${P.rows.slice(0, 8).map((r, i) => `<i style="width:${(r.v / (P.val || 1)) * 100}%;background:${COLS[i]}"></i>`).join('')}</div></div>
    <div class="card">${P.rows.length ? P.rows.map((r, i) => `<div class="row" style="cursor:default"><div class="ic" style="color:${COLS[i % 8]}">${r.sym[0]}</div><div class="nm"><b>${r.sym} <span class="xs mut">${r.src === 'binance' ? 'Binance' : 'manual'}</span></b><span>${+r.qty.toPrecision(6)} × $${fp(r.p)}${r.cost ? ` · cost $${fp(r.cost)}` : ''}</span></div><div class="pr"><b>${usd(r.v)}</b>${r.pnl != null ? `<span class="${cls(r.pnl)}">${sgnUsd(r.pnl)}</span>` : `<span class="mut">${nf((r.v / (P.val || 1)) * 100, 0)}%</span>`}</div>${r.src !== 'binance' ? `<button class="btn g" style="min-height:36px;padding:8px 10px" data-hdel="${r.id}" aria-label="Șterge">✕</button>` : ''}</div>`).join('') : '<div class="empty">Nimic încă. Adaugă manual sau sincronizează din Binance.</div>'}</div>
    <form class="card" id="hF"><b style="font:600 16px var(--H)">Adaugă manual</b><div class="f3"><div><label for="hS">Activ</label><input id="hS" autocapitalize="characters" placeholder="BTC" required></div><div><label for="hQ">Cantitate</label><input id="hQ" type="number" step="any" inputmode="decimal" required></div><div><label for="hC">Preț mediu $</label><input id="hC" type="number" step="any" inputmode="decimal" placeholder="opțional"></div></div><button class="btn w" style="margin-top:12px">Adaugă</button></form>
    <form class="card" id="bF"><b style="font:600 16px var(--H)">Sincronizare Binance</b><p class="sm mut" style="margin:6px 0 0">Fă o cheie API doar cu <b>Enable Reading</b> (fără trading, fără retrageri). Cheia rămâne doar pe telefonul tău.${st.port.binAt ? ` Ultima sincronizare: ${ago(st.port.binAt)}.` : ''}</p>
      <label for="bK">API Key</label><input id="bK" autocomplete="off" value="${esc(st.set.binK)}"><label for="bS">Secret Key</label><input id="bS" type="password" autocomplete="off" value="${esc(st.set.binS)}">
      <div class="act"><button class="btn">Sincronizează</button>${st.port.binAt ? '<button type="button" class="btn g" id="bX">Deconectează</button>' : ''}</div></form>
    <p class="xs mut" style="margin:0 4px">Revolut și alte aplicații fără API: adaugi manual.</p></div>`;
  $('#hF').onsubmit = (e) => { e.preventDefault(); const s = $('#hS').value.trim().toUpperCase(), q = +$('#hQ').value, c = +$('#hC').value || null; if (!s || !(q > 0)) return;
    st.port.hold.push({ id: Date.now().toString(36), sym: s, qty: q, cost: c, src: 'manual' }); savePort(); pullTickers(); openPortfolio(); renderPortCard(); };
  $('#bF').onsubmit = async (e) => { e.preventDefault(); st.set.binK = $('#bK').value.trim(); st.set.binS = $('#bS').value.trim(); saveSet();
    try { toast({ title: 'Sincronizez cu Binance…' }); const bal = await binanceBalances(st.set.binK, st.set.binS); const keep = st.port.hold.filter((h) => h.src !== 'binance');
      const old = Object.fromEntries(st.port.hold.filter((h) => h.src === 'binance').map((h) => [h.sym, h.cost]));
      st.port.hold = [...keep, ...bal.map((b) => ({ id: 'b' + b.sym, sym: b.sym, qty: b.qty, cost: old[b.sym] || null, src: 'binance' }))]; st.port.binAt = Date.now(); savePort();
      await pullTickers(); toast({ title: 'Portofoliu sincronizat', body: `${bal.length} active din Binance.` }); openPortfolio(); renderPortCard(); }
    catch (er) { toast({ title: 'Binance a refuzat', body: `${er.message}. Verifică cheia și că are „Enable Reading”.` }); } };
  if ($('#bX')) $('#bX').onclick = () => { st.port.hold = st.port.hold.filter((h) => h.src !== 'binance'); st.port.binAt = 0; st.set.binK = st.set.binS = ''; saveSet(); savePort(); openPortfolio(); renderPortCard(); };
}
function openNews() {
  const f = st.nf, mine = new Set(st.port.hold.map((h) => h.sym));
  let L = st.news; if (f === 'imp') L = L.filter((x) => x.imp >= 4); else if (f === 'port') L = L.filter((x) => x.tags.some((t) => mine.has(t))); else if (f !== 'all') L = L.filter((x) => x.kind === f);
  if (st.sheet !== 'news') openSheet('news', 'Știri');
  $('#shB').innerHTML = `<div class="seg">${[['all', 'Toate'], ['imp', 'Importante'], ['port', 'Portofoliu'], ['crypto', 'Crypto'], ['bursă', 'Bursă']].map(([k, l]) => `<button data-n="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="wrap"><div class="card">${L.length ? L.slice(0, 60).map(newsHTML).join('') : `<div class="empty">${f === 'bursă' && !st.set.kF ? 'Pentru știri de bursă pune cheia Finnhub în Setări.' : f === 'port' && !mine.size ? 'Adaugă active în portofoliu ca să filtrez știrile.' : 'Nimic aici încă.'}</div>`}</div></div>`;
}
function openSettings() {
  openSheet('settings', 'Setări', '<span class="xs mut">se salvează singur</span>'); const s = st.set, P = 'Notification' in window ? Notification.permission : 'nesuportat';
  const sa = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('#shB').innerHTML = `<div class="wrap" style="margin-top:8px">
    <div class="card"><label for="sN" style="margin-top:0">Numele tău</label><input id="sN" data-set="name" value="${esc(s.name)}" placeholder="ex. Darius" autocomplete="given-name"></div>
    <div class="card"><b style="font:600 16px var(--H)">Notificări</b><p class="sm mut" style="margin:6px 0 0" id="nSt">${P === 'granted' ? '✅ Active.' : P === 'denied' ? '❌ Blocate. Le activezi din Setări iPhone → Notificări → Markets.' : !sa && /iPhone|iPad/.test(navigator.userAgent) ? 'Mai întâi pune aplicația pe Home Screen și deschide-o de acolo.' : 'Apasă ca să primești alerte.'}</p>
      <div class="act">${P !== 'granted' ? '<button class="btn" id="nOn">Activează</button>' : ''}<button class="btn g" id="nTest">Trimite un test</button></div>
      <div class="row" style="cursor:default;border:0;padding-bottom:0"><div class="nm"><b>Notificări de sistem</b><span>Pe lângă cele din aplicație</span></div><button class="tg ${s.notif ? 'on' : ''}" id="nEn" aria-label="Notificări de sistem"></button></div></div>
    <div class="card"><b style="font:600 16px var(--H)">Alerte cu aplicația închisă</b><p class="sm mut" style="margin:6px 0 0">Monitorul de pe GitHub verifică piața la ~15 minute și îți trimite push. Generezi codul, îl copiezi și îl pui în GitHub ca secret PUSH_SUBSCRIPTION.</p>
      <div class="act"><button class="btn" id="pSub">Generează codul</button><button class="btn g" id="pCopy" hidden>Copiază</button></div><pre id="pOut" hidden></pre></div>
    <div class="card"><b style="font:600 16px var(--H)">Praguri alerte</b><div class="f2"><div><label for="th1">Mișcare în 1h (%)</label><input id="th1" data-th="h1" type="number" step="0.5" inputmode="decimal" value="${s.th.h1}"></div><div><label for="thd">Crypto 24h (%)</label><input id="thd" data-th="d1" type="number" step="0.5" inputmode="decimal" value="${s.th.d1}"></div><div><label for="ths">Acțiuni 24h (%)</label><input id="ths" data-th="d1Stock" type="number" step="0.5" inputmode="decimal" value="${s.th.d1Stock}"></div><div><label for="thv">Volum (× normal)</label><input id="thv" data-th="vol" type="number" step="0.5" inputmode="decimal" value="${s.th.vol}"></div></div></div>
    <div class="card"><b style="font:600 16px var(--H)">Watchlist</b><label for="wC">Crypto (perechi USDT pe Binance)</label><input id="wC" data-list="crypto" autocapitalize="characters" value="${s.crypto.join(', ')}"><label for="wS">Acțiuni și ETF-uri (max 8)</label><input id="wS" data-list="stocks" autocapitalize="characters" value="${s.stocks.join(', ')}"></div>
    <div class="card"><b style="font:600 16px var(--H)">Chei API</b>
      <label for="kA">Anthropic (Claude) · <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">ia cheie</a></label><input id="kA" data-set="kA" type="password" autocomplete="off" value="${esc(s.kA)}" placeholder="sk-ant-…">
      <label for="kM">Model AI</label><select id="kM" data-set="kM">${[['claude-haiku-5-5', 'Haiku 5.5 · rapid, ieftin'], ['claude-sonnet-5-5', 'Sonnet 5.5 · recomandat'], ['claude-opus-5-5', 'Opus 5.5 · cel mai bun, scump']].map(([v, l]) => `<option value="${v}" ${s.kM === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label for="kT">Twelve Data (acțiuni) · <a href="https://twelvedata.com/register" target="_blank" rel="noopener">gratis</a></label><input id="kT" data-set="kT" type="password" autocomplete="off" value="${esc(s.kT)}">
      <label for="kF">Finnhub (știri bursă) · <a href="https://finnhub.io/register" target="_blank" rel="noopener">gratis</a></label><input id="kF" data-set="kF" type="password" autocomplete="off" value="${esc(s.kF)}">
      <p class="xs mut" style="margin:10px 0 0">Cheile stau doar pe telefonul tău. Cheia Anthropic e plătită per folosire, separat de abonamentul Claude.</p></div>
    <div class="card"><label for="sC" style="margin-top:0">Capital demo la resetare ($)</label><input id="sC" data-set="simCap" type="number" inputmode="decimal" value="${s.simCap}"></div>
    <button class="btn g w" id="reOnb">Revezi ghidul de început</button>
    <p class="disc" style="margin:4px">Torque Markets e un instrument de analiză, nu consultanță financiară. Nu investi bani de care ai nevoie.</p></div>`;
  const L = (v) => [...new Set(v.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  $$('[data-set]', $('#shB')).forEach((el) => el.addEventListener('input', () => { s[el.dataset.set] = el.dataset.set === 'simCap' ? +el.value || 10000 : el.value.trim(); saveSet(); if (el.dataset.set === 'name') renderHome(); }));
  $$('[data-set=kT],[data-set=kF]', $('#shB')).forEach((el) => el.addEventListener('change', () => { if (el.dataset.set === 'kT') pullStocks(); else pullNews(); }));
  $$('[data-th]', $('#shB')).forEach((el) => el.addEventListener('input', () => { const v = +el.value; if (v > 0) { s.th[el.dataset.th] = v; saveSet(); } }));
  $$('[data-list]', $('#shB')).forEach((el) => el.addEventListener('change', () => { const k = el.dataset.list, v = L(el.value); s[k] = k === 'stocks' ? v.slice(0, 8) : v; saveSet(); toast({ title: 'Watchlist actualizat', body: 'Încarc datele noi…' }); if (k === 'crypto') { pullTickers(); pullCrypto(true); } else pullStocks(); }));
  $('#nEn').onclick = (e) => { s.notif = !s.notif; saveSet(); e.currentTarget.classList.toggle('on', s.notif); };
  if ($('#nOn')) $('#nOn').onclick = async () => { try { const p = await Notification.requestPermission(); $('#nSt').textContent = p === 'granted' ? '✅ Active.' : '❌ Nu ai permis notificările.'; if (p === 'granted') { $('#nOn').remove(); notify({ title: 'Notificări active ✅', body: 'Te anunț la mișcări mari, semnale și știri importante.', key: 't' + Date.now(), level: 'high', t: Date.now() }); } } catch { toast({ title: 'Nu merge aici', body: 'Deschide aplicația de pe Home Screen.' }); } };
  $('#nTest').onclick = () => notify({ title: 'BTC 🚀 +5,2% în 24h (test)', body: 'Așa arată o alertă reală.', key: 't' + Date.now(), level: 'high', t: Date.now() });
  $('#pSub').onclick = async () => { try { if ((await Notification.requestPermission()) !== 'granted') throw new Error('Permite notificările mai întâi.'); const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription(); if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(C.CONFIG.VAPID_PUBLIC) }); $('#pOut').textContent = JSON.stringify(sub); $('#pOut').hidden = false; $('#pCopy').hidden = false; } catch (e) { toast({ title: 'Push indisponibil', body: e.message + ' (merge doar din aplicația de pe Home Screen, iOS 16.4+)' }); } };
  $('#pCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#pOut').textContent); toast({ title: 'Copiat', body: 'Pune-l în GitHub ca secret PUSH_SUBSCRIPTION.' }); } catch { toast({ title: 'Copiere eșuată', body: 'Ține apăsat pe text și copiază manual.' }); } };
  $('#reOnb').onclick = () => { closeSheet(); onboarding(0); };
}
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

/* ================= AI chat ================= */
function context() {
  const m = M(), P = portCalc();
  const assets = Object.entries(st.an).map(([s, a]) => {
    const b = st.bt[s] || (st.S[s] ? (st.bt[s] = C.backtest(st.S[s], kindOf(s))) : null), g = sig(s);
    return { s, pret: px(s), ch24: ch24(s)?.toFixed(2), ch7: a.chg7d?.toFixed(1), ch30: a.chg30d?.toFixed(1), rsi: a.rsi?.toFixed(0), trend: a.trend, scor: a.score, semnal: g?.txt, sanseSus7z: st.prob[s] != null ? pcRaw(st.prob[s]) : null,
      motive: a.reasons.slice(0, 4).map((r) => `${r[0] > 0 ? '+' : ''}${r[0]} ${r[1]}`), suport: a.support, rezistenta: a.resistance, atr: a.atr, deLaMax90: a.dd90?.toFixed(1),
      istoric: b ? b.rows.filter((r) => r.n >= 4).map((r) => `${r.name}: n=${r.n}, 30z ${pc(r.avg30)}, câștig ${Math.round(r.win30)}%`) : [] };
  });
  return JSON.stringify({ data: new Date().toISOString(), fearGreed: st.fng.slice(0, 8).map((x) => x.v), global: st.glob, verdict: verdict().h,
    modelAI: m && { pragLong: m.thr, pragShort: m.thrS, avantajLong: m.edgeL, avantajShort: m.edgeS, test: { cazuri: m.test.n, bazaSus: pcRaw(m.test.base), susPestePrag: pcRaw(m.test.hitSel), josSubPrag: pcRaw(m.test.downSel) } },
    jurnalSemnaleLive: learnStats(), portofoliu: P.rows.map((r) => ({ s: r.sym, qty: r.qty, valoare: Math.round(r.v), cost: r.cost })),
    demo: { valoare: Math.round(SIM.equity(st.sim, px)), pozitii: st.sim.pos.map((p) => ({ s: p.sym, side: p.side, lev: p.lev, intrare: p.entry, sl: p.sl, tp: p.tp })), stats: SIM.simStats(st.sim.hist) },
    active: assets, stiri: st.news.slice(0, 15).map((x) => `[${x.imp >= 5 ? 'IMP' : ''}${x.sent > 0 ? '+' : x.sent < 0 ? '-' : ''}] ${x.title} (${x.src}, ${ago(x.t)})`) });
}
const SYS = `Ești analistul de piață personal al utilizatorului: trader cu experiență pe crypto și acțiuni, long și short. Vorbești în română, direct și relaxat, ca un prieten care se pricepe, fără introduceri.
Reguli:
- Te bazezi DOAR pe datele live primite. Dacă lipsesc date, spui asta.
- Pentru fiecare idee spui clar: Long, Short sau Aștept, cu intrare, stop, țintă și R:R (folosește ATR, suport, rezistență).
- Spui cât să creadă în semnal: modelul AI are avantaj doar unde avantajLong/avantajShort e true; altfel e doar un filtru. Ține cont și de jurnalul live.
- Ești sincer: dacă setup-ul e prost, spui. Nu promiți câștiguri. Levier mic sau deloc, risc 1–2% pe trade.
- Format scurt pentru telefon: titluri ###, liste scurte, max ~220 de cuvinte dacă nu ți se cere mai mult.
- Închei cu o linie scurtă: decizia e a lui, nu e consultanță financiară.`;
function md(t) {
  const lines = esc(t).split('\n'); let h = '', ul = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<i>$2</i>');
    if (/^\s*[-*•] /.test(l)) { if (!ul) { h += '<ul>'; ul = true; } h += `<li>${l.replace(/^\s*[-*•] /, '')}</li>`; continue; }
    if (ul) { h += '</ul>'; ul = false; }
    if (/^#{1,4} /.test(l)) h += `<h4>${l.replace(/^#+ /, '')}</h4>`; else if (l.trim()) h += `<p>${l}</p>`;
  }
  return h + (ul ? '</ul>' : '');
}
function renderChat() {
  $('#aiKey').hidden = !!st.set.kA;
  $('#chat').innerHTML = st.chat.length ? st.chat.map((m) => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">${m.role === 'user' ? esc(m.content) : md(m.content)}</div>`).join('')
    : '<div class="msg a"><p>Am pe mână prețurile live, modelul AI testat, statisticile, portofoliul, contul demo și știrile. Întreabă-mă orice.</p></div>';
}
function localBrief(q) {
  const keys = Object.keys(st.an); if (!keys.length) return 'Încă încarc datele. Mai încearcă în câteva secunde.';
  const m = M(), sym = q.toUpperCase().match(/\b[A-Z]{2,5}\b/g)?.find((s) => st.an[s]);
  if (sym) {
    const a = st.an[sym], g = sig(sym), side = g?.side || (a.score >= 0 ? 'long' : 'short'), pl = C.planFor(a, px(sym), side), p = st.prob[sym];
    return `### ${sym}: ${g?.txt || 'Așteaptă'}\n- Preț $${fp(px(sym))}, trend ${a.trend}, RSI ${a.rsi?.toFixed(0)}, scor ${a.score}\n${p != null && m ? `- AI: ${pcRaw(p)} șanse sus în 7 zile (${m.edgeL || m.edgeS ? 'model cu avantaj dovedit pe ' + [m.edgeL && 'long', m.edgeS && 'short'].filter(Boolean).join(' și ') : 'modelul n-are avantaj dovedit acum, e doar un filtru'})\n` : ''}${a.reasons.slice(0, 3).map((r) => `- ${r[0] > 0 ? '+' : ''}${r[0]}: ${r[1]}`).join('\n')}\n${pl ? `### Plan ${SIDE[side]}\n- Intrare ${fp(pl.entry)}, stop ${fp(pl.stop)}, țintă ${fp(pl.target)} (R:R 1:2)\n` : ''}### Concluzie\n${g?.strong ? `Semnal ${g.txt} cu avantaj dovedit. Poziție mică, stopul de mai sus.` : g?.side ? `${g.txt}, dar fără confirmare AI. Poziție mică sau aștepți.` : 'Nimic clar. Aștepți.'}\n\n_Analiză locală. Pune cheia Claude în Setări pentru analiză completă._`;
  }
  const v = verdict(), top = keys.filter((s) => sig(s)?.side).sort((a, b) => rank(b) - rank(a)).slice(0, 4);
  return `### ${v.h}\n${v.p}\n### Cele mai clare semnale\n${top.length ? top.map((s) => `- **${s}** ${sig(s).txt}: ${sig(s).why}`).join('\n') : '- Nimic clar acum.'}\n\n_Analiză locală. Pune cheia Claude în Setări pentru analiză completă._`;
}
async function ask(q) {
  q = q.trim(); if (!q) return; if (cur() !== 'ai') go('ai'); if (st.itab !== 'chat') setItab('chat');
  st.chat.push({ role: 'user', content: q }); renderChat(); $('#askI').value = ''; $('#askB').disabled = true;
  const pendEl = document.createElement('div'); pendEl.className = 'msg a'; pendEl.innerHTML = '<p class="mut">Analizez…</p>'; $('#chat').append(pendEl); pendEl.scrollIntoView({ block: 'end', behavior: 'smooth' });
  let ans;
  if (!st.set.kA) ans = localBrief(q);
  else try {
    const hist = st.chat.slice(-7, -1).map((m) => ({ role: m.role, content: m.content })); while (hist.length && hist[0].role !== 'user') hist.shift();
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': st.set.kA, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: st.set.kM, max_tokens: 1600, system: SYS, messages: [...hist, { role: 'user', content: `DATE LIVE:\n${context()}\n\nÎNTREBARE: ${q}` }] }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
    ans = d.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  } catch (e) { ans = `Eroare la Claude: ${e.message}\n\n${localBrief(q)}`; }
  st.chat.push({ role: 'assistant', content: ans }); st.chat = st.chat.slice(-30); save('tm_chat', st.chat);
  renderChat(); $('#askB').disabled = false; $('#chat').lastElementChild?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function setItab(k) { st.itab = k; $$('#segI button').forEach((x) => x.classList.toggle('on', x.dataset.i === k)); $('#aiChat').hidden = k !== 'chat'; $('#aiPerf').hidden = k !== 'perf'; if (k === 'perf') renderPerf(); else renderChat(); }

/* ================= onboarding ================= */
const ONB = [
  ['Piața, explicată în două rânduri', 'În fiecare zi primești verdictul: ce se întâmplă și ce ai face. Fiecare monedă are un singur semnal clar: Long, Short sau Așteaptă.', '<svg width="220" height="150" viewBox="0 0 220 150"><rect x="10" y="20" width="200" height="110" rx="22" fill="#3A1620"/><rect x="30" y="44" width="90" height="10" rx="5" fill="#FF9AA8"/><rect x="30" y="66" width="150" height="14" rx="7" fill="#E8F0FA"/><rect x="30" y="88" width="120" height="14" rx="7" fill="#E8F0FA" opacity=".7"/><rect x="30" y="112" width="70" height="8" rx="4" fill="#4FB3E8"/></svg>'],
  ['Un AI care își arată notele', 'Modelul e testat pe date pe care nu le-a văzut. Îți trimite semnale doar pe direcția unde a dovedit că bate hazardul.', '<svg width="220" height="150" viewBox="0 0 220 150"><rect x="20" y="96" width="30" height="40" rx="6" fill="#24344B"/><rect x="62" y="80" width="30" height="56" rx="6" fill="#24344B"/><rect x="104" y="62" width="30" height="74" rx="6" fill="#4FB3E8"/><rect x="146" y="36" width="30" height="100" rx="6" fill="#22C38E"/><circle cx="161" cy="20" r="9" fill="#FF7A1A"/></svg>'],
  ['Tranzacționezi pe demo, fără risc', 'Long sau short, cu levier, pe prețuri reale. Graficul se mărește cu două degete, se trage cu unul, iar apăsarea lungă arată prețul exact.', '<svg width="220" height="150" viewBox="0 0 220 150"><path d="M10 120 L50 96 L80 104 L120 60 L150 72 L200 24" stroke="#22C38E" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="10" y1="40" x2="210" y2="40" stroke="#4FB3E8" stroke-dasharray="6 6" stroke-width="2"/><line x1="10" y1="132" x2="210" y2="132" stroke="#FF7A1A" stroke-dasharray="6 6" stroke-width="2"/></svg>'],
];
function onboarding(i) {
  const o = $('#onb'); if (i >= ONB.length) { o.hidden = true; st.set.onb = true; saveSet(); return; }
  const [h, p, art] = ONB[i]; o.hidden = false;
  o.innerHTML = `<div class="art">${art}</div><div class="dots">${ONB.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div><h2>${h}</h2><p>${p}</p>
    ${i === 0 ? '<input id="onName" placeholder="Cum te cheamă? (opțional)" style="margin-bottom:12px" autocomplete="given-name">' : ''}<button class="btn w" id="onN">${i === ONB.length - 1 ? 'Hai să începem' : 'Mai departe'}</button>${i < ONB.length - 1 ? '<button class="btn g w" id="onS" style="margin-top:8px">Sari peste</button>' : ''}`;
  if (i === 0 && st.set.name) $('#onName').value = st.set.name;
  const keep = () => { const n = $('#onName')?.value.trim(); if (n) { st.set.name = n; saveSet(); renderHome(); } };
  $('#onN').onclick = () => { keep(); onboarding(i + 1); }; if ($('#onS')) $('#onS').onclick = () => { keep(); onboarding(99); };
}

/* ================= navigare ================= */
function renderAll() {
  const v = cur(); renderHome();
  if (v === 'piata') renderMkt(); if (v === 'trade') renderTrade(false); if (v === 'alerte') renderAlerts(); if (v === 'ai' && st.itab === 'perf') renderPerf();
}
function go(v) {
  if (!document.getElementById('v-' + v)) v = 'acasa';
  const prev = $('.v.on')?.id;
  $$('.v').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  if (v !== 'trade') { st.chart?.stop(); st.chart = null; }
  if (v === 'alerte') { save('tm_unread', 0); badge(); renderAlerts(); }
  if (v === 'piata') renderMkt(); if (v === 'trade') renderTrade(true); if (v === 'ai') setItab(st.itab); if (v === 'acasa') renderHome();
  if (prev !== 'v-' + v) scrollTo(0, 0);
}
function pick(s) { st.sym = s; save('tm_sym', s); closeSheet(); if (cur() === 'trade') { renderTrade(true); scrollTo(0, 0); } else go('trade'); }
function bind() {
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.v); };
  $('#back').onclick = closeSheet; $('#fsX').onclick = closeFs;
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go],[data-open],[data-ask],[data-order],[data-palert],[data-close],[data-sym],[data-pick],[data-url],[data-tf],[data-ind],[data-n],[data-k],[data-a],[data-i],[data-pat],[data-pdel],[data-hdel],#autoT,#resetSim,#clrA,#quietT,#goFs,#acct');
    if (!t) return; const d = t.dataset;
    if (d.go) { closeSheet(); go(d.go); }
    else if (d.open) ({ settings: openSettings, portfolio: openPortfolio, history: openHistory, news: () => { st.nf = 'all'; openNews(); } })[d.open]?.();
    else if (d.ask) { closeSheet(); ask(d.ask); }
    else if (d.order) openOrder(d.order);
    else if (d.palert) { closeSheet(); go('alerte'); st.atab = 'mine'; $$('#segA button').forEach((x) => x.classList.toggle('on', x.dataset.a === 'mine')); renderAlerts(); $('#paS').value = d.palert; $('#paP').value = +(px(d.palert) * 0.95).toPrecision(5); $('#paP').focus(); }
    else if (d.close) { const ps = st.sim.pos.find((p) => p.id === d.close); if (!ps) return; const h = SIM.closePos(st.sim, d.close, px(ps.sym) ?? ps.entry, 'manual'); saveSim(); simClosedNote(h); renderPositions(); renderAcct(); st.chart?.draw(); }
    else if (d.tf) { st.tf = d.tf; save('tm_tf', d.tf); const fs = !!st.fchart; closeFs(); renderTrade(true).then(() => { if (fs) openFs(); }); }
    else if (d.ind) { st.set.show[d.ind] = !st.set.show[d.ind]; saveSet(); $$(`[data-ind="${d.ind}"]`).forEach((x) => x.classList.toggle('on', st.set.show[d.ind])); st.chart?.draw(); st.fchart?.draw(); }
    else if (d.n) { st.nf = d.n; openNews(); }
    else if (d.k) { st.kind = d.k; $$('#segK button').forEach((x) => x.classList.toggle('on', x === t)); renderMkt(); }
    else if (d.a) { st.atab = d.a; $$('#segA button').forEach((x) => x.classList.toggle('on', x === t)); renderAlerts(); }
    else if (d.i) setItab(d.i);
    else if (d.pat) { const a = st.palerts.find((x) => x.id === d.pat); a.on = !a.on; if (a.on) a.hitAt = null; save('tm_palerts', st.palerts); renderAlerts(); }
    else if (d.pdel) { st.palerts = st.palerts.filter((x) => x.id !== d.pdel); save('tm_palerts', st.palerts); renderAlerts(); }
    else if (d.hdel) { st.port.hold = st.port.hold.filter((x) => x.id !== d.hdel); savePort(); openPortfolio(); renderPortCard(); }
    else if (d.url) window.open(d.url, '_blank');
    else if (d.pick || d.sym) pick(d.pick || d.sym);
    else if (t.id === 'goFs') openFs();
    else if (t.id === 'acct') { go('ai'); setItab('perf'); }
    else if (t.id === 'autoT') { st.sim.auto = !st.sim.auto; saveSim(); t.classList.toggle('on', st.sim.auto); toast({ title: st.sim.auto ? 'Auto-pilot pornit' : 'Auto-pilot oprit', body: st.sim.auto ? 'Intră doar pe semnalele cu avantaj dovedit. Verific la 3 minute.' : '' }); if (st.sim.auto) recompute('crypto'); }
    else if (t.id === 'resetSim') { if (t.dataset.sure) { st.sim = SIM.newSim(st.set.simCap); saveSim(); renderPerf(); toast({ title: 'Cont demo resetat', body: usd(st.set.simCap) + ' virtuali' }); } else { t.dataset.sure = 1; t.textContent = 'Sigur? Apasă iar'; setTimeout(() => { delete t.dataset.sure; t.textContent = 'Resetează contul demo'; }, 3000); } }
    else if (t.id === 'clrA') { st.alerts = []; save('tm_alerts', []); renderAlerts(); }
    else if (t.id === 'quietT') { st.set.quiet = !st.set.quiet; saveSet(); renderAlerts(); }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'paF') return; e.preventDefault();
    const s = $('#paS').value.trim().toUpperCase(), p = +$('#paP').value; if (!s || !(p > 0)) return;
    st.palerts.unshift({ id: Date.now().toString(36), sym: s, op: $('#paO').value, price: p, on: true, t: Date.now() }); save('tm_palerts', st.palerts);
    if (!st.valid.has(s) && !isStock(s)) pullTickers(); renderAlerts(); toast({ title: 'Alertă adăugată', body: `${s} ${$('#paO').value === '<' ? 'sub' : 'peste'} $${fp(p)}` });
  });
  $('#askF').onsubmit = (e) => { e.preventDefault(); ask($('#askI').value); };
  $('#askI').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('#askI').value); } });
  const Q = ['Rezumat piață acum', 'Long sau short pe BTC?', 'Ce zici de portofoliul meu?', 'Cea mai bună oportunitate acum', 'Cât să cred în modelul AI?', 'Plan DCA pe 4 săptămâni'];
  $('#qs').innerHTML = Q.map((q) => `<button>${q}</button>`).join(''); $('#qs').onclick = (e) => { const b = e.target.closest('button'); if (b) ask(b.textContent); };
  addEventListener('hashchange', () => go(cur()));
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return; live.wake(); pullTickers();
    const c = await SIM.reconcile(st.sim, (s, t) => C.cryptoKlines(s, '1h', Math.min(1000, Math.ceil((Date.now() - t) / 36e5) + 2))); if (c.length) { saveSim(); c.forEach(simClosedNote); renderPositions(); }
    if (Date.now() - (st.lastK || 0) > 60e3) tick3();
  });
}

/* ================= pornire ================= */
async function tick3() { st.lastK = Date.now(); await pullCrypto(); }
async function init() {
  bind(); badge(); go(cur()); renderHome(); renderPortCard(); liveStatus();
  if (!st.set.onb) onboarding(0);
  const ios = /iPhone|iPad/.test(navigator.userAgent), sa = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('#install').hidden = !(ios && !sa);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await pullTickers();
  st.lastK = Date.now();
  await Promise.all([pullMacro(), pullCrypto(true), pullNews(), pullStocks()]);
  const c = await SIM.reconcile(st.sim, (s, t) => C.cryptoKlines(s, '1h', Math.min(1000, Math.ceil((Date.now() - t) / 36e5) + 2))); if (c.length) { saveSim(); c.forEach(simClosedNote); }
  setInterval(() => { if (!st.liveUp) pullTickers(); }, 20e3);
  setInterval(tick3, 3 * 60e3);
  setInterval(pullNews, 5 * 60e3);
  setInterval(pullMacro, 30 * 60e3);
  setInterval(pullStocks, 30 * 60e3);
  setInterval(() => { liveStatus(); if (cur() === 'trade') { renderPositions(); renderAcct(); } }, 15e3);
}
init();
