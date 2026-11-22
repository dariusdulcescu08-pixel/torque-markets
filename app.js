import * as C from './core.js';

/* ---------- stare ---------- */
const $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const DEF = { crypto: C.CONFIG.crypto, stocks: C.CONFIG.stocks, th: { ...C.CONFIG.th }, notif: true, kA: '', kM: 'claude-sonnet-5-5', kT: '', kF: '' };
const st = {
  set: { ...DEF, ...load('tm_set', {}) }, tick: {}, daily: {}, h1: {}, S: {}, an: {}, bt: {}, fng: [], glob: null, news: [],
  alerts: load('tm_alerts', []), seen: load('tm_seen', {}), chat: load('tm_chat', []), kind: 'crypto', nf: 'imp', cur: null, range: 365, busy: 0, err: {},
};
st.set.th = { ...DEF.th, ...st.set.th };
const firstRun = !Object.keys(st.seen).length;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fp = C.fmtP, pc = (x) => (x == null || isNaN(x) ? '—' : (x >= 0 ? '+' : '') + x.toFixed(1) + '%'), cls = (x) => (x == null ? '' : x >= 0 ? 'up' : 'dn');
const ago = (t) => { const m = (Date.now() - t) / 6e4; return m < 1 ? 'acum' : m < 60 ? `${m | 0} min` : m < 1440 ? `${(m / 60) | 0} h` : `${(m / 1440) | 0} z`; };
const isStock = (s) => st.set.stocks.includes(s);

/* ---------- date ---------- */
function mergeC(old, nw) {
  if (!old?.length) return nw; const m = new Map(old.map((x) => [x.t, x])); nw.forEach((x) => m.set(x.t, x));
  return [...m.values()].sort((a, b) => a.t - b.t).slice(-1000);
}
async function safe(name, fn) {
  st.busy++; status();
  try { await fn(); delete st.err[name]; } catch (e) { st.err[name] = e.message || String(e); console.warn(name, e); }
  finally { st.busy--; status(); }
}
async function pullTickers() { await safe('preț', async () => { st.tick = { ...st.tick, ...(await C.cryptoTickers(st.set.crypto)) }; st.lastT = Date.now(); }); renderWatch(); }
async function pullCrypto(full = false) {
  await safe('crypto', async () => {
    const res = await Promise.allSettled(st.set.crypto.map(async (s) => {
      const need = full || !st.daily[s];
      const d = await C.cryptoKlines(s, '1d', need ? 1000 : 3);
      st.daily[s] = need ? d : mergeC(st.daily[s], d);
      st.h1[s] = await C.cryptoKlines(s, '1h', 168);
    }));
    const bad = res.filter((r) => r.status === 'rejected'); if (bad.length === res.length) throw bad[0].reason;
  });
  recompute('crypto');
}
async function pullStocks() {
  if (!st.set.kT) return;
  await safe('acțiuni', async () => { const d = await C.stockSeries(st.set.stocks.slice(0, 8), st.set.kT); Object.assign(st.daily, d); });
  recompute('stocks');
}
async function pullMacro() {
  await safe('sentiment', async () => { st.fng = await C.fearGreed(30); });
  await safe('global', async () => { st.glob = await C.globalMkt(); });
  handle(C.marketAlerts({ fng: st.fng[0]?.v })); renderGlob(); recompute('crypto');
}
async function pullNews() {
  await safe('știri', async () => { st.news = await C.news({ finnhubKey: st.set.kF }); });
  handle(C.newsAlerts(st.news)); renderNews();
}
function recompute(kind) {
  const list = kind === 'crypto' ? st.set.crypto : st.set.stocks;
  for (const s of list) {
    const d = st.daily[s]; if (!d || d.length < 60) continue;
    const S = C.series(d); st.S[s] = S;
    const a = C.analyze(S, { fng: st.fng[0]?.v, kind }); st.an[s] = a;
    st.bt[s] = null; // recalculat la cerere
    handle(C.detectAlerts({ sym: s, kind, S, a, h1: kind === 'crypto' ? st.h1[s] : null, live: kind === 'crypto' ? st.tick[s] : null, th: st.set.th }));
  }
  renderAll();
}

/* ---------- alerte + notificări ---------- */
function handle(list) {
  let n = 0;
  for (const al of list) {
    if (st.seen[al.key]) continue; st.seen[al.key] = Date.now();
    st.alerts.unshift(al); n++;
    if (!firstRun || al.level === 'high') notify(al, firstRun);
  }
  if (!n) return;
  const wk = Date.now() - 7 * 864e5; for (const k in st.seen) if (st.seen[k] < wk) delete st.seen[k];
  st.alerts = st.alerts.slice(0, 150); save('tm_alerts', st.alerts); save('tm_seen', st.seen);
  const u = load('tm_unread', 0) + n; save('tm_unread', u); badge(); renderAlerts();
}
async function notify(al, quiet) {
  toast(al);
  if (quiet || !st.set.notif || !('Notification' in window) || Notification.permission !== 'granted') return;
  try { const reg = await navigator.serviceWorker?.ready; await reg.showNotification(al.title, { body: al.body, tag: al.key, icon: 'icon-192.png', badge: 'icon-192.png', data: { url: al.url || './#alerte' } }); }
  catch { try { new Notification(al.title, { body: al.body }); } catch {} }
}
let tq = [], tOn = false;
function toast(al) { if (tq.length >= 3) return; tq.push(al); if (!tOn) nextToast(); }
function nextToast() {
  const al = tq.shift(); const el = $('#toast'); if (!al) { tOn = false; return; } tOn = true;
  el.innerHTML = `<b>${esc(al.title)}</b><p>${esc(al.body)}</p>`; el.classList.add('on');
  setTimeout(() => { el.classList.remove('on'); setTimeout(nextToast, 300); }, 4200);
}
function badge() { const u = load('tm_unread', 0), b = $('#badge'); b.hidden = !u; b.textContent = u > 99 ? '99+' : u; }

/* ---------- randare ---------- */
function status() {
  const e = Object.keys(st.err); $('#dot').className = 'dot' + (st.busy ? ' ld' : e.length ? ' err' : '');
  $('#upd').textContent = st.busy ? 'actualizez…' : e.length ? `eroare: ${e.join(', ')}` : st.lastT ? `live · ${new Date(st.lastT).toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}` : '';
}
function spark(S) {
  if (!S) return '';
  const c = S.c.slice(-30), mn = Math.min(...c), mx = Math.max(...c), r = mx - mn || 1;
  const pts = c.map((v, i) => `${(i / (c.length - 1)) * 70},${26 - ((v - mn) / r) * 24}`).join(' ');
  return `<svg class="spark" viewBox="0 0 70 28"><polyline points="${pts}" fill="none" stroke="${c.at(-1) >= c[0] ? 'var(--up)' : 'var(--dn)'}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}
const chip = (a) => (a ? `<span class="chip t-${a.label.tone}">${a.score > 0 ? '+' : ''}${a.score}</span>` : '<span class="chip">…</span>');
function priceOf(s) { const t = st.tick[s]; if (t && !isStock(s)) return { p: t.price, ch: t.chg24 }; const a = st.an[s]; return a ? { p: a.price, ch: a.chg1d } : { p: null, ch: null }; }
function renderWatch() {
  const all = [...st.set.crypto, ...(st.set.kT ? st.set.stocks : [])];
  $('#watch').innerHTML = all.map((s) => { const { p, ch } = priceOf(s); return `<div class="row" data-s="${s}"><div class="sym">${s}<small>${esc(C.nameOf(s))}</small></div>${spark(st.S[s])}<div class="px num">${fp(p)}<small class="${cls(ch)}">${pc(ch)}</small></div>${chip(st.an[s])}</div>`; }).join('')
    + (st.set.kT ? '' : '<p class="sm mut" style="margin:10px 4px 0">Pentru acțiuni (NVDA, SPY…) pune o cheie gratuită Twelve Data în Setări.</p>');
}
function renderGlob() {
  const f = st.fng[0]?.v, w = st.fng[7]?.v;
  const ang = Math.PI * (1 - (f ?? 50) / 100), cx = 75, cy = 80, R = 62;
  const arc = (a0, a1, col) => { const p = (a) => `${cx + R * Math.cos(a)} ${cy - R * Math.sin(a)}`; return `<path d="M${p(a0)} A${R} ${R} 0 0 1 ${p(a1)}" stroke="${col}" stroke-width="12" fill="none"/>`; };
  const seg = [['#ff5a6e', 1, .75], ['#ff9a5a', .75, .55], ['#7d8ca3', .55, .45], ['#7fd4a8', .45, .25], ['#22c38e', .25, 0]];
  $('#gauge').innerHTML = seg.map(([c, a, b]) => arc(Math.PI * a - .02, Math.PI * b + .02, c)).join('')
    + `<line x1="${cx}" y1="${cy}" x2="${cx + (R - 16) * Math.cos(ang)}" y2="${cy - (R - 16) * Math.sin(ang)}" stroke="#e8f0fa" stroke-width="3" stroke-linecap="round"/><circle cx="${cx}" cy="${cy}" r="5" fill="#e8f0fa"/>`
    + `<text x="${cx}" y="${cy - 18}" text-anchor="middle" font-family="Outfit" font-weight="700" font-size="24" fill="#e8f0fa">${f ?? '–'}</text>`;
  const g = st.glob, btc = st.tick.BTC;
  $('#glob').innerHTML = `<div><span>Sentiment</span><b>${esc(st.fng[0]?.cls ?? '—')}</b></div>
    <div><span>Acum o săpt.</span><b>${w ?? '—'}</b></div>
    <div><span>Cap. piață</span><b class="num">${g ? '$' + (g.mcap / 1e12).toFixed(2) + 'T' : '—'} <small class="${cls(g?.mcapChg)}">${pc(g?.mcapChg)}</small></b></div>
    <div><span>Dominanță BTC</span><b class="num">${g ? g.btcDom.toFixed(1) + '%' : '—'}</b></div>
    <div><span>BTC</span><b class="num">${fp(btc?.price)} <small class="${cls(btc?.chg24)}">${pc(btc?.chg24)}</small></b></div>`;
}
function renderOpps() {
  const arr = Object.entries(st.an).filter(([s]) => st.set.crypto.includes(s) || st.set.stocks.includes(s)).sort((a, b) => b[1].score - a[1].score).slice(0, 3);
  $('#opps').innerHTML = arr.length ? arr.map(([s, a]) => `<div class="o" data-s="${s}"><div class="h"><b class="num">${s} · ${fp(a.price)}</b>${chip(a)}</div><div class="sm">${esc(a.reasons.filter((r) => r[0] > 0).slice(0, 2).map((r) => r[1]).join(' · ') || 'Fără semnale pozitive clare')}</div><div class="sm mut">Suport ${fp(a.support)} · Rezistență ${fp(a.resistance)} · Stop ~${fp(a.stop)}</div></div>`).join('') : '<div class="empty">Se calculează…</div>';
}
const alHTML = (a) => `<div class="al ${a.level}"${a.url ? ` data-u="${esc(a.url)}"` : a.sym && st.an[a.sym] ? ` data-s="${a.sym}"` : ''}><b>${esc(a.title)}</b><p>${esc(a.body)} · ${ago(a.t)}</p></div>`;
function renderAlerts() {
  $('#alertsMini').innerHTML = st.alerts.length ? st.alerts.slice(0, 5).map(alHTML).join('') : '<div class="empty">Nicio alertă încă. Te anunț când se mișcă ceva.</div>';
  $('#alertsAll').innerHTML = st.alerts.length ? st.alerts.map(alHTML).join('') : '<div class="empty">Liniște deocamdată.</div>';
}
function renderSigs() {
  const list = st.kind === 'crypto' ? st.set.crypto : st.set.stocks;
  if (st.kind === 'stocks' && !st.set.kT) { $('#sigs').innerHTML = '<div class="card empty">Pune cheia gratuită Twelve Data în Setări ca să analizez acțiunile.</div>'; return; }
  const arr = list.filter((s) => st.an[s]).sort((a, b) => st.an[b].score - st.an[a].score);
  $('#sigs').innerHTML = arr.length ? arr.map((s) => { const a = st.an[s]; return `<div class="card sig" data-s="${s}"><div class="h"><div class="sym">${s} <span class="mut sm">${esc(C.nameOf(s))}</span></div>${chip(a)}</div>
    <div class="bar"><i style="left:calc(${(a.score + 100) / 2}% - 1px)"></i></div>
    <div class="sm"><b>${a.label.txt}</b> · trend ${a.trend} · RSI ${a.rsi?.toFixed(0) ?? '—'} · 7z <span class="${cls(a.chg7d)}">${pc(a.chg7d)}</span></div>
    <div class="sm mut">${esc(a.reasons.slice(0, 2).map((r) => r[1]).join(' · '))}</div></div>`; }).join('') : '<div class="card empty">Se încarcă datele…</div>';
}
function renderNews() {
  let n = st.news; const f = st.nf;
  if (f === 'imp') n = n.filter((x) => x.imp >= 4); else if (f !== 'all') n = n.filter((x) => x.kind === f);
  $('#news').innerHTML = n.length ? n.slice(0, 60).map((x) => `<a class="news" href="${esc(x.url)}" target="_blank" rel="noopener"><b>${esc(x.title)}</b><div class="m">${x.imp >= 5 ? '<span class="imp">IMPORTANT</span>' : ''}<span class="${x.sent > 0 ? 'up' : x.sent < 0 ? 'dn' : ''}">${x.sent > 0 ? '▲ pozitiv' : x.sent < 0 ? '▼ negativ' : '• neutru'}</span><span>${esc(x.src)}</span><span>${ago(x.t)}</span>${x.tags.map((t) => `<span class="chip">${t}</span>`).join('')}</div></a>`).join('')
    : `<div class="empty">${st.err['știri'] ? 'Știrile nu se încarcă acum. Pune o cheie Finnhub în Setări pentru o sursă în plus.' : f === 'bursă' && !st.set.kF ? 'Pentru știri de bursă pune cheia Finnhub în Setări.' : 'Nimic aici încă.'}</div>`;
}
function renderAll() { renderWatch(); renderOpps(); renderSigs(); renderAlerts(); if (st.cur) openDetail(st.cur, true); }

/* ---------- detaliu ---------- */
function openDetail(s, refresh = false) {
  const a = st.an[s], S = st.S[s]; if (!a) return;
  st.cur = s; const kind = isStock(s) ? 'stocks' : 'crypto';
  if (!st.bt[s]) st.bt[s] = C.backtest(S, kind);
  const b = st.bt[s], { p, ch } = priceOf(s);
  $('#dT').innerHTML = `${s} <span class="mut sm">${esc(C.nameOf(s))}</span>`; $('#dL').className = `chip t-${a.label.tone}`; $('#dL').textContent = `${a.label.txt} ${a.score > 0 ? '+' : ''}${a.score}`;
  const row = (r, base) => `<tr${base ? ' class="base"' : ''}><td>${esc(r.name)}</td><td>${r.n}</td><td class="${cls(r.avg7)}">${pc(r.avg7)}</td><td class="${cls(r.avg30)}">${pc(r.avg30)}</td><td>${r.win30 == null ? '—' : r.win30.toFixed(0) + '%'}</td><td class="${cls(r.worst30)}">${pc(r.worst30)}</td></tr>`;
  const best = b.rows.filter((r) => r.n >= 6).sort((x, y) => y.avg30 - x.avg30)[0];
  $('#dBody').innerHTML = `
  <div class="card"><div class="big">${fp(p)}</div><div class="sm" style="margin-top:6px">24h <b class="${cls(ch)}">${pc(ch)}</b> · 7z <b class="${cls(a.chg7d)}">${pc(a.chg7d)}</b> · 30z <b class="${cls(a.chg30d)}">${pc(a.chg30d)}</b> · 90z <b class="${cls(a.chg90d)}">${pc(a.chg90d)}</b></div></div>
  <div class="seg" id="rng">${[[90, '3L'], [365, '1A'], [1000, 'Tot']].map(([d, l]) => `<button data-d="${d}" class="${st.range === d ? 'on' : ''}">${l}</button>`).join('')}<span class="sm mut" style="align-self:center;margin-left:auto"><span style="color:var(--or)">━</span> EMA50 <span style="color:var(--sky)">━</span> EMA200</span></div>
  <div class="fig"><canvas id="cv"></canvas><div class="tip" id="tip"></div></div>
  <h2>Niveluri cheie</h2>
  <div class="card grid2">
    <div><span>Suport (20z)</span><b>${fp(a.support)}</b></div><div><span>Rezistență (20z)</span><b>${fp(a.resistance)}</b></div>
    <div><span>Stop logic (2×ATR)</span><b>${fp(a.stop)}</b></div><div><span>EMA50 / EMA200</span><b>${fp(a.e50)} / ${fp(a.e200)}</b></div>
    <div><span>RSI 14</span><b>${a.rsi?.toFixed(1) ?? '—'}</b></div><div><span>Volatilitate anuală</span><b>${a.vol30?.toFixed(0)}%</b></div>
    <div><span>De la maxim 90z</span><b class="dn">${pc(a.dd90)}</b></div><div><span>Mișcare medie zilnică</span><b>${a.atrPct?.toFixed(1)}%</b></div>
  </div>
  <h2>De ce scorul e ${a.score}</h2>
  <div class="card">${a.reasons.map((r) => `<div class="rs"><b class="${r[0] > 0 ? 'up' : 'dn'}">${r[0] > 0 ? '+' : ''}${r[0]}</b><span>${esc(r[1])}</span></div>`).join('')}</div>
  <h2>Statistici istorice</h2>
  <div class="card"><p class="sm mut" style="margin-top:0">Ce s-a întâmplat cu ${s} după fiecare semnal, pe ultimele ${b.days} zile. Randament mediu după 7 și 30 de zile, Win = câte au fost pe plus la 30 de zile, Min = cel mai prost caz.</p>
    <div class="scroll"><table><thead><tr><th>Semnal</th><th>n</th><th>7z</th><th>30z</th><th>Win</th><th>Min</th></tr></thead><tbody>${b.rows.map((r) => row(r)).join('')}${row(b.base, true)}</tbody></table></div>
    <p class="sm" style="margin-bottom:0">${best ? `Cel mai bun semnal istoric pe ${s}: <b>${esc(best.name)}</b>, ${pc(best.avg30)} în medie la 30 de zile, față de ${pc(b.base.avg30)} în orice zi.` : 'Prea puține semnale pentru o concluzie.'} Unde n &lt; 6, rezultatul e mai mult noroc decât statistică.</p></div>
  <h2>Calculator de risc</h2>
  <div class="card"><div class="grid2" style="gap:10px;grid-template-columns:1fr 1fr">
    <div><label for="rC">Capital ($)</label><input id="rC" type="number" inputmode="decimal" value="${load('tm_cap', 1000)}"></div>
    <div><label for="rR">Risc / trade (%)</label><input id="rR" type="number" step="0.5" inputmode="decimal" value="${load('tm_risk', 1)}"></div>
    <div><label for="rE">Intrare</label><input id="rE" type="number" inputmode="decimal" value="${+(p ?? a.price).toPrecision(6)}"></div>
    <div><label for="rS">Stop</label><input id="rS" type="number" inputmode="decimal" value="${+(a.stop ?? a.support).toPrecision(6)}"></div>
  </div><p id="rOut" class="sm" style="margin-bottom:0"></p></div>
  <div class="btns" style="margin:0 12px"><button class="btn" id="dAsk">Întreabă AI despre ${s}</button></div>`;
  $('#sheet').classList.add('on');
  if (!refresh) $('#sheet').scrollTop = 0;
  requestAnimationFrame(() => drawChart(S));
  risk(a);
}
function risk(a) {
  const f = () => {
    const cap = +$('#rC').value, r = +$('#rR').value, e = +$('#rE').value, sp = +$('#rS').value;
    save('tm_cap', cap); save('tm_risk', r);
    if (!(cap > 0 && r > 0 && e > 0 && sp > 0 && sp < e)) { $('#rOut').textContent = 'Stopul trebuie să fie sub prețul de intrare.'; return; }
    const loss = (cap * r) / 100, units = loss / (e - sp), val = units * e, rr = (a.resistance - e) / (e - sp);
    $('#rOut').innerHTML = `Cumperi <b>${units.toPrecision(4)}</b> unități (≈ <b>$${val.toFixed(0)}</b>${val > cap ? ', <span class="dn">peste capital: stopul e prea strâns</span>' : ''}). Dacă te scoate stopul pierzi <b>$${loss.toFixed(0)}</b>. Până la rezistență: R:R <b>${rr > 0 ? rr.toFixed(1) : '—'}</b>${rr > 0 && rr < 1.5 ? ' <span class="dn">(slab, sub 1.5)</span>' : ''}.`;
  };
  ['#rC', '#rR', '#rE', '#rS'].forEach((id) => $(id).addEventListener('input', f)); f();
}
let cvObs;
function drawChart(S) {
  const cv = $('#cv'); if (!cv) return;
  const draw = (hx = null) => {
    const W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1; if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const n = Math.min(st.range, S.n), st0 = S.n - n, idx = (i) => st0 + i;
    const pH = H * 0.72, rT = pH + 14, rH = H - rT - 4, padR = 58;
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) { const k = idx(i); mn = Math.min(mn, S.l[k], S.bb.lo[k] ?? Infinity); mx = Math.max(mx, S.h[k], S.bb.up[k] ?? -Infinity); }
    const X = (i) => (i / (n - 1)) * (W - padR), Y = (v) => 6 + (1 - (v - mn) / (mx - mn)) * (pH - 12), RY = (v) => rT + (1 - v / 100) * rH;
    g.strokeStyle = '#1c3050'; g.lineWidth = 1; g.fillStyle = '#8aa0b8'; g.font = '11px Inter';
    for (let k = 0; k <= 4; k++) { const v = mn + ((mx - mn) * k) / 4, y = Y(v); g.beginPath(); g.moveTo(0, y); g.lineTo(W - padR, y); g.stroke(); g.fillText(fp(v), W - padR + 6, y + 4); }
    g.beginPath(); let started = false;
    for (let i = 0; i < n; i++) { const v = S.bb.up[idx(i)]; if (v == null) continue; started ? g.lineTo(X(i), Y(v)) : (g.moveTo(X(i), Y(v)), (started = true)); }
    for (let i = n - 1; i >= 0; i--) { const v = S.bb.lo[idx(i)]; if (v != null) g.lineTo(X(i), Y(v)); }
    g.fillStyle = 'rgba(79,179,232,.08)'; g.fill();
    const line = (arr, col, w) => { g.beginPath(); g.strokeStyle = col; g.lineWidth = w; let s0 = false; for (let i = 0; i < n; i++) { const v = arr[idx(i)]; if (v == null) continue; s0 ? g.lineTo(X(i), Y(v)) : (g.moveTo(X(i), Y(v)), (s0 = true)); } g.stroke(); };
    line(S.e200, '#4fb3e8', 1.5); line(S.e50, '#ff7a1a', 1.5);
    const up = S.c[S.n - 1] >= S.c[st0]; line(S.c, up ? '#22c38e' : '#ff5a6e', 2);
    const ly = Y(S.c[S.n - 1]); g.fillStyle = up ? '#22c38e' : '#ff5a6e'; g.fillRect(W - padR + 2, ly - 9, padR - 2, 18); g.fillStyle = '#04121f'; g.font = '600 11px Inter'; g.fillText(fp(S.c[S.n - 1]), W - padR + 6, ly + 4);
    g.strokeStyle = '#1c3050'; [30, 70].forEach((v) => { g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, RY(v)); g.lineTo(W - padR, RY(v)); g.stroke(); }); g.setLineDash([]);
    g.fillStyle = '#8aa0b8'; g.font = '11px Inter'; g.fillText('RSI', W - padR + 6, rT + 10);
    g.beginPath(); g.strokeStyle = '#b9a2ff'; g.lineWidth = 1.4; let s1 = false;
    for (let i = 0; i < n; i++) { const v = S.rsi[idx(i)]; if (v == null) continue; s1 ? g.lineTo(X(i), RY(v)) : (g.moveTo(X(i), RY(v)), (s1 = true)); } g.stroke();
    const tip = $('#tip');
    if (hx != null) {
      const i = Math.max(0, Math.min(n - 1, Math.round((hx / (W - padR)) * (n - 1)))), k = idx(i);
      g.strokeStyle = 'rgba(232,240,250,.4)'; g.beginPath(); g.moveTo(X(i), 0); g.lineTo(X(i), H); g.stroke();
      tip.textContent = `${new Date(S.t[k]).toLocaleDateString('ro-RO')} · ${fp(S.c[k])} · RSI ${S.rsi[k]?.toFixed(0) ?? '—'}`;
    } else tip.textContent = '';
  };
  draw();
  cvObs?.disconnect(); cvObs = new ResizeObserver(() => draw()); cvObs.observe(cv);
  const mv = (e) => { const r = cv.getBoundingClientRect(), x = (e.touches ? e.touches[0].clientX : e.clientX) - r.left; draw(x); };
  cv.ontouchstart = mv; cv.ontouchmove = (e) => { e.preventDefault(); mv(e); }; cv.ontouchend = () => draw(); cv.onmousemove = mv; cv.onmouseleave = () => draw();
}

/* ---------- AI ---------- */
function context() {
  const assets = Object.entries(st.an).map(([s, a]) => {
    const b = st.bt[s] || (st.S[s] ? (st.bt[s] = C.backtest(st.S[s], isStock(s) ? 'stocks' : 'crypto')) : null);
    const { p, ch } = priceOf(s);
    return { s, pret: +(+p).toPrecision(6), ch24: +(ch ?? 0).toFixed(2), ch7: +(a.chg7d ?? 0).toFixed(1), ch30: +(a.chg30d ?? 0).toFixed(1), rsi: +(a.rsi ?? 0).toFixed(0), trend: a.trend, scor: a.score,
      motive: a.reasons.slice(0, 4).map((r) => `${r[0] > 0 ? '+' : ''}${r[0]} ${r[1]}`), suport: +a.support.toPrecision(6), rezistenta: +a.resistance.toPrecision(6), stop2ATR: a.stop && +a.stop.toPrecision(6),
      ema50: a.e50 && +a.e50.toPrecision(6), ema200: a.e200 && +a.e200.toPrecision(6), volAnual: +(a.vol30 ?? 0).toFixed(0), deLaMax90: +(a.dd90 ?? 0).toFixed(1),
      istoric: b ? b.rows.filter((r) => r.n >= 4).map((r) => `${r.name}: n=${r.n}, 30z ${pc(r.avg30)}, câștig ${r.win30?.toFixed(0)}%`).concat(`referință: 30z ${pc(b.base.avg30)}, câștig ${b.base.win30?.toFixed(0)}%`) : [] };
  });
  return JSON.stringify({ data: new Date().toISOString(), fearGreed: st.fng.slice(0, 8).map((x) => x.v), global: st.glob, active: assets,
    stiri: st.news.slice(0, 15).map((x) => `[${x.imp >= 5 ? 'IMP' : ''}${x.sent > 0 ? '+' : x.sent < 0 ? '-' : ''}] ${x.title} (${x.src}, ${ago(x.t)})`), alerteRecente: st.alerts.slice(0, 8).map((x) => x.title) });
}
const SYS = `Ești analistul de piață personal al utilizatorului: trader cu experiență pe crypto și acțiuni. Vorbești în română, direct și relaxat, ca un prieten care se pricepe, fără introduceri și fără umplutură.
Reguli:
- Te bazezi DOAR pe datele live primite (prețuri, indicatori, scoruri, statistici istorice, știri). Dacă lipsesc date, spui asta.
- Dai niveluri concrete: zonă de intrare, stop, țintă, raport risc/câștig. Folosește suport/rezistență/ATR din date.
- Citezi statisticile istorice când susțin sau contrazic ideea (n mic = nesigur).
- Ești sincer: dacă setup-ul e prost sau piața e riscantă, spui clar. Nu promiți câștiguri. Recomanzi intrări etapizate (DCA), fără leverage, risc 1–2% pe trade.
- Format scurt pentru telefon: titluri cu ###, liste scurte, max ~250 de cuvinte dacă nu ți se cere mai mult.
- Închei cu o linie scurtă: decizia e a lui, nu e consultanță financiară.`;
function md(t) {
  const lines = esc(t).split('\n'); let h = '', inUl = false;
  for (let l of lines) {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<i>$2</i>');
    if (/^\s*[-*•] /.test(l)) { if (!inUl) { h += '<ul>'; inUl = true; } h += `<li>${l.replace(/^\s*[-*•] /, '')}</li>`; continue; }
    if (inUl) { h += '</ul>'; inUl = false; }
    if (/^#{1,4} /.test(l)) h += `<h4>${l.replace(/^#+ /, '')}</h4>`; else if (l.trim()) h += `<p>${l}</p>`;
  }
  return h + (inUl ? '</ul>' : '');
}
function renderChat() {
  $('#aiKey').hidden = !!st.set.kA;
  $('#chat').innerHTML = st.chat.length ? st.chat.map((m) => `<div class="msg ${m.role === 'user' ? 'u' : 'a'}">${m.role === 'user' ? esc(m.content) : md(m.content)}</div>`).join('')
    : '<div class="msg a"><p>Salut. Am pe mână prețurile live, indicatorii, statisticile istorice și știrile. Întreabă-mă ce vrei sau apasă o întrebare rapidă.</p></div>';
}
function localBrief(q) {
  const A = Object.entries(st.an).sort((a, b) => b[1].score - a[1].score); if (!A.length) return 'Încă încarc datele. Mai încearcă în câteva secunde.';
  const f = st.fng[0]?.v, mood = f == null ? 'necunoscut' : f <= 25 ? 'frică (extremă dacă sub 20)' : f >= 75 ? 'lăcomie' : 'neutru';
  const m = q.toUpperCase().match(/\b[A-Z]{2,5}\b/g)?.find((s) => st.an[s]);
  if (m) {
    const a = st.an[m], b = st.bt[m] || C.backtest(st.S[m], isStock(m) ? 'stocks' : 'crypto'), good = b.rows.filter((r) => r.n >= 6).sort((x, y) => y.avg30 - x.avg30)[0];
    return `### ${m}: ${a.label.txt} (scor ${a.score})\n- Preț ${fp(a.price)}, trend ${a.trend}, RSI ${a.rsi?.toFixed(0)}\n${a.reasons.slice(0, 4).map((r) => `- ${r[0] > 0 ? '+' : ''}${r[0]}: ${r[1]}`).join('\n')}\n### Niveluri\n- Suport ${fp(a.support)}, rezistență ${fp(a.resistance)}\n- Stop logic (2×ATR): ${fp(a.stop)}\n${good ? `### Istoric\n- Cel mai bun semnal: ${good.name}, ${pc(good.avg30)} la 30 zile (n=${good.n}, câștig ${good.win30.toFixed(0)}%)\n` : ''}### Concluzie\n${a.score >= 40 ? 'Setup bun pe date. Dacă intri, etapizat, cu stop sub nivelul de mai sus.' : a.score >= 15 ? 'Înclinat pozitiv, dar fără semnal puternic. Poziție mică sau aștepți confirmare.' : a.score > -15 ? 'Neutru. Nu e grabă, aștepți să iasă din range.' : 'Date slabe. Nu prinde cuțitul: aștepți RSI să întoarcă și prețul peste EMA20.'}\n\n_Analiză locală, fără AI. Pune cheia Claude în Setări pentru analiză completă._`;
  }
  const top = A.slice(0, 3), bot = A.slice(-2), imp = st.news.filter((x) => x.imp >= 5).slice(0, 3);
  return `### Piața acum\n- Sentiment: ${f ?? '—'} (${mood})\n- BTC ${pc(st.tick.BTC?.chg24)} în 24h, scor ${st.an.BTC?.score ?? '—'}\n### Cele mai bune setup-uri\n${top.map(([s, a]) => `- **${s}** scor ${a.score}: ${a.reasons.filter((r) => r[0] > 0).slice(0, 2).map((r) => r[1]).join(', ') || 'fără semnale clare'}`).join('\n')}\n### Cele mai slabe\n${bot.map(([s, a]) => `- **${s}** scor ${a.score}`).join('\n')}\n${imp.length ? `### Știri care contează\n${imp.map((x) => `- ${x.title}`).join('\n')}\n` : ''}### Ce aș face\n${f != null && f <= 25 ? '- Frică mare: zonă bună de acumulare etapizată pe BTC/ETH, nu all-in, fără leverage.' : f != null && f >= 75 ? '- Euforie: iei profit parțial, nu intri cu tot acum.' : '- Piață fără extreme: intri doar pe setup-uri cu scor peste +40 și stop clar.'}\n\n_Analiză locală, fără AI. Pune cheia Claude în Setări pentru analiză completă._`;
}
async function ask(q) {
  q = q.trim(); if (!q) return;
  st.chat.push({ role: 'user', content: q }); renderChat(); $('#askI').value = ''; $('#askB').disabled = true;
  const pend = document.createElement('div'); pend.className = 'msg a'; pend.innerHTML = '<p class="mut">Analizez…</p>'; $('#chat').append(pend); pend.scrollIntoView({ block: 'end', behavior: 'smooth' });
  let ans;
  if (!st.set.kA) ans = localBrief(q);
  else try {
    const hist = st.chat.slice(-7, -1).map((m) => ({ role: m.role, content: m.content }));
    while (hist.length && hist[0].role !== 'user') hist.shift();
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': st.set.kA, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: st.set.kM, max_tokens: 1600, system: SYS, messages: [...hist, { role: 'user', content: `DATE LIVE:\n${context()}\n\nÎNTREBARE: ${q}` }] }) });
    const d = await r.json(); if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`);
    ans = d.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  } catch (e) { ans = `Eroare la Claude: ${e.message}\n\n${localBrief(q)}`; }
  st.chat.push({ role: 'assistant', content: ans }); st.chat = st.chat.slice(-30); save('tm_chat', st.chat);
  renderChat(); $('#askB').disabled = false; $('#chat').lastElementChild?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

/* ---------- navigare + setări ---------- */
function go(v) {
  if (!document.getElementById('v-' + v)) v = 'piata';
  $$('.v').forEach((x) => x.classList.toggle('on', x.id === 'v-' + v));
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'alerte') { save('tm_unread', 0); badge(); }
  if (v === 'ai') renderChat();
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  scrollTo(0, 0);
}
function fillSettings() {
  const s = st.set; $('#th1').value = s.th.h1; $('#thd').value = s.th.d1; $('#ths').value = s.th.d1Stock; $('#thv').value = s.th.vol;
  $('#wC').value = s.crypto.join(', '); $('#wS').value = s.stocks.join(', '); $('#kA').value = s.kA; $('#kM').value = s.kM; $('#kT').value = s.kT; $('#kF').value = s.kF; $('#nEn').checked = s.notif;
  const P = 'Notification' in window ? Notification.permission : 'nesuportat';
  const sa = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('#nStat').innerHTML = P === 'granted' ? '✅ Notificările sunt active.' : P === 'denied' ? '❌ Blocate. Le activezi din Setări iPhone → Notificări → Markets.' : !sa && /iPhone|iPad/.test(navigator.userAgent) ? 'Mai întâi adaugă aplicația pe Home Screen, apoi deschide-o de acolo și apasă butonul.' : 'Apasă butonul ca să primești alerte.';
}
function saveSettings() {
  const L = (v) => [...new Set(v.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  const old = JSON.stringify([st.set.crypto, st.set.stocks, st.set.kT]);
  Object.assign(st.set, { crypto: L($('#wC').value), stocks: L($('#wS').value).slice(0, 8), kA: $('#kA').value.trim(), kM: $('#kM').value, kT: $('#kT').value.trim(), kF: $('#kF').value.trim(), notif: $('#nEn').checked,
    th: { ...st.set.th, h1: +$('#th1').value || 3, d1: +$('#thd').value || 8, d1Stock: +$('#ths').value || 4, vol: +$('#thv').value || 3 } });
  save('tm_set', st.set); toast({ title: 'Salvat', body: 'Setările sunt aplicate.' });
  if (old !== JSON.stringify([st.set.crypto, st.set.stocks, st.set.kT])) { pullTickers(); pullCrypto(true); pullStocks(); }
  pullNews(); renderAll();
}
const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

function bind() {
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.v); };
  $('#bell').onclick = () => go('alerte');
  document.body.addEventListener('click', (e) => {
    const s = e.target.closest('[data-s]'); if (s && !e.target.closest('#sheet')) { openDetail(s.dataset.s); return; }
    const u = e.target.closest('[data-u]'); if (u) window.open(u.dataset.u, '_blank');
  });
  $('#back').onclick = () => { $('#sheet').classList.remove('on'); st.cur = null; cvObs?.disconnect(); };
  $('#sheet').addEventListener('click', (e) => {
    const r = e.target.closest('#rng button'); if (r) { st.range = +r.dataset.d; openDetail(st.cur, true); }
    if (e.target.id === 'dAsk') { const s = st.cur; $('#back').click(); go('ai'); ask(`Analizează ${s} acum: merită intrare? Unde intru, unde pun stop și țintă?`); }
  });
  $('#segK').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.kind = b.dataset.k; $$('#segK button').forEach((x) => x.classList.toggle('on', x === b)); renderSigs(); };
  $('#segN').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; st.nf = b.dataset.n; $$('#segN button').forEach((x) => x.classList.toggle('on', x === b)); renderNews(); };
  $('#askF').onsubmit = (e) => { e.preventDefault(); ask($('#askI').value); };
  $('#askI').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask($('#askI').value); } });
  const Q = ['Rezumat piață acum', 'Care e cea mai bună oportunitate?', 'Merită BTC acum?', 'Ce știri contează azi?', 'Ce să evit?', 'Plan DCA pe 4 săptămâni'];
  $('#qs').innerHTML = Q.map((q) => `<button>${q}</button>`).join(''); $('#qs').onclick = (e) => { const b = e.target.closest('button'); if (b) ask(b.textContent); };
  $('#save').onclick = saveSettings; $('#nEn').onchange = saveSettings;
  $('#clrA').onclick = () => { st.alerts = []; save('tm_alerts', []); renderAlerts(); };
  $('#nOn').onclick = async () => { try { const p = await Notification.requestPermission(); fillSettings(); if (p === 'granted') notify({ title: 'Notificări active ✅', body: 'Te anunț la mișcări mari, setup-uri și știri importante.', key: 'test' + Date.now(), t: Date.now() }); } catch (e) { toast({ title: 'Nu merge aici', body: 'Deschide aplicația de pe Home Screen.' }); } };
  $('#nTest').onclick = () => notify({ title: 'BTC 🚀 +5.2% în 24h (test)', body: 'Așa arată o alertă reală.', key: 'test' + Date.now(), t: Date.now() });
  $('#pSub').onclick = async () => {
    try {
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('Permite notificările mai întâi.');
      const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(C.CONFIG.VAPID_PUBLIC) });
      $('#pOut').textContent = JSON.stringify(sub); $('#pOut').hidden = false; $('#pCopy').hidden = false;
    } catch (e) { toast({ title: 'Push indisponibil', body: e.message + ' (merge doar din aplicația de pe Home Screen, iOS 16.4+)' }); }
  };
  $('#pCopy').onclick = async () => { try { await navigator.clipboard.writeText($('#pOut').textContent); toast({ title: 'Copiat', body: 'Pune-l în GitHub ca secret PUSH_SUBSCRIPTION.' }); } catch { toast({ title: 'Copiere eșuată', body: 'Ține apăsat pe text și copiază manual.' }); } };
  addEventListener('hashchange', () => go(location.hash.slice(1)));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pullTickers(); if (Date.now() - (st.lastK || 0) > 6e4) tickSlow(); } });
}

/* ---------- pornire ---------- */
async function tickSlow() { st.lastK = Date.now(); await pullCrypto(); }
async function init() {
  bind(); fillSettings(); badge(); renderAlerts(); renderChat(); go(location.hash.slice(1) || 'piata');
  const ios = /iPhone|iPad/.test(navigator.userAgent), sa = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  $('#install').hidden = !(ios && !sa);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await pullTickers(); renderGlob();
  st.lastK = Date.now();
  await Promise.all([pullMacro(), pullCrypto(true), pullNews(), pullStocks()]);
  setInterval(pullTickers, 20e3);
  setInterval(tickSlow, 3 * 60e3);
  setInterval(pullNews, 5 * 60e3);
  setInterval(pullMacro, 30 * 60e3);
  setInterval(pullStocks, 30 * 60e3);
  setInterval(() => { renderAlerts(); }, 60e3);
}
init();
