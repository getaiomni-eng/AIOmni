#!/usr/bin/env python3
"""
Hour 3 polish — swap draft.tsx's plain "THE O" text for the branded
TheOLogo wordmark (logo-font "THE" + aperture O glyph with gold hex pupil).

Run AFTER hour3_draft_rewrite.py. This expects the "THE O" strings to
already be in place.

Targets:
  1. Setup wizard hero title   — 36pt, amber on dark
  2. Draft board header title  — 22pt, amber on dark
  3. AI modal title            — 22pt, amber on dark
  4. "ASK THE O" button        — 13pt, black on amber (inline ApertureO)

Left unchanged:
  - "The O is thinking..." loader text — mid-sentence, plain text is correct

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour3_the_o_logo.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "draft.tsx"

REPLACEMENTS = [
    # ── 1. Add imports ──────────────────────────────────────────────────────
    # Anchor on draftPool import (added in hour3_draft_rewrite.py) so
    # re-running the earlier patch doesn't collide.
    (
        "add TheOLogo imports",
        "import { applyEngineToDraftPool, draftSettingsToUIFormat } from '../../services/rankings/draftPool';\nimport {\n    DEFAULT_PLAYER_DB,",
        "import { applyEngineToDraftPool, draftSettingsToUIFormat } from '../../services/rankings/draftPool';\nimport { TheOLogo, ApertureO } from '../components/TheOLogo';\nimport {\n    DEFAULT_PLAYER_DB,",
    ),

    # ── 2. Setup wizard hero title (36pt amber) ──────────────────────────────
    (
        "setup wizard title → TheOLogo",
        '<Text style={styles.setupTitle}>THE O</Text>',
        '<TheOLogo fontSize={36} color="#ffb800" />',
    ),

    # ── 3. Draft board header title (22pt amber) ─────────────────────────────
    (
        "draft board header title → TheOLogo",
        '<Text style={styles.draftHeaderTitle}>THE O</Text>',
        '<TheOLogo fontSize={22} color="#ffb800" />',
    ),

    # ── 4. AI advice modal title (22pt amber) ────────────────────────────────
    (
        "modal title → TheOLogo",
        '<Text style={styles.modalTitle}>THE O</Text>',
        '<TheOLogo fontSize={22} color="#ffb800" />',
    ),

    # ── 5. "ASK THE O" button (13pt black on amber button bg) ────────────────
    # Can't use TheOLogo wholesale because "ASK" prefix changes the layout.
    # Split into Text("ASK THE ") + ApertureO glyph, wrapped in a flex row.
    # Pupil set to black to match the outline — on the gold button bg,
    # gold pupil would disappear; black pupil reads clearly.
    (
        "ASK THE O button → inline row",
        '<Text style={styles.bottomBtnAIText}>ASK THE O</Text>',
        "<View style={{ flexDirection: 'row', alignItems: 'center' }}>\n                <Text style={styles.bottomBtnAIText}>ASK THE </Text>\n                <ApertureO size={18} color=\"#000\" pupilColor=\"#000\" />\n              </View>",
    ),
]


def patch_file():
    if not TARGET.exists():
        print(f"ERROR: {TARGET} not found.")
        sys.exit(1)

    original = TARGET.read_text()
    content = original
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
            # Idempotency check: is the NEW content already there?
            fingerprint = new.strip()[:60]
            if fingerprint in content:
                skipped += 1
                print(f"  [ALREADY]  {desc}")
            else:
                failed.append(desc)
                print(f"  [MISSING]  {desc}")
        else:
            failed.append(f"{desc} (appears {count} times)")
            print(f"  [AMBIG]    {desc} — appears {count} times")

    if failed:
        print("\nWARNING: Did not apply cleanly. File NOT modified.")
        for f in failed:
            print(f"  - {f}")
        print("\nMost common cause: hour3_draft_rewrite.py hasn't been run yet.")
        print("Run that first, then re-run this.")
        sys.exit(2)

    if content == original:
        print(f"\nNo changes needed ({skipped} already patched).")
        return

    TARGET.write_text(content)
    print(f"\n✓ Patched {TARGET}  ({applied} applied, {skipped} already)")


if __name__ == "__main__":
    print("=" * 60)
    print("Hour 3 polish — swap THE O text for branded wordmark")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Reload Expo and check:")
    print("  1. Open Draft tab — setup title should show 'THE [O-glyph]'")
    print("  2. Start a draft — header title uses the glyph")
    print("  3. Button now reads 'ASK THE [O-glyph]'")
    print("  4. Ask for advice — modal title uses the glyph")
