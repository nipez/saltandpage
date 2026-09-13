// Bridge between App.jsx local storage writes and cloud sync.
// SyncBootstrap registers a pusher when the user is signed in.

let pusher = null;
let pushTimer = null;
const DEBOUNCE_MS = 600;

export function setSyncPusher(fn) {
  pusher = typeof fn === 'function' ? fn : null;
  if (!pusher && pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
}

export function getSyncPusher() {
  return pusher;
}

/** Debounced full-state push after local writes. */
export function scheduleCloudPush() {
  if (!pusher) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    Promise.resolve()
      .then(() => pusher())
      .catch((err) => console.warn('cloud sync push failed', err));
  }, DEBOUNCE_MS);
}

export function flushCloudPush() {
  if (!pusher) return Promise.resolve();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  return Promise.resolve().then(() => pusher());
}
