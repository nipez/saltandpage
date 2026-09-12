# salt & page.

The cookbook for people who actually cook, not just save.

This repo is the production home for the React prototype. Local-first for now; Cloudflare is the host and the API.

## Stack decision

**Cloudflare Workers + Vite. Not classic Pages. Not Vercel. Not Supabase + Railway.**

Cloudflare’s current recommendation for new apps is [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) with the [Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/). Pages still works; new features go to Workers. Same dashboard, same R2 / D1 / KV.

| Option | Verdict |
| --- | --- |
| **Cloudflare Workers** | One platform: SPA, AI proxy (unlocks mobile URL extract), R2 photos, D1 sync, KV cache, preview deploys. Matches the product brief. |
| Classic Pages | Fine last year. Don’t start a new project there. |
| Vercel | Great previews. Still need a database and object storage somewhere else. Extra vendor, extra bill. |
| Supabase + Railway | Three vendors. Clerk is already the auth plan, so Supabase Auth is redundant. Railway is a long-running Node box we don’t need. |

Later: Clerk (auth), Stripe (Plus / Family), R2 (hero + cook-log photos), D1 (cloud sync), Capacitor (iOS).

## Local

```bash
npm install
cp .dev.vars.example .dev.vars   # add ANTHROPIC_API_KEY to use AI features
npm run dev
```

Open http://localhost:5173. Recipes persist in `localStorage` via the same `window.storage` contract as the artifact.

```bash
npm run validate   # @babel/parser on the React source
npm run build
npm run check      # validate + build + wrangler dry-run
```

## Deploy

1. Cloudflare Dashboard → Workers & Pages → Create → Connect to GitHub → `nipez/saltandpage`.
2. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
3. Add the secret `ANTHROPIC_API_KEY` in the Worker settings (or `npx wrangler secret put ANTHROPIC_API_KEY`).

Or from a logged-in machine: `npm run deploy`.

## What’s in this repo

- `src/App.jsx` — the working prototype (search by function name or `// ----------` section comments)
- `src/storage.js` — `window.storage` shim over `localStorage`
- `worker/index.js` — `/api/health` and `/api/ai` (Anthropic proxy)
- `wrangler.jsonc` — Workers + SPA routing

AI calls go to `/api/ai` so the key never ships to the browser.

## Not in this pass

Clerk, Stripe, D1, R2, KV bindings, cloud sync, Chrome extension, Capacitor. Those come next, on this stack.
