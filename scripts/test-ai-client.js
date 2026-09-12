/**
 * Unit checks for src/ai.js error formatting (no network).
 */
import assert from 'node:assert/strict';
import { ANTHROPIC_MODEL, formatAiErrorMessage, throwAiHttpError } from '../src/ai.js';

assert.equal(ANTHROPIC_MODEL, 'claude-sonnet-4-5-20250929');
assert.doesNotMatch(ANTHROPIC_MODEL, /claude-sonnet-4-20250514/);

assert.equal(
  formatAiErrorMessage(404, {
    type: 'error',
    error: { type: 'not_found_error', message: 'model: claude-sonnet-4-20250514' }
  }),
  'API error: 404 (not_found_error: model: claude-sonnet-4-20250514)'
);

assert.equal(
  formatAiErrorMessage(403, { error: 'Forbidden origin', code: 'origin_not_allowed' }),
  'API error: 403 (Forbidden origin)'
);

assert.equal(
  formatAiErrorMessage(429, { error: 'Rate limit exceeded', code: 'rate_limited' }),
  'API error: 429 (Rate limit exceeded)'
);

assert.equal(formatAiErrorMessage(500, null), 'API error: 500');
assert.equal(formatAiErrorMessage(502, {}), 'API error: 502');

{
  const res = new Response(
    JSON.stringify({
      type: 'error',
      error: { type: 'not_found_error', message: 'model: stale-id' }
    }),
    { status: 404, headers: { 'content-type': 'application/json' } }
  );
  await assert.rejects(
    () => throwAiHttpError(res),
    (err) => {
      assert.equal(err.message, 'API error: 404 (not_found_error: model: stale-id)');
      return true;
    }
  );
}

console.log('ok  scripts/test-ai-client.js');
