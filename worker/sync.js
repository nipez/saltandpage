// D1 cloud sync for salt & page cookbook state.
// All mutations are scoped to the verified Clerk user_id.

export const DOC_KEYS = Object.freeze([
  'shopping_list_current',
  'meal_plan',
  'pantry_current',
  'user_subs',
  'prefs',
  'onboarded_v1',
  'subscription_plan'
]);

export function syncCorsHeaders(origin) {
  const headers = new Headers({
    'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization',
    vary: 'Origin'
  });
  if (origin) {
    headers.set('access-control-allow-origin', origin);
  }
  return headers;
}

export async function ensureUser(db, userId) {
  const now = Date.now();
  const existing = await db
    .prepare('SELECT user_id, imported_local_at, created_at, updated_at FROM users WHERE user_id = ?')
    .bind(userId)
    .first();

  if (existing) return existing;

  await db
    .prepare(
      'INSERT OR IGNORE INTO users (user_id, created_at, updated_at, imported_local_at) VALUES (?, ?, ?, NULL)'
    )
    .bind(userId, now, now)
    .run();

  const created = await db
    .prepare('SELECT user_id, imported_local_at, created_at, updated_at FROM users WHERE user_id = ?')
    .bind(userId)
    .first();

  return (
    created || { user_id: userId, imported_local_at: null, created_at: now, updated_at: now }
  );
}

export async function loadCookbook(db, userId) {
  const recipeRows = await db
    .prepare(
      'SELECT id, payload, updated_at, deleted_at FROM recipes WHERE user_id = ? AND deleted_at IS NULL'
    )
    .bind(userId)
    .all();

  const recipes = [];
  for (const row of recipeRows?.results || []) {
    try {
      recipes.push(JSON.parse(row.payload));
    } catch {
      /* skip corrupt */
    }
  }
  recipes.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

  const docRows = await db
    .prepare('SELECT doc_key, payload, updated_at FROM user_docs WHERE user_id = ?')
    .bind(userId)
    .all();

  const docs = {};
  for (const row of docRows?.results || []) {
    try {
      docs[row.doc_key] = JSON.parse(row.payload);
    } catch {
      docs[row.doc_key] = row.payload;
    }
  }

  const user = await ensureUser(db, userId);

  return {
    recipes,
    docs,
    meta: {
      userId,
      importedLocalAt: user.imported_local_at ?? null,
      recipeCount: recipes.length,
      updatedAt: Math.max(
        user.updated_at || 0,
        ...(recipeRows?.results || []).map((r) => r.updated_at || 0),
        ...(docRows?.results || []).map((r) => r.updated_at || 0)
      )
    }
  };
}

/**
 * Upsert recipes + docs. Soft-deletes recipe ids listed in deletedRecipeIds.
 * When replaceRecipes is true, soft-deletes any cloud recipe not in the payload.
 */
export async function saveCookbook(db, userId, body, { markImported = false, replaceRecipes = false } = {}) {
  const now = Date.now();
  await ensureUser(db, userId);

  const recipes = Array.isArray(body?.recipes) ? body.recipes : [];
  const docs = body?.docs && typeof body.docs === 'object' ? body.docs : {};
  const deletedRecipeIds = Array.isArray(body?.deletedRecipeIds) ? body.deletedRecipeIds : [];

  const statements = [];

  for (const recipe of recipes) {
    if (!recipe?.id) continue;
    const updatedAt = Number(recipe.updated_at) || now;
    statements.push(
      db
        .prepare(
          `INSERT INTO recipes (user_id, id, payload, updated_at, deleted_at)
           VALUES (?, ?, ?, ?, NULL)
           ON CONFLICT(user_id, id) DO UPDATE SET
             payload = excluded.payload,
             updated_at = excluded.updated_at,
             deleted_at = NULL`
        )
        .bind(userId, recipe.id, JSON.stringify(recipe), updatedAt)
    );
  }

  for (const id of deletedRecipeIds) {
    if (!id) continue;
    statements.push(
      db
        .prepare(
          `UPDATE recipes SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ?`
        )
        .bind(now, now, userId, id)
    );
  }

  if (replaceRecipes) {
    const keepIds = new Set(recipes.map((r) => r?.id).filter(Boolean));
    const existing = await db
      .prepare('SELECT id FROM recipes WHERE user_id = ? AND deleted_at IS NULL')
      .bind(userId)
      .all();
    for (const row of existing?.results || []) {
      if (!keepIds.has(row.id)) {
        statements.push(
          db
            .prepare(
              `UPDATE recipes SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ?`
            )
            .bind(now, now, userId, row.id)
        );
      }
    }
  }

  for (const key of DOC_KEYS) {
    if (!(key in docs)) continue;
    statements.push(
      db
        .prepare(
          `INSERT INTO user_docs (user_id, doc_key, payload, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, doc_key) DO UPDATE SET
             payload = excluded.payload,
             updated_at = excluded.updated_at`
        )
        .bind(userId, key, JSON.stringify(docs[key]), now)
    );
  }

  if (markImported) {
    statements.push(
      db
        .prepare(
          `UPDATE users SET imported_local_at = ?, updated_at = ? WHERE user_id = ?`
        )
        .bind(now, now, userId)
    );
  } else {
    statements.push(
      db.prepare(`UPDATE users SET updated_at = ? WHERE user_id = ?`).bind(now, userId)
    );
  }

  if (statements.length) {
    await db.batch(statements);
  }

  return loadCookbook(db, userId);
}

export async function getSyncStatus(db, userId) {
  const user = await ensureUser(db, userId);
  const recipeRow = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM recipes WHERE user_id = ? AND deleted_at IS NULL`
    )
    .bind(userId)
    .first();
  const docRow = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM user_docs WHERE user_id = ?`)
    .bind(userId)
    .first();
  const recipeCount = Number(recipeRow?.cnt) || 0;
  const docCount = Number(docRow?.cnt) || 0;
  return {
    userId,
    importedLocalAt: user.imported_local_at ?? null,
    hasCloudData: recipeCount > 0 || docCount > 0,
    recipeCount,
    docCount
  };
}
