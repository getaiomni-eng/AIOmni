// services/notifications.ts
// Expo push notifications setup. One-call entry point from _layout.tsx
// after auth: registerPushNotifications(userId) — asks permission, gets
// the Expo push token, persists it to public.users.push_token.
//
// Server side: edge functions in supabase/functions/notification-*
// read push_token from users joined with notification_prefs to decide
// whether to fire, and POST to https://exp.host/--/api/v2/push/send.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from './supabase';

// Foreground behavior: show the alert + sound + badge even when the app
// is open. Without this an incoming push silently lands in the tray.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList:   true,
  }),
});

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

/**
 * Request permission, fetch the Expo push token, and persist it to
 * public.users.push_token. Safe to call on every app launch — it short-
 * circuits if the token hasn't changed.
 *
 * Returns the token if successful, null if the user denied permission
 * or we couldn't get one (simulator, etc.).
 */
export async function registerPushNotifications(authUserId: string): Promise<string | null> {
  try {
    // iOS: must request explicit permission.
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== 'granted') return null;

    // EAS projectId is required for getExpoPushTokenAsync to work in
    // standalone builds. expo-constants exposes it from app.json.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;
    if (!projectId) {
      console.log('[push] no EAS projectId — skipping (dev build?)');
      return null;
    }

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (!token) return null;

    // Android needs a notification channel created before any push fires.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    // Persist — but skip the round-trip if it already matches what we
    // had stored. Token rarely changes within an install lifecycle.
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
    console.log('[push] register error:', e);
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
    console.log('[push] setPrefs error:', e);
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
