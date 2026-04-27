#!/usr/bin/env python3
"""
Consolidate Settings to single source of truth.

The repo has THREE settings files:
  app/settings.tsx           — V6 cream theme fossil
  app/settings-page.tsx      — V7 dark, pre-today's-fixes
  app/(tabs)/settings.tsx    — V7 dark, fully current (THE GOOD ONE)

Different surfaces of the app navigate to different ones, so today's
patches landed in the canonical tabs version but users were seeing the
fossils when they tapped gear icons.

This script:
  1. Deletes app/settings.tsx and app/settings-page.tsx
  2. Rewrites all router.push('/settings') → router.push('/(tabs)/settings')
  3. Rewrites all router.push('/settings-page') → router.push('/(tabs)/settings')
  4. Removes the orphaned <Stack.Screen name="settings"/> and
     <Stack.Screen name="settings-page"/> registrations from app/_layout.tsx

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/consolidate_settings.py
"""

import sys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FOSSILS = [
    ROOT / "app" / "settings.tsx",
    ROOT / "app" / "settings-page.tsx",
]

# Files that may contain navigation calls or screen registrations
SEARCH_PATHS = [
    ROOT / "app",
    ROOT / "services",
]


def find_navigation_callers():
    """Return list of (file, line_no, line) tuples that need rewriting."""
    callers = []
    patterns = [
        r"router\.push\(['\"]\/settings['\"]",
        r"router\.replace\(['\"]\/settings['\"]",
        r"router\.push\(['\"]\/settings-page['\"]",
        r"router\.replace\(['\"]\/settings-page['\"]",
        r'href=["\']\/settings["\']',
        r'href=["\']\/settings-page["\']',
    ]
    combined = re.compile("|".join(patterns))

    for path in SEARCH_PATHS:
        if not path.exists():
            continue
        for tsx in path.rglob("*.tsx"):
            if "node_modules" in str(tsx):
                continue
            try:
                content = tsx.read_text()
            except Exception:
                continue
            for line_no, line in enumerate(content.splitlines(), 1):
                if combined.search(line):
                    callers.append((tsx, line_no, line))
        for ts in path.rglob("*.ts"):
            if "node_modules" in str(ts):
                continue
            try:
                content = ts.read_text()
            except Exception:
                continue
            for line_no, line in enumerate(content.splitlines(), 1):
                if combined.search(line):
                    callers.append((ts, line_no, line))

    return callers


def patch_navigation_calls():
    """Rewrite router.push('/settings') and router.push('/settings-page') to tabs."""
    files_changed = 0
    rewrites = [
        # /settings-page first (longer must come first so /settings doesn't
        # accidentally match part of /settings-page)
        (r"router\.push\(['\"]\/settings-page['\"](\s*as\s+any)?\)",
         "router.push('/(tabs)/settings' as any)"),
        (r"router\.replace\(['\"]\/settings-page['\"](\s*as\s+any)?\)",
         "router.replace('/(tabs)/settings' as any)"),
        # then /settings
        (r"router\.push\(['\"]\/settings['\"](\s*as\s+any)?\)",
         "router.push('/(tabs)/settings' as any)"),
        (r"router\.replace\(['\"]\/settings['\"](\s*as\s+any)?\)",
         "router.replace('/(tabs)/settings' as any)"),
    ]

    for path in SEARCH_PATHS:
        if not path.exists():
            continue
        for tsx in list(path.rglob("*.tsx")) + list(path.rglob("*.ts")):
            if "node_modules" in str(tsx):
                continue
            try:
                content = tsx.read_text()
            except Exception:
                continue
            original = content
            for pattern, replacement in rewrites:
                content = re.sub(pattern, replacement, content)
            if content != original:
                tsx.write_text(content)
                files_changed += 1
                print(f"  [REWROTE]  {tsx.relative_to(ROOT)}")

    return files_changed


def remove_stack_screens():
    """Remove <Stack.Screen name=\"settings\"/> and settings-page from _layout.tsx."""
    layout = ROOT / "app" / "_layout.tsx"
    if not layout.exists():
        print("  [WARN]     app/_layout.tsx not found")
        return False

    content = layout.read_text()
    original = content

    # Match Stack.Screen lines for "settings" or "settings-page" — there's no
    # nested content; they're self-closing one-liners.
    patterns = [
        r'\s*<Stack\.Screen\s+name="settings"\s+options=\{\{\s*headerShown:\s*false\s*\}\}\s*/>\n?',
        r'\s*<Stack\.Screen\s+name="settings-page"\s+options=\{\{\s*headerShown:\s*false\s*\}\}\s*/>\n?',
    ]
    for p in patterns:
        content = re.sub(p, "\n", content)

    # Also handle slight variations (different option ordering)
    fuzzy = [
        (r'\s*<Stack\.Screen\s+name="settings"[^/]*/>\n?', ""),
        (r'\s*<Stack\.Screen\s+name="settings-page"[^/]*/>\n?', ""),
    ]
    for p, rep in fuzzy:
        content = re.sub(p, rep, content)

    if content != original:
        layout.write_text(content)
        print(f"  [PATCHED]  removed Stack.Screen registrations from app/_layout.tsx")
        return True
    else:
        print(f"  [ALREADY]  no Stack.Screen settings entries to remove")
        return False


def delete_fossils():
    """Delete the duplicate settings files."""
    deleted = []
    for fossil in FOSSILS:
        if fossil.exists():
            fossil.unlink()
            deleted.append(fossil.relative_to(ROOT))
            print(f"  [DELETED]  {fossil.relative_to(ROOT)}")
        else:
            print(f"  [ALREADY]  {fossil.relative_to(ROOT)} does not exist")
    return deleted


def main():
    print("=" * 64)
    print("Consolidate Settings to single source of truth")
    print("=" * 64)
    print()

    # Sanity check: canonical exists
    canonical = ROOT / "app" / "(tabs)" / "settings.tsx"
    if not canonical.exists():
        print(f"ERROR: canonical {canonical} not found. Aborting.")
        sys.exit(1)

    # Step 1: show the navigation callers we're about to rewrite
    print("Found these navigation callers to rewrite:")
    callers = find_navigation_callers()
    if not callers:
        print("  (none — already consolidated)")
    else:
        for f, ln, line in callers:
            print(f"  {f.relative_to(ROOT)}:{ln}: {line.strip()}")
    print()

    # Step 2: rewrite navigation calls
    print("Rewriting navigation calls:")
    n = patch_navigation_calls()
    if n == 0:
        print("  (no changes)")
    print()

    # Step 3: remove orphan Stack.Screen registrations
    print("Cleaning up _layout.tsx:")
    remove_stack_screens()
    print()

    # Step 4: delete fossils
    print("Deleting fossil files:")
    delete_fossils()
    print()

    print("=" * 64)
    print("✓ Done")
    print("=" * 64)
    print()
    print("Verify:")
    print("  ls app/settings*           # should only show app/(tabs)/settings.tsx via the (tabs) dir")
    print("  npx tsc --noEmit")
    print()
    print("Then commit + build 124:")
    print("  git add -A")
    print("  git commit -m 'Consolidate Settings to single source of truth'")
    print("  git push && eas build --platform ios --profile testflight --auto-submit")


if __name__ == "__main__":
    main()
