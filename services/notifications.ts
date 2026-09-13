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
import * as Sentry from '@sentry/react-native';

function crumb(message: string, level: Sentry.SeverityLevel = 'info', data?: any) {
  try { Sentry.addBreadcrumb({ category: 'notifications', message, level, data }); } catch {}
}

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
export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/**
 * Current OS notification permission, without ever triggering the dialog.
 *
 * 'unavailable' means this build cannot receive push at all (web, or a dev
 * build with no EAS projectId) — distinct from 'denied', which is a real
 * user decision and the only one worth showing recovery UI for.
 */
export async function getPushPermissionStatus(): Promise<PushPermission> {
  try {
    const Platform = require('react-native').Platform;
    if (Platform.OS === 'web') return 'unavailable';
    const Notifications = require('expo-notifications');
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status === 'granted') return 'granted';
    // iOS reports 'undetermined' only before the one dialog it allows. Once
    // the user has answered, canAskAgain is false and asking again is a
    // no-op — that case has to be routed to the OS settings app instead.
    if (status === 'undetermined' && canAskAgain !== false) return 'undetermined';
    return 'denied';
  } catch {
    return 'unavailable';
  }
}

/**
 * Ask for permission ONLY if the OS will actually show the dialog, then
 * register the token. Returns the resulting permission state.
 *
 * Call this when the user has just asked for something that needs push —
 * flipping a notification toggle on. Never call it speculatively: iOS shows
 * that dialog exactly once per install, so a cold ask at sign-in spends the
 * single attempt before the user has any reason to say yes, and a denial is
 * unrecoverable from inside the app forever after.
 */
export async function ensurePushPermission(authUserId: string): Promise<PushPermission> {
  const status = await getPushPermissionStatus();
  if (status === 'granted') {
    await registerPushNotifications(authUserId);
    return 'granted';
  }
  if (status !== 'undetermined') return status;

  const token = await registerPushNotifications(authUserId, { askIfNeeded: true });
  return token ? 'granted' : 'denied';
}

export async function registerPushNotifications(
  authUserId: string,
  opts: { askIfNeeded?: boolean } = {},
): Promise<string | null> {
  // Lazy require — if expo-notifications native isn't initialized
  // correctly, this throws here and we catch + return null instead of
  // crashing the app at module-load time the way a top-level import did.
  crumb('registerPushNotifications: enter');
  let Notifications: any;
  let Constants: any;
  let Platform: any;
  try {
    Notifications = require('expo-notifications');
    Constants     = require('expo-constants').default;
    Platform      = require('react-native').Platform;
  } catch (e: any) {
    crumb('require() failed', 'error', { msg: e?.message });
    console.log('[push] native modules unavailable:', e?.message);
    return null;
  }

  try {
    if (!handlerWired) {
      try {
        crumb('setNotificationHandler');
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
      } catch (e: any) {
        crumb('setNotificationHandler failed', 'error', { msg: e?.message });
        console.log('[push] setNotificationHandler failed:', e?.message);
      }
    }

    // Web cannot produce an Expo push token. require('expo-notifications')
    // resolves there, so without this guard the call gets far enough to log
    // a failure and burn a permission attempt. Same shape as the
    // expo-secure-store web bug.
    if (Platform.OS === 'web') { crumb('web — push unavailable'); return null; }

    crumb('getPermissionsAsync');
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      // Only surface the OS dialog when the caller explicitly asked for it.
      //
      // This used to prompt unconditionally, and _layout called it on every
      // sign-in — so the one permission dialog iOS allows was spent at the
      // least persuasive moment possible, before the user had seen a single
      // alert worth receiving. 9 of 14 accounts have no push token, and a
      // cold ask is the most likely reason. A denial there is permanent:
      // canAskAgain goes false and only the OS settings app can undo it.
      if (!opts.askIfNeeded) { crumb('permission not granted, not asking'); return null; }
      crumb('requestPermissionsAsync');
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') { crumb('permission denied', 'warning'); return null; }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    if (!projectId) {
      crumb('no EAS projectId', 'warning');
      console.log('[push] no EAS projectId — skipping (dev build?)');
      return null;
    }

    crumb('getExpoPushTokenAsync');
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
