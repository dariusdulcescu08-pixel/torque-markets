// Torque Markets — motor de analiză comun (aplicație + monitor în fundal)
// Funcții pure: indicatori, scor, backtest, alerte, știri, surse de date.

export const CONFIG = {
  crypto: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'LINK', 'AVAX', 'SUI'],
  stocks: ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'MSFT'],
  th: { h1: 3, d1: 8, d1Stock: 4, vol: 3, score: 40 },
  VAPID_PUBLIC: 'BIn9HxhLVOwLe9TxcmoZT0JIe13CYEcRUTdXwg23y-gHPqspFO-xsfl1dNg_bkpJdDNj4WFaC9WPEwTni0Pp35s',
};

export const NAMES = {
  BTC: ['Bitcoin', 'bitcoin', 'btc'], ETH: ['Ethereum', 'ethereum', 'ether', 'eth'],
  SOL: ['Solana', 'solana'], BNB: ['BNB', 'bnb', 'binance coin'], XRP: ['XRP', 'xrp', 'ripple'],
  DOGE: ['Dogecoin', 'dogecoin', 'doge'], ADA: ['Cardano', 'cardano'], LINK: ['Chainlink', 'chainlink'],
  AVAX: ['Avalanche', 'avalanche', 'avax'], SUI: ['Sui', ' sui '], TON: ['Toncoin', 'toncoin'],
  DOT: ['Polkadot', 'polkadot'], LTC: ['Litecoin', 'litecoin'], PEPE: ['Pepe', 'pepe'],
  SPY: ['S&P 500 ETF', 's&p 500', 's&p'], QQQ: ['Nasdaq 100 ETF', 'nasdaq'], NVDA: ['Nvidia', 'nvidia'],
  AAPL: ['Apple', 'apple'], TSLA: ['Tesla', 'tesla'], MSFT: ['Microsoft', 'microsoft'],
  AMZN: ['Amazon', 'amazon'], META: ['Meta', 'meta platforms'], GOOGL: ['Alphabet', 'google'],
  AMD: ['AMD', ' amd '], COIN: ['Coinbase', 'coinbase'], MSTR: ['Strategy', 'microstrategy'],
};
export const nameOf = (s) => (NAMES[s] ? NAMES[s][0] : s);

/* ---------------- indicatori ---------------- */
const nul = (n) => new Array(n).fill(null);

export function sma(a, n) {
  const o = nul(a.length); let s = 0;
  for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; }
  return o;
}
export function ema(a, n) {
  const o = nul(a.length); if (a.length < n) return o;
  const k = 2 / (n + 1); let e = 0;
  for (let i = 0; i < n; i++) e += a[i];
  e /= n; o[n - 1] = e;
  for (let i = n; i < a.length; i++) { e = a[i] * k + e * (1 - k); o[i] = e; }
  return o;
}
export function rsi(c, n = 14) {
  const o = nul(c.length); if (c.length <= n) return o;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n; o[n] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = n + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n;
    o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return o;
}
export function macd(c) {
  const f = ema(c, 12), s = ema(c, 26);
  const line = c.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const st = line.findIndex((v) => v != null); const sig = nul(c.length);
  if (st >= 0) ema(line.slice(st), 9).forEach((v, j) => { sig[st + j] = v; });
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
  return { line, sig, hist };
}
export function bollinger(c, n = 20, k = 2) {
  const mid = sma(c, n), up = nul(c.length), lo = nul(c.length);
  for (let i = n - 1; i < c.length; i++) {
    let v = 0; for (let j = i - n + 1; j <= i; j++) v += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / n); up[i] = mid[i] + k * sd; lo[i] = mid[i] - k * sd;
  }
  return { mid, up, lo };
}
export function atr(h, l, c, n = 14) {
  const o = nul(c.length); if (c.length <= n) return o;
  const tr = c.map((_, i) => (i === 0 ? h[0] - l[0] : Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]))));
  let a = 0; for (let i = 1; i <= n; i++) a += tr[i];
  a /= n; o[n] = a;
  for (let i = n + 1; i < c.length; i++) { a = (a * (n - 1) + tr[i]) / n; o[i] = a; }
  return o;
}

// candles: [{t,o,h,l,c,v}] crescător în timp
export function series(candles) {
  const t = candles.map((x) => x.t), o = candles.map((x) => x.o), h = candles.map((x) => x.h),
    l = candles.map((x) => x.l), c = candles.map((x) => x.c), v = candles.map((x) => x.v);
  return { t, o, h, l, c, v, e20: ema(c, 20), e50: ema(c, 50), e200: ema(c, 200), rsi: rsi(c), macd: macd(c),
    bb: bollinger(c), atr: atr(h, l, c), vAvg: sma(v, 20), n: c.length };
}

const pct = (a, b) => (a != null && b ? (a / b - 1) * 100 : null);

/* ---------------- scor ---------------- */
export function scoreAt(S, i, fng = null, kind = 'crypto') {
  const r = []; let s = 0;
  const c = S.c[i], add = (p, txt) => { s += p; r.push([p, txt]); };
  if (S.e200[i] != null) add(c > S.e200[i] ? 15 : -15, c > S.e200[i] ? 'Peste media de 200 zile (trend lung pozitiv)' : 'Sub media de 200 zile (trend lung negativ)');
  if (S.e50[i] != null && S.e200[i] != null) add(S.e50[i] > S.e200[i] ? 10 : -10, S.e50[i] > S.e200[i] ? 'EMA50 peste EMA200' : 'EMA50 sub EMA200');
  if (S.e20[i] != null) add(c > S.e20[i] ? 5 : -5, c > S.e20[i] ? 'Peste EMA20 (scurt pozitiv)' : 'Sub EMA20 (scurt negativ)');
  const hst = S.macd.hist[i], hp = S.macd.hist[i - 1];
  if (hst != null && hp != null) {
    if (hst > 0 && hst > hp) add(10, 'MACD pozitiv și accelerează');
    else if (hst < 0 && hst < hp) add(-10, 'MACD negativ și accelerează în jos');
    else if (hst < 0 && hst > hp) add(5, 'Presiunea de vânzare slăbește (MACD)');
    else if (hst > 0 && hst < hp) add(-5, 'Momentumul pozitiv slăbește (MACD)');
  }
  const R = S.rsi[i], up = S.e200[i] != null && c > S.e200[i];
  if (R != null) {
    if (R < 25) add(18, `RSI ${R.toFixed(0)}: supravânzare puternică`);
    else if (R < 32) add(12, `RSI ${R.toFixed(0)}: supravânzare`);
    else if (R > 80) add(-18, `RSI ${R.toFixed(0)}: supracumpărare puternică`);
    else if (R > 72) add(up ? -6 : -12, `RSI ${R.toFixed(0)}: supracumpărare`);
    else if (R >= 50 && R <= 68 && up) add(5, `RSI ${R.toFixed(0)}: momentum sănătos`);
  }
  if (S.bb.lo[i] != null) {
    if (c < S.bb.lo[i]) add(8, 'Sub banda Bollinger de jos (întindere în jos)');
    else if (c > S.bb.up[i]) add(up ? 3 : -8, up ? 'Breakout peste banda de sus' : 'Peste banda de sus în trend slab');
  }
  if (i >= 90) {
    let hi = -Infinity; for (let j = i - 90; j <= i; j++) hi = Math.max(hi, S.h[j]);
    const dd = (c / hi - 1) * 100;
    if (dd < -(kind === 'crypto' ? 30 : 15) && R != null && S.rsi[i - 1] != null && R > S.rsi[i - 1]) add(8, `La ${dd.toFixed(0)}% de maximul pe 90 zile, RSI întoarce`);
  }
  if (S.vAvg[i] && S.v[i] > 2 * S.vAvg[i]) {
    const upDay = c > S.o[i];
    add(upDay ? 5 : -5, upDay ? 'Volum mare pe zi verde (cumpărători)' : 'Volum mare pe zi roșie (vânzare agresivă)');
  }
  if (fng != null && kind === 'crypto') {
    if (fng <= 20) add(10, `Fear & Greed ${fng}: frică extremă (contrarian pozitiv)`);
    else if (fng >= 80) add(-10, `Fear & Greed ${fng}: lăcomie extremă`);
  }
  s = Math.max(-100, Math.min(100, s));
  return { score: s, reasons: r.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])) };
}

export function labelFor(s) {
  if (s >= 40) return { txt: 'Setup puternic', tone: 'up2' };
  if (s >= 15) return { txt: 'Favorabil', tone: 'up' };
  if (s > -15) return { txt: 'Neutru', tone: 'flat' };
  if (s > -40) return { txt: 'Slab', tone: 'dn' };
  return { txt: 'Risc ridicat', tone: 'dn2' };
}

export function analyze(S, { fng = null, kind = 'crypto' } = {}) {
  const i = S.n - 1, c = S.c[i];
  const { score, reasons } = scoreAt(S, i, fng, kind);
  const prev = i > 0 ? scoreAt(S, i - 1, fng, kind).score : score;
  const lo20 = Math.min(...S.l.slice(-20)), hi20 = Math.max(...S.h.slice(-20));
  const hi90 = Math.max(...S.h.slice(-90)), lo90 = Math.min(...S.l.slice(-90));
  const rets = []; for (let j = Math.max(1, i - 29); j <= i; j++) rets.push(Math.log(S.c[j] / S.c[j - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, rets.length - 1));
  const ann = sd * Math.sqrt(kind === 'crypto' ? 365 : 252) * 100;
  const A = S.atr[i];
  let trend = 'lateral';
  if (S.e50[i] && S.e200[i]) trend = c > S.e50[i] && S.e50[i] > S.e200[i] ? 'ascendent' : c < S.e50[i] && S.e50[i] < S.e200[i] ? 'descendent' : 'lateral';
  return {
    price: c, chg1d: pct(c, S.c[i - 1]), chg7d: pct(c, S.c[i - 7]), chg30d: pct(c, S.c[i - 30]), chg90d: pct(c, S.c[i - 90]),
    rsi: S.rsi[i], macdHist: S.macd.hist[i], e20: S.e20[i], e50: S.e50[i], e200: S.e200[i],
    bbUp: S.bb.up[i], bbLo: S.bb.lo[i], atr: A, atrPct: A ? (A / c) * 100 : null, vol30: ann,
    dd90: pct(c, hi90), hi90, lo90, support: lo20, resistance: hi20, stop: A ? c - 2 * A : null,
    trend, score, prevScore: prev, label: labelFor(score), reasons,
  };
}

/* ---------------- backtest / statistici ---------------- */
export function backtest(S, kind = 'crypto') {
  const n = S.n, sc = new Array(n).fill(null);
  for (let i = 200; i < n; i++) sc[i] = scoreAt(S, i, null, kind).score;
  const drop = kind === 'crypto' ? 8 : 4;
  const sig = [
    ['RSI coboară sub 30', (i) => S.rsi[i] < 30 && S.rsi[i - 1] >= 30],
    ['RSI urcă peste 70', (i) => S.rsi[i] > 70 && S.rsi[i - 1] <= 70],
    ['Golden cross (EMA50↑200)', (i) => S.e50[i] > S.e200[i] && S.e50[i - 1] <= S.e200[i - 1]],
    ['Death cross (EMA50↓200)', (i) => S.e50[i] < S.e200[i] && S.e50[i - 1] >= S.e200[i - 1]],
    ['Închide sub banda Bollinger', (i) => S.c[i] < S.bb.lo[i] && S.c[i - 1] >= S.bb.lo[i - 1]],
    [`Cădere ≥${drop}% într-o zi`, (i) => (S.c[i] / S.c[i - 1] - 1) * 100 <= -drop],
    ['Scorul trece peste +40', (i) => sc[i] >= 40 && sc[i - 1] != null && sc[i - 1] < 40],
    ['Scorul trece sub -40', (i) => sc[i] <= -40 && sc[i - 1] != null && sc[i - 1] > -40],
  ];
  const H1 = 7, H2 = 30, rows = [];
  const fwd = (i, h) => (i + h < n ? (S.c[i + h] / S.c[i] - 1) * 100 : null);
  for (const [name, fn] of sig) {
    const r7 = [], r30 = []; let last = -99;
    for (let i = 201; i < n; i++) {
      let hit = false; try { hit = fn(i); } catch { hit = false; }
      if (!hit || i - last < 10) continue; last = i;
      const a = fwd(i, H1), b = fwd(i, H2);
      if (a != null) r7.push(a); if (b != null) r30.push(b);
    }
    rows.push(stat(name, r7, r30));
  }
  const b7 = [], b30 = [];
  for (let i = 201; i < n; i++) { const a = fwd(i, H1), b = fwd(i, H2); if (a != null) b7.push(a); if (b != null) b30.push(b); }
  const days = n - 201;
  return { rows, base: stat('Orice zi (referință)', b7, b30), days, from: S.t[Math.min(201, n - 1)] };
}
function stat(name, r7, r30) {
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return { name, n: r30.length, n7: r7.length, avg7: avg(r7), avg30: avg(r30), med30: med(r30),
    win30: r30.length ? (r30.filter((x) => x > 0).length / r30.length) * 100 : null,
    worst30: r30.length ? Math.min(...r30) : null, best30: r30.length ? Math.max(...r30) : null };
}

/* ---------------- alerte ---------------- */
const day = (t) => new Date(t).toISOString().slice(0, 10);
const hour = (t) => new Date(t).toISOString().slice(0, 13);
const f2 = (x) => (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
export const fmtP = (p) => (p == null ? '—' : p >= 1000 ? p.toLocaleString('en-US', { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toPrecision(4));

export function detectAlerts({ sym, kind = 'crypto', S, a, h1 = null, live = null, th = CONFIG.th }) {
  const out = [], now = Date.now(), D = day(now), i = S.n - 1;
  const push = (key, level, title, body) => out.push({ key, level, sym, title, body, t: now });
  const name = nameOf(sym);
  const ch24 = live?.chg24 ?? a.chg1d, px = live?.price ?? a.price;
  const lim = kind === 'crypto' ? th.d1 : th.d1Stock;
  if (ch24 != null && Math.abs(ch24) >= lim)
    push(`d1:${sym}:${D}:${ch24 > 0 ? 'u' : 'd'}`, 'high', `${sym} ${ch24 > 0 ? '🚀' : '🩸'} ${f2(ch24)} în 24h`, `${name} la ${fmtP(px)}. ${ch24 > 0 ? 'Mișcare puternică în sus' : 'Scădere masivă'}, RSI ${a.rsi?.toFixed(0) ?? '—'}, scor ${a.score}.`);
  if (h1 && h1.length > 50) {
    const L = h1.length - 1, c1 = (h1[L].c / h1[L - 1].c - 1) * 100, c4 = (h1[L].c / h1[L - 4].c - 1) * 100;
    if (Math.abs(c1) >= th.h1) push(`h1:${sym}:${hour(h1[L].t)}`, 'high', `${sym} ${f2(c1)} în ultima oră`, `${name} se mișcă violent: ${fmtP(h1[L].c)}. Atenție la volatilitate.`);
    else if (Math.abs(c4) >= th.h1 * 1.8) push(`h4:${sym}:${hour(h1[L].t)}`, 'med', `${sym} ${f2(c4)} în 4 ore`, `${name} la ${fmtP(h1[L].c)}.`);
    const prevV = h1.slice(L - 49, L - 1).map((x) => x.v), avgV = prevV.reduce((x, y) => x + y, 0) / prevV.length;
    const lv = h1[L - 1].v; // ultima oră închisă
    if (avgV > 0 && lv / avgV >= th.vol) push(`vol:${sym}:${hour(h1[L - 1].t)}`, 'med', `${sym}: volum ${(lv / avgV).toFixed(1)}× peste normal`, `Ultima oră a avut volum neobișnuit pe ${name}. ${h1[L - 1].c > h1[L - 1].o ? 'Lumânare verde: cumpărători agresivi.' : 'Lumânare roșie: vânzători agresivi.'}`);
  }
  const R = S.rsi[i], Rp = S.rsi[i - 1];
  if (R != null && Rp != null) {
    if (R < 30 && Rp >= 30) push(`rsi30:${sym}:${D}`, 'med', `${sym} intră în supravânzare (RSI ${R.toFixed(0)})`, `Istoric, ${name} a avut adesea revenire după astfel de momente. Verifică tabul Statistici.`);
    if (R > 70 && Rp <= 70) push(`rsi70:${sym}:${D}`, 'med', `${sym} supracumpărat (RSI ${R.toFixed(0)})`, `Risc de corecție pe termen scurt pentru ${name}.`);
  }
  if (S.e50[i] && S.e200[i] && S.e50[i - 1] && S.e200[i - 1]) {
    if (S.e50[i] > S.e200[i] && S.e50[i - 1] <= S.e200[i - 1]) push(`gc:${sym}:${D}`, 'high', `${sym}: Golden cross`, `EMA50 a trecut peste EMA200 pe ${name}. Semnal de trend pe termen lung.`);
    if (S.e50[i] < S.e200[i] && S.e50[i - 1] >= S.e200[i - 1]) push(`dc:${sym}:${D}`, 'high', `${sym}: Death cross`, `EMA50 a trecut sub EMA200 pe ${name}. Trendul lung se strică.`);
  }
  if (a.score >= th.score && a.prevScore < th.score) push(`opp:${sym}:${D}`, 'high', `💡 Oportunitate: ${sym} scor ${a.score}`, `${a.reasons.slice(0, 2).map((r) => r[1]).join(' · ')}. Stop logic ~${fmtP(a.stop)}.`);
  if (a.score <= -th.score && a.prevScore > -th.score) push(`risk:${sym}:${D}`, 'med', `⚠️ ${sym} intră în zona de risc (scor ${a.score})`, a.reasons.slice(0, 2).map((r) => r[1]).join(' · '));
  if (i > 91) {
    const lo = Math.min(...S.l.slice(i - 90, i)), hi = Math.max(...S.h.slice(i - 90, i));
    if (px < lo) push(`lo90:${sym}:${D}`, 'med', `${sym} rupe minimul pe 90 de zile`, `${name} sub ${fmtP(lo)}. Fără confirmare de întoarcere, nu prinde cuțitul.`);
    if (px > hi) push(`hi90:${sym}:${D}`, 'med', `${sym} rupe maximul pe 90 de zile`, `${name} peste ${fmtP(hi)}. Breakout.`);
  }
  return out;
}

export function marketAlerts({ fng }) {
  const out = [], D = day(Date.now());
  if (fng != null && fng <= 15) out.push({ key: `fng:lo:${D}`, level: 'med', sym: 'PIAȚĂ', title: `Frică extremă: Fear & Greed ${fng}`, body: 'Istoric, frica extremă a fost mai des zonă de acumulare decât de vânzare. Intră etapizat, nu all-in.', t: Date.now() });
  if (fng != null && fng >= 85) out.push({ key: `fng:hi:${D}`, level: 'med', sym: 'PIAȚĂ', title: `Lăcomie extremă: Fear & Greed ${fng}`, body: 'Euforie în piață. Moment bun de luat profit parțial, prost de intrat cu tot.', t: Date.now() });
  return out;
}

/* ---------------- știri ---------------- */
const KW = [
  [/\b(sec|cftc|regulat|lawsuit|sued|court|ban(s|ned)?|crackdown)\b/i, 3], [/\betf\b/i, 3], [/\b(fed|fomc|powell|rate (cut|hike)|interest rate|cpi|inflation|jobs report|payroll)\b/i, 3],
  [/\b(hack(ed)?|exploit|stolen|breach|drain(ed)?)\b/i, 4], [/\b(bankrupt|insolven|collapse|halt(s|ed)? withdrawals)\b/i, 4],
  [/\b(blackrock|fidelity|grayscale|microstrategy|strategy inc|saylor|tesla|nvidia)\b/i, 2], [/\b(liquidat)/i, 2],
  [/\b(record|all-time high|ath|plunge|crash|soar|surge|tumble|selloff|sell-off)\b/i, 2], [/\b(approv|reject|delay)/i, 2],
  [/\b(trump|white house|treasury|tariff|sanction)\b/i, 2], [/\b(earnings|guidance|revenue|ipo)\b/i, 2], [/\b(halving|upgrade|hard fork|mainnet)\b/i, 1],
];
const BULL = /\b(surge|soar|rally|approv|record|inflow|adopt|bullish|gain|jump|rebound|buy(s|ing)?|upgrade|beat)/i;
const BEAR = /\b(plunge|crash|tumble|outflow|hack|ban(s|ned)?\b|lawsuit|bearish|drop|fall|sell-?off|liquidat|reject|fear|slump|miss(es|ed)?\b)/i;

export function scoreNews(item) {
  const txt = `${item.title} ${item.body || ''}`; let imp = 0;
  for (const [re, w] of KW) if (re.test(txt)) imp += w;
  const bu = BULL.test(item.title), be = BEAR.test(item.title);
  const sent = bu && !be ? 1 : be && !bu ? -1 : 0;
  const tags = Object.keys(NAMES).filter((s) => NAMES[s].some((k) => (' ' + txt.toLowerCase() + ' ').includes(k.toLowerCase())) || new RegExp(`\\b${s}\\b`).test(txt));
  return { ...item, imp, sent, tags: tags.slice(0, 4) };
}

/* ---------------- surse de date ---------------- */
async function jget(url, ms = 12000, opt = {}) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { ...opt, signal: ctl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(tm); }
}
const BIN = ['https://data-api.binance.vision', 'https://api.binance.com', 'https://api1.binance.com'];
async function bin(path) {
  let err; for (const b of BIN) { try { return await jget(b + path); } catch (e) { err = e; } }
  throw err;
}
export async function cryptoTickers(syms) {
  const q = encodeURIComponent(JSON.stringify(syms.map((s) => s + 'USDT')));
  const d = await bin(`/api/v3/ticker/24hr?symbols=${q}`);
  const o = {}; for (const x of d) o[x.symbol.replace(/USDT$/, '')] = { price: +x.lastPrice, chg24: +x.priceChangePercent, vol: +x.quoteVolume, hi: +x.highPrice, lo: +x.lowPrice };
  return o;
}
export async function cryptoKlines(sym, interval = '1d', limit = 1000) {
  const d = await bin(`/api/v3/klines?symbol=${sym}USDT&interval=${interval}&limit=${limit}`);
  return d.map((k) => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[7] }));
}
export async function fearGreed(limit = 30) {
  const d = await jget(`https://api.alternative.me/fng/?limit=${limit}`);
  return d.data.map((x) => ({ v: +x.value, cls: x.value_classification, t: +x.timestamp * 1000 }));
}
export async function globalMkt() {
  const d = (await jget('https://api.coingecko.com/api/v3/global')).data;
  return { mcap: d.total_market_cap.usd, mcapChg: d.market_cap_change_percentage_24h_usd, btcDom: d.market_cap_percentage.btc, ethDom: d.market_cap_percentage.eth };
}
export async function stockSeries(symbols, key) {
  if (!key || !symbols.length) return {};
  const d = await jget(`https://api.twelvedata.com/time_series?symbol=${symbols.join(',')}&interval=1day&outputsize=400&apikey=${key}`, 20000);
  const one = (x) => (x && x.values ? x.values.map((v) => ({ t: Date.parse(v.datetime + 'T21:00:00Z'), o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0) })).reverse() : null);
  const o = {};
  if (symbols.length === 1) { const s = one(d); if (s) o[symbols[0]] = s; else throw new Error(d.message || 'Twelve Data'); }
  else for (const s of symbols) { const r = one(d[s]); if (r) o[s] = r; }
  if (!Object.keys(o).length) throw new Error(d.message || 'Twelve Data fără date');
  return o;
}
export async function news({ finnhubKey = '' } = {}) {
  const all = [], errs = [];
  const tasks = [
    jget('https://min-api.cryptocompare.com/data/v2/news/?lang=EN').then((d) => (d.Data || []).forEach((x) => all.push({ title: x.title, url: x.url, src: x.source_info?.name || x.source, t: x.published_on * 1000, body: (x.body || '').slice(0, 300), kind: 'crypto' }))),
    jget('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://cointelegraph.com/rss')).then((d) => (d.items || []).forEach((x) => all.push({ title: x.title, url: x.link, src: 'Cointelegraph', t: Date.parse(x.pubDate.replace(' ', 'T') + 'Z'), body: (x.description || '').replace(/<[^>]+>/g, '').slice(0, 300), kind: 'crypto' }))),
    jget('https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent('https://www.coindesk.com/arc/outboundfeeds/rss/')).then((d) => (d.items || []).forEach((x) => all.push({ title: x.title, url: x.link, src: 'CoinDesk', t: Date.parse(x.pubDate.replace(' ', 'T') + 'Z'), body: (x.description || '').replace(/<[^>]+>/g, '').slice(0, 300), kind: 'crypto' }))),
  ];
  if (finnhubKey) for (const cat of ['general', 'crypto'])
    tasks.push(jget(`https://finnhub.io/api/v1/news?category=${cat}&token=${finnhubKey}`).then((d) => (d || []).slice(0, 40).forEach((x) => all.push({ title: x.headline, url: x.url, src: x.source, t: x.datetime * 1000, body: (x.summary || '').slice(0, 300), kind: cat === 'crypto' ? 'crypto' : 'bursă' }))));
  (await Promise.allSettled(tasks)).forEach((r) => r.status === 'rejected' && errs.push(r.reason?.message));
  const seen = new Set(), out = [];
  for (const x of all.filter((x) => x.title && x.t).sort((a, b) => b.t - a.t)) {
    const k = x.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60); if (seen.has(k)) continue; seen.add(k); out.push(scoreNews(x));
  }
  if (!out.length && errs.length) throw new Error('Știri indisponibile: ' + errs.join('; '));
  return out.slice(0, 80);
}
export function newsAlerts(items, minImp = 5, maxAgeMs = 3 * 3600e3) {
  return items.filter((x) => x.imp >= minImp && Date.now() - x.t < maxAgeMs).slice(0, 5).map((x) => ({
    key: 'news:' + x.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50), level: x.imp >= 7 ? 'high' : 'med', sym: x.tags[0] || 'ȘTIRI',
    title: `📰 ${x.sent > 0 ? '🟢' : x.sent < 0 ? '🔴' : '⚪️'} ${x.title}`.slice(0, 140), body: `${x.src}${x.tags.length ? ' · ' + x.tags.join(', ') : ''}`, url: x.url, t: x.t,
  }));
}
