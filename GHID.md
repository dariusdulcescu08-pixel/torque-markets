# Torque Markets: instalare

## 1. Pune-o online (GitHub Pages, gratis)
1. Fă un repo **public** nou pe github.com/new, de exemplu `torque-markets`.
2. Urcă toate fișierele din arhivă (fără `node_modules`).
3. În repo: **Settings → Pages → Build and deployment → Deploy from a branch → main / (root) → Save**.
4. După 1–2 minute aplicația e la `https://USERUL-TAU.github.io/torque-markets/`.

## 2. Pune-o pe iPhone
1. Deschide linkul în **Safari** (nu Chrome).
2. **Share → Add to Home Screen → Add**.
3. Deschide-o de pe iconiță → **Setări → Activează notificările → Allow**.

Cu app-ul deschis primești alerte live (prețuri la 20 s, analiză la 3 min, știri la 5 min).

## 3. Notificări cu app-ul închis (monitorul de pe GitHub)
iOS nu lasă aplicațiile web să ruleze în fundal, așa că verificarea o face GitHub Actions la ~15 minute și îți trimite push.

1. În app: **Setări → Generează codul de push → Copiază**.
2. În repo: **Settings → Secrets and variables → Actions → New repository secret**, adaugi:
   - `PUSH_SUBSCRIPTION` = codul copiat din app
   - `VAPID_PRIVATE` = cheia privată primită separat (nu o pune în cod!)
   - `VAPID_SUBJECT` = `mailto:emailul-tau@gmail.com`
   - opțional `TWELVE_KEY` (acțiuni) și `FINNHUB_KEY` (știri bursă)
3. Tab-ul **Actions → Monitor piață → Run workflow**. Trebuie să-ți vină „monitor activ ✅”.

De știut:
- Cron-ul GitHub poate întârzia 5–20 de minute la ore aglomerate. Nu e pentru scalping, e pentru mișcări mari și setup-uri.
- GitHub oprește cron-ul după 60 de zile fără niciun commit în repo. Un commit oarecare îl repornește.
- Dacă reinstalezi app-ul pe telefon, generezi cod nou și actualizezi `PUSH_SUBSCRIPTION`.
- Watchlist-ul monitorului se schimbă cu secretele opționale `CRYPTO` (ex. `BTC,ETH,SOL`) și `STOCKS`.

## Chei opționale (în Setări, în app)
- **Anthropic**: analiză AI reală pe datele live. Plătită per folosire, separat de abonamentul Claude. Fără ea ai analiza locală (reguli + statistici).
- **Twelve Data**: acțiuni și ETF-uri (gratis, 800 cereri/zi).
- **Finnhub**: știri de bursă (gratis).
