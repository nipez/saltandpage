// Shared Anthropic client helpers for salt & page.
// Model id is centralized so a single bump unsticks URL/photo/social extract.

/** Worker proxy — API key stays on the server; mobile can extract URLs. */
export const ANTHROPIC_MESSAGES = '/api/ai';

/**
 * Current Sonnet used for all client AI calls (vision, JSON extract, web_search).
 * Verified live: claude-sonnet-4-20250514 → Anthropic 404 not_found_error;
 * claude-sonnet-4-5-20250929 → 200 with web_search_20250305.
 */
export const ANTHROPIC_MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Build a client-visible error from a failed /api/ai response.
 * Prefers Anthropic `{ error: { type, message } }` and Worker string `error`,
 * falling back to bare status.
 */
export function formatAiErrorMessage(status, payload) {
  const err = payload?.error;
  if (err && typeof err === 'object') {
    const type = typeof err.type === 'string' ? err.type.trim() : '';
    const message = typeof err.message === 'string' ? err.message.trim() : '';
    if (type && message) return `API error: ${status} (${type}: ${message})`;
    if (message) return `API error: ${status} (${message})`;
    if (type) return `API error: ${status} (${type})`;
  }
  if (typeof err === 'string' && err.trim()) {
    return `API error: ${status} (${err.trim()})`;
  }
  if (typeof payload?.message === 'string' && payload.message.trim()) {
    return `API error: ${status} (${payload.message.trim()})`;
  }
  return `API error: ${status}`;
}

/**
 * Read body (JSON when possible) and throw an Error with a useful message.
 * Consumes the response body — call only when !response.ok.
 */
export async function throwAiHttpError(response) {
  let payload = null;
  try {
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        const trimmed = text.trim().slice(0, 200);
        if (trimmed) {
          throw new Error(`API error: ${response.status} (${trimmed})`);
        }
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('API error:')) throw e;
  }
  throw new Error(formatAiErrorMessage(response.status, payload));
}

/** POST JSON to /api/ai; returns parsed JSON or throws a useful Error. */
export async function postAi(body) {
  const response = await fetch(ANTHROPIC_MESSAGES, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) await throwAiHttpError(response);
  return response.json();
}
