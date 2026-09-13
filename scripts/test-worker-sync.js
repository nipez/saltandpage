/**
 * Worker routing checks for sync + config endpoints (mocked auth + D1).
 */
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { setTestAuthenticate } from '../worker/auth.js';

function makeKv() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, String(value));
    }
  };
}

/** Minimal D1 mock matching worker/sync.js SQL usage. */
function makeDb() {
  const users = new Map();
  const recipes = new Map();
  const docs = new Map();

  return {
    prepare(sql) {
      const statement = {
        _binds: [],
        bind(...args) {
          statement._binds = args;
          return statement;
        },
        async first() {
          if (sql.includes('FROM users')) {
            return users.get(statement._binds[0]) || null;
          }
          if (sql.includes('FROM user_docs') && sql.includes('COUNT(*)')) {
            const userId = statement._binds[0];
            let cnt = 0;
            for (const row of docs.values()) {
              if (row.user_id === userId) cnt++;
            }
            return { cnt };
          }
          if (sql.includes('COUNT(*)')) {
            const userId = statement._binds[0];
            let cnt = 0;
            for (const row of recipes.values()) {
              if (row.user_id === userId && row.deleted_at == null) cnt++;
            }
            return { cnt };
          }
          return null;
        },
        async all() {
          const userId = statement._binds[0];
          if (sql.includes('FROM recipes')) {
            return {
              results: [...recipes.values()].filter(
                (r) =>
                  r.user_id === userId &&
                  !(sql.includes('deleted_at IS NULL') && r.deleted_at != null)
              )
            };
          }
          if (sql.includes('FROM user_docs')) {
            return {
              results: [...docs.values()].filter((r) => r.user_id === userId)
            };
          }
          return { results: [] };
        },
        async run() {
          const binds = statement._binds;
          if (sql.startsWith('INSERT INTO users') || sql.includes('INSERT OR IGNORE INTO users')) {
            if (!users.has(binds[0])) {
              users.set(binds[0], {
                user_id: binds[0],
                created_at: binds[1],
                updated_at: binds[2],
                imported_local_at: null
              });
            }
          } else if (sql.includes('INSERT INTO recipes')) {
            recipes.set(`${binds[0]}::${binds[1]}`, {
              user_id: binds[0],
              id: binds[1],
              payload: binds[2],
              updated_at: binds[3],
              deleted_at: null
            });
          } else if (sql.includes('UPDATE recipes SET deleted_at')) {
            const row = recipes.get(`${binds[2]}::${binds[3]}`);
            if (row) {
              row.deleted_at = binds[0];
              row.updated_at = binds[1];
            }
          } else if (sql.includes('INSERT INTO user_docs')) {
            docs.set(`${binds[0]}::${binds[1]}`, {
              user_id: binds[0],
              doc_key: binds[1],
              payload: binds[2],
              updated_at: binds[3]
            });
          } else if (sql.includes('UPDATE users SET imported_local_at')) {
            const u = users.get(binds[2]);
            if (u) {
              u.imported_local_at = binds[0];
              u.updated_at = binds[1];
            }
          } else if (sql.includes('UPDATE users SET updated_at')) {
            const u = users.get(binds[1]);
            if (u) u.updated_at = binds[0];
          }
          return { success: true };
        }
      };
      return statement;
    },
    async batch(stmts) {
      for (const s of stmts) await s.run();
    }
  };
}

function makeEnv(overrides = {}) {
  return {
    ANTHROPIC_API_KEY: '',
    ALLOWED_ORIGINS: '',
    AI_RATE_LIMIT: '20',
    AI_RATE_LIMIT_PERIOD: '60',
    AI_RATE_LIMIT_KV: makeKv(),
    CLERK_SECRET_KEY: 'sk_test_fake',
    CLERK_PUBLISHABLE_KEY: 'pk_test_fake',
    DB: makeDb(),
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

setTestAuthenticate(async (request, env, corsHeaders) => {
  const headers = corsHeaders ? new Headers(corsHeaders) : new Headers();
  if (!env.CLERK_SECRET_KEY || !env.CLERK_PUBLISHABLE_KEY) {
    return {
      error: Response.json(
        { error: 'Clerk is not configured', code: 'clerk_not_configured' },
        { status: 501, headers }
      )
    };
  }
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token !== 'good-token') {
    return {
      error: Response.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401, headers })
    };
  }
  return { userId: 'user_test_1' };
});

try {
  // Public config
  {
    const res = await call('/api/config');
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.clerkPublishableKey, 'pk_test_fake');
  }

  // Health reports clerk + d1
  {
    const res = await call('/api/health');
    const json = await res.json();
    assert.equal(json.clerkConfigured, true);
    assert.equal(json.d1Configured, true);
  }

  // Sync without auth → 401
  {
    const res = await call('/api/sync/status', {
      headers: { Origin: 'https://salt-and-page.nickperez.workers.dev' }
    });
    assert.equal(res.status, 401);
  }

  // Sync with bearer token
  {
    const env = makeEnv();
    const res = await call('/api/sync/status', {
      headers: {
        Origin: 'https://salt-and-page.nickperez.workers.dev',
        Authorization: 'Bearer good-token'
      },
      env
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.userId, 'user_test_1');
    assert.equal(json.hasCloudData, false);
  }

  // Import local recipes
  {
    const env = makeEnv();
    const res = await call('/api/sync/import', {
      method: 'POST',
      headers: {
        Origin: 'https://salt-and-page.nickperez.workers.dev',
        Authorization: 'Bearer good-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        recipes: [
          {
            id: 'r_import',
            title: 'Imported',
            ingredients: [],
            instructions: [],
            created_at: 1,
            updated_at: 1,
            cook_log: [],
            collections: [],
            diet_tags: [],
            favorite: false
          }
        ],
        docs: { prefs: { showIngredientInfo: true } }
      }),
      env
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.imported, true);
    assert.equal(json.recipes.length, 1);

    const pull = await call('/api/sync', {
      headers: {
        Origin: 'https://salt-and-page.nickperez.workers.dev',
        Authorization: 'Bearer good-token'
      },
      env
    });
    const cookbook = await pull.json();
    assert.equal(cookbook.recipes[0].title, 'Imported');
    assert.equal(cookbook.docs.prefs.showIngredientInfo, true);

    // Second import is rejected
    const again = await call('/api/sync/import', {
      method: 'POST',
      headers: {
        Origin: 'https://salt-and-page.nickperez.workers.dev',
        Authorization: 'Bearer good-token',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ skip: true }),
      env
    });
    assert.equal(again.status, 409);
    const againJson = await again.json();
    assert.equal(againJson.code, 'import_already_done');
  }

  // Missing Clerk secrets → 501
  {
    const res = await call('/api/sync', {
      headers: {
        Origin: 'https://salt-and-page.nickperez.workers.dev',
        Authorization: 'Bearer good-token'
      },
      env: makeEnv({ CLERK_SECRET_KEY: '', CLERK_PUBLISHABLE_KEY: '' })
    });
    assert.equal(res.status, 501);
    const json = await res.json();
    assert.equal(json.code, 'clerk_not_configured');
  }

  console.log('ok  scripts/test-worker-sync.js');
} finally {
  setTestAuthenticate(null);
}
