import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { setSyncPusher, scheduleCloudPush } from './sync-bridge.js';
import {
  fetchSyncStatus,
  importLocalCookbook,
  localCookbookHasData,
  pullCookbook,
  pushCookbook,
  readLocalCookbook,
  skipLocalImport,
  writeLocalCookbook
} from './sync-api.js';

/**
 * When signed in: pull cloud state, offer one-time local import, register push hook.
 * Signed-out users keep local-first behavior untouched.
 *
 * Pusher stays disarmed until bootstrap finishes (or the user resolves the import modal)
 * so we never silently upload mid-decision.
 */
export function SyncBootstrap({ onCookbookHydrated }) {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const [migration, setMigration] = useState(null); // { mode, localCount, cloudCount? }
  const [busy, setBusy] = useState(false);

  const hydrateFromCloud = useCallback(
    async (cookbook) => {
      await writeLocalCookbook(cookbook, { clearMissingDocs: true });
      onCookbookHydrated?.(cookbook);
    },
    [onCookbookHydrated]
  );

  const runPush = useCallback(async () => {
    if (!isSignedIn) return;
    const local = await readLocalCookbook();
    await pushCookbook(getToken, {
      recipes: local.recipes,
      docs: local.docs,
      replaceRecipes: true
    });
  }, [getToken, isSignedIn]);

  const armPusher = useCallback(() => {
    setSyncPusher(() => runPush);
  }, [runPush]);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setSyncPusher(null);
      setMigration(null);
      return;
    }

    // Stay disarmed until bootstrap (or modal) decides.
    setSyncPusher(null);

    let cancelled = false;
    (async () => {
      try {
        const status = await fetchSyncStatus(getToken);
        if (cancelled) return;

        const local = await readLocalCookbook();
        const localHas = localCookbookHasData(local);

        if (status.hasCloudData) {
          if (localHas) {
            // Account already has cloud data and this device has local cookbook
            // state — ask before replacing the device cache.
            setMigration({
              mode: 'conflict',
              localCount: local.recipes.length,
              cloudCount: status.recipeCount
            });
            return;
          }
          const cookbook = await pullCookbook(getToken);
          if (cancelled) return;
          await hydrateFromCloud(cookbook);
          if (cancelled) return;
          armPusher();
          return;
        }

        if (!status.importedLocalAt && localHas) {
          setMigration({
            mode: 'import',
            localCount: local.recipes.length
          });
          return;
        }

        // Empty cloud: either already decided, or nothing local.
        if (localHas) {
          armPusher();
          scheduleCloudPush();
        } else {
          armPusher();
        }
      } catch (err) {
        console.warn('sync bootstrap failed', err);
        // Still allow later saves to attempt sync.
        if (!cancelled) armPusher();
      }
    })();

    return () => {
      cancelled = true;
      setSyncPusher(null);
    };
  }, [isLoaded, isSignedIn, userId, getToken, hydrateFromCloud, armPusher]);

  const onImport = async () => {
    setBusy(true);
    try {
      const local = await readLocalCookbook();
      const result = await importLocalCookbook(getToken, local);
      setMigration(null);
      await hydrateFromCloud(result);
      armPusher();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  const onSkip = async () => {
    setBusy(true);
    try {
      await skipLocalImport(getToken);
      setMigration(null);
      // Keep local data intact — do not hydrate an empty cloud snapshot over it.
      armPusher();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Could not skip import');
    } finally {
      setBusy(false);
    }
  };

  const onUseCloud = async () => {
    setBusy(true);
    try {
      const cookbook = await pullCookbook(getToken);
      await hydrateFromCloud(cookbook);
      // Mark import decision done so we don't re-prompt on empty-local edge cases.
      try {
        await skipLocalImport(getToken);
      } catch (err) {
        // Already imported is fine.
        if (err?.code !== 'import_already_done') throw err;
      }
      setMigration(null);
      armPusher();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Could not load cloud cookbook');
    } finally {
      setBusy(false);
    }
  };

  const onKeepLocalUpload = async () => {
    setBusy(true);
    try {
      const local = await readLocalCookbook();
      // Prefer import endpoint (marks imported). If already imported, fall back to PUT.
      let result;
      try {
        result = await importLocalCookbook(getToken, local);
      } catch (err) {
        if (err?.code === 'import_already_done') {
          result = await pushCookbook(getToken, {
            recipes: local.recipes,
            docs: local.docs,
            replaceRecipes: true
          });
        } else {
          throw err;
        }
      }
      setMigration(null);
      await hydrateFromCloud(result);
      armPusher();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  if (!migration) return null;

  return (
    <MigrationModal
      mode={migration.mode}
      localCount={migration.localCount}
      cloudCount={migration.cloudCount}
      busy={busy}
      onImport={onImport}
      onSkip={onSkip}
      onUseCloud={onUseCloud}
      onKeepLocalUpload={onKeepLocalUpload}
    />
  );
}

export function MigrationModal({
  mode = 'import',
  localCount,
  cloudCount,
  busy,
  onImport,
  onSkip,
  onUseCloud,
  onKeepLocalUpload
}) {
  const isConflict = mode === 'conflict';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="migration-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(31, 24, 16, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24
      }}
    >
      <div
        style={{
          background: 'var(--paper, #f4ede0)',
          border: '1px solid var(--line, #d8cdb8)',
          maxWidth: 420,
          width: '100%',
          padding: '36px 32px',
          color: 'var(--ink, #1f1810)'
        }}
      >
        <div className="label mb-3" style={{ color: 'var(--tomato, #b34a2c)' }}>
          Cloud sync
        </div>
        {isConflict ? (
          <>
            <h2 id="migration-title" className="display text-3xl mb-3" style={{ fontWeight: 400 }}>
              This account already has a cookbook
            </h2>
            <p className="text-sm mb-8" style={{ color: 'var(--ink-soft, #5a4d3f)', lineHeight: 1.55 }}>
              Cloud has {cloudCount} recipe{cloudCount === 1 ? '' : 's'}; this device has {localCount}.
              Choose which copy to keep on this device — we won&apos;t silently wipe either side.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" className="btn-primary" onClick={onUseCloud} disabled={busy}>
                {busy ? 'Working…' : 'Use cloud on this device'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={onKeepLocalUpload}
                disabled={busy}
                style={{ border: '1px solid var(--line)', padding: '10px 16px' }}
              >
                Keep this device &amp; upload
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 id="migration-title" className="display text-3xl mb-3" style={{ fontWeight: 400 }}>
              Bring this device with you?
            </h2>
            <p className="text-sm mb-8" style={{ color: 'var(--ink-soft, #5a4d3f)', lineHeight: 1.55 }}>
              You have {localCount} recipe{localCount === 1 ? '' : 's'} saved on this device.
              Import them into your account once — we won&apos;t wipe local data either way.
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" className="btn-primary" onClick={onImport} disabled={busy}>
                {busy ? 'Working…' : 'Import to cloud'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={onSkip}
                disabled={busy}
                style={{ border: '1px solid var(--line)', padding: '10px 16px' }}
              >
                Skip for now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
