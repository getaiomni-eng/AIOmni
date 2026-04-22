#!/usr/bin/env python3
"""
Surgical wire-up for behavioralSync into app/_layout.tsx.

Anchors on `export default Sentry.wrap(function RootLayout() {\n  const router = useRouter();`
and inserts a useEffect right after router assignment.

Imports were already added by the prior script run.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/phase1_wire_sync_v2.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "_layout.tsx"

OLD = """export default Sentry.wrap(function RootLayout() {
  const router = useRouter();"""

NEW = """export default Sentry.wrap(function RootLayout() {
  const router = useRouter();

  // Phase 1 behavioral data sync — Sleeper + Yahoo only.
  // Triggers on mount and every app foreground. The service enforces a
  // 6hr cooldown internally so this is safe to call aggressively.
  useEffect(() => {
    const run = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (data?.user?.id) {
          await syncUserBehavioralData(data.user.id);
        }
      } catch (e) {
        console.log('behavioralSync error:', e);
      }
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, []);"""


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    content = TARGET.read_text()

    if "syncUserBehavioralData(data.user.id)" in content:
        print("Already wired — skipping.")
        return

    count = content.count(OLD)
    if count != 1:
        print(f"ERROR: expected 1 match for anchor, found {count}")
        print("Anchor was:")
        print(OLD)
        sys.exit(2)

    content = content.replace(OLD, NEW)
    TARGET.write_text(content)
    print(f"✓ Wired behavioralSync into {TARGET.name}")


if __name__ == "__main__":
    print("=" * 60)
    print("Phase 1 wire-up v2 — Sentry.wrap RootLayout anchor")
    print("=" * 60)
    print()
    main()
