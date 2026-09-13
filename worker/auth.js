// Clerk JWT verification for Cloudflare Workers.
// Prefer networkless verification when CLERK_JWT_KEY (PEM) is set.

import { createClerkClient } from '@clerk/backend';

/** Test-only override: `(request, env, headers) => Promise<{userId}|{error}>`. */
export let __testAuthenticate = null;

export function setTestAuthenticate(fn) {
  __testAuthenticate = typeof fn === 'function' ? fn : null;
}

/** True when both Clerk keys look real (not empty / REPLACE_ME placeholders). */
export function isClerkConfigured(env = {}) {
  return isUsableClerkKey(env.CLERK_SECRET_KEY, 'sk_') && isUsableClerkKey(env.CLERK_PUBLISHABLE_KEY, 'pk_');
}

function isUsableClerkKey(value, prefix) {
  if (!value || typeof value !== 'string') return false;
  if (!value.startsWith(prefix)) return false;
  if (value.includes('REPLACE_ME')) return false;
  return true;
}

/**
 * Authenticate an incoming request and return the Clerk user id.
 * Never trusts a client-supplied user id.
 *
 * @returns {Promise<{ userId: string } | { error: Response }>}
 */
export async function requireClerkUser(request, env, corsHeaders = null) {
  if (__testAuthenticate) {
    return __testAuthenticate(request, env, corsHeaders);
  }

  const headers = corsHeaders ? new Headers(corsHeaders) : new Headers();

  if (!isClerkConfigured(env)) {
    return {
      error: Response.json(
        {
          error: 'Clerk is not configured',
          code: 'clerk_not_configured',
          hint: 'Set CLERK_SECRET_KEY (secret) and CLERK_PUBLISHABLE_KEY (var)'
        },
        { status: 501, headers }
      )
    };
  }

  try {
    const clerk = createClerkClient({
      secretKey: env.CLERK_SECRET_KEY,
      publishableKey: env.CLERK_PUBLISHABLE_KEY,
      jwtKey: env.CLERK_JWT_KEY || undefined
    });

    const authorizedParties = buildAuthorizedParties(request, env);
    const state = await clerk.authenticateRequest(request, {
      authorizedParties
    });

    if (!state.isAuthenticated) {
      return {
        error: Response.json(
          { error: 'Unauthorized', code: 'unauthorized' },
          { status: 401, headers }
        )
      };
    }

    const auth = state.toAuth();
    const userId = auth?.userId;
    if (!userId) {
      return {
        error: Response.json(
          { error: 'Unauthorized', code: 'unauthorized' },
          { status: 401, headers }
        )
      };
    }

    return { userId };
  } catch (err) {
    console.error('Clerk authenticateRequest failed', err);
    return {
      error: Response.json(
        { error: 'Authentication failed', code: 'auth_failed' },
        { status: 401, headers }
      )
    };
  }
}

/** Origins allowed to mint session tokens (azp claim). */
export function buildAuthorizedParties(request, env = {}) {
  const parties = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:8787',
    'http://127.0.0.1:8787'
  ]);

  try {
    parties.add(new URL(request.url).origin);
  } catch {
    /* ignore */
  }

  const extras = env.ALLOWED_ORIGINS || env.CLERK_AUTHORIZED_PARTIES || '';
  if (typeof extras === 'string' && extras.trim()) {
    for (const part of extras.split(',')) {
      const trimmed = part.trim();
      if (trimmed) parties.add(trimmed);
    }
  }

  return [...parties];
}
