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

Optional in `.dev.vars`: `ALLOWED_ORIGINS` (comma-separated) if you need extra Origins beyond localhost and the Worker host. Rate limits are configured in `wrangler.jsonc` (`ratelimits`), not env vars.

```bash
npm run validate   # parse sources + AI guard unit/integration checks
npm run build
npm run check      # validate + build + wrangler dry-run
```

## Deploy

1. Cloudflare Dashboard → Workers & Pages → Create → Connect to GitHub → `nipez/saltandpage`.
2. Create a KV namespace for AI rate limits (one-time):

```bash
npx wrangler kv namespace create AI_RATE_LIMIT_KV
npx wrangler kv namespace create AI_RATE_LIMIT_KV --preview
```

Paste the returned `id` / `preview_id` into `wrangler.jsonc` → `kv_namespaces` (replace the placeholder ids). Or in the Dashboard: Workers & Pages → KV → Create, then bind as `AI_RATE_LIMIT_KV`.

3. Build command: `npm run build`. Deploy command: `npx wrangler deploy`.
4. Add the secret `ANTHROPIC_API_KEY` in the Worker settings (or `npx wrangler secret put ANTHROPIC_API_KEY`).

Or from a logged-in machine: `npm run deploy`.

Local `wrangler dev` / Vite uses an in-memory KV mock — placeholder ids are fine until you deploy.

## `/api/ai` hardening (pre-Clerk)

`/api/health` stays public. `POST /api/ai` is gated:

| Check | Behavior |
| --- | --- |
| **Origin allowlist** | Require `Origin` (or `Referer` origin) in the allowlist. Others → `403` `{ code: "origin_not_allowed" }`. CORS echoes the allowed origin only (never `*`). |
| **Rate limit** | **20** calls per **60s** per `CF-Connecting-IP` + coarse User-Agent fingerprint via KV (`AI_RATE_LIMIT_KV`). Exceeded → `429` + `Retry-After`. Missing binding → `503`. |

**Allowlist sources** (any match is enough):

1. The request host (`https://salt-and-page.nickperez.workers.dev`, or a custom domain attached to the Worker)
2. Local Vite / wrangler: `http://localhost:5173`, `http://127.0.0.1:5173`, `:8787` variants
3. Optional extras via `ALLOWED_ORIGINS` (comma-separated) in `.dev.vars` locally, or Worker `vars` / dashboard for production

Tune via `wrangler.jsonc` `vars` (or `.dev.vars`):

```jsonc
"vars": {
  "ALLOWED_ORIGINS": "https://saltandpage.example,https://www.saltandpage.example",
  "AI_RATE_LIMIT": "20",
  "AI_RATE_LIMIT_PERIOD": "60"
}
```

Optional: uncomment `ratelimits` in `wrangler.jsonc` to add the [Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) binding in front of KV (`period` must be `10` or `60`; `namespace_id` is an account-unique integer string). No dashboard create for that binding.

Same-origin SPA `fetch('/api/ai')` keeps working. Cross-origin browsers and scripts without an allowlisted Origin are rejected. Burst abuse from an allowlisted origin is capped until Clerk lands.

## What’s in this repo

- `src/App.jsx` — the working prototype (search by function name or `// ----------` section comments)
- `src/storage.js` — `window.storage` shim over `localStorage`
- `worker/index.js` — `/api/health` and hardened `/api/ai` (Anthropic proxy)
- `worker/ai-guard.js` — origin allowlist + rate-limit key helpers
- `wrangler.jsonc` — Workers + SPA routing + `AI_RATE_LIMIT_KV`

AI calls go to `/api/ai` so the key never ships to the browser.

## Not in this pass

Clerk, Stripe, D1, R2, cloud sync, Chrome extension, Capacitor. Those come next, on this stack. (KV is introduced here only for `/api/ai` rate limiting.)
