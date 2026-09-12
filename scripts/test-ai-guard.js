import assert from 'node:assert/strict';
import {
  LOCAL_DEV_ORIGINS,
  buildAllowedOrigins,
  clientRateLimitKey,
  corsHeaders,
  isOriginAllowed,
  parseAllowedOrigins,
  resolveClientOrigin
} from '../worker/ai-guard.js';

function req(headers = {}) {
  return new Request('https://salt-and-page.nickperez.workers.dev/api/ai', {
    method: 'POST',
    headers
  });
}

// --- parseAllowedOrigins ---
assert.deepEqual(parseAllowedOrigins(''), []);
assert.deepEqual(parseAllowedOrigins(undefined), []);
assert.deepEqual(parseAllowedOrigins(' https://a.example ,https://b.example '), [
  'https://a.example',
  'https://b.example'
]);

// --- buildAllowedOrigins ---
const allowed = buildAllowedOrigins('https://salt-and-page.nickperez.workers.dev/api/ai', {
  ALLOWED_ORIGINS: 'https://saltandpage.example'
});
assert.ok(allowed.has('https://salt-and-page.nickperez.workers.dev'));
assert.ok(allowed.has('https://saltandpage.example'));
for (const origin of LOCAL_DEV_ORIGINS) {
  assert.ok(allowed.has(origin), `missing local origin ${origin}`);
}

// --- resolveClientOrigin / isOriginAllowed ---
assert.equal(
  resolveClientOrigin(req({ Origin: 'https://salt-and-page.nickperez.workers.dev' })),
  'https://salt-and-page.nickperez.workers.dev'
);
assert.equal(
  resolveClientOrigin(req({ Referer: 'http://localhost:5173/recipes' })),
  'http://localhost:5173'
);
assert.equal(resolveClientOrigin(req({})), null);

assert.equal(isOriginAllowed('https://evil.example', allowed), false);
assert.equal(isOriginAllowed(null, allowed), false);
assert.equal(isOriginAllowed('https://salt-and-page.nickperez.workers.dev', allowed), true);
assert.equal(isOriginAllowed('http://localhost:5173', allowed), true);

// --- CORS: no wildcard ---
const headers = corsHeaders('https://salt-and-page.nickperez.workers.dev');
assert.equal(headers.get('access-control-allow-origin'), 'https://salt-and-page.nickperez.workers.dev');
assert.notEqual(headers.get('access-control-allow-origin'), '*');
assert.equal(headers.get('vary'), 'Origin');

// --- clientRateLimitKey stability ---
const keyA = await clientRateLimitKey(
  req({
    'CF-Connecting-IP': '203.0.113.10',
    'User-Agent': 'Mozilla/5.0 TestCookBook'
  })
);
const keyB = await clientRateLimitKey(
  req({
    'CF-Connecting-IP': '203.0.113.10',
    'User-Agent': 'Mozilla/5.0 TestCookBook'
  })
);
const keyC = await clientRateLimitKey(
  req({
    'CF-Connecting-IP': '203.0.113.11',
    'User-Agent': 'Mozilla/5.0 TestCookBook'
  })
);
assert.equal(keyA, keyB);
assert.notEqual(keyA, keyC);
assert.match(keyA, /^203\.0\.113\.10:[0-9a-f]{16}$/);

console.log('ok  scripts/test-ai-guard.js');
