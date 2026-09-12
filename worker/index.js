// Edge API for salt & page.
// /api/ai proxies Anthropic so the key never ships to the browser and
// mobile clients can run URL extraction (the artifact sandbox blocked web_search).

const ANTHROPIC_MESSAGES = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

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
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (request.method !== 'POST') {
        return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders() });
      }
      return proxyAnthropic(request, env);
    }

    return new Response('Not found', { status: 404 });
  }
};

async function proxyAnthropic(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json(
      {
        error: 'ANTHROPIC_API_KEY is not configured. Add it to .dev.vars locally, or run: npx wrangler secret put ANTHROPIC_API_KEY'
      },
      { status: 501, headers: corsHeaders() }
    );
  }

  const body = await request.text();
  if (!body) {
    return Response.json({ error: 'Request body required' }, { status: 400, headers: corsHeaders() });
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

  const headers = corsHeaders();
  headers.set('content-type', upstream.headers.get('content-type') || 'application/json');
  return new Response(upstream.body, { status: upstream.status, headers });
}

function corsHeaders() {
  return new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type, anthropic-version'
  });
}
