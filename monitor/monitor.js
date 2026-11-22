// Monitor în fundal: rulează pe GitHub Actions la ~15 min și trimite Web Push pe iPhone.
import fs from 'node:fs';
import * as webpush from 'web-push';
import * as C from '../core.js';

const E = process.env, STATE = new URL('./state.json', import.meta.url);
const subs = (() => { try { const v = JSON.parse(E.PUSH_SUBSCRIPTION || '[]'); return Array.isArray(v) ? v : [v]; } catch { return []; } })();
if (!subs.length || !E.VAPID_PRIVATE) { console.log('Lipsește PUSH_SUBSCRIPTION sau VAPID_PRIVATE. Nimic de făcut.'); process.exit(0); }
webpush.setVapidDetails(E.VAPID_SUBJECT || 'mailto:torque@example.com', C.CONFIG.VAPID_PUBLIC, E.VAPID_PRIVATE);

let state = { seen: {} }; try { state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch {}
const first = !Object.keys(state.seen).length;
const th = { ...C.CONFIG.th, ...(E.THRESHOLDS ? JSON.parse(E.THRESHOLDS) : {}) };
const crypto = E.CRYPTO ? E.CRYPTO.split(',').map((s) => s.trim().toUpperCase()) : C.CONFIG.crypto;
const stocks = E.STOCKS ? E.STOCKS.split(',').map((s) => s.trim().toUpperCase()) : C.CONFIG.stocks;

const alerts = [];
const tryit = async (name, fn) => { try { await fn(); } catch (e) { console.warn(name, e.message); } };
let fng = null;
await tryit('fng', async () => { fng = (await C.fearGreed(2))[0]?.v; alerts.push(...C.marketAlerts({ fng })); });
let tick = {};
await tryit('tickers', async () => { tick = await C.cryptoTickers(crypto); });
for (const s of crypto) await tryit(s, async () => {
  const d = await C.cryptoKlines(s, '1d', 400), h1 = await C.cryptoKlines(s, '1h', 168);
  const S = C.series(d), a = C.analyze(S, { fng, kind: 'crypto' });
  alerts.push(...C.detectAlerts({ sym: s, kind: 'crypto', S, a, h1, live: tick[s], th }));
});
if (E.TWELVE_KEY) await tryit('stocks', async () => {
  const all = await C.stockSeries(stocks.slice(0, 8), E.TWELVE_KEY);
  for (const [s, d] of Object.entries(all)) { const S = C.series(d), a = C.analyze(S, { kind: 'stocks' }); alerts.push(...C.detectAlerts({ sym: s, kind: 'stocks', S, a, th })); }
});
await tryit('news', async () => alerts.push(...C.newsAlerts(await C.news({ finnhubKey: E.FINNHUB_KEY || '' }), 6, 45 * 60e3)));

const fresh = alerts.filter((a) => !state.seen[a.key]);
fresh.forEach((a) => { state.seen[a.key] = Date.now(); });
const wk = Date.now() - 7 * 864e5; for (const k in state.seen) if (state.seen[k] < wk) delete state.seen[k];
fs.writeFileSync(STATE, JSON.stringify(state));

const send = async (p) => { for (const sub of subs) { try { await webpush.sendNotification(sub, JSON.stringify(p), { TTL: 3600, urgency: 'high' }); } catch (e) { console.warn('push', e.statusCode, e.body); } } };
console.log(`alerte: ${alerts.length}, noi: ${fresh.length}, prima rulare: ${first}`);
if (first) { await send({ title: 'Torque Markets: monitor activ ✅', body: `Urmăresc ${crypto.length} crypto${E.TWELVE_KEY ? ` și ${stocks.length} acțiuni` : ''} la fiecare ~15 minute.`, tag: 'start' }); process.exit(0); }
const pick = fresh.sort((a, b) => (b.level === 'high') - (a.level === 'high')).slice(0, 4);
for (const a of pick) await send({ title: a.title, body: a.body, tag: a.key, url: a.url });
if (fresh.length > pick.length) await send({ title: `+${fresh.length - pick.length} alte alerte`, body: fresh.slice(pick.length, pick.length + 4).map((a) => a.title).join(' · '), tag: 'more' });
