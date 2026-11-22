// Prețuri live prin WebSocket Binance (miniTicker) + portofoliu Binance read-only.
const WS = ['wss://data-stream.binance.vision/stream?streams=', 'wss://stream.binance.com:9443/stream?streams='];

export class Live {
  constructor(onTick, onState) { this.onTick = onTick; this.onState = onState; this.syms = []; this.ws = null; this.tries = 0; this.up = false; }
  set(syms) {
    const s = [...new Set(syms)].sort();
    if (s.join() === this.syms.join() && this.ws && this.ws.readyState <= 1) return;
    this.syms = s; this.connect();
  }
  connect() {
    try { this.ws?.close(); } catch {}
    clearTimeout(this.rt); if (!this.syms.length || typeof WebSocket === 'undefined') return;
    const url = WS[this.tries % 2] + this.syms.map((x) => x.toLowerCase() + 'usdt@miniTicker').join('/');
    const ws = new WebSocket(url); this.ws = ws;
    ws.onopen = () => { this.tries = 0; this.up = true; this.onState?.(true); };
    ws.onmessage = (e) => {
      try { const d = JSON.parse(e.data).data; if (!d?.s) return; const o = +d.o, c = +d.c;
        this.onTick(d.s.replace(/USDT$/, ''), { price: c, chg24: o ? (c / o - 1) * 100 : 0, hi: +d.h, lo: +d.l, vol: +d.q, t: d.E }); } catch {}
    };
    ws.onclose = () => { if (this.ws !== ws) return; this.up = false; this.onState?.(false); this.tries++; this.rt = setTimeout(() => this.connect(), Math.min(30000, 1500 * 2 ** Math.min(this.tries, 4))); };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }
  wake() { if (!this.ws || this.ws.readyState > 1) { this.tries = 0; this.connect(); } }
}

// Binance read-only: semnătură HMAC-SHA256 în browser (WebCrypto). Cheia rămâne pe telefon.
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function binanceBalances(key, secret) {
  const q = `timestamp=${Date.now()}&recvWindow=10000&omitZeroBalances=true`;
  const sig = await hmac(secret, q);
  const r = await fetch(`https://api.binance.com/api/v3/account?${q}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': key } });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.msg || `Binance HTTP ${r.status}`);
  const stable = new Set(['USDT', 'USDC', 'FDUSD', 'BUSD', 'DAI', 'TUSD']);
  return (d.balances || []).map((b) => ({ sym: b.asset.replace(/^LD/, ''), qty: +b.free + +b.locked }))
    .filter((b) => b.qty > 0).reduce((acc, b) => { const e = acc.find((x) => x.sym === b.sym); e ? (e.qty += b.qty) : acc.push({ ...b, stable: stable.has(b.sym) }); return acc; }, []);
}
