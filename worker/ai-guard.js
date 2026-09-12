// Origin allowlist + client key helpers for /api/ai hardening.
// Pure functions so scripts/test-ai-guard.js can exercise them without Miniflare.

export const LOCAL_DEV_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:8787',
  'http://127.0.0.1:8787'
]);

/** Parse comma-separated ALLOWED_ORIGINS (extra custom domains, preview URLs, etc.). */
export function parseAllowedOrigins(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Trusted origins for /api/ai:
 * - the Worker/request host (workers.dev or attached custom domain)
 * - localhost Vite / wrangler ports
 * - optional ALLOWED_ORIGINS env (comma-separated)
 */
export function buildAllowedOrigins(requestUrl, env = {}) {
  const url = typeof requestUrl === 'string' ? new URL(requestUrl) : new URL(requestUrl.href ?? String(requestUrl));
  const allowed = new Set([url.origin, ...LOCAL_DEV_ORIGINS]);
  for (const origin of parseAllowedOrigins(env.ALLOWED_ORIGINS)) {
    allowed.add(origin);
  }
  return allowed;
}

/** Prefer Origin; fall back to Referer origin (some clients omit Origin on same-site POSTs). */
export function resolveClientOrigin(request) {
  const origin = request.headers.get('Origin');
  if (origin) return origin;

  const referer = request.headers.get('Referer');
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function isOriginAllowed(clientOrigin, allowedOrigins) {
  if (!clientOrigin) return false;
  return allowedOrigins.has(clientOrigin);
}

/**
 * Coarse anonymous client key: CF-Connecting-IP plus a short UA fingerprint.
 * IP alone is shared on mobile NATs; UA alone is spoofable — together they
 * raise the cost of key-drain bursts until real auth lands.
 */
export async function clientRateLimitKey(request) {
  const ip =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('cf-connecting-ip') ||
    'unknown';
  const ua = request.headers.get('User-Agent') || request.headers.get('user-agent') || '';
  const fp = await shortHash(ua || 'no-ua');
  return `${ip}:${fp}`;
}

async function shortHash(value) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function corsHeaders(allowedOrigin) {
  return new Headers({
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, anthropic-version',
    vary: 'Origin'
  });
}
