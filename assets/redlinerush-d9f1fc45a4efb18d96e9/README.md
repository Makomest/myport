# Redline Rush — Offline Demo

A fully **self-contained, backend-free** build of Redline Rush for a portfolio / static site.
The whole game (betting → race → settle loop, provably-fair crash points, payouts) runs
**in the browser** — no server, database or WebSocket needed.

## What's inside
- `index.html` — the game.
- `GAME-SHEET.en.html` — one-page game spec sheet.
- `demo-server.js` — the in-browser "server" (runs the real engine + a provably-fair
  HMAC-SHA256 stream, so the in-game *Provably fair* verifier still passes).
- `dist/` — the game client library. `engine/` — the shared game engine.
- `assets/` — art + sound.

## How to run / publish
ES modules need to be served over **http/https** (opening `index.html` directly via
`file://` won't work because browsers block module + fetch from the filesystem).

- **Publish to your site:** just upload the whole `demo/` folder and link to `demo/index.html`
  (and/or `demo/GAME-SHEET.en.html`). That's it — it's static.
- **Preview locally:** run any static server in this folder, e.g.
  - `npx serve .`  → open the printed URL
  - or `python -m http.server 8080` → http://localhost:8080/

## Notes
- Money is **play money** kept in `localStorage` (demo only — no real-money wagering).
- The "+ Funds" button tops up the demo balance.
- Edit the contact email in `GAME-SHEET.en.html` (`hello@redlinerush.game`) before publishing.
