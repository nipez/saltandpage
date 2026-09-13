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
 */
export function SyncBootstrap({ onCookbookHydrated }) {
  const { isLoaded, isSignedIn, getToken, userId } = useAuth();
  const [migration, setMigration] = useState(null); // { localCount } | null
  const [busy, setBusy] = useState(false);

  const hydrateFromCloud = useCallback(
    async (cookbook) => {
      await writeLocalCookbook(cookbook);
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

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      setSyncPusher(null);
      setMigration(null);
      return;
    }

    setSyncPusher(() => runPush);

    let cancelled = false;
    (async () => {
      try {
        const status = await fetchSyncStatus(getToken);
        if (cancelled) return;

        const local = await readLocalCookbook();
        const localHas = localCookbookHasData(local);

        if (status.hasCloudData) {
          const cookbook = await pullCookbook(getToken);
          if (cancelled) return;
          await hydrateFromCloud(cookbook);
          return;
        }

        if (!status.importedLocalAt && localHas) {
          setMigration({ localCount: local.recipes.length });
          return;
        }

        // Empty cloud, already decided import, or empty local — ensure user row via status already.
        if (localHas) {
          // Keep pushing local → cloud so new accounts without migration modal still sync.
          scheduleCloudPush();
        }
      } catch (err) {
        console.warn('sync bootstrap failed', err);
      }
    })();

    return () => {
      cancelled = true;
      setSyncPusher(null);
    };
  }, [isLoaded, isSignedIn, userId, getToken, hydrateFromCloud, runPush]);

  const onImport = async () => {
    setBusy(true);
    try {
      const local = await readLocalCookbook();
      const result = await importLocalCookbook(getToken, local);
      setMigration(null);
      await hydrateFromCloud(result);
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
      const cookbook = await pullCookbook(getToken);
      await hydrateFromCloud(cookbook);
    } catch (err) {
      console.error(err);
      alert(err.message || 'Could not skip import');
    } finally {
      setBusy(false);
    }
  };

  if (!migration) return null;

  return (
    <MigrationModal
      localCount={migration.localCount}
      busy={busy}
      onImport={onImport}
      onSkip={onSkip}
    />
  );
}

export function MigrationModal({ localCount, busy, onImport, onSkip }) {
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
      </div>
    </div>
  );
}
