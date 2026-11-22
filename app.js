import * as C from './core.js';
import * as SIM from './sim.js';
import { Live, binanceBalances } from './live.js';
import { candleChart, lineChart, spark } from './charts.js';

/* ================= stare ================= */
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const DEF = { name: '', crypto: C.CONFIG.crypto, stocks: C.CONFIG.stocks, th: { ...C.CONFIG.th }, notif: true, quiet: true, qFrom: 23, qTo: 8,
  kA: '', kM: 'claude-sonnet-5-5', kT: '', kF: '', binK: '', binS: '', simCap: 10000, onb: false };
const st = {
  set: { ...DEF, ...load('tm_set', {}) }, tick: {}, daily: {}, h1: {}, S: {}, an: {}, bt: {}, prob: {}, model: {}, fngMap: null, fng: [], glob: null, news: [], m15: {},
  alerts: load('tm_alerts', []), seen: load('tm_seen', {}), chat: load('tm_chat', []), journal: load('tm_journal', []), palerts: load('tm_palerts', []),
  sim: load('tm_sim', null), port: load('tm_port', { hold: [], binAt: 0 }), err: {}, busy: 0, kind: 'crypto', nf: 'all', atab: 'rec', sheet: null, cur: null, tf: '3L', liveUp: false, valid: new Set(),
};
st.set.th = { ...DEF.th, ...st.set.th };
if (!st.sim) st.sim = SIM.newSim(st.set.simCap);
const firstRun = !Object.keys(st.seen).length;
const saveSim = () => save('tm_sim', st.sim), savePort = () => save('tm_port', st.port);

/* ================= formatare (românește) ================= */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (x, d) => x.toLocaleString('ro-RO', { minimumFractionDigits: d, maximumFractionDigits: d });
const fp = (p) => (p == null || !isFinite(p) ? '—' : p >= 1000 ? nf(p, 0) : p >= 1 ? nf(p, 2) : p >= 0.01 ? nf(p, 4) : p.toPrecision(3));
const usd = (v, d = 0) => (v == null || !isFinite(v) ? '—' : (v < 0 ? '−$' : '$') + nf(Math.abs(v), d));
const pc = (x, d = 1) => (x == null || !isFinite(x) ? '—' : (x > 0 ? '+' : x < 0 ? '−' : '') + nf(Math.abs(x), d) + '%');
const sgnUsd = (v) => (v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + '$' + nf(Math.abs(v), Math.abs(v) < 100 ? 2 : 0));
const cls = (x) => (x == null ? '' : x >= 0 ? 'up' : 'dn');
const ago = (t) => { const m = (Date.now() - t) / 6e4; return m < 1 ? 'acum' : m < 60 ? `acum ${m | 0} min` : m < 1440 ? `acum ${(m / 60) | 0} h` : `acum ${(m / 1440) | 0} z`; };
const STABLE = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD', 'USD']);
const isStock = (s) => st.set.stocks.includes(s) || (!!st.daily[s] && !st.set.crypto.includes(s) && !st.tick[s]);
const kindOf = (s) => (isStock(s) ? 'stocks' : 'crypto');
const px = (s) => (STABLE.has(s) ? 1 : st.tick[s]?.price ?? (st.daily[s] ? st.daily[s].at(-1).c : null));
const ch24 = (s) => (STABLE.has(s) ? 0 : st.tick[s]?.chg24 ?? st.an[s]?.chg1d ?? null);
const pillT = (a) => ({ up2: 'p-up', up: 'p-up', flat: 'p-flat', dn: 'p-dn', dn2: 'p-dn' }[a.label.tone]);
const M = () => st.model.crypto;

/* ================= date ================= */
async function safe(name, fn) {
  st.busy++; liveStatus();
  try { await fn(); delete st.err[name]; } catch (e) { st.err[name] = e.message || String(e); console.warn(name, e); }
  finally { st.busy--; liveStatus(); }
}
const mergeC = (old, nw) => { if (!old?.length) return nw; const m = new Map(old.map((x) => [x.t, x])); nw.forEach((x) => m.set(x.t, x)); return [...m.values()].sort((a, b) => a.t - b.t).slice(-1000); };
const extraSyms = () => [...new Set([...st.port.hold.map((h) => h.sym), ...st.sim.pos.map((p) => p.sym)])].filter((s) => !STABLE.has(s) && !st.set.crypto.includes(s) && !st.set.stocks.includes(s));

async function pullTickers() {
  await safe('preț', async () => {
    try { Object.assign(st.tick, await C.cryptoTickers(st.set.crypto)); st.set.crypto.forEach((s) => st.valid.add(s)); }
    catch (e) { const r = await Promise.allSettled(st.set.crypto.map(async (s) => { Object.assign(st.tick, await C.cryptoTickers([s])); st.valid.add(s); })); if (!r.some((x) => x.status === 'fulfilled')) throw e; }
    st.lastT = Date.now();
  });
  await Promise.allSettled(extraSyms().map(async (s) => { const t = await C.cryptoTickers([s]); Object.assign(st.tick, t); st.valid.add(s); }));
  live.set([...st.valid]); renderTicks(true);
}
async function pullCrypto(full = false) {
  await safe('crypto', async () => {
    const res = await Promise.allSettled(st.set.crypto.map(async (s) => {
      const need = full || !st.daily[s]; const d = await C.cryptoKlines(s, '1d', need ? 1000 : 3);
      st.daily[s] = need ? d : mergeC(st.daily[s], d); st.h1[s] = await C.cryptoKlines(s, '1h', 168);
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
  if (m) { st.model.crypto = m; st.model.at = Date.now(); save('tm_model_sum', { test: m.test, thr: m.thr, at: m.trainedAt, n: m.nRows }); }
}

function recompute(kind) {
  const list = kind === 'crypto' ? st.set.crypto : st.set.stocks, mdl = st.model[kind], D = C.dayKey(Date.now());
  for (const s of list) {
    const d = st.daily[s]; if (!d || d.length < 60) continue;
    const S = C.series(d); st.S[s] = S;
    const a = C.analyze(S, { fng: st.fng[0]?.v, kind }); st.an[s] = a; st.bt[s] = null;
    const p = mdl ? C.probNow(mdl, S, kind === 'crypto' ? st.fngMap : null) : null; st.prob[s] = p;
    let al = C.detectAlerts({ sym: s, kind, S, a, h1: kind === 'crypto' ? st.h1[s] : null, live: kind === 'crypto' ? st.tick[s] : null, th: st.set.th });
    if (mdl) al = al.filter((x) => !x.key.startsWith('opp:') || p >= mdl.thr);
    if (mdl && p >= mdl.thr && a.score >= 0) {
      al.push({ key: `ai:${s}:${D}`, level: 'high', sym: s, t: Date.now(), title: `🧠 AI: ${s} are ${Math.round(p * 100)}% șanse să fie mai sus în 7 zile`,
        body: `Pe date nevăzute, la acest nivel de încredere modelul a nimerit ${pcRaw(mdl.test.hitSel)} din cazuri. Scor ${a.score}, stop logic ~${fp(a.stop)}.` });
    }
    for (const x of al) if (/^(opp|ai):/.test(x.key) && !st.seen[x.key]) journalAdd(x.key.split(':')[0], s, a.price, p, a.score);
    handle(al);
    if (kind === 'crypto') autopilot(s, a, p);
  }
  evalJournal(); renderAll();
}
const pcRaw = (x) => (x == null ? '—' : Math.round(x * 100) + '%');

/* ================= învățare din greșeli ================= */
function journalAdd(type, sym, price, prob, score) {
  st.journal.unshift({ id: Date.now() + sym + type, type, sym, t: Date.now(), price, prob, score, done: false });
  st.journal = st.journal.slice(0, 400); save('tm_journal', st.journal);
}
function evalJournal() {
  let ch = false;
  for (const j of st.journal) {
    if (j.done || Date.now() - j.t < 7 * 864e5) continue;
    const d = st.daily[j.sym]; if (!d) continue;
    const k = d.find((x) => x.t >= j.t + 7 * 864e5 - 864e5 / 2); if (!k) continue;
    j.ret = (k.c / j.price - 1) * 100; j.ok = j.ret > 0; j.done = true; ch = true;
  }
  if (ch) save('tm_journal', st.journal);
}
function learnStats() {
  const by = {};
  for (const j of st.journal.filter((x) => x.done)) { const b = (by[j.type] ||= { n: 0, w: 0, r: 0 }); b.n++; b.w += j.ok ? 1 : 0; b.r += j.ret; }
  for (const k in by) { const b = by[k]; b.hit = b.w / b.n; b.avg = b.r / b.n; b.muted = b.n >= 8 && (b.w + 1) / (b.n + 2) < 0.45; }
  return by;
}
const muted = (key) => { const t = key.split(':')[0]; return learnStats()[t]?.muted; };

/* ================= auto-pilot demo ================= */
function autopilot(s, a, p) {
  const m = M(); if (!st.sim.auto || !m || p == null || p < m.thr || a.score < 0 || muted('ai:')) return;
  if (st.sim.pos.some((x) => x.sym === s) || st.sim.pos.filter((x) => x.src === 'auto').length >= 5) return;
  const price = px(s), plan = C.planFor(a, price); if (!price || !plan) return;
  const eq = SIM.equity(st.sim, px), amt = Math.min(st.sim.cash * 0.98, eq * 0.1); if (amt < 20) return;
  try {
    SIM.openPos(st.sim, { sym: s, price, usd: amt, sl: plan.stop, tp: price + 3 * a.atr, src: 'auto', note: `AI ${Math.round(p * 100)}%, scor ${a.score}`, maxH: 7 * 864e5 });
    saveSim(); notify({ key: 'auto:' + s + Date.now(), level: 'high', sym: s, t: Date.now(), title: `🤖 Auto-pilot a cumpărat ${s} (demo)`, body: `${usd(amt)} la ${fp(price)}. Stop ${fp(plan.stop)}, țintă ${fp(price + 3 * a.atr)}, maxim 7 zile.` }, false, true);
  } catch {}
}

/* ================= alerte + notificări ================= */
function handle(list) {
  let n = 0;
  for (const al of list) {
    if (st.seen[al.key]) continue; st.seen[al.key] = Date.now();
    if (muted(al.key)) { al.body += ' (notificare oprită: semnalul ăsta a greșit des)'; al.level = 'med'; }
    st.alerts.unshift(al); n++;
    if (!muted(al.key) && (!firstRun || al.level === 'high')) notify(al, firstRun);
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
  setTimeout(() => { el.classList.remove('on'); setTimeout(nextToast, 300); }, 4000);
}
function badge() { const u = load('tm_unread', 0), b = $('#badge'); b.hidden = !u; b.textContent = u > 99 ? '99+' : u; }

/* ================= live (WebSocket) ================= */
let pend = new Set(), rafOn = false;
const live = new Live((s, t) => {
  const prev = st.tick[s]?.price; st.tick[s] = { ...st.tick[s], ...t, prev }; st.lastT = Date.now(); pend.add(s);
  const d = st.daily[s]; if (d?.length) { const k = d.at(-1); k.c = t.price; k.h = Math.max(k.h, t.price); k.l = Math.min(k.l, t.price); }
  onPriceAlerts(s, t.price);
  const closed = SIM.checkLive(st.sim, px); if (closed.length) { saveSim(); closed.forEach(simClosedNote); }
  if (!rafOn) { rafOn = true; setTimeout(() => { rafOn = false; renderTicks(); }, 700); }
}, (up) => { st.liveUp = up; liveStatus(); });

function renderTicks(all = false) {
  const set = all ? Object.keys(st.tick) : [...pend]; pend.clear();
  for (const s of set) {
    const t = st.tick[s]; if (!t) continue;
    for (const el of $$(`[data-p="${s}"]`)) { el.textContent = (el.dataset.u ? '$' : '') + fp(t.price); if (t.prev && t.prev !== t.price) { el.classList.remove('flash-u', 'flash-d'); void el.offsetWidth; el.classList.add(t.price > t.prev ? 'flash-u' : 'flash-d'); setTimeout(() => el.classList.remove('flash-u', 'flash-d'), 600); } }
    for (const el of $$(`[data-c="${s}"]`)) { el.textContent = pc(t.chg24); el.className = cls(t.chg24); }
  }
  renderPortCard(); if (cur() === 'demo') renderDemoTop(true); if (cur() === 'demo') renderPositions(); liveStatus();
  if (st.sheet === 'detail' && st.chart && set.includes(st.cur)) st.chart.draw();
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
      notify({ key: 'pa:' + a.id, level: 'high', sym: s, t: Date.now(), title: `🎯 ${s} ${a.op === '<' ? 'a coborât sub' : 'a urcat peste'} $${fp(a.price)}`, body: `Preț acum: $${fp(p)}. Alerta s-a oprit; o reactivezi din Alerte → Ale mele.` }, false, true);
    }
  }
  if (ch) { save('tm_palerts', st.palerts); if (cur() === 'alerte') renderAlerts(); }
}
function simClosedNote(h) {
  if (!h) return;
  notify({ key: 'simc:' + h.id, level: 'high', sym: h.sym, t: Date.now(), title: `${h.pnl >= 0 ? '✅' : '❌'} Demo: ${h.sym} închis la ${h.reason} (${sgnUsd(h.pnl)})`, body: `Intrare ${fp(h.entry)} → ieșire ${fp(h.exit)}, ${pc(h.pnlPct)}.` }, false, true);
}

/* ================= randare: Acasă ================= */
const cur = () => location.hash.slice(1) || 'acasa';
function verdict() {
  const f = st.fng[0]?.v, b = st.an.BTC, vals = Object.values(st.an), br = vals.length ? vals.filter((a) => a.score > 0).length / vals.length : 0.5, m = M();
  const nAI = m ? st.set.crypto.filter((s) => st.prob[s] >= m.thr).length : 0;
  let k = 'n', h, p;
  if (f != null && f <= 25) { k = ''; h = `Frică extremă.${b?.dd90 < -15 ? ` BTC e la ${pc(b.dd90, 0)} de maximul pe 90 de zile.` : ''}`; p = 'Istoric, zonele astea au fost mai des de acumulare decât de vânzare. Intră etapizat, fără leverage.'; }
  else if (f != null && f >= 75) { k = ''; h = 'Lăcomie în piață.'; p = 'Euforia e momentul de luat profit parțial, nu de intrat cu tot.'; }
  else if (br >= 0.6) { k = 'g'; h = 'Piața e pe verde.'; p = 'Majoritatea activelor au setup pozitiv. Caută intrări pe retrageri, cu stop clar.'; }
  else if (br <= 0.3) { k = ''; h = 'Piață slabă.'; p = 'Cele mai multe active sunt în trend negativ. Ține cash și intră doar pe setup-uri foarte bune.'; }
  else { h = 'Piață fără direcție clară.'; p = 'Nu e grabă. Așteaptă confirmare înainte să intri.'; }
  if (m) p += ` Modelul AI: ${nAI ? `${nAI} ${nAI === 1 ? 'activ e' : 'active sunt'} peste pragul de încredere.` : 'niciun activ peste pragul de încredere acum.'}`;
  return { k, h, p, f };
}
function renderHome() {
  $('#hello').textContent = st.set.name ? `Bună, ${st.set.name}` : 'Bună';
  if (!Object.keys(st.an).length) return;
  const v = verdict();
  $('#verdict').className = 'verdict ' + v.k;
  $('#verdict').innerHTML = `<div class="k">VERDICTUL ZILEI</div><h2>${esc(v.h)}</h2><p>${esc(v.p)}</p>
    <div class="fg"><span>Sentiment ${v.f ?? '—'}</span><div class="fgb"><i style="left:${v.f ?? 50}%"></i></div></div>
    <div class="act"><button class="btn" data-go="semnale">Vezi setup-urile</button><button class="btn g" data-ask="Explică-mi verdictul zilei pe scurt și ce aș face concret azi.">De ce?</button></div>`;
  renderPortCard(); renderOpps(); renderNewsMini(); renderWatch(); liveStatus();
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
  if (!st.port.hold.length) { el.innerHTML = `<div class="port"><div><b style="font-size:15px">Adaugă ce deții</b><div class="sm mut" style="margin-top:2px">Manual sau sincronizat din Binance. Vezi profitul și primești alerte pe ce ai.</div></div><span class="btn g">Adaugă</span></div>`; return; }
  const P = portCalc();
  el.innerHTML = `<div class="port"><div><div class="big num" style="font-size:26px">${usd(P.val)}</div><span class="xs mut">Valoare totală</span></div>
    <div style="text-align:right"><b class="${cls(P.d24)}" style="font:700 20px var(--H)">${sgnUsd(P.d24)}</b><div class="xs mut">${pc((P.d24 / (P.val - P.d24 || 1)) * 100)} azi${P.pnl != null ? ` · ${sgnUsd(P.pnl)} total` : ''}</div></div></div>
    <div class="alloc">${P.rows.slice(0, 8).map((r, i) => `<i style="width:${(r.v / P.val) * 100}%;background:${COLS[i]}"></i>`).join('')}</div>`;
}
function oppList() {
  const m = M();
  return Object.entries(st.an).map(([s, a]) => ({ s, a, p: st.prob[s], r: a.score / 100 + (st.prob[s] != null && m ? (st.prob[s] - m.test.base) * 4 : 0) })).sort((x, y) => y.r - x.r);
}
function renderOpps() {
  const L = oppList().slice(0, 5);
  $('#opps').innerHTML = L.map(({ s, a, p }) => { const pl = C.planFor(a, px(s)); return `<div class="oc" data-sym="${s}"><div class="h"><b>${s}</b><span>${p != null ? `<span class="pill p-ai">AI ${Math.round(p * 100)}%</span> ` : ''}<span class="pill ${pillT(a)}">${a.label.txt}</span></span></div>
    <p>${esc(a.reasons.filter((r) => r[0] > 0).slice(0, 2).map((r) => r[1]).join(' · ') || 'Fără semnale pozitive clare acum.')}</p>
    ${pl ? `<div class="lv3"><div>Intrare<b>${fp(pl.entry)}</b></div><div>Stop<b>${fp(pl.stop)}</b></div><div>Țintă<b>${fp(pl.target)}</b></div></div>` : ''}</div>`; }).join('') || '<div class="empty">Se calculează…</div>';
}
function newsHTML(x) {
  return `<a class="news" href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.title)}</b><div class="m">${x.imp >= 5 ? '<span class="pill p-or" style="padding:2px 7px;font-size:11px">IMPORTANT</span>' : ''}<span class="${x.sent > 0 ? 'up' : x.sent < 0 ? 'dn' : ''}">${x.sent > 0 ? '▲ pozitiv' : x.sent < 0 ? '▼ negativ' : '• neutru'}</span><span>${esc(x.src)}</span><span>${ago(x.t)}</span>${x.tags.map((t) => `<span class="pill p-flat" style="padding:2px 7px;font-size:11px">${t}</span>`).join('')}</div></a>`;
}
function renderNewsMini() {
  const el = $('#newsMini'); if (!el) return;
  const mine = new Set([...st.port.hold.map((h) => h.sym), ...st.set.crypto]);
  const L = [...st.news].sort((a, b) => (b.imp + (b.tags.some((t) => mine.has(t)) ? 2 : 0)) - (a.imp + (a.tags.some((t) => mine.has(t)) ? 2 : 0)) || b.t - a.t).filter((x) => Date.now() - x.t < 36 * 3600e3).slice(0, 3);
  el.innerHTML = L.length ? L.map(newsHTML).join('') : `<div class="empty">${st.err['știri'] ? 'Știrile nu se încarcă acum.' : 'Se încarcă…'}</div>`;
}
function wRow(s) {
  const t = st.tick[s], p = px(s), c = ch24(s), S = st.S[s];
  return `<div class="row" data-sym="${s}"><div class="ic">${s[0]}</div><div class="nm"><b>${s}</b><span>${esc(C.nameOf(s))}</span></div>${spark(S ? S.c.slice(-30) : null)}
    <div class="pr" style="width:92px"><b data-p="${s}" data-u="1">$${fp(p)}</b><span data-c="${s}" class="${cls(c)}">${pc(c)}</span></div></div>`;
}
function renderWatch() {
  const L = [...st.set.crypto, ...(st.set.kT ? st.set.stocks.filter((s) => st.daily[s]) : [])];
  $('#watch').innerHTML = L.map(wRow).join('') + (st.set.kT ? '' : '<p class="xs mut" style="margin:10px 0 2px">Pentru acțiuni (NVDA, SPY…) pune o cheie gratuită Twelve Data în Setări.</p>');
}

/* ================= Semnale ================= */
function meter(sc) { const w = Math.abs(sc) / 2; return `<div class="meter"><i style="left:${sc >= 0 ? 50 : 50 - w}%;width:${Math.max(w, 1)}%;background:${sc >= 0 ? 'var(--up)' : 'var(--dn)'}"></i></div>`; }
function renderSigs() {
  let list = st.kind === 'crypto' ? st.set.crypto : st.kind === 'stocks' ? st.set.stocks : st.port.hold.map((h) => h.sym);
  if (st.kind === 'stocks' && !st.set.kT) { $('#sigs').innerHTML = '<div class="card empty">Pune cheia gratuită Twelve Data în Setări ca să analizez acțiunile.</div>'; return; }
  if (st.kind === 'port' && !list.length) { $('#sigs').innerHTML = '<div class="card empty">Adaugă ce deții în Portofoliu și aici vezi semnalele doar pentru ele.</div>'; return; }
  const arr = list.filter((s) => st.an[s]).sort((a, b) => st.an[b].score - st.an[a].score);
  $('#sigs').innerHTML = arr.length ? arr.map((s) => { const a = st.an[s], p = st.prob[s], c = ch24(s); return `<div class="card sig" data-sym="${s}"><div class="h"><div class="ic">${s[0]}</div><div class="nm"><b>${s}</b><span>$<span data-p="${s}">${fp(px(s))}</span> · <span data-c="${s}" class="${cls(c)}">${pc(c)}</span></span></div>${p != null ? `<span class="pill p-ai">AI ${Math.round(p * 100)}%</span>` : ''}<span class="pill ${pillT(a)}">${a.label.txt}</span></div>
    ${meter(a.score)}<div class="why">${esc(a.reasons.slice(0, 2).map((r) => r[1]).join(' · '))}</div></div>`; }).join('')
    : (st.kind === 'port' ? '<div class="card empty">Activele din portofoliu care nu sunt în watchlist nu au încă analiză. Adaugă-le în watchlist din Setări.</div>' : [1, 2, 3].map(() => '<div class="card sk" style="height:110px"></div>').join(''));
}

/* ================= Demo ================= */
function renderDemoTop(light = false) {
  const eq = SIM.equity(st.sim, px), pnl = eq - st.sim.start, s = SIM.simStats(st.sim.hist);
  SIM.recordEq(st.sim, eq);
  if (light && $('#eqV')) { $('#eqV').textContent = usd(eq, 2); $('#eqP').textContent = `${sgnUsd(pnl)} · ${pc((pnl / st.sim.start) * 100, 2)}`; $('#eqP').className = 'sm ' + cls(pnl); return; }
  $('#demoTop').innerHTML = `<div class="card"><div class="port"><div><span class="xs mut">Valoare cont demo</span><div class="big num" id="eqV" style="font-size:32px">${usd(eq, 2)}</div><div id="eqP" class="sm ${cls(pnl)}">${sgnUsd(pnl)} · ${pc((pnl / st.sim.start) * 100, 2)}</div></div>
      <div style="text-align:right"><span class="xs mut">Cash</span><b style="display:block;font:600 16px var(--H)">${usd(st.sim.cash)}</b></div></div>
      <div style="height:90px;position:relative;margin-top:12px"><canvas id="eqC" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div>
      <div class="g2" style="margin-top:12px"><div><span>Tranzacții închise</span><b>${s.n}</b></div><div><span>Rată de câștig</span><b>${s.win == null ? '—' : pcRaw(s.win)}</b></div><div><span>Profit factor</span><b>${s.pf == null ? '—' : s.pf === Infinity ? '∞' : nf(s.pf, 2)}</b></div><div><span>Scădere maximă</span><b class="dn">${pc(SIM.maxDD(st.sim.eq))}</b></div></div></div>
    <div class="card" style="display:flex;align-items:center;gap:12px"><div class="nm"><b>Auto-pilot AI</b><span>Intră singur când modelul trece de prag. Stop 2×ATR, țintă 3×ATR, maxim 7 zile, 10% din cont.</span></div><button class="tg ${st.sim.auto ? 'on' : ''}" id="autoT" aria-label="Auto-pilot"></button></div>
    <button class="btn w" data-trade="">Tranzacție nouă</button>`;
  st.eqChart?.stop(); st.eqChart = lineChart($('#eqC'), st.sim.eq, usd);
  saveSim();
}
function renderPositions() {
  const P = st.sim.pos; $('#posN').textContent = P.length ? `${P.length} deschise` : '';
  $('#positions').innerHTML = P.length ? P.map((p) => { const c = px(p.sym) ?? p.entry, v = p.qty * c, pnl = v - p.usd, pp = (c / p.entry - 1) * 100;
    return `<div class="row" style="cursor:default"><div class="ic">${p.sym[0]}</div><div class="nm"><b>${p.sym} ${p.src === 'auto' ? '<span class="pill p-ai" style="padding:2px 7px;font-size:11px">auto</span>' : ''}</b><span>${usd(p.usd)} la ${fp(p.entry)} · ${p.sl ? 'stop ' + fp(p.sl) : 'fără stop'}${p.tp ? ' · țintă ' + fp(p.tp) : ''}</span></div>
      <div class="pr"><b class="${cls(pnl)}">${sgnUsd(pnl)}</b><span class="${cls(pp)}">${pc(pp)}</span></div><button class="btn g" style="min-height:36px;padding:8px 12px" data-close="${p.id}">Vinde</button></div>`; }).join('')
    : '<div class="empty">Nicio poziție deschisă. Deschide una din ecranul unui activ sau pornește auto-pilotul.</div>';
}
function renderPerf() {
  const m = M(), L = learnStats(), as = SIM.simStats(st.sim.hist.filter((h) => h.src === 'auto'));
  if (!m) { $('#perf').innerHTML = `<div class="card empty">${st.err.crypto ? 'Fără date, nu pot antrena modelul.' : 'Antrenez modelul pe istoricul monedelor…'}</div>`; return; }
  const t = m.test, edge = (t.hitSel ?? 0) - t.base;
  const bk = t.buckets.filter((b) => b.n >= 10);
  $('#perf').innerHTML = `<div class="ins"><div class="k">TEST PE DATE NEVĂZUTE · ${t.n} CAZURI DIN ${new Date(t.from).toLocaleDateString('ro-RO', { month: 'short', year: 'numeric' })} ÎNCOACE</div>
      <p>Când modelul a dat peste <b>${Math.round(m.thr * 100)}%</b>, prețul a fost mai sus după 7 zile în <b>${pcRaw(t.hitSel)}</b> din cazuri, față de <b>${pcRaw(t.base)}</b> în orice zi.</p>
      <div class="wb"><span>${t.nSel} semnale</span><div class="wbb"><i style="width:${(t.hitSel ?? 0) * 100}%"></i></div><span>${pc(t.avgSel)} medie / 7z</span></div>
      <p class="sm" style="color:var(--sub);margin-top:10px">${edge > 0.03 ? `Avantaj real de ${Math.round(edge * 100)} puncte procentuale. Mic, dar măsurat.` : edge > 0 ? 'Avantaj mic față de hazard. Folosește-l ca filtru, nu ca oracol.' : 'Pe perioada de test modelul n-a bătut piața. Nu te baza pe el singur acum.'} Strategia „cumpăr la semnal, țin 7 zile”: ${t.trades} tranzacții, ${pcRaw(t.tradeWin)} pe plus, ${pc(t.tradeAvg)} medie cu comision.</p></div>
    <div class="card"><b style="font:600 16px var(--H)">Precizie pe niveluri de încredere</b>
      ${bk.map((b) => `<div class="wb" style="margin-top:10px"><span style="width:74px">${Math.round(b.a * 100)}–${Math.min(100, Math.round(b.b * 100))}%</span><div class="wbb"><i style="width:${b.hit * 100}%;background:${b.hit >= t.base ? 'var(--up)' : 'var(--dn)'}"></i></div><span style="width:72px;text-align:right">${pcRaw(b.hit)} · n${b.n}</span></div>`).join('')}
      <p class="xs mut" style="margin:10px 0 0">Antrenat pe ${nf(m.nRows, 0)} zile din ${m.syms.length} monede, reantrenat la fiecare 6 ore. Accuracy brut ${pcRaw(t.acc)}.</p></div>
    <div class="card"><b style="font:600 16px var(--H)">Ce urmărește modelul cel mai mult</b>${m.imp.slice(0, 5).map((x) => `<div class="rs"><b class="${x.w > 0 ? 'up' : 'dn'}">${x.w > 0 ? '↑' : '↓'}</b><span>${esc(x.f)} <span class="mut xs">${x.w > 0 ? 'mai mare = mai bullish' : 'mai mare = mai bearish'}</span></span></div>`).join('')}</div>
    <div class="card"><b style="font:600 16px var(--H)">Învățare din semnalele live</b><div class="g2" style="margin-top:10px">
      ${['ai', 'opp'].map((k) => { const b = L[k]; return `<div><span>${k === 'ai' ? 'Semnale AI' : 'Oportunități scor'}</span><b>${b ? `${pcRaw(b.hit)} din ${b.n}` : 'în curs'}</b>${b?.muted ? '<span class="dn">oprit automat</span>' : ''}</div>`; }).join('')}
      <div><span>Auto-pilot (demo)</span><b>${as.n ? `${pcRaw(as.win)} din ${as.n}` : 'nicio tranzacție'}</b></div><div><span>În verificare</span><b>${st.journal.filter((j) => !j.done).length}</b></div></div>
      <p class="xs mut" style="margin:10px 0 0">Fiecare semnal e verificat automat după 7 zile. Dacă un tip greșește des (sub 45% din minim 8), îi opresc notificările până își revine.</p></div>`;
}
function renderHist() {
  const H = st.sim.hist;
  $('#hist').innerHTML = H.length ? H.slice(0, 40).map((h) => `<div class="row" style="cursor:default"><div class="ic" style="color:${h.pnl >= 0 ? 'var(--up)' : 'var(--dn)'}">${h.pnl >= 0 ? '✓' : '✕'}</div><div class="nm"><b>${h.sym} <span class="mut xs">${h.reason}${h.src === 'auto' ? ' · auto' : ''}</span></b><span>${fp(h.entry)} → ${fp(h.exit)} · ${new Date(h.exitT).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })}</span></div><div class="pr"><b class="${cls(h.pnl)}">${sgnUsd(h.pnl)}</b><span class="${cls(h.pnlPct)}">${pc(h.pnlPct)}</span></div></div>`).join('')
    : '<div class="empty">Istoricul apare după prima tranzacție închisă.</div>';
}
function renderDemo() { renderDemoTop(); renderPositions(); renderPerf(); renderHist(); }

/* ================= Alerte ================= */
function renderAlerts() {
  const el = $('#alBody');
  if (st.atab === 'rec') {
    if (!st.alerts.length) { el.innerHTML = '<div class="wrap"><div class="card empty">Liniște deocamdată. Te anunț când se mișcă ceva.</div></div>'; return; }
    const g = {}; for (const a of st.alerts.slice(0, 120)) { const d = new Date(a.t), k = C.dayKey(a.t) === C.dayKey(Date.now()) ? 'AZI' : C.dayKey(a.t) === C.dayKey(Date.now() - 864e5) ? 'IERI' : d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'long' }).toUpperCase(); (g[k] ||= []).push(a); }
    const dot = (a) => (/^(d1|h1|h4).*:d$|scădere|🩸|sub|❌|death|lo90|risc/i.test(a.key + a.title) ? 'var(--dn)' : /^news/.test(a.key) ? 'var(--or)' : /^(opp|ai|gc|hi90|auto|simc)|✅|🚀/.test(a.key + a.title) ? 'var(--up)' : 'var(--sky)');
    el.innerHTML = Object.entries(g).map(([k, L]) => `<div class="grp">${k}</div><div class="wrap"><div class="card">${L.map((a) => `<div class="al"${a.url ? ` data-url="${esc(a.url)}"` : st.an[a.sym] ? ` data-sym="${a.sym}"` : ''}><div class="d" style="background:${dot(a)}"></div><div><b>${esc(a.title)}</b><span>${esc(a.body)} · ${ago(a.t)}</span></div></div>`).join('')}</div></div>`).join('')
      + '<div class="wrap" style="margin-top:12px"><button class="btn g w" id="clrA">Golește lista</button></div>';
  } else if (st.atab === 'mine') {
    el.innerHTML = `<div class="grp">ALERTELE MELE DE PREȚ</div><div class="wrap"><div class="card">${st.palerts.length ? st.palerts.map((a) => { const p = px(a.sym), dist = p ? (a.price / p - 1) * 100 : null;
      return `<div class="row" style="cursor:default"><div class="ic">${a.sym[0]}</div><div class="nm"><b>${a.sym} ${a.op === '<' ? 'sub' : 'peste'} $${fp(a.price)}</b><span>${a.on ? (dist != null ? `Mai e ${pc(dist)}` : 'Activă') : a.hitAt ? `Atinsă ${ago(a.hitAt)}` : 'Pe pauză'}</span></div><button class="tg ${a.on ? 'on' : ''}" data-pat="${a.id}" aria-label="Pornește sau oprește"></button><button class="btn g" style="min-height:36px;padding:8px 10px" data-pdel="${a.id}" aria-label="Șterge">✕</button></div>`; }).join('') : '<div class="empty">Nicio alertă de preț. Adaugă una mai jos.</div>'}</div>
      <form class="card" id="paF"><b style="font:600 16px var(--H)">Alertă nouă</b><div class="f3"><div><label for="paS">Activ</label><input id="paS" autocapitalize="characters" placeholder="BTC" required></div><div><label for="paO">Când</label><select id="paO"><option value="<">sub</option><option value=">">peste</option></select></div><div><label for="paP">Preț $</label><input id="paP" type="number" step="any" inputmode="decimal" required></div></div><button class="btn w" style="margin-top:12px">Adaugă alerta</button></form>
      <div class="card" style="display:flex;align-items:center;gap:12px"><div class="nm"><b>Liniște noaptea</b><span>${st.set.qFrom}:00 – ${st.set.qTo}:00, doar alertele critice</span></div><button class="tg ${st.set.quiet ? 'on' : ''}" id="quietT" aria-label="Liniște noaptea"></button></div>
      <p class="xs mut" style="margin:0 4px">Alertele de preț se verifică live cât aplicația e deschisă sau în fundal recent. Pentru siguranță 24/7, monitorul GitHub acoperă mișcările mari.</p></div>`;
  } else {
    const L = learnStats(), J = st.journal;
    el.innerHTML = `<div class="wrap"><div class="card"><b style="font:600 16px var(--H)">Jurnalul semnalelor</b><p class="sm mut" style="margin:6px 0 4px">Fiecare semnal de oportunitate primit e verificat automat după 7 zile: a avut dreptate sau nu. Din asta aplicația decide ce merită notificat.</p>
      ${Object.keys(L).length ? Object.entries(L).map(([k, b]) => `<div class="rs"><b class="${b.hit >= 0.5 ? 'up' : 'dn'}">${pcRaw(b.hit)}</b><span>${k === 'ai' ? 'Semnale AI' : 'Oportunități din scor'}: ${b.w} corecte din ${b.n}, ${pc(b.avg)} medie${b.muted ? ' · <span class="dn">notificări oprite</span>' : ''}</span></div>`).join('') : '<div class="empty">Primele rezultate apar la 7 zile după primele semnale.</div>'}</div>
      <div class="card">${J.length ? J.slice(0, 40).map((j) => `<div class="row" data-sym="${j.sym}"><div class="ic" style="color:${!j.done ? 'var(--mut)' : j.ok ? 'var(--up)' : 'var(--dn)'}">${!j.done ? '…' : j.ok ? '✓' : '✕'}</div><div class="nm"><b>${j.sym} · ${j.type === 'ai' ? 'AI' : 'scor'} ${j.prob != null ? Math.round(j.prob * 100) + '%' : ''}</b><span>${new Date(j.t).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' })} la ${fp(j.price)} · scor ${j.score}</span></div><div class="pr">${j.done ? `<b class="${cls(j.ret)}">${pc(j.ret)}</b><span class="mut">după 7z</span>` : `<span class="mut">verific în ${Math.max(0, Math.ceil((j.t + 7 * 864e5 - Date.now()) / 864e5))}z</span>`}</div></div>`).join('') : '<div class="empty">Niciun semnal înregistrat încă.</div>'}</div></div>`;
  }
}

/* ================= Sheets ================= */
function openSheet(kind, title, right = '') {
  st.sheet = kind; $('#shT').innerHTML = title; $('#shR').innerHTML = right; $('#sheet').classList.add('on'); $('#sheet').scrollTop = 0;
}
function closeSheet() { $('#sheet').classList.remove('on'); st.sheet = null; st.cur = null; st.chart?.stop(); st.chart = null; }

async function tfCandles(s) {
  const tf = st.tf, d = st.daily[s] || [];
  if (isStock(s) || !['1Z', '1S'].includes(tf)) { const n = { '1L': 30, '3L': 90, '1A': 365 }[tf] || 90; return { cs: d.slice(-n), n, intraday: false }; }
  if (tf === '1S') return { cs: st.h1[s] || [], intraday: true };
  if (!st.m15[s] || Date.now() - st.m15[s].at > 60e3) { try { st.m15[s] = { at: Date.now(), cs: await C.cryptoKlines(s, '15m', 96) }; } catch { return { cs: st.h1[s]?.slice(-24) || [], intraday: true }; } }
  return { cs: st.m15[s].cs, intraday: true };
}
async function openDetail(s, refresh = false) {
  const a = st.an[s], S = st.S[s]; if (!a) return;
  st.cur = s; const kind = kindOf(s); if (isStock(s) && ['1Z', '1S'].includes(st.tf)) st.tf = '3L';
  if (!st.bt[s]) st.bt[s] = C.backtest(S, kind);
  const b = st.bt[s], p = px(s), c = ch24(s), pr = st.prob[s], m = st.model[kind], plan = C.planFor(a, p);
  if (!refresh) openSheet('detail', `${s} <span class="mut sm" style="font:400 13px Inter">${esc(C.nameOf(s))}</span>`, `<span class="pill ${pillT(a)}">${a.label.txt} · ${a.score > 0 ? '+' : ''}${a.score}</span>`);
  let ins;
  if (m && pr != null) { const bk = m.test.buckets.find((x) => pr >= x.a && pr < x.b); ins = { k: 'CE ZICE MODELUL, TESTAT PE DATE NEVĂZUTE', p: `Modelul dă <b>${Math.round(pr * 100)}%</b> șanse ca ${s} să fie mai sus peste 7 zile. La nivelul ăsta de încredere a avut dreptate în <b>${pcRaw(bk?.hit)}</b> din cazuri.`, n: bk?.n, hit: bk?.hit, avg: bk?.avg }; }
  const rsiRow = b.rows[0], best = b.rows.filter((r) => r.n >= 6).sort((x, y) => y.avg30 - x.avg30)[0];
  const hist = a.rsi < 38 && rsiRow.n >= 4 ? { k: 'CE ZICE ISTORICUL', p: `După ce RSI a coborât sub 30, ${s} a fost pe plus după 30 de zile în <b>${pcRaw(rsiRow.win30 / 100)}</b> din cazuri.`, n: rsiRow.n, hit: rsiRow.win30 / 100, avg: rsiRow.avg30, d: 30 }
    : best ? { k: 'CE ZICE ISTORICUL', p: `Cel mai bun semnal istoric pe ${s}: <b>${esc(best.name)}</b>, pe plus după 30 de zile în ${pcRaw(best.win30 / 100)} din cazuri.`, n: best.n, hit: best.win30 / 100, avg: best.avg30, d: 30 } : null;
  const insC = (x) => (x ? `<div class="ins"><div class="k">${x.k}</div><p>${x.p}</p><div class="wb"><span>${x.n ?? 0} cazuri</span><div class="wbb"><i style="width:${(x.hit ?? 0) * 100}%"></i></div><span>${pc(x.avg)} medie${x.d ? ' / 30z' : ' / 7z'}</span></div></div>` : '');
  const row = (r, base) => `<tr${base ? ' class="base"' : ''}><td>${esc(r.name)}</td><td>${r.n}</td><td class="${cls(r.avg7)}">${pc(r.avg7)}</td><td class="${cls(r.avg30)}">${pc(r.avg30)}</td><td>${r.win30 == null ? '—' : Math.round(r.win30) + '%'}</td><td class="${cls(r.worst30)}">${pc(r.worst30)}</td></tr>`;
  $('#shB').innerHTML = `<div style="padding:2px 20px 0"><div class="big">$<span data-p="${s}">${fp(p)}</span></div><div class="sm" style="margin-top:4px"><span data-c="${s}" class="${cls(c)}">${pc(c)}</span> <span class="mut">azi · ${pc(a.dd90, 0)} de la maximul pe 90 de zile</span></div></div>
    <div class="tf" id="tfB">${(isStock(s) ? ['1L', '3L', '1A'] : ['1Z', '1S', '1L', '3L', '1A']).map((k) => `<button data-tf="${k}" class="${st.tf === k ? 'on' : ''}">${k}</button>`).join('')}<span class="xs mut" style="margin-left:auto;align-self:center">${['1L', '3L', '1A'].includes(st.tf) ? '<span style="color:var(--or)">━</span> EMA50 <span style="color:var(--sky)">━</span> EMA200' : ''}</span></div>
    <div class="fig"><canvas id="cv"></canvas><div class="tip" id="tip"></div></div>
    <div class="wrap" style="margin-top:14px">
      ${plan ? `<div class="card" style="padding:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><b style="font:600 18px var(--H)">Planul de trade</b><span class="pill p-flat">${pr != null ? `AI ${Math.round(pr * 100)}%` : 'Generat din date'}</span></div>
        <div class="pg"><div><span>Intrare</span><b>${fp(plan.entry)}</b></div><div><span>Stop</span><b style="color:var(--or)">${fp(plan.stop)}</b></div><div><span>Țintă</span><b style="color:var(--sky)">${fp(plan.target)}</b></div></div>
        <div class="rr"><span>Risc / câștig</span><div class="rrb"><i style="width:33%;background:var(--or)"></i><i style="width:67%;background:var(--sky)"></i></div><b>1 : 2</b></div>
        <p class="xs mut" style="margin:10px 0 0">Stop la 2× mișcarea medie zilnică (${pc(-plan.riskPct)}), țintă la dublul riscului. Rezistența cea mai apropiată: ${fp(a.resistance)}.</p>
        <div class="act"><button class="btn" data-trade="${s}">Deschide în Demo</button><button class="btn g" data-palert="${s}">Alertă de preț</button><button class="btn g" data-ask="Analizează ${s} acum: merită intrare? Unde intru, unde pun stop și țintă?">Întreabă AI</button></div></div>` : ''}
      ${insC(ins)}${insC(hist)}
      <div class="card"><b style="font:600 16px var(--H)">De ce scorul e ${a.score}</b>${a.reasons.map((r) => `<div class="rs"><b class="${r[0] > 0 ? 'up' : 'dn'}">${r[0] > 0 ? '+' : ''}${r[0]}</b><span>${esc(r[1])}</span></div>`).join('')}</div>
      <div class="g2"><div><span>Suport (20z)</span><b>${fp(a.support)}</b></div><div><span>Rezistență (20z)</span><b>${fp(a.resistance)}</b></div><div><span>RSI 14</span><b>${a.rsi?.toFixed(0)}</b></div><div><span>Volatilitate anuală</span><b>${a.vol30?.toFixed(0)}%</b></div></div>
      <div class="card"><details><summary>Toate statisticile istorice (${b.days} zile) →</summary><div style="overflow-x:auto;margin-top:8px"><table><thead><tr><th>Semnal</th><th>n</th><th>7z</th><th>30z</th><th>Win</th><th>Min</th></tr></thead><tbody>${b.rows.map((r) => row(r)).join('')}${row(b.base, true)}</tbody></table></div><p class="xs mut">Win = câte au fost pe plus la 30 de zile. Unde n &lt; 6, e mai mult noroc decât statistică.</p></details></div>
    </div>`;
  {
    st.chart?.stop(); st.chart = null;
    let data = await tfCandles(s);
    const fmtC = () => {
      const cs = data.cs.map((k, i) => (i === data.cs.length - 1 && st.tick[s] && !isStock(s) ? { ...k, c: st.tick[s].price, h: Math.max(k.h, st.tick[s].price), l: Math.min(k.l, st.tick[s].price) } : k));
      const daily = !data.intraday, off = S.n - cs.length;
      return { cs, plan: C.planFor(a, px(s)), fmt: fp, intraday: data.intraday, emas: daily ? [{ v: S.e50.slice(off), c: '#FF7A1A' }, { v: S.e200.slice(off), c: '#4FB3E8' }] : [] };
    };
    if (st.cur === s && $('#cv')) st.chart = candleChart($('#cv'), fmtC, $('#tip'));
  }
}

function openTrade(s) {
  const syms = [...new Set([...st.set.crypto.filter((x) => st.an[x]), ...st.set.stocks.filter((x) => st.an[x])])];
  s = s || syms[0];
  openSheet('trade', 'Tranzacție nouă (demo)');
  const fill = () => {
    const sym = $('#tS').value, a = st.an[sym], p = px(sym), pl = a && C.planFor(a, p);
    $('#tP').textContent = `$${fp(p)}`; $('#tSL').value = pl ? +pl.stop.toPrecision(6) : ''; $('#tTP').value = pl ? +pl.target.toPrecision(6) : ''; sum();
  };
  const sum = () => {
    const sym = $('#tS').value, p = px(sym), u = +$('#tU').value, sl = +$('#tSL').value, tp = +$('#tTP').value, eq = SIM.equity(st.sim, px);
    if (!(u > 0 && p)) { $('#tSum').textContent = ''; return; }
    const q = u / p, risk = sl ? q * (p - sl) : null, gain = tp ? q * (tp - p) : null;
    $('#tSum').innerHTML = `Cumperi <b>${q.toPrecision(4)} ${sym}</b> la ~$${fp(p)}. ${risk != null && sl < p ? `Dacă te scoate stopul pierzi <b class="dn">${usd(risk, 2)}</b> (${nf((risk / eq) * 100, 1)}% din cont${risk / eq > 0.02 ? ', <span class="dn">peste 2%: prea mult</span>' : ''}).` : '<span class="dn">Fără stop valid.</span>'} ${gain != null && tp > p ? `La țintă câștigi <b class="up">${usd(gain, 2)}</b>${risk ? `, R:R 1:${nf(gain / risk, 1)}` : ''}.` : ''}`;
  };
  $('#shB').innerHTML = `<form class="wrap" id="tF" style="margin-top:8px"><div class="card">
    <div class="f2"><div><label for="tS">Activ</label><select id="tS">${syms.map((x) => `<option ${x === s ? 'selected' : ''}>${x}</option>`).join('')}</select></div><div><label>Preț acum</label><div id="tP" class="big" style="font-size:24px;padding-top:8px"></div></div></div>
    <label for="tU">Sumă (USD virtuali) · cash ${usd(st.sim.cash)}</label><input id="tU" type="number" step="any" inputmode="decimal" value="${Math.floor(Math.min(st.sim.cash, SIM.equity(st.sim, px) * 0.1))}">
    <div class="qk">${[10, 25, 50, 100].map((k) => `<button type="button" data-q="${k}">${k}%</button>`).join('')}</div>
    <div class="f2"><div><label for="tSL">Stop loss</label><input id="tSL" type="number" step="any" inputmode="decimal"></div><div><label for="tTP">Take profit</label><input id="tTP" type="number" step="any" inputmode="decimal"></div></div>
    <p id="tSum" class="sm" style="margin:14px 0 0;line-height:1.5"></p></div>
    <button class="btn up w">Cumpără (demo)</button><p class="xs mut" style="margin:0 4px">Comision simulat 0,1% la intrare și ieșire, ca pe Binance. Stopul și ținta se execută singure, chiar dacă închizi aplicația (verific la redeschidere pe lumânări de 1h).</p></form>`;
  $('#tS').onchange = fill; ['#tU', '#tSL', '#tTP'].forEach((id) => ($(id).oninput = sum));
  $$('[data-q]').forEach((b) => (b.onclick = () => { $('#tU').value = Math.floor(st.sim.cash * (+b.dataset.q / 100) / 1.001); sum(); }));
  $('#tF').onsubmit = (e) => {
    e.preventDefault(); const sym = $('#tS').value;
    try { const p = SIM.openPos(st.sim, { sym, price: px(sym), usd: +$('#tU').value, sl: +$('#tSL').value || null, tp: +$('#tTP').value || null }); saveSim(); live.set([...st.valid, ...(isStock(sym) ? [] : [sym])]);
      toast({ title: `Cumpărat ${sym} (demo)`, body: `${usd(p.usd)} la ${fp(p.entry)}` }); closeSheet(); go('demo'); }
    catch (er) { toast({ title: 'Nu merge', body: er.message }); }
  };
  fill();
}

function openPortfolio() {
  openSheet('portfolio', 'Portofoliu');
  const P = portCalc();
  $('#shB').innerHTML = `<div class="wrap" style="margin-top:8px">
    <div class="card"><span class="xs mut">Valoare totală</span><div class="big">${usd(P.val)}</div><div class="sm"><span class="${cls(P.d24)}">${sgnUsd(P.d24)} azi</span>${P.pnl != null ? ` · <span class="${cls(P.pnl)}">${sgnUsd(P.pnl)} față de cost</span>` : ''}</div>
      <div class="alloc">${P.rows.slice(0, 8).map((r, i) => `<i style="width:${(r.v / (P.val || 1)) * 100}%;background:${COLS[i]}"></i>`).join('')}</div></div>
    <div class="card">${P.rows.length ? P.rows.map((r, i) => `<div class="row" style="cursor:default"><div class="ic" style="color:${COLS[i % 8]}">${r.sym[0]}</div><div class="nm"><b>${r.sym} <span class="xs mut">${r.src === 'binance' ? 'Binance' : 'manual'}</span></b><span>${+r.qty.toPrecision(6)} × $${fp(r.p)}${r.cost ? ` · cost $${fp(r.cost)}` : ''}</span></div><div class="pr"><b>${usd(r.v)}</b>${r.pnl != null ? `<span class="${cls(r.pnl)}">${sgnUsd(r.pnl)}</span>` : `<span class="mut">${pc((r.v / (P.val || 1)) * 100, 0).replace('+', '')}</span>`}</div>${r.src !== 'binance' ? `<button class="btn g" style="min-height:36px;padding:8px 10px" data-hdel="${r.id}" aria-label="Șterge">✕</button>` : ''}</div>`).join('') : '<div class="empty">Nimic încă. Adaugă manual sau sincronizează din Binance.</div>'}</div>
    <form class="card" id="hF"><b style="font:600 16px var(--H)">Adaugă manual</b><div class="f3"><div><label for="hS">Activ</label><input id="hS" autocapitalize="characters" placeholder="BTC" required></div><div><label for="hQ">Cantitate</label><input id="hQ" type="number" step="any" inputmode="decimal" required></div><div><label for="hC">Preț mediu $</label><input id="hC" type="number" step="any" inputmode="decimal" placeholder="opțional"></div></div><button class="btn w" style="margin-top:12px">Adaugă</button></form>
    <form class="card" id="bF"><b style="font:600 16px var(--H)">Sincronizare Binance</b><p class="sm mut" style="margin:6px 0 0">Fă o cheie API doar cu <b>Enable Reading</b> (fără trading, fără retrageri). Cheia rămâne doar pe telefonul tău.${st.port.binAt ? ` Ultima sincronizare: ${ago(st.port.binAt)}.` : ''}</p>
      <label for="bK">API Key</label><input id="bK" autocomplete="off" value="${esc(st.set.binK)}"><label for="bS">Secret Key</label><input id="bS" type="password" autocomplete="off" value="${esc(st.set.binS)}">
      <div class="act"><button class="btn">Sincronizează</button>${st.port.binAt ? '<button type="button" class="btn g" id="bX">Deconectează</button>' : ''}</div></form>
    <p class="xs mut" style="margin:0 4px">Revolut și alte aplicații fără API: adaugi manual. Acțiunile din portofoliu au preț doar cu cheia Twelve Data și dacă sunt în watchlist.</p></div>`;
  $('#hF').onsubmit = (e) => { e.preventDefault(); const s = $('#hS').value.trim().toUpperCase(), q = +$('#hQ').value, c = +$('#hC').value || null; if (!s || !(q > 0)) return;
    st.port.hold.push({ id: Date.now().toString(36), sym: s, qty: q, cost: c, src: 'manual' }); savePort(); pullTickers(); openPortfolio(); renderPortCard(); };
  $('#bF').onsubmit = async (e) => { e.preventDefault(); st.set.binK = $('#bK').value.trim(); st.set.binS = $('#bS').value.trim(); save('tm_set', st.set);
    try { toast({ title: 'Sincronizez cu Binance…' }); const bal = await binanceBalances(st.set.binK, st.set.binS); const keep = st.port.hold.filter((h) => h.src !== 'binance');
      const old = Object.fromEntries(st.port.hold.filter((h) => h.src === 'binance').map((h) => [h.sym, h.cost]));
      st.port.hold = [...keep, ...bal.map((b) => ({ id: 'b' + b.sym, sym: b.sym, qty: b.qty, cost: old[b.sym] || null, src: 'binance' }))]; st.port.binAt = Date.now(); savePort();
      await pullTickers(); toast({ title: 'Portofoliu sincronizat', body: `${bal.length} active din Binance.` }); openPortfolio(); renderPortCard(); }
    catch (er) { toast({ title: 'Binance a refuzat', body: `${er.message}. Verifică cheia și că are „Enable Reading”.` }); } };
  if ($('#bX')) $('#bX').onclick = () => { st.port.hold = st.port.hold.filter((h) => h.src !== 'binance'); st.port.binAt = 0; st.set.binK = st.set.binS = ''; save('tm_set', st.set); savePort(); openPortfolio(); renderPortCard(); };
}

function openNews() {
  const f = st.nf, mine = new Set(st.port.hold.map((h) => h.sym));
  let L = st.news; if (f === 'imp') L = L.filter((x) => x.imp >= 4); else if (f === 'port') L = L.filter((x) => x.tags.some((t) => mine.has(t))); else if (f !== 'all') L = L.filter((x) => x.kind === f);
  if (st.sheet !== 'news') openSheet('news', 'Știri');
  $('#shB').innerHTML = `<div class="seg" id="segN">${[['all', 'Toate'], ['imp', 'Importante'], ['port', 'Portofoliu'], ['crypto', 'Crypto'], ['bursă', 'Bursă']].map(([k, l]) => `<button data-n="${k}" class="${f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="wrap"><div class="card">${L.length ? L.slice(0, 60).map(newsHTML).join('') : `<div class="empty">${f === 'bursă' && !st.set.kF ? 'Pentru știri de bursă pune cheia Finnhub în Setări.' : f === 'port' && !mine.size ? 'Adaugă active în portofoliu ca să filtrez știrile.' : 'Nimic aici încă.'}</div>`}</div></div>`;
}

function openSettings() {
  openSheet('settings', 'Setări'); const s = st.set, P = 'Notification' in window ? Notification.permission : 'nesuportat';
  const sa = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('#shB').innerHTML = `<div class="wrap" style="margin-top:8px">
    <div class="card"><label for="sN" style="margin-top:0">Numele tău</label><input id="sN" value="${esc(s.name)}" placeholder="ex. Darius"></div>
    <div class="card"><b style="font:600 16px var(--H)">Notificări</b><p class="sm mut" style="margin:6px 0 0">${P === 'granted' ? '✅ Active.' : P === 'denied' ? '❌ Blocate. Le activezi din Setări iPhone → Notificări → Markets.' : !sa && /iPhone|iPad/.test(navigator.userAgent) ? 'Mai întâi pune aplicația pe Home Screen și deschide-o de acolo.' : 'Apasă ca să primești alerte.'}</p>
      <div class="act"><button class="btn" id="nOn">Activează</button><button class="btn g" id="nTest">Trimite un test</button></div>
      <div class="row" style="cursor:default;border:0;padding-bottom:0"><div class="nm"><b>Notificări de sistem</b><span>Pe lângă cele din aplicație</span></div><button class="tg ${s.notif ? 'on' : ''}" id="nEn" aria-label="Notificări de sistem"></button></div></div>
    <div class="card"><b style="font:600 16px var(--H)">Alerte cu aplicația închisă</b><p class="sm mut" style="margin:6px 0 0">Monitorul de pe GitHub verifică piața la ~15 minute și îți trimite push. Generezi codul, îl copiezi și îl pui în GitHub ca secret PUSH_SUBSCRIPTION.</p>
      <div class="act"><button class="btn" id="pSub">Generează codul</button><button class="btn g" id="pCopy" hidden>Copiază</button></div><pre id="pOut" hidden></pre></div>
    <div class="card"><b style="font:600 16px var(--H)">Praguri alerte</b><div class="f2"><div><label for="th1">Mișcare în 1h (%)</label><input id="th1" type="number" step="0.5" inputmode="decimal" value="${s.th.h1}"></div><div><label for="thd">Crypto 24h (%)</label><input id="thd" type="number" step="0.5" inputmode="decimal" value="${s.th.d1}"></div><div><label for="ths">Acțiuni 24h (%)</label><input id="ths" type="number" step="0.5" inputmode="decimal" value="${s.th.d1Stock}"></div><div><label for="thv">Volum (× normal)</label><input id="thv" type="number" step="0.5" inputmode="decimal" value="${s.th.vol}"></div></div></div>
    <div class="card"><b style="font:600 16px var(--H)">Watchlist</b><label for="wC">Crypto (perechi USDT pe Binance)</label><input id="wC" autocapitalize="characters" value="${s.crypto.join(', ')}"><label for="wS">Acțiuni și ETF-uri (max 8)</label><input id="wS" autocapitalize="characters" value="${s.stocks.join(', ')}"></div>
    <div class="card"><b style="font:600 16px var(--H)">Chei API</b>
      <label for="kA">Anthropic (Claude) · <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">ia cheie</a></label><input id="kA" type="password" autocomplete="off" value="${esc(s.kA)}" placeholder="sk-ant-…">
      <label for="kM">Model AI</label><select id="kM">${[['claude-haiku-5-5', 'Haiku 5.5 · rapid, ieftin'], ['claude-sonnet-5-5', 'Sonnet 5.5 · recomandat'], ['claude-opus-5-5', 'Opus 5.5 · cel mai bun, scump']].map(([v, l]) => `<option value="${v}" ${s.kM === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label for="kT">Twelve Data (acțiuni) · <a href="https://twelvedata.com/register" target="_blank" rel="noopener">gratis</a></label><input id="kT" type="password" autocomplete="off" value="${esc(s.kT)}">
      <label for="kF">Finnhub (știri bursă) · <a href="https://finnhub.io/register" target="_blank" rel="noopener">gratis</a></label><input id="kF" type="password" autocomplete="off" value="${esc(s.kF)}">
      <p class="xs mut" style="margin:10px 0 0">Cheile stau doar pe telefonul tău. Cheia Anthropic e plătită per folosire, separat de abonamentul Claude.</p></div>
    <div class="card"><b style="font:600 16px var(--H)">Demo</b><label for="sC">Capital de pornire ($)</label><input id="sC" type="number" inputmode="decimal" value="${s.simCap}"><p class="xs mut" style="margin:8px 0 0">Se aplică la următoarea resetare a contului demo.</p></div>
    <button class="btn w" id="saveS">Salvează</button><button class="btn g w" id="reOnb">Revezi ghidul de început</button>
    <p class="disc" style="margin:4px">Torque Markets e un instrument de analiză, nu consultanță financiară. Nu investi bani de care ai nevoie și nu folosi leverage.</p></div>`;
  $('#nEn').onclick = (e) => e.currentTarget.classList.toggle('on');
  $('#nOn').onclick = async () => { try { const p = await Notification.requestPermission(); if (p === 'granted') notify({ title: 'Notificări active ✅', body: 'Te anunț la mișcări mari, setup-uri și știri importante.', key: 't' + Date.now(), level: 'high', t: Date.now() }); openSettings(); } catch { toast({ title: 'Nu merge aici', body: 'Deschide aplicația de pe Home Screen.' }); } };
  $('#nTest').onclick = () => notify({ title: 'BTC 🚀 +5,2% în 24h (test)', body: 'Așa arată o alertă reală.', key: 't' + Date.now(), level: 'high', t: Date.now() });
  $('#pSub').onclick = async () => { try { if ((await Notification.requestPermission()) !== 'granted') throw new Error('Permite notificările mai întâi.'); const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription(); if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(C.CONFIG.VAPID_PUBLIC) }); $('#pOut').textContent = JSON.stringify(sub); $('#pOut').hidden = false; $('#pCopy').hidden = false; } catch (e) { toast({ title: 'Push indisponibil', body: e.message + ' (merge doar din aplicația de pe Home Screen, iOS 16.4+)' }); } };
  $('#pCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#pOut').textContent); toast({ title: 'Copiat', body: 'Pune-l în GitHub ca secret PUSH_SUBSCRIPTION.' }); } catch { toast({ title: 'Copiere eșuată', body: 'Ține apăsat pe text și copiază manual.' }); } };
  $('#reOnb').onclick = () => { closeSheet(); onboarding(0); };
  $('#saveS').onclick = () => {
    const L = (v) => [...new Set(v.toUpperCase().split(/[\s,;]+/).filter(Boolean))], old = JSON.stringify([s.crypto, s.stocks, s.kT]);
    Object.assign(s, { name: $('#sN').value.trim(), crypto: L($('#wC').value), stocks: L($('#wS').value).slice(0, 8), kA: $('#kA').value.trim(), kM: $('#kM').value, kT: $('#kT').value.trim(), kF: $('#kF').value.trim(), notif: $('#nEn').classList.contains('on'), simCap: +$('#sC').value || 10000,
      th: { ...s.th, h1: +$('#th1').value || 3, d1: +$('#thd').value || 8, d1Stock: +$('#ths').value || 4, vol: +$('#thv').value || 3 } });
    save('tm_set', s); toast({ title: 'Salvat', body: 'Setările sunt aplicate.' }); closeSheet();
    if (old !== JSON.stringify([s.crypto, s.stocks, s.kT])) { pullTickers(); pullCrypto(true); pullStocks(); }
    pullNews(); renderAll();
  };
}
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

/* ================= AI ================= */
function context() {
  const m = M(), P = portCalc(), Ls = learnStats();
  const assets = Object.entries(st.an).map(([s, a]) => {
    const b = st.bt[s] || (st.S[s] ? (st.bt[s] = C.backtest(st.S[s], kindOf(s))) : null), pl = C.planFor(a, px(s));
    return { s, pret: px(s), ch24: ch24(s)?.toFixed(2), ch7: a.chg7d?.toFixed(1), ch30: a.chg30d?.toFixed(1), rsi: a.rsi?.toFixed(0), trend: a.trend, scor: a.score, probAI7z: st.prob[s] != null ? Math.round(st.prob[s] * 100) + '%' : null,
      motive: a.reasons.slice(0, 4).map((r) => `${r[0] > 0 ? '+' : ''}${r[0]} ${r[1]}`), suport: a.support, rezistenta: a.resistance, plan: pl && { intrare: pl.entry, stop: pl.stop, tinta: pl.target }, volAnual: a.vol30?.toFixed(0), deLaMax90: a.dd90?.toFixed(1),
      istoric: b ? b.rows.filter((r) => r.n >= 4).map((r) => `${r.name}: n=${r.n}, 30z ${pc(r.avg30)}, câștig ${Math.round(r.win30)}%`) : [] };
  });
  return JSON.stringify({ data: new Date().toISOString(), fearGreed: st.fng.slice(0, 8).map((x) => x.v), global: st.glob, verdict: verdict().h,
    modelAI: m && { prag: m.thr, testNevazut: { cazuri: m.test.n, ratăBază: pcRaw(m.test.base), ratăPestePrag: pcRaw(m.test.hitSel), semnale: m.test.nSel }, factoriPrincipali: m.imp.slice(0, 5).map((x) => x.f) },
    jurnalSemnaleLive: Ls, portofoliu: P.rows.map((r) => ({ s: r.sym, qty: r.qty, valoare: Math.round(r.v), cost: r.cost })), demo: { valoare: Math.round(SIM.equity(st.sim, px)), pozitii: st.sim.pos.map((p) => ({ s: p.sym, intrare: p.entry, sl: p.sl, tp: p.tp })), stats: SIM.simStats(st.sim.hist) },
    active: assets, stiri: st.news.slice(0, 15).map((x) => `[${x.imp >= 5 ? 'IMP' : ''}${x.sent > 0 ? '+' : x.sent < 0 ? '-' : ''}] ${x.title} (${x.src}, ${ago(x.t)})`), alerteRecente: st.alerts.slice(0, 8).map((x) => x.title) });
}
const SYS = `Ești analistul de piață personal al utilizatorului: trader cu experiență pe crypto și acțiuni. Vorbești în română, direct și relaxat, ca un prieten care se pricepe, fără introduceri și fără umplutură.
Reguli:
- Te bazezi DOAR pe datele live primite: prețuri, indicatori, scoruri, probabilitatea modelului AI (testat pe date nevăzute), statistici istorice, jurnalul semnalelor, portofoliul, contul demo, știri. Dacă lipsesc date, spui asta.
- Dai niveluri concrete: zonă de intrare, stop, țintă, raport risc/câștig. Folosește planul și suportul/rezistența din date.
- Spui cât de mult să crezi în semnal: compară rata de reușire a modelului peste prag cu rata de bază și ține cont de jurnalul live. n mic = nesigur.
- Ești sincer: dacă setup-ul e prost sau piața e riscantă, spui clar. Nu promiți câștiguri. Recomanzi intrări etapizate, fără leverage, risc 1–2% pe trade.
- Dacă întreabă de portofoliul lui, te uiți la ce deține efectiv.
- Format scurt pentru telefon: titluri cu ###, liste scurte, max ~250 de cuvinte dacă nu ți se cere mai mult.
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
    : '<div class="msg a"><p>Am pe mână prețurile live, modelul AI testat, statisticile istorice, portofoliul tău, contul demo și știrile. Întreabă-mă orice sau apasă o întrebare rapidă.</p></div>';
}
function localBrief(q) {
  const A = oppList(); if (!A.length) return 'Încă încarc datele. Mai încearcă în câteva secunde.';
  const m = M(), up = q.toUpperCase(), sym = up.match(/\b[A-Z]{2,5}\b/g)?.find((s) => st.an[s]);
  if (sym) {
    const a = st.an[sym], b = st.bt[sym] || C.backtest(st.S[sym], kindOf(sym)), pl = C.planFor(a, px(sym)), pr = st.prob[sym], good = b.rows.filter((r) => r.n >= 6).sort((x, y) => y.avg30 - x.avg30)[0];
    return `### ${sym}: ${a.label.txt} (scor ${a.score})\n- Preț $${fp(px(sym))}, trend ${a.trend}, RSI ${a.rsi?.toFixed(0)}\n${pr != null && m ? `- Model AI: **${Math.round(pr * 100)}%** șanse în sus pe 7 zile (prag ${Math.round(m.thr * 100)}%, peste prag a nimerit ${pcRaw(m.test.hitSel)} pe date nevăzute)\n` : ''}${a.reasons.slice(0, 3).map((r) => `- ${r[0] > 0 ? '+' : ''}${r[0]}: ${r[1]}`).join('\n')}\n${pl ? `### Plan\n- Intrare ${fp(pl.entry)}, stop ${fp(pl.stop)}, țintă ${fp(pl.target)} (R:R 1:2)\n` : ''}${good ? `### Istoric\n- Cel mai bun semnal: ${good.name}, ${pc(good.avg30)} la 30 de zile (n=${good.n})\n` : ''}### Concluzie\n${(pr ?? 0) >= (m?.thr ?? 1) && a.score >= 0 ? 'Setup bun pe date și model. Dacă intri, etapizat, cu stopul de mai sus.' : a.score >= 15 ? 'Înclinat pozitiv, dar fără confirmare de la model. Poziție mică sau aștepți.' : a.score > -15 ? 'Neutru. Nu e grabă.' : 'Date slabe. Nu prinde cuțitul: aștepți RSI să întoarcă și prețul peste EMA20.'}\n\n_Analiză locală. Pune cheia Claude în Setări pentru analiză completă._`;
  }
  const v = verdict(), top = A.slice(0, 3), imp = st.news.filter((x) => x.imp >= 5).slice(0, 3);
  return `### ${v.h}\n${v.p}\n### Cele mai bune setup-uri\n${top.map(({ s, a, p }) => `- **${s}** scor ${a.score}${p != null ? `, AI ${Math.round(p * 100)}%` : ''}: ${a.reasons.filter((r) => r[0] > 0).slice(0, 2).map((r) => r[1]).join(', ') || 'fără semnale clare'}`).join('\n')}\n${imp.length ? `### Știri care contează\n${imp.map((x) => `- ${x.title}`).join('\n')}\n` : ''}\n_Analiză locală. Pune cheia Claude în Setări pentru analiză completă._`;
}
async function ask(q) {
  q = q.trim(); if (!q) return; if (cur() !== 'ai') go('ai');
  st.chat.push({ role: 'user', content: q }); renderChat(); $('#askI').value = ''; $('#askB').disabled = true;
  const pend = document.createElement('div'); pend.className = 'msg a'; pend.innerHTML = '<p class="mut">Analizez…</p>'; $('#chat').append(pend); pend.scrollIntoView({ block: 'end', behavior: 'smooth' });
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

/* ================= onboarding ================= */
const ONB = [
  ['Piața, explicată în două rânduri', 'În fiecare dimineață primești verdictul zilei: ce se întâmplă și ce ai face. Fără 20 de grafice.', '<svg width="220" height="150" viewBox="0 0 220 150"><rect x="10" y="20" width="200" height="110" rx="22" fill="#3A1620"/><rect x="30" y="44" width="90" height="10" rx="5" fill="#FF9AA8"/><rect x="30" y="66" width="150" height="14" rx="7" fill="#E8F0FA"/><rect x="30" y="88" width="120" height="14" rx="7" fill="#E8F0FA" opacity=".7"/><rect x="30" y="112" width="70" height="8" rx="4" fill="#4FB3E8"/></svg>'],
  ['Un AI care își arată notele', 'Modelul e testat pe date pe care nu le-a văzut și îți spune cât de des a avut dreptate. Semnalele care greșesc des sunt oprite automat.', '<svg width="220" height="150" viewBox="0 0 220 150"><rect x="20" y="96" width="30" height="40" rx="6" fill="#24344B"/><rect x="62" y="80" width="30" height="56" rx="6" fill="#24344B"/><rect x="104" y="62" width="30" height="74" rx="6" fill="#4FB3E8"/><rect x="146" y="36" width="30" height="100" rx="6" fill="#22C38E"/><circle cx="161" cy="20" r="9" fill="#FF7A1A"/></svg>'],
  ['Exersezi pe demo, fără risc', 'Bani virtuali, prețuri reale, stop și țintă automate. Sau lași auto-pilotul AI să tranzacționeze și vezi cifrele.', '<svg width="220" height="150" viewBox="0 0 220 150"><path d="M10 120 L50 96 L80 104 L120 60 L150 72 L200 24" stroke="#22C38E" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="10" y1="40" x2="210" y2="40" stroke="#4FB3E8" stroke-dasharray="6 6" stroke-width="2"/><line x1="10" y1="132" x2="210" y2="132" stroke="#FF7A1A" stroke-dasharray="6 6" stroke-width="2"/></svg>'],
];
function onboarding(i) {
  const o = $('#onb'); if (i >= ONB.length) { o.hidden = true; st.set.onb = true; save('tm_set', st.set); return; }
  const [h, p, art] = ONB[i]; o.hidden = false;
  o.innerHTML = `<div class="art">${art}</div><div class="dots">${ONB.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div><h2>${h}</h2><p>${p}</p>
    <button class="btn w" id="onN">${i === ONB.length - 1 ? 'Hai să începem' : 'Mai departe'}</button>${i < ONB.length - 1 ? '<button class="btn g w" id="onS" style="margin-top:8px">Sari peste</button>' : ''}`;
  $('#onN').onclick = () => onboarding(i + 1); if ($('#onS')) $('#onS').onclick = () => onboarding(99);
}

/* ================= navigare ================= */
function renderAll() {
  const v = cur(); renderHome();
  if (v === 'semnale') renderSigs(); if (v === 'demo') renderDemo(); if (v === 'alerte') renderAlerts();
  if (st.sheet === 'detail' && st.cur) openDetail(st.cur, true);
}
function go(v) {
  if (!document.getElementById('v-' + v)) v = 'acasa';
  $$('.v').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  if (v === 'alerte') { save('tm_unread', 0); badge(); renderAlerts(); }
  if (v === 'semnale') renderSigs(); if (v === 'demo') renderDemo(); if (v === 'ai') renderChat(); if (v === 'acasa') renderHome();
  scrollTo(0, 0);
}
function bind() {
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.v); };
  $('#back').onclick = closeSheet;
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go],[data-open],[data-ask],[data-trade],[data-palert],[data-close],[data-sym],[data-url],[data-tf],[data-n],[data-k],[data-a],[data-pat],[data-pdel],[data-hdel],#autoT,#resetSim,#clrA,#quietT,#newTrade');
    if (!t) return; const d = t.dataset;
    if (d.go) { closeSheet(); go(d.go); }
    else if (d.open) ({ settings: openSettings, portfolio: openPortfolio, news: () => { st.nf = 'all'; openNews(); } })[d.open]?.();
    else if (d.ask) { closeSheet(); ask(d.ask); }
    else if (d.trade !== undefined) openTrade(d.trade);
    else if (d.palert) { closeSheet(); go('alerte'); st.atab = 'mine'; $$('#segA button').forEach((x) => x.classList.toggle('on', x.dataset.a === 'mine')); renderAlerts(); $('#paS').value = d.palert; $('#paP').value = +(px(d.palert) * 0.95).toPrecision(5); $('#paP').focus(); }
    else if (d.close) { const ps = st.sim.pos.find((p) => p.id === d.close); if (!ps) return; const h = SIM.closePos(st.sim, d.close, px(ps.sym) ?? ps.entry, 'manual'); saveSim(); simClosedNote(h); renderDemo(); }
    else if (d.tf) { st.tf = d.tf; st.chart?.stop(); st.chart = null; openDetail(st.cur, true); }
    else if (d.n) { st.nf = d.n; openNews(); }
    else if (d.k) { st.kind = d.k; $$('#segK button').forEach((x) => x.classList.toggle('on', x === t)); renderSigs(); }
    else if (d.a) { st.atab = d.a; $$('#segA button').forEach((x) => x.classList.toggle('on', x === t)); renderAlerts(); }
    else if (d.pat) { const a = st.palerts.find((x) => x.id === d.pat); a.on = !a.on; if (a.on) a.hitAt = null; save('tm_palerts', st.palerts); renderAlerts(); }
    else if (d.pdel) { st.palerts = st.palerts.filter((x) => x.id !== d.pdel); save('tm_palerts', st.palerts); renderAlerts(); }
    else if (d.hdel) { st.port.hold = st.port.hold.filter((x) => x.id !== d.hdel); savePort(); openPortfolio(); renderPortCard(); }
    else if (d.url) window.open(d.url, '_blank');
    else if (d.sym) { if (st.an[d.sym]) openDetail(d.sym); }
    else if (t.id === 'autoT') { st.sim.auto = !st.sim.auto; saveSim(); t.classList.toggle('on', st.sim.auto); toast({ title: st.sim.auto ? 'Auto-pilot pornit' : 'Auto-pilot oprit', body: st.sim.auto ? 'Intră singur când modelul trece de prag. Verific la fiecare 3 minute.' : '' }); if (st.sim.auto) recompute('crypto'); }
    else if (t.id === 'resetSim') { if (t.dataset.sure) { st.sim = SIM.newSim(st.set.simCap); saveSim(); renderDemo(); toast({ title: 'Cont demo resetat', body: usd(st.set.simCap) + ' virtuali' }); } else { t.dataset.sure = 1; t.textContent = 'Sigur? Apasă iar'; setTimeout(() => { delete t.dataset.sure; t.textContent = 'Resetează'; }, 3000); } }
    else if (t.id === 'clrA') { st.alerts = []; save('tm_alerts', []); renderAlerts(); }
    else if (t.id === 'quietT') { st.set.quiet = !st.set.quiet; save('tm_set', st.set); renderAlerts(); }
    else if (t.id === 'newTrade') openTrade();
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'paF') return; e.preventDefault();
    const s = $('#paS').value.trim().toUpperCase(), p = +$('#paP').value; if (!s || !(p > 0)) return;
    st.palerts.unshift({ id: Date.now().toString(36), sym: s, op: $('#paO').value, price: p, on: true, t: Date.now() }); save('tm_palerts', st.palerts);
    if (!st.valid.has(s) && !isStock(s)) pullTickers(); renderAlerts(); toast({ title: 'Alertă adăugată', body: `${s} ${$('#paO').value === '<' ? 'sub' : 'peste'} $${fp(p)}` });
  });
  $('#askF').onsubmit = (e) => { e.preventDefault(); ask($('#askI').value); };
  $('#askI').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('#askI').value); } });
  const Q = ['Rezumat piață acum', 'Ce zici de portofoliul meu?', 'Care e cea mai bună oportunitate?', 'Cât de mult să cred în modelul AI?', 'Merită BTC acum?', 'Plan DCA pe 4 săptămâni'];
  $('#qs').innerHTML = Q.map((q) => `<button>${q}</button>`).join(''); $('#qs').onclick = (e) => { const b = e.target.closest('button'); if (b) ask(b.textContent); };
  addEventListener('hashchange', () => go(cur()));
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return; live.wake(); pullTickers();
    const c = await SIM.reconcile(st.sim, (s, t) => C.cryptoKlines(s, '1h', Math.min(1000, Math.ceil((Date.now() - t) / 36e5) + 2))); if (c.length) { saveSim(); c.forEach(simClosedNote); }
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
  setInterval(() => { liveStatus(); if (cur() === 'demo') { renderPositions(); renderDemoTop(true); } }, 15e3);
}
init();
