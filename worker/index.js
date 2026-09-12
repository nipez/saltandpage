// Edge API for salt & page.
// /api/ai proxies Anthropic so the key never ships to the browser and
// mobile clients can run URL extraction (the artifact sandbox blocked web_search).
// Interim hardening (pre-Clerk): origin allowlist + KV-backed per-client rate limits.

import {
  buildAllowedOrigins,
  clientRateLimitKey,
  corsHeaders,
  isOriginAllowed,
  resolveClientOrigin
} from './ai-guard.js';

const ANTHROPIC_MESSAGES = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const DEFAULT_LIMIT = 20;
const DEFAULT_PERIOD_SEC = 60;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health' && request.method === 'GET') {
      return Response.json({
        ok: true,
        service: 'salt-and-page',
        aiConfigured: Boolean(env.ANTHROPIC_API_KEY)
      });
    }

    if (url.pathname === '/api/ai') {
      return handleAi(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleAi(request, env) {
  const allowedOrigins = buildAllowedOrigins(request.url, env);
  const clientOrigin = resolveClientOrigin(request);

  if (!isOriginAllowed(clientOrigin, allowedOrigins)) {
    return Response.json(
      { error: 'Forbidden origin', code: 'origin_not_allowed' },
      { status: 403 }
    );
  }

  const headers = corsHeaders(clientOrigin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
  }

  const limited = await enforceRateLimit(request, env, headers);
  if (limited) return limited;

  return proxyAnthropic(request, env, headers);
}

/**
 * Prefer optional Workers Rate Limiting binding when present; otherwise KV
 * (`AI_RATE_LIMIT_KV`). Fail closed if neither is configured.
 */
async function enforceRateLimit(request, env, headers) {
  const key = await clientRateLimitKey(request);
  const limit = positiveInt(env.AI_RATE_LIMIT, DEFAULT_LIMIT);
  const periodSec = positiveInt(env.AI_RATE_LIMIT_PERIOD, DEFAULT_PERIOD_SEC);

  let success;
  if (env.AI_RATE_LIMITER?.limit) {
    try {
      ({ success } = await env.AI_RATE_LIMITER.limit({ key }));
    } catch {
      console.warn('AI_RATE_LIMITER.limit failed; falling back to KV');
      success = await kvLimit(env, key, limit, periodSec);
    }
  } else {
    success = await kvLimit(env, key, limit, periodSec);
  }

  if (success === null) {
    return Response.json(
      { error: 'Rate limiter unavailable', code: 'rate_limiter_missing' },
      { status: 503, headers }
    );
  }

  if (success) return null;

  const out = new Headers(headers);
  out.set('retry-after', String(periodSec));
  return Response.json(
    { error: 'Rate limit exceeded', code: 'rate_limited' },
    { status: 429, headers: out }
  );
}

async function kvLimit(env, key, limit, periodSec) {
  const kv = env.AI_RATE_LIMIT_KV;
  if (!kv?.get || !kv?.put) return null;

  const now = Date.now();
  const epoch = Math.floor(now / (periodSec * 1000));
  const storageKey = `ai-rl:${epoch}:${key}`;

  const raw = await kv.get(storageKey);
  const count = raw ? Number(raw) : 0;
  if (Number.isFinite(count) && count >= limit) return false;

  await kv.put(storageKey, String((Number.isFinite(count) ? count : 0) + 1), {
    expirationTtl: Math.max(periodSec + 5, 60)
  });
  return true;
}

function positiveInt(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function proxyAnthropic(request, env, headers) {
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error:
          'ANTHROPIC_API_KEY is not configured. Add it to .dev.vars locally, or run: npx wrangler secret put ANTHROPIC_API_KEY'
      },
      { status: 501, headers }
    );
  }

  const body = await request.text();
  if (!body) {
    return Response.json({ error: 'Request body required' }, { status: 400, headers });
  }

  const upstream = await fetch(ANTHROPIC_MESSAGES, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': request.headers.get('anthropic-version') || ANTHROPIC_VERSION
    },
    body
  });

  const out = new Headers(headers);
  out.set('content-type', upstream.headers.get('content-type') || 'application/json');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}
