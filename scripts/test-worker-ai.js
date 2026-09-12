/**
 * Integration checks for worker/index.js with a fake KV rate-limit binding.
 * Does not call Anthropic — covers health, origin gate, CORS, and 429 paths.
 */
import assert from 'node:assert/strict';
import worker from '../worker/index.js';

function makeKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    },
    _store: store
  };
}

function makeEnv(overrides = {}) {
  return {
    ANTHROPIC_API_KEY: '',
    ALLOWED_ORIGINS: '',
    AI_RATE_LIMIT: '20',
    AI_RATE_LIMIT_PERIOD: '60',
    AI_RATE_LIMIT_KV: makeKv(),
    ...overrides
  };
}

async function call(path, { method = 'GET', headers = {}, body, env } = {}) {
  const request = new Request(`https://salt-and-page.nickperez.workers.dev${path}`, {
    method,
    headers,
    body
  });
  return worker.fetch(request, env ?? makeEnv());
}

// /api/health stays public
{
  const res = await call('/api/health');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
  assert.equal(json.aiConfigured, false);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
}

// Missing origin → 403
{
  const res = await call('/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.code, 'origin_not_allowed');
}

// Evil origin → 403
{
  const res = await call('/api/ai', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'content-type': 'application/json' },
    body: '{}'
  });
  assert.equal(res.status, 403);
}

// OPTIONS preflight
{
  const res = await call('/api/ai', {
    method: 'OPTIONS',
    headers: { Origin: 'https://salt-and-page.nickperez.workers.dev' }
  });
  assert.equal(res.status, 204);
  assert.equal(
    res.headers.get('access-control-allow-origin'),
    'https://salt-and-page.nickperez.workers.dev'
  );
  assert.notEqual(res.headers.get('access-control-allow-origin'), '*');
}

// Localhost allowed → 501 past gates
{
  const res = await call('/api/ai', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5173',
      'content-type': 'application/json',
      'CF-Connecting-IP': '127.0.0.1',
      'User-Agent': 'vitest-local'
    },
    body: '{"model":"x"}'
  });
  assert.equal(res.status, 501);
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
}

// Custom domain via ALLOWED_ORIGINS
{
  const env = makeEnv({ ALLOWED_ORIGINS: 'https://saltandpage.example' });
  const res = await call('/api/ai', {
    method: 'OPTIONS',
    headers: { Origin: 'https://saltandpage.example' },
    env
  });
  assert.equal(res.status, 204);
}

// KV burst → 429
{
  const env = makeEnv({ AI_RATE_LIMIT: '3' });
  const headers = {
    Origin: 'https://salt-and-page.nickperez.workers.dev',
    'content-type': 'application/json',
    'CF-Connecting-IP': '198.51.100.4',
    'User-Agent': 'burst-bot'
  };
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const res = await call('/api/ai', { method: 'POST', headers, body: '{}', env });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 3), [501, 501, 501]);
  assert.equal(statuses[3], 429);
  assert.equal(statuses[4], 429);
}

// Missing KV → 503 fail-closed
{
  const env = makeEnv({ AI_RATE_LIMIT_KV: undefined });
  const res = await call('/api/ai', {
    method: 'POST',
    headers: {
      Origin: 'https://salt-and-page.nickperez.workers.dev',
      'content-type': 'application/json'
    },
    body: '{}',
    env
  });
  assert.equal(res.status, 503);
}

// Optional Rate Limiting binding honored
{
  const calls = [];
  const env = makeEnv({
    AI_RATE_LIMITER: {
      async limit({ key }) {
        calls.push(key);
        return { success: calls.length <= 1 };
      }
    }
  });
  const headers = {
    Origin: 'https://salt-and-page.nickperez.workers.dev',
    'content-type': 'application/json',
    'CF-Connecting-IP': '198.51.100.5',
    'User-Agent': 'binding-bot'
  };
  assert.equal((await call('/api/ai', { method: 'POST', headers, body: '{}', env })).status, 501);
  assert.equal((await call('/api/ai', { method: 'POST', headers, body: '{}', env })).status, 429);
}

console.log('ok  scripts/test-worker-ai.js');
