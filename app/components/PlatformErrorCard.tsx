// app/components/PlatformErrorCard.tsx
// ═══════════════════════════════════════════════════════════════════════════
// PLATFORM ERROR CARD — inline error display for platform integration failures
// ═══════════════════════════════════════════════════════════════════════════
//
// Surfaces errors thrown by services/platform/* in a user-actionable way.
// Renders inline where data would have shown (so the user sees WHY there's
// no data, not just an empty screen).
//
// ─── ERROR KINDS ────────────────────────────────────────────────────────────
//
//   'auth'    — user needs to reconnect their platform account.
//               Shows a "Reconnect [platform]" button that deep-links to
//               the settings screen for that platform.
//
//   'network' — transient failure (API down, bad wifi). Shows a "Retry"
//               button that re-invokes the caller's onRetry callback.
//
//   'unknown' — anything else. Shows a generic message with retry + a
//               note that the error was logged.
//
// ─── DESIGN ─────────────────────────────────────────────────────────────────
// V7 dark palette. Single inline card, not a modal. Does not block the rest
// of the screen — other tabs/features continue to work.
// ═══════════════════════════════════════════════════════════════════════════

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

type ErrorKind = 'auth' | 'network' | 'unknown';
type Platform = 'sleeper' | 'espn' | 'yahoo';

export interface PlatformErrorCardProps {
  kind: ErrorKind;
  platform?: Platform;
  /** Optional override for the main message. Defaults to a platform-aware default. */
  message?: string;
  /** Called when the user taps Retry (network/unknown kind). */
  onRetry?: () => void;
  /** If provided, called instead of the default deep-link when user taps Reconnect. */
  onReconnect?: () => void;
}

const PLATFORM_NAMES: Record<Platform, string> = {
  sleeper: 'Sleeper',
  espn: 'ESPN',
  yahoo: 'Yahoo',
};

const PLATFORM_COLORS: Record<Platform, string> = {
  sleeper: '#1be7ff',
  espn: '#e03030',
  yahoo: '#6001D2',
};

// Default deep-link paths per platform. Settings screen lives at /settings
// and handles platform re-auth for any platform id passed as a param.
const RECONNECT_PATHS: Record<Platform, string> = {
  sleeper: '/settings?reconnect=sleeper',
  espn: '/settings?reconnect=espn',
  yahoo: '/settings?reconnect=yahoo',
};

export function PlatformErrorCard({
  kind,
  platform,
  message,
  onRetry,
  onReconnect,
}: PlatformErrorCardProps) {
  const router = useRouter();
  const platformName = platform ? PLATFORM_NAMES[platform] : 'Service';
  const accentColor = platform ? PLATFORM_COLORS[platform] : '#ffb800';

  const defaultMessage = (() => {
    if (kind === 'auth') {
      if (platform === 'espn') return 'Your ESPN session has expired. Reconnect to see your league data.';
      if (platform === 'yahoo') return 'Your Yahoo authorization has expired. Reconnect to continue.';
      return `Please reconnect your ${platformName} account.`;
    }
    if (kind === 'network') {
      return `Can't reach ${platformName} right now. Check your connection and try again.`;
    }
    return `Something went wrong loading data from ${platformName}. Tap retry or try again in a moment.`;
  })();

  const handleReconnect = () => {
    if (onReconnect) {
      onReconnect();
      return;
    }
    if (platform) {
      router.push(RECONNECT_PATHS[platform] as any);
    }
  };

  return (
    <View style={[styles.card, { borderLeftColor: accentColor }]}>
      <Text style={styles.title}>
        {kind === 'auth' ? 'CONNECTION EXPIRED' :
         kind === 'network' ? 'CONNECTION PROBLEM' :
         'SOMETHING WENT WRONG'}
      </Text>
      <Text style={styles.message}>{message ?? defaultMessage}</Text>

      <View style={styles.actions}>
        {kind === 'auth' && platform ? (
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: accentColor }]}
            onPress={handleReconnect}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryBtnText, { color: platform === 'sleeper' ? '#0a1214' : '#fff' }]}>
              RECONNECT {platformName.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ) : onRetry ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={onRetry} activeOpacity={0.8}>
            <Text style={[styles.primaryBtnText, { color: '#0a1214' }]}>RETRY</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

// ─── HELPER: classify an error into a kind ─────────────────────────────────
// Import in screen-level try/catch blocks to decide which kind of card to
// render. Falls through to 'unknown' for anything not recognized.

export function classifyPlatformError(err: any): {
  kind: ErrorKind;
  platform?: Platform;
  message?: string;
} {
  if (!err) return { kind: 'unknown' };

  // PlatformAuthError — auth/token/cookie expired
  if (err.name === 'PlatformAuthError' || err.code === 'platform_auth') {
    return {
      kind: 'auth',
      platform: err.platform,
      message: typeof err.message === 'string' && err.message.length > 0 ? err.message : undefined,
    };
  }

  // PlatformError — treat 4xx/5xx as network-ish, auth specifically as auth
  if (err.name === 'PlatformError' || err.code === 'platform') {
    const msg = String(err.message ?? '');
    if (/401|403|session|token|unauthorized/i.test(msg)) {
      return { kind: 'auth', platform: err.platform };
    }
    return { kind: 'network', platform: err.platform };
  }

  // Network-level errors (fetch rejected, timeout, DNS, AbortError)
  const msg = String(err.message ?? err ?? '');
  if (/network|timeout|abort|failed to fetch|offline/i.test(msg)) {
    return { kind: 'network' };
  }

  return { kind: 'unknown', message: msg.length > 0 && msg.length < 200 ? msg : undefined };
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#12252e',
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 16,
    marginHorizontal: 16,
    marginVertical: 12,
  },
  title: {
    fontFamily: 'SpaceMono-Regular',
    fontSize: 10,
    letterSpacing: 2,
    color: '#7a9eaa',
    marginBottom: 8,
  },
  message: {
    fontFamily: 'Barlow-Regular',
    fontSize: 14,
    color: '#f0f4f5',
    lineHeight: 20,
    marginBottom: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: '#ffb800',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    flexGrow: 1,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontFamily: 'BebasNeue-Regular',
    fontSize: 14,
    letterSpacing: 1.5,
  },
});
