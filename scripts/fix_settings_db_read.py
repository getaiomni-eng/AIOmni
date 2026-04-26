#!/usr/bin/env python3
"""
Fix Settings screen to read email and sleeper_username from public.users
(Supabase) instead of AsyncStorage.

Why:
  AsyncStorage is a cache from the legacy pre-auth onboarding flow. When
  users sign up via email auth, user_email is never written to AsyncStorage,
  so Settings shows "Not set" even though the DB has the email.

  DB is source of truth. Settings should query the user row on mount and
  use AsyncStorage only as a fallback for offline display.

What this patch does:
  1. Adds supabase import
  2. Rewrites loadSettings() to:
     a. Get the auth user from supabase.auth.getUser()
     b. Query public.users row by auth_id
     c. Set email, sleeper_username from that row
     d. Fall back to AsyncStorage values if DB query fails (offline safety)

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_settings_db_read.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "settings.tsx"


# ─── Patch 1: add supabase import (idempotent) ───────────────────────────
# We add it after AsyncStorage import. The file probably has many imports;
# we anchor on AsyncStorage which we know is there.

OLD_IMPORT_BLOCK = "import AsyncStorage from '@react-native-async-storage/async-storage';"
NEW_IMPORT_BLOCK = """import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../services/supabase';"""


# ─── Patch 2: rewrite loadSettings ────────────────────────────────────────

OLD_LOAD = """  const loadSettings = async () => {
    const u = await AsyncStorage.getItem('sleeper_username');
    if (u) setUsername(u);
    const e = await AsyncStorage.getItem('user_email');
    if (e) setEmail(e);
    const espn = await AsyncStorage.getItem('espn_s2');
    setEspnLinked(!!espn);
    const yahoo = await AsyncStorage.getItem('yahoo_tokens');
    setYahooLinked(!!yahoo);
  };"""

NEW_LOAD = """  const loadSettings = async () => {
    // ESPN/Yahoo connection state lives in AsyncStorage (it's the auth
    // token cache). Fetch those first — they don't depend on the network.
    const espn = await AsyncStorage.getItem('espn_s2');
    setEspnLinked(!!espn);
    const yahoo = await AsyncStorage.getItem('yahoo_tokens');
    setYahooLinked(!!yahoo);

    // Email + Sleeper username come from public.users (source of truth).
    // AsyncStorage is the offline fallback — we read it first as a fast
    // local hint, then overwrite with the canonical DB values.
    try {
      const cachedUser = await AsyncStorage.getItem('user_email');
      const cachedSleeper = await AsyncStorage.getItem('sleeper_username');
      if (cachedUser) setEmail(cachedUser);
      if (cachedSleeper) setUsername(cachedSleeper);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: row } = await supabase
        .from('users')
        .select('email, sleeper_username')
        .eq('auth_id', user.id)
        .maybeSingle();

      if (row?.email) {
        setEmail(row.email);
        // Refresh AsyncStorage cache for next cold start
        await AsyncStorage.setItem('user_email', row.email);
      } else if (user.email) {
        // Fallback to auth user email if public.users.email is somehow null
        setEmail(user.email);
        await AsyncStorage.setItem('user_email', user.email);
      }

      if (row?.sleeper_username) {
        setUsername(row.sleeper_username);
        await AsyncStorage.setItem('sleeper_username', row.sleeper_username);
      }
    } catch (e) {
      // Network failure or DB error — AsyncStorage values already shown above
      console.warn('loadSettings: falling back to cached values', e);
    }
  };"""


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    content = TARGET.read_text()
    original = content

    # ── Patch 1: import ──
    if "from '../../services/supabase'" in content:
        print("  [ALREADY]  supabase import present")
    elif OLD_IMPORT_BLOCK in content:
        content = content.replace(OLD_IMPORT_BLOCK, NEW_IMPORT_BLOCK)
        print("  [APPLIED]  added supabase import")
    else:
        print("  [MISSING]  could not find AsyncStorage import to anchor on")
        sys.exit(2)

    # ── Patch 2: loadSettings ──
    if "supabase.auth.getUser()" in content and "loadSettings" in content:
        print("  [ALREADY]  loadSettings already reads from supabase")
    elif OLD_LOAD in content:
        content = content.replace(OLD_LOAD, NEW_LOAD)
        print("  [APPLIED]  rewrote loadSettings to read from public.users")
    else:
        print("  [MISSING]  could not find existing loadSettings block")
        sys.exit(2)

    if content != original:
        TARGET.write_text(content)
        print(f"\n✓ {TARGET.name} updated")


if __name__ == "__main__":
    print("=" * 60)
    print("Fix Settings: read email/sleeper from public.users")
    print("=" * 60)
    print()
    main()
    print()
    print("Next:")
    print("  npx tsc --noEmit")
    print("  git add -A && git commit -m \"Settings: read email/sleeper from public.users\"")
    print("  git push && eas build --platform ios --profile testflight --auto-submit")
