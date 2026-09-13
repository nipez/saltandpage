/**
 * In-memory D1-ish mock + sync handler unit tests (no Cloudflare account needed).
 */
import assert from 'node:assert/strict';
import {
  DOC_KEYS,
  ensureUser,
  getSyncStatus,
  loadCookbook,
  saveCookbook
} from '../worker/sync.js';
import { buildAuthorizedParties } from '../worker/auth.js';

function makeDb() {
  const users = new Map();
  const recipes = new Map(); // key: userId::id
  const docs = new Map(); // key: userId::docKey

  const api = {
    prepare(sql) {
      const statement = {
        _sql: sql,
        _binds: [],
        bind(...args) {
          statement._binds = args;
          return statement;
        },
        async first() {
          return runFirst(sql, statement._binds);
        },
        async all() {
          return { results: runAll(sql, statement._binds) };
        },
        async run() {
          runMutate(sql, statement._binds);
          return { success: true };
        }
      };
      return statement;
    },
    async batch(statements) {
      for (const stmt of statements) {
        await stmt.run();
      }
    }
  };

  function runFirst(sql, binds) {
    if (sql.includes('FROM users')) {
      const userId = binds[0];
      const u = users.get(userId);
      return u || null;
    }
    if (sql.includes('COUNT(*)')) {
      const userId = binds[0];
      let cnt = 0;
      for (const [k, row] of recipes) {
        if (row.user_id === userId && row.deleted_at == null) cnt++;
      }
      return { cnt };
    }
    return null;
  }

  function runAll(sql, binds) {
    const userId = binds[0];
    if (sql.includes('FROM recipes')) {
      const out = [];
      for (const row of recipes.values()) {
        if (row.user_id !== userId) continue;
        if (sql.includes('deleted_at IS NULL') && row.deleted_at != null) continue;
        out.push({ ...row });
      }
      return out;
    }
    if (sql.includes('FROM user_docs')) {
      const out = [];
      for (const row of docs.values()) {
        if (row.user_id === userId) out.push({ ...row });
      }
      return out;
    }
    return [];
  }

  function runMutate(sql, binds) {
    if (sql.startsWith('INSERT INTO users')) {
      const [userId, created, updated] = binds;
      users.set(userId, {
        user_id: userId,
        created_at: created,
        updated_at: updated,
        imported_local_at: null
      });
      return;
    }
    if (sql.includes('INSERT INTO recipes')) {
      const [userId, id, payload, updatedAt] = binds;
      recipes.set(`${userId}::${id}`, {
        user_id: userId,
        id,
        payload,
        updated_at: updatedAt,
        deleted_at: null
      });
      return;
    }
    if (sql.includes('UPDATE recipes SET deleted_at')) {
      const [deletedAt, updatedAt, userId, id] = binds;
      const row = recipes.get(`${userId}::${id}`);
      if (row) {
        row.deleted_at = deletedAt;
        row.updated_at = updatedAt;
      }
      return;
    }
    if (sql.includes('INSERT INTO user_docs')) {
      const [userId, docKey, payload, updatedAt] = binds;
      docs.set(`${userId}::${docKey}`, {
        user_id: userId,
        doc_key: docKey,
        payload,
        updated_at: updatedAt
      });
      return;
    }
    if (sql.includes('UPDATE users SET imported_local_at')) {
      const [imported, updated, userId] = binds;
      const u = users.get(userId);
      if (u) {
        u.imported_local_at = imported;
        u.updated_at = updated;
      }
      return;
    }
    if (sql.includes('UPDATE users SET updated_at')) {
      const [updated, userId] = binds;
      const u = users.get(userId);
      if (u) u.updated_at = updated;
    }
  }

  return api;
}

{
  const db = makeDb();
  const user = await ensureUser(db, 'user_abc');
  assert.equal(user.user_id, 'user_abc');
  assert.equal(user.imported_local_at, null);
  const again = await ensureUser(db, 'user_abc');
  assert.equal(again.user_id, 'user_abc');
}

{
  const db = makeDb();
  const saved = await saveCookbook(
    db,
    'user_1',
    {
      recipes: [
        {
          id: 'r_1',
          title: 'Tomato soup',
          ingredients: ['1 onion'],
          instructions: ['Simmer'],
          created_at: 1,
          updated_at: 2,
          cook_log: [],
          collections: [],
          diet_tags: [],
          favorite: false
        }
      ],
      docs: {
        shopping_list_current: { recipes: [], items: [{ id: 'i1', name: 'onion' }], generated_at: null },
        meal_plan: { days: {} }
      }
    },
    { markImported: true, replaceRecipes: true }
  );
  assert.equal(saved.recipes.length, 1);
  assert.equal(saved.recipes[0].title, 'Tomato soup');
  assert.equal(saved.docs.shopping_list_current.items[0].name, 'onion');
  assert.ok(saved.meta.importedLocalAt);

  const status = await getSyncStatus(db, 'user_1');
  assert.equal(status.hasCloudData, true);
  assert.equal(status.recipeCount, 1);
  assert.ok(status.importedLocalAt);

  // Soft-delete via replaceRecipes
  await saveCookbook(db, 'user_1', { recipes: [], docs: {} }, { replaceRecipes: true });
  const after = await loadCookbook(db, 'user_1');
  assert.equal(after.recipes.length, 0);
}

{
  assert.ok(DOC_KEYS.includes('shopping_list_current'));
  assert.ok(DOC_KEYS.includes('subscription_plan'));
}

{
  const parties = buildAuthorizedParties(
    new Request('https://salt-and-page.nickperez.workers.dev/api/sync'),
    { ALLOWED_ORIGINS: 'https://saltandpage.example' }
  );
  assert.ok(parties.includes('https://salt-and-page.nickperez.workers.dev'));
  assert.ok(parties.includes('http://localhost:5173'));
  assert.ok(parties.includes('https://saltandpage.example'));
}

{
  const { isClerkConfigured } = await import('../worker/auth.js');
  assert.equal(
    isClerkConfigured({
      CLERK_SECRET_KEY: 'sk_test_REPLACE_ME',
      CLERK_PUBLISHABLE_KEY: 'pk_test_REPLACE_ME'
    }),
    false
  );
  assert.equal(
    isClerkConfigured({
      CLERK_SECRET_KEY: 'sk_test_realish',
      CLERK_PUBLISHABLE_KEY: 'pk_test_realish'
    }),
    true
  );
}

console.log('ok  scripts/test-sync.js');
