#!/usr/bin/env python3
"""
Fix import paths in app/auth/index.tsx.

When restructure_auth_route.py moved app/auth.tsx → app/auth/index.tsx,
the file went one directory deeper. Three imports need their relative
paths updated:

  ./components/AIOmniLogo     →  ../components/AIOmniLogo
  ../services/auth            →  ../../services/auth
  ./constants/tokens          →  ../constants/tokens

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/fix_auth_index_imports.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "auth" / "index.tsx"

REPLACEMENTS = [
    # AIOmniLogo: app/components/AIOmniLogo from app/auth/index.tsx → ../components/...
    (
        "AIOmniLogo import path",
        "import { AIOmniLogo } from './components/AIOmniLogo';",
        "import { AIOmniLogo } from '../components/AIOmniLogo';",
    ),
    # services/auth.ts: from app/auth/index.tsx → ../../services/auth
    (
        "services/auth import path",
        "import { signInWithEmail, signUpWithEmail, resetPassword } from '../services/auth';",
        "import { signInWithEmail, signUpWithEmail, resetPassword } from '../../services/auth';",
    ),
    # constants/tokens: app/constants/tokens from app/auth/index.tsx → ../constants/...
    (
        "constants/tokens import path",
        "import { C, F, SZ, R, SP } from './constants/tokens';",
        "import { C, F, SZ, R, SP } from '../constants/tokens';",
    ),
]


def main():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found")
        sys.exit(1)

    content = TARGET.read_text()
    original = content
    applied = 0
    skipped = 0
    failed = []

    for desc, old, new in REPLACEMENTS:
        count = content.count(old)
        if count == 1:
            content = content.replace(old, new)
            applied += 1
            print(f"  [APPLIED]  {desc}")
        elif count == 0:
            if new in content:
                skipped += 1
                print(f"  [ALREADY]  {desc}")
            else:
                failed.append(desc)
                print(f"  [MISSING]  {desc}")
        else:
            failed.append(f"{desc} ({count} matches)")
            print(f"  [AMBIG]    {desc}")

    if failed:
        print("\nWARNING: did not apply cleanly. File NOT modified.")
        sys.exit(2)

    if content != original:
        TARGET.write_text(content)
        print(f"\n✓ Patched {TARGET.name} ({applied} applied, {skipped} already)")


if __name__ == "__main__":
    print("=" * 60)
    print("Fix import paths in app/auth/index.tsx")
    print("=" * 60)
    print()
    main()
    print()
    print("Next: npx tsc --noEmit")
