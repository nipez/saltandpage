# salt & page.

The cookbook for people who actually cook, not just save.

This repo is the production home for the React prototype. **Local-first by default**; Cloudflare hosts the SPA and API. **Clerk** signs users in; **D1** syncs cookbook state per Clerk `user_id`.

## Stack decision

**Cloudflare Workers + Vite. Not classic Pages. Not Vercel. Not Supabase + Railway.**

Cloudflare’s current recommendation for new apps is [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) with the [Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/). Pages still works; new features go to Workers. Same dashboard, same R2 / D1 / KV.

| Option | Verdict |
| --- | --- |
| **Cloudflare Workers** | One platform: SPA, AI proxy, R2 photos, D1 sync, KV cache, preview deploys. Matches the product brief. |
| Classic Pages | Fine last year. Don’t start a new project there. |
| Vercel | Great previews. Still need a database and object storage somewhere else. Extra vendor, extra bill. |
| Supabase + Railway | Three vendors. Clerk is already the auth plan, so Supabase Auth is redundant. Railway is a long-running Node box we don’t need. |

Later: Stripe (Plus / Family), R2 (hero + cook-log photos), Capacitor (iOS).

## Architecture (auth + sync)

```
Browser (Vite SPA)
  ├─ signed out → localStorage only (window.storage)
  └─ signed in (Clerk)
       ├─ Bearer JWT on /api/sync*
       └─ Worker verifies JWT (@clerk/backend) → D1 scoped by user_id
```

| Concern | Behavior |
| --- | --- |
| **Auth** | `@clerk/clerk-react` in the SPA (modal Sign in / Sign up). Worker uses `authenticateRequest` — never trusts a client-sent user id. |
| **Local-first** | No account required. Recipes and related state stay in `localStorage` via `src/storage.js`. |
| **Cloud sync** | Signed-in users push/pull recipes + docs (`shopping_list_current`, `meal_plan`, `pantry_current`, `user_subs`, `prefs`, `onboarded_v1`, `subscription_plan`) to D1. |
| **Migration** | On first sign-in, if the cloud is empty and this device has data, a one-time modal offers **Import to cloud** or **Skip**. Local data is not wiped. |
| **AI proxy** | `/api/ai` keeps origin allowlist + KV rate limits. Clerk does not remove those gates. |
| **Public** | `/api/health`, `/api/config` (publishable key for the SPA). |

### D1 schema

Migration: `migrations/0001_init.sql`

- `users` — Clerk `user_id`, `imported_local_at`
- `recipes` — full recipe JSON payload per row (includes cook_log, collections, favorite)
- `user_docs` — other cookbook blobs keyed like localStorage

| Env | Name | database_id |
| --- | --- | --- |
| Production | `salt-and-page` | `f7b712c7-1a50-4c97-a7e4-3c172e23b594` |
| Preview | `salt-and-page-preview` | `a23c85b5-4b68-4380-97e8-439c9923dc53` |

## Local

```bash
npm install
cp .dev.vars.example .dev.vars
# Fill ANTHROPIC_API_KEY and Clerk keys when ready
npx wrangler d1 migrations apply salt-and-page --local
npm run dev
```

Open http://localhost:5173. Without Clerk keys, the app runs local-only (Sign in stays hidden / settings explains setup).

Optional Vite env (otherwise the SPA reads publishable key from `GET /api/config`):

```bash
# .env.local (not committed)
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
```

```bash
npm run validate   # parse sources + AI + sync unit/integration checks
npm run build
npm run check      # validate + build + wrangler dry-run
```

## Nicholas checklist — ship Clerk + D1

### 1. Clerk Dashboard

1. Create an application at [dashboard.clerk.com](https://dashboard.clerk.com) (email + social as you prefer).
2. **Configure → Domains / Allowed origins** (or Paths): add
   - `http://localhost:5173`
   - `http://127.0.0.1:5173`
   - `https://salt-and-page.nickperez.workers.dev`
   - any custom domain you attach later
3. Copy **Publishable key** (`pk_…`) and **Secret key** (`sk_…`).
4. Optional but recommended: API Keys → **Show JWT public key** → PEM → use as `CLERK_JWT_KEY` for networkless verification on Workers.

### 2. Worker secrets & vars

```bash
# Publishable key (also in wrangler.jsonc vars — update the placeholder)
npx wrangler secret put CLERK_SECRET_KEY
# Optional:
npx wrangler secret put CLERK_JWT_KEY

npx wrangler secret put ANTHROPIC_API_KEY   # if not already
```

Update `wrangler.jsonc` → `vars.CLERK_PUBLISHABLE_KEY` to your real `pk_…` (safe to commit publishable keys; still prefer not committing secrets).

Local `.dev.vars`:

```
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
CLERK_JWT_KEY=...          # optional PEM
ANTHROPIC_API_KEY=...
```

### 3. D1 migrate + deploy

D1 databases (already bound in `wrangler.jsonc`):

| Binding | Env | Name | database_id |
| --- | --- | --- | --- |
| `DB` | Production | `salt-and-page` | `f7b712c7-1a50-4c97-a7e4-3c172e23b594` |
| `DB` | Preview | `salt-and-page-preview` | `a23c85b5-4b68-4380-97e8-439c9923dc53` |

```bash
npx wrangler d1 migrations apply salt-and-page --remote
npx wrangler d1 migrations apply salt-and-page-preview --remote
npm run deploy
```

### 4. Smoke test

1. Signed out: add a recipe → still in localStorage only.
2. Sign in → import modal if local recipes exist → Import (or Skip — local is kept).
3. If this device has local recipes and the account already has cloud data → choose **Use cloud** or **Keep this device & upload**.
4. Confirm `GET /api/health` shows `clerkConfigured: true`, `d1Configured: true`.
5. Second browser / incognito, sign in → recipes appear after pull.

## Deploy (Cloudflare)

1. Workers & Pages → connect `nipez/saltandpage` (or `npm run deploy` from a logged-in machine).
2. KV for AI rate limits (already bound in `wrangler.jsonc`).
3. D1 binding `DB` (already in `wrangler.jsonc`).
4. Secrets: `ANTHROPIC_API_KEY`, `CLERK_SECRET_KEY` (+ optional `CLERK_JWT_KEY`).
5. Apply D1 migrations (see above).

## `/api/ai` hardening

`/api/health` stays public. `POST /api/ai` is gated:

| Check | Behavior |
| --- | --- |
| **Origin allowlist** | Require `Origin` (or `Referer` origin) in the allowlist. Others → `403` `{ code: "origin_not_allowed" }`. CORS echoes the allowed origin only (never `*`). |
| **Rate limit** | **20** calls per **60s** per `CF-Connecting-IP` + coarse User-Agent fingerprint via KV (`AI_RATE_LIMIT_KV`). Exceeded → `429` + `Retry-After`. Missing binding → `503`. |

Same-origin SPA `fetch('/api/ai')` keeps working. Authenticated-user rate tiers can come later — do not remove origin/KV limits.

## `/api/sync` (authenticated)

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/api/sync/status` | `{ userId, hasCloudData, recipeCount, importedLocalAt }` |
| `GET` | `/api/sync` | Full cookbook snapshot |
| `PUT` | `/api/sync` | Upsert recipes + docs (`replaceRecipes` soft-deletes missing) |
| `POST` | `/api/sync/import` | One-time local import (`skip: true` marks done without upload) |

All require `Authorization: Bearer <Clerk session JWT>`.

## What’s in this repo

- `src/App.jsx` — cookbook UI
- `src/storage.js` — `window.storage` shim over `localStorage`
- `src/AuthUI.jsx` / `src/SyncBootstrap.jsx` — Clerk UI + migration + sync bootstrap
- `src/sync-api.js` / `src/sync-bridge.js` — client sync helpers
- `worker/index.js` — `/api/health`, `/api/config`, `/api/ai`, `/api/sync*`
- `worker/auth.js` — Clerk JWT verification
- `worker/sync.js` — D1 read/write
- `migrations/` — D1 SQL migrations
- `wrangler.jsonc` — Workers + SPA + KV + D1

AI calls go to `/api/ai` so the key never ships to the browser.

## Not in this pass

Stripe billing (demo Free/Plus gates stay local), R2 photo storage, Capacitor, Family household sharing.
