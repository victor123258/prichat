# PriChat — Stealth Protocol

Encrypted 2-party direct stealth messaging & peer calls linked by a 6-digit passkey.

A single-page **PWA built with Vite**, powered by **Firebase Realtime Database + Storage** as the backend (a BaaS — required because GitHub Pages can only serve static files). Fully deployable to **GitHub Pages** with zero servers.

## Features

- 🔑 6-digit passkey rooms — share the key, only 2 operators per channel
- 📡 Live presence, active-channels radar, typing indicators
- 🔒 End-to-end synchronized text, images, files & voice notes (uploaded to Firebase Storage)
- 📞 WebRTC peer-to-peer audio & video calls (STUN signaling via Firebase)
- 🛡 Panic / decoy mode (`ESC` hotkey)
- 📱 Installable PWA (manifest + service worker)

## Tech Stack

| Layer      | Technology |
| ---------- | -------------------------------------------- |
| Frontend   | Vite · Tailwind CSS (CDN) · vanilla JS (ES modules) |
| Backend    | Firebase Realtime Database (signaling/presence) |
| Media      | Firebase Cloud Storage (files & voice notes) |
| Calls      | WebRTC (STUN-only, P2P direct) |
| Hosting    | GitHub Pages (static build output) |

## Getting Started

```bash
npm install
npm run dev        # local dev at http://localhost:3000
npm run build      # production build → dist/
npm run preview    # preview the production build
```

## Firebase Setup (one time)

> GitHub Pages is static-only, so Firebase is the "backend". The app is pre-wired to a default project — swap in your own so you control the data.

1. Go to https://console.firebase.google.com → **Add project**.
2. **Realtime Database** → Create database in *Test mode* (or locked + paste the rules below).
3. **Storage** → Get started (default Cloud Storage bucket).
4. Copy your project's web-app config and paste it into `src/js/firebase-config.js` (or set `VITE_FIREBASE_*` vars from `.env.example`).

### Realtime Database rules

Deploy `firebase-database.rules.json` (or paste in the console): allows the passkey rooms subtree.

### Cloud Storage rules

```js
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /rooms/{roomId}/{type}/{anySegment} {
      allow read, write: if true;
    }
  }
}
```

## Deploy to GitHub Pages

The repo (or branch) name must match `base` in `vite.config.js` (`/prichat/`). Then either:

### Option A — GitHub Actions (recommended, zero setup)

1. Push this repository to GitHub (branch `main`).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push a commit — the included `.github/workflows/deploy.yml` builds and deploys automatically.

### Option B — Local build & push

```bash
npm run deploy     # runs: npm run build && gh-pages -d dist
```

The built site will be live at `https://<username>.github.io/prichat/` (GitHub serves project pages at the lowercase path).

## Project Structure

```text
prichat/
├── index.html                # Vite entry (plain markup, no inline logic)
├── public/
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service worker (app shell cache)
│   ├── .nojekyll             # Let GH Pages treat output as plain static
│   └── icons/                # App icons (192 / 512)
├── src/
│   ├── css/main.css          # Core styles (stealth theme, animations)
│   └── js/
│       ├── app.js            # Entry point — wiring & init
│       ├── config.js         # Config loader (env vars → fallback)
│       ├── firebase-config.js # Your Firebase project credentials
│       ├── firebase-config.template.js
│       ├── state.js          # Shared app state
│       ├── ui.js             # DOM refs, toasts, PIN inputs, helpers
│       ├── db.js             # Firebase RTDB/Storage init + rooms & presence
│       ├── chat.js           # Messages, files, voice notes, typing
│       └── calls.js          # WebRTC call signaling & controls
├── firebase-database.rules.json
├── .github/workflows/deploy.yml
└── vite.config.js            # base: '/prichat/' (matches the repo name)
```

## Security Notes

- The 6-digit passkey is not actual encryption; content in RTDB/Storage is owned by your Firebase project rules. For real 2-party secrecy, add Firebase Auth + per-room rules (or layer E2E encryption client-side) — see roadmap.
- Firebase API keys are public by design for web apps; protect data with **Security Rules**, not the key.