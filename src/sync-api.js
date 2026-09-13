// Client helpers for /api/sync (Clerk Bearer JWT).

const DOC_KEYS = [
  'shopping_list_current',
  'meal_plan',
  'pantry_current',
  'user_subs',
  'prefs',
  'onboarded_v1',
  'subscription_plan'
];

export { DOC_KEYS };

async function authHeaders(getToken) {
  const token = typeof getToken === 'function' ? await getToken() : null;
  if (!token) {
    const err = new Error('Not signed in');
    err.code = 'unauthorized';
    throw err;
  }
  return {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json'
  };
}

async function parseResponse(res) {
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = new Error(json?.error || `Sync request failed (${res.status})`);
    err.code = json?.code || 'sync_http_error';
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export async function fetchSyncStatus(getToken) {
  const headers = await authHeaders(getToken);
  const res = await fetch('/api/sync/status', { headers });
  return parseResponse(res);
}

export async function pullCookbook(getToken) {
  const headers = await authHeaders(getToken);
  const res = await fetch('/api/sync', { headers });
  return parseResponse(res);
}

export async function pushCookbook(getToken, payload) {
  const headers = await authHeaders(getToken);
  const res = await fetch('/api/sync', {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload)
  });
  return parseResponse(res);
}

export async function importLocalCookbook(getToken, payload) {
  const headers = await authHeaders(getToken);
  const res = await fetch('/api/sync/import', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  return parseResponse(res);
}

export async function skipLocalImport(getToken) {
  const headers = await authHeaders(getToken);
  const res = await fetch('/api/sync/import', {
    method: 'POST',
    headers,
    body: JSON.stringify({ skip: true })
  });
  return parseResponse(res);
}

/** Read current localStorage cookbook into a sync payload. */
export async function readLocalCookbook() {
  const recipes = [];
  const { keys } = await window.storage.list('recipe:');
  for (const key of keys || []) {
    try {
      const row = await window.storage.get(key);
      if (row?.value) recipes.push(JSON.parse(row.value));
    } catch {
      /* skip */
    }
  }

  const docs = {};
  for (const docKey of DOC_KEYS) {
    try {
      const row = await window.storage.get(docKey);
      if (row?.value != null) docs[docKey] = JSON.parse(row.value);
    } catch {
      /* skip */
    }
  }

  return { recipes, docs };
}

/** Write a cloud cookbook snapshot into localStorage (cache). */
export async function writeLocalCookbook({ recipes = [], docs = {} } = {}) {
  const { keys } = await window.storage.list('recipe:');
  for (const key of keys || []) {
    await window.storage.delete(key);
  }
  for (const recipe of recipes) {
    if (!recipe?.id) continue;
    await window.storage.set(`recipe:${recipe.id}`, JSON.stringify(recipe));
  }
  for (const docKey of DOC_KEYS) {
    if (!(docKey in docs)) continue;
    await window.storage.set(docKey, JSON.stringify(docs[docKey]));
  }
}

export function localCookbookHasData(payload) {
  if (!payload) return false;
  if ((payload.recipes || []).length > 0) return true;
  const docs = payload.docs || {};
  if ((docs.shopping_list_current?.items || []).length > 0) return true;
  if ((docs.shopping_list_current?.recipes || []).length > 0) return true;
  if (Object.keys(docs.meal_plan?.days || {}).length > 0) return true;
  if ((docs.pantry_current?.items || []).length > 0) return true;
  if ((docs.user_subs?.items || []).length > 0) return true;
  return false;
}
