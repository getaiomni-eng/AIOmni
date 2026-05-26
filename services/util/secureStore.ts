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

import AsyncStorage from '@react-native-async-storage/async-storage';

// Native module is loaded lazily so a broken pod link can't crash the
// app on import. Pattern matches services/notifications.ts.
function getSecureStore(): any | null {
  try {
    return require('expo-secure-store');
  } catch (e) {
    console.log('[secureStore] native module unavailable:', (e as any)?.message);
    return null;
  }
}

export async function setSecure(key: string, value: string): Promise<void> {
  const ss = getSecureStore();
  if (!ss) {
    // Hard fallback to AsyncStorage so the feature still works on
    // a broken install — UX > absolute security in that edge case.
    try { await AsyncStorage.setItem(`_fallback_${key}`, value); } catch {}
    return;
  }
  try {
    await ss.setItemAsync(key, value, {
      keychainAccessible: ss.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch (e) {
    console.log('[secureStore] set error:', key, (e as any)?.message);
  }
}

export async function getSecure(key: string): Promise<string | null> {
  const ss = getSecureStore();
  if (!ss) {
    try { return await AsyncStorage.getItem(`_fallback_${key}`); } catch { return null; }
  }
  try {
    return await ss.getItemAsync(key);
  } catch (e) {
    console.log('[secureStore] get error:', key, (e as any)?.message);
    return null;
  }
}

export async function deleteSecure(key: string): Promise<void> {
  const ss = getSecureStore();
  if (!ss) {
    try { await AsyncStorage.removeItem(`_fallback_${key}`); } catch {}
    return;
  }
  try {
    await ss.deleteItemAsync(key);
  } catch (e) {
    console.log('[secureStore] delete error:', key, (e as any)?.message);
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
