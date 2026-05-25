// services/notifications.ts
// Expo push notifications setup. Defensive lazy-load design:
//
//   - expo-notifications is NEVER imported at module level. If anything
//     goes wrong with its native init (missing entitlement, broken pod
//     link, version mismatch), top-level import would crash the app at
//     launch — instead we `require()` inside the function, wrapped in
//     try/catch so a broken native module fails gracefully (returns
//     null, app keeps running).
//
//   - setNotificationHandler runs ONCE inside register, not at module
//     load. Previously the top-level handler call appeared to crash on
//     the first install when native wasn't ready yet.
//
//   - Every native call is wrapped in try/catch; this function CAN NOT
//     throw. Callers fire-and-forget without an error handler.

import { supabase } from './supabase';

export type NotificationPrefs = {
  player_news:    boolean;
  lineup_warning: boolean;
  pulse_alerts:   boolean;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  player_news:    true,
  lineup_warning: true,
  pulse_alerts:   true,
};

// Module-local "did we already wire the foreground handler" flag — set
// after the first successful register so we don't reinstall on every call.
let handlerWired = false;

/**
 * Request permission, fetch the Expo push token, persist to
 * public.users.push_token. Returns the token on success or null on
 * ANY failure (no permission, no token, broken native module, etc.).
 * Never throws.
 */
export async function registerPushNotifications(authUserId: string): Promise<string | null> {
  // Lazy require — if expo-notifications native isn't initialized
  // correctly, this throws here and we catch + return null instead of
  // crashing the app at module-load time the way a top-level import did.
  let Notifications: any;
  let Constants: any;
  let Platform: any;
  try {
    Notifications = require('expo-notifications');
    Constants     = require('expo-constants').default;
    Platform      = require('react-native').Platform;
  } catch (e) {
    console.log('[push] native modules unavailable:', (e as any)?.message);
    return null;
  }

  try {
    // Foreground display behavior — install once.
    if (!handlerWired) {
      try {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert:  true,
            shouldPlaySound:  true,
            shouldSetBadge:   true,
            shouldShowBanner: true,
            shouldShowList:   true,
          }),
        });
        handlerWired = true;
      } catch (e) {
        console.log('[push] setNotificationHandler failed:', (e as any)?.message);
      }
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    if (!projectId) {
      console.log('[push] no EAS projectId — skipping (dev build?)');
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return null;

    if (Platform.OS === 'android') {
      try {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.HIGH,
        });
      } catch {}
    }

    // Persist — skip the round-trip if token hasn't changed.
    const { data: row } = await supabase
      .from('users')
      .select('push_token')
      .eq('auth_id', authUserId)
      .maybeSingle();
    if (row?.push_token === token) return token;

    await supabase
      .from('users')
      .update({ push_token: token, updated_at: new Date().toISOString() })
      .eq('auth_id', authUserId);

    return token;
  } catch (e) {
    console.log('[push] register error:', (e as any)?.message);
    return null;
  }
}

/** Read the current user's notification prefs (per-type opt-in). */
export async function getNotificationPrefs(authUserId: string): Promise<NotificationPrefs> {
  try {
    const { data } = await supabase
      .from('users')
      .select('notification_prefs')
      .eq('auth_id', authUserId)
      .maybeSingle();
    return { ...DEFAULT_NOTIFICATION_PREFS, ...(data?.notification_prefs ?? {}) };
  } catch {
    return DEFAULT_NOTIFICATION_PREFS;
  }
}

/** Update one or more notification preferences. */
export async function setNotificationPrefs(
  authUserId: string,
  partial: Partial<NotificationPrefs>,
): Promise<void> {
  try {
    const current = await getNotificationPrefs(authUserId);
    const merged = { ...current, ...partial };
    await supabase
      .from('users')
      .update({ notification_prefs: merged, updated_at: new Date().toISOString() })
      .eq('auth_id', authUserId);
  } catch (e) {
    console.log('[push] setPrefs error:', (e as any)?.message);
  }
}

/**
 * Clear the push token on logout — without this an old install keeps
 * receiving pushes for whoever last logged in there.
 */
export async function unregisterPushNotifications(authUserId: string): Promise<void> {
  try {
    await supabase
      .from('users')
      .update({ push_token: null, updated_at: new Date().toISOString() })
      .eq('auth_id', authUserId);
  } catch {}
}
