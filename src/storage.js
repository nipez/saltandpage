// window.storage shim — same contract as Claude.ai artifacts.
// list(prefix) → { keys: string[] }
// get(key)     → { key, value } | null
// set(key, value)
// delete(key)
//
// Backed by localStorage so the prototype stays local-first until D1/R2 land.

export function installStorage() {
  if (window.storage?.list && window.storage?.get && window.storage?.set) {
    return;
  }

  window.storage = {
    async list(prefix = '') {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) keys.push(key);
      }
      return { keys };
    },

    async get(key) {
      const value = localStorage.getItem(key);
      return value == null ? null : { key, value };
    },

    async set(key, value) {
      localStorage.setItem(key, String(value));
    },

    async delete(key) {
      localStorage.removeItem(key);
    }
  };
}
