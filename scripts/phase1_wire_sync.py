#!/usr/bin/env python3
"""
Phase 1 wire-up — call syncUserBehavioralData on auth + app foreground.

The sync service itself has internal gating (6-hour minimum between syncs),
so calling it on every foreground is safe. We trigger it from the root
_layout so it runs regardless of which tab the user lands on.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/phase1_wire_sync.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "_layout.tsx"


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        print("If your root layout lives elsewhere, rename the TARGET path at the top.")
        sys.exit(1)

    content = TARGET.read_text()

    # Check for already-wired
    if "syncUserBehavioralData" in content:
        print("Already wired — skipping.")
        return

    # We insert two things:
    #   1. Import of the sync service
    #   2. A useEffect that listens to AppState and triggers sync
    #
    # The trigger is gated internally by 6hr cooldown in AsyncStorage, so
    # we can safely call it every time AppState becomes 'active'.

    # Find the react import line to anchor our new import after it
    react_import_patterns = [
        "import React from 'react';",
        'import React from "react";',
        "import { useEffect } from 'react';",
        "import React, { useEffect } from 'react';",
    ]
    anchor = None
    for p in react_import_patterns:
        if p in content:
            anchor = p
            break

    if not anchor:
        print("COULDN'T FIND React import line — can't anchor new imports.")
        print("Manually add these imports to app/_layout.tsx:")
        print()
        print("  import { useEffect } from 'react';")
        print("  import { AppState } from 'react-native';")
        print("  import { supabase } from '../services/supabase';")
        print("  import { syncUserBehavioralData } from '../services/behavioralSync';")
        print()
        print("Then add this inside your root component function body:")
        print()
        print(SNIPPET)
        sys.exit(2)

    # Insert imports right after the react import
    new_imports = (
        anchor + "\n"
        "import { AppState } from 'react-native';\n"
        "import { supabase } from '../services/supabase';\n"
        "import { syncUserBehavioralData } from '../services/behavioralSync';"
    )
    # Only add useEffect if it's not already in the import
    if "useEffect" not in anchor:
        new_imports = new_imports.replace(
            anchor,
            anchor.replace("React", "React, { useEffect }") if "{ useEffect }" not in anchor else anchor,
        )

    content = content.replace(anchor, new_imports, 1)

    # Look for a root component body to inject the useEffect into.
    # Common patterns: `export default function RootLayout() {` or
    # `export default function App() {`
    func_patterns = [
        "export default function RootLayout() {",
        "export default function App() {",
        "export default function Layout() {",
    ]
    func_anchor = None
    for p in func_patterns:
        if p in content:
            func_anchor = p
            break

    if not func_anchor:
        print("COULDN'T FIND root component function.")
        print("Imports added. Now add this useEffect block inside your root component:")
        print()
        print(SNIPPET)
        TARGET.write_text(content)
        sys.exit(2)

    # Insert the useEffect immediately after the function opening brace
    content = content.replace(
        func_anchor,
        func_anchor + "\n" + SNIPPET,
        1,
    )

    TARGET.write_text(content)
    print(f"✓ Wired behavioralSync into {TARGET.name}")
    print("  - Triggers on mount (if user logged in)")
    print("  - Triggers on app returning to foreground")
    print("  - 6-hour cooldown enforced by the service itself")


SNIPPET = """  // Phase 1 behavioral data sync — Sleeper + Yahoo only
  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getUser();
      if (data?.user?.id) {
        syncUserBehavioralData(data.user.id).catch(e =>
          console.log('behavioralSync error:', e)
        );
      }
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => sub.remove();
  }, []);
"""


if __name__ == "__main__":
    print("=" * 60)
    print("Phase 1 wire-up — behavioralSync on _layout.tsx")
    print("=" * 60)
    print()
    main()
