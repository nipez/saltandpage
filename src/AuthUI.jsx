import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  SignInButton,
  SignUpButton,
  UserButton,
  useAuth,
  useUser
} from '@clerk/clerk-react';
import { SyncBootstrap, MigrationModal } from './SyncBootstrap.jsx';

const ClerkConfigContext = createContext({ enabled: false, loaded: false });

export function useClerkConfig() {
  return useContext(ClerkConfigContext);
}

function isUsablePublishableKey(key) {
  return Boolean(key && typeof key === 'string' && key.startsWith('pk_') && !key.includes('REPLACE_ME'));
}

/**
 * Resolve Clerk publishable key from Vite env or /api/config.
 * Returns null when Clerk is not configured — app stays local-first.
 */
function useClerkPublishableKey() {
  const viteKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
  const [key, setKey] = useState(() => (isUsablePublishableKey(viteKey) ? viteKey : null));
  const [loaded, setLoaded] = useState(() => isUsablePublishableKey(viteKey));

  useEffect(() => {
    if (isUsablePublishableKey(viteKey)) {
      setKey(viteKey);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error('config fetch failed');
        const json = await res.json();
        if (!cancelled) {
          setKey(isUsablePublishableKey(json.clerkPublishableKey) ? json.clerkPublishableKey : null);
        }
      } catch {
        if (!cancelled) setKey(null);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [viteKey]);

  return { key, loaded };
}

export function AppWithAuth({ children }) {
  const { key, loaded } = useClerkPublishableKey();

  if (!loaded) {
    return (
      <ClerkConfigContext.Provider value={{ enabled: false, loaded: false }}>
        {children}
      </ClerkConfigContext.Provider>
    );
  }

  if (!key) {
    return (
      <ClerkConfigContext.Provider value={{ enabled: false, loaded: true }}>
        {children}
      </ClerkConfigContext.Provider>
    );
  }

  return (
    <ClerkProvider
      publishableKey={key}
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: '#b34a2c',
          colorText: '#1f1810',
          colorTextSecondary: '#5a4d3f',
          colorBackground: '#f4ede0',
          colorInputBackground: '#ebe1cf',
          colorInputText: '#1f1810',
          borderRadius: '2px',
          fontFamily: '"DM Sans", system-ui, sans-serif'
        },
        elements: {
          card: {
            boxShadow: 'none',
            border: '1px solid #d8cdb8',
            background: '#f4ede0'
          },
          headerTitle: {
            fontFamily: 'Fraunces, Georgia, serif',
            fontWeight: '400'
          },
          formButtonPrimary: {
            background: '#1f1810',
            color: '#f4ede0',
            boxShadow: 'none',
            textTransform: 'none',
            fontSize: '14px'
          },
          footerActionLink: {
            color: '#b34a2c'
          }
        }
      }}
    >
      <ClerkConfigContext.Provider value={{ enabled: true, loaded: true }}>
        <SyncBootstrap
          onCookbookHydrated={() => {
            window.dispatchEvent(new CustomEvent('saltandpage:cookbook-hydrated'));
          }}
        />
        {children}
      </ClerkConfigContext.Provider>
    </ClerkProvider>
  );
}

/** Compact Sign in control for TopNav — quiet paper/ink styling. */
export function NavAuthControls() {
  const { enabled, loaded } = useClerkConfig();
  if (!loaded || !enabled) return null;
  return <NavAuthInner />;
}

function NavAuthInner() {
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button
            type="button"
            className="nav-link"
            style={{
              padding: '6px 12px',
              fontSize: 12,
              letterSpacing: '0.04em',
              border: '1px solid var(--line)',
              background: 'transparent',
              color: 'var(--ink)',
              cursor: 'pointer',
              fontFamily: 'inherit',
              borderRadius: 2
            }}
          >
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton
          afterSignOutUrl="/"
          appearance={{
            elements: {
              avatarBox: {
                width: 28,
                height: 28,
                borderRadius: 2
              }
            }
          }}
        />
      </SignedIn>
    </>
  );
}

/** Settings account block — sign in / identity / sync status. */
export function SettingsAuthSection() {
  const { enabled, loaded } = useClerkConfig();
  if (!loaded) return null;

  if (!enabled) {
    return (
      <section className="mb-12" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 32 }}>
        <h2 className="display text-2xl mb-2">Cloud sync</h2>
        <p className="text-sm" style={{ color: 'var(--ink-soft)', maxWidth: 420 }}>
          Sign-in is not configured yet. Add Clerk keys (see README) to sync recipes across devices.
          Until then, everything stays on this device.
        </p>
      </section>
    );
  }

  return <SettingsAuthInner />;
}

function SettingsAuthInner() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();

  return (
    <section className="mb-12" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 32 }}>
      <h2 className="display text-2xl mb-2">Account</h2>
      <SignedOut>
        <p className="text-sm mb-5" style={{ color: 'var(--ink-soft)', maxWidth: 440 }}>
          Your cookbook stays on this device until you sign in. Sign in to sync recipes, shopping,
          meal plan, pantry, and journal to the cloud.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <SignInButton mode="modal">
            <button type="button" className="btn-primary">
              Sign in
            </button>
          </SignInButton>
          <SignUpButton mode="modal">
            <button
              type="button"
              className="btn-ghost"
              style={{ border: '1px solid var(--line)', padding: '10px 16px' }}
            >
              Create account
            </button>
          </SignUpButton>
        </div>
      </SignedOut>
      <SignedIn>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm mb-1" style={{ color: 'var(--ink)' }}>
              {user?.primaryEmailAddress?.emailAddress || user?.fullName || 'Signed in'}
            </p>
            <p className="text-sm" style={{ color: 'var(--ink-faint)' }}>
              {isSignedIn
                ? 'Cloud sync on · changes save to this account'
                : 'Cloud sync ready'}
            </p>
          </div>
          <UserButton afterSignOutUrl="/" />
        </div>
      </SignedIn>
    </section>
  );
}

export { MigrationModal };
