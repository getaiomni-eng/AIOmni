// services/util/secureStore.ts
//
// Wraps expo-secure-store (iOS Keychain / Android Keystore) for storing
// authentication tokens that grant access to external accounts.
//
// Why this exists: AsyncStorage on iOS is sandboxed but unencrypted at
// rest beyond iOS's filesystem-level protection. Anything an attacker
// with a device backup could read in plaintext belongs in Keychain
// instead — specifically OAuth tokens, session cookies, and similar.
//
// Cached non-secret data (player DBs, prefs, sync timestamps) stays in
// AsyncStorage where it's faster and supports larger values.
//
// Lazy-load + defensive try/catch: if expo-secure-store native bindings
// fail to initialize, callers see null (treated as "not connected")
// instead of an app crash.
//
// 2026-05-26: build 162 crashed at boot on
// ObjCTurboModule::performVoidMethodInvocation → abort(). Root cause was
// a wrong-major npm install of expo-secure-store (56.x vs SDK-54's
// 15.x). Downgraded via `npx expo install`. Sentry breadcrumbs added
// below so the NEXT module-incompatibility crash captures which call
// site triggered it instead of dying opaque.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';

function crumb(category: string, message: string, level: Sentry.SeverityLevel = 'info', data?: any) {
  try {
    Sentry.addBreadcrumb({ category, message, level, data });
  } catch {}
}

// Native module is loaded lazily so a broken pod link can't crash the
// app on import. Pattern matches services/notifications.ts.
function getSecureStore(): any | null {
  try {
    return require('expo-secure-store');
  } catch (e: any) {
    crumb('secureStore', 'native module require() failed', 'error', { msg: e?.message });
    console.log('[secureStore] native module unavailable:', e?.message);
    return null;
  }
}

export async function setSecure(key: string, value: string): Promise<void> {
  const ss = getSecureStore();
  if (!ss) {
    try { await AsyncStorage.setItem(`_fallback_${key}`, value); } catch {}
    return;
  }
  crumb('secureStore', `setItemAsync(${key})`);
  try {
    await ss.setItemAsync(key, value, {
      keychainAccessible: ss.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (e: any) {
    crumb('secureStore', `setItemAsync(${key}) failed`, 'error', { msg: e?.message });
    console.log('[secureStore] set error:', key, e?.message);
  }
}

export async function getSecure(key: string): Promise<string | null> {
  const ss = getSecureStore();
  if (!ss) {
    try { return await AsyncStorage.getItem(`_fallback_${key}`); } catch { return null; }
  }
  crumb('secureStore', `getItemAsync(${key})`);
  try {
    return await ss.getItemAsync(key);
  } catch (e: any) {
    crumb('secureStore', `getItemAsync(${key}) failed`, 'error', { msg: e?.message });
    console.log('[secureStore] get error:', key, e?.message);
    return null;
  }
}

export async function deleteSecure(key: string): Promise<void> {
  const ss = getSecureStore();
  if (!ss) {
    try { await AsyncStorage.removeItem(`_fallback_${key}`); } catch {}
    return;
  }
  crumb('secureStore', `deleteItemAsync(${key})`);
  try {
    await ss.deleteItemAsync(key);
  } catch (e: any) {
    crumb('secureStore', `deleteItemAsync(${key}) failed`, 'error', { msg: e?.message });
    console.log('[secureStore] delete error:', key, e?.message);
  }
}

/**
 * One-time migration: if `key` exists in AsyncStorage but not in
 * secure store, copy it into secure store and remove the AsyncStorage
 * copy. Idempotent — safe to call on every app launch. Returns the
 * current value (either freshly migrated or already-secure).
 */
export async function migrateAsyncToSecure(key: string): Promise<string | null> {
  const secureVal = await getSecure(key);
  if (secureVal !== null) return secureVal;

  try {
    const asyncVal = await AsyncStorage.getItem(key);
    if (asyncVal !== null) {
      await setSecure(key, asyncVal);
      try { await AsyncStorage.removeItem(key); } catch {}
      return asyncVal;
    }
  } catch {}
  return null;
}
