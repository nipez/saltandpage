-- salt & page cloud sync schema (Clerk user_id scoped)
-- Recipes store the full client JSON payload (ingredients, cook_log, collections, favorite, …).
-- Other cookbook state mirrors existing localStorage keys in user_docs.

CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  -- Set when the one-time localStorage → D1 import completes (or user skips).
  imported_local_at INTEGER
);

CREATE TABLE recipes (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX idx_recipes_user_updated ON recipes (user_id, updated_at);

-- doc_key values match client storage keys:
-- shopping_list_current | meal_plan | pantry_current | user_subs | prefs | onboarded_v1 | subscription_plan
CREATE TABLE user_docs (
  user_id TEXT NOT NULL,
  doc_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, doc_key)
);
