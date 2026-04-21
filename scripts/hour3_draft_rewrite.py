#!/usr/bin/env python3
"""
Hour 3 — draft.tsx engine integration + rename to "The O".

Changes:
1. Import applyEngineToDraftPool + draftSettingsToUIFormat from new module
2. Overlay engine rankings + user overrides onto loadLivePlayerDB output
3. Rename user-facing "Draft Copilot" → "The O"

Skipped (deliberate):
- Rookie drafts still use loadLivePlayerDB('rookie') directly; engine doesn't
  rank 2026 rookies yet (no team/age). PROSPECT_SEED_2026 stays authoritative.
- The component function name stays DraftCopilotScreen (internal only; no
  value in churning it).

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/hour3_draft_rewrite.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "app" / "(tabs)" / "draft.tsx"

REPLACEMENTS = [
    # ── 1. Update file header comment ──
    (
        "update file header comment",
        "// app/(tabs)/draft.tsx\n// AIOmni Draft Copilot — V7 Dark Theme\n// Sleeper: auto-sync live picks | ESPN/Yahoo/Offline: companion mode",
        "// app/(tabs)/draft.tsx\n// AIOmni The O — Draft Intelligence (V7 Dark Theme)\n// Sleeper: auto-sync live picks | ESPN/Yahoo/Offline: companion mode",
    ),

    # ── 2. Add import for draftPool module ──
    #       Anchor on the following import (askAI) so OLD no longer matches after.
    (
        "add draftPool imports",
        """import { askAI } from '../../services/ai';
import {
    DEFAULT_PLAYER_DB,""",
        """import { askAI } from '../../services/ai';
import { applyEngineToDraftPool, draftSettingsToUIFormat } from '../../services/rankings/draftPool';
import {
    DEFAULT_PLAYER_DB,""",
    ),

    # ── 3. Wire engine overlay into handleStartDraft ──
    #       After loadLivePlayerDB, before rosters filter: apply engine for
    #       non-rookie drafts so rankings/tiers/ADP match the Rankings tab
    #       and user overrides carry through.
    (
        "apply engine overlay to live DB",
        """      let liveDB = await loadLivePlayerDB(draftMode);
      if (settings.platform === 'sleeper' && settings.leagueId && settings.leagueId !== 'offline') {""",
        """      let liveDB = await loadLivePlayerDB(draftMode);
      // Overlay AIOmni engine rankings + user overrides onto the base pool.
      // Skipped for rookie drafts (engine doesn't score 2026 prospects).
      if (draftMode !== 'rookie') {
        const uiFormat = draftSettingsToUIFormat({
          scoringFormat: settings.scoringFormat,
          rosterSlots: settings.rosterSlots,
          isDynasty,
        });
        const leagueIdForOverrides = settings.leagueId && settings.leagueId !== 'offline'
          ? settings.leagueId
          : null;
        liveDB = await applyEngineToDraftPool(liveDB, uiFormat, leagueIdForOverrides);
      }
      if (settings.platform === 'sleeper' && settings.leagueId && settings.leagueId !== 'offline') {""",
    ),

    # ── 4. Rename: setup wizard title ──
    (
        "rename setup wizard title",
        '<Text style={styles.setupTitle}>DRAFT COPILOT</Text>',
        '<Text style={styles.setupTitle}>THE O</Text>',
    ),

    # ── 5. Rename: draft board header title ──
    (
        "rename draft board header title",
        '<Text style={styles.draftHeaderTitle}>DRAFT COPILOT</Text>',
        '<Text style={styles.draftHeaderTitle}>THE O</Text>',
    ),

    # ── 6. Rename: "WHO SHOULD I PICK?" bottom bar button ──
    (
        "rename ask-AI button to ASK THE O",
        '<Text style={styles.bottomBtnAIText}>WHO SHOULD I PICK?</Text>',
        '<Text style={styles.bottomBtnAIText}>ASK THE O</Text>',
    ),

    # ── 7. Rename: AI advice modal title ──
    (
        "rename AI advice modal title",
        '<Text style={styles.modalTitle}>AI DRAFT ADVICE</Text>',
        '<Text style={styles.modalTitle}>THE O</Text>',
    ),

    # ── 8. Rename: AI loading text ──
    (
        "rename AI loading text",
        '<Text style={styles.aiLoadingText}>Analyzing your draft...</Text>',
        '<Text style={styles.aiLoadingText}>The O is thinking...</Text>',
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
            if new.strip() == "":
                skipped += 1
                print(f"  [ALREADY]  {desc}")
            else:
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
        sys.exit(2)

    if content == original:
        print(f"\nNo changes needed ({skipped} already patched).")
        return

    TARGET.write_text(content)
    print(f"\n✓ Patched {TARGET}  ({applied} applied, {skipped} already)")


if __name__ == "__main__":
    print("=" * 60)
    print("AIOmni Hour 3 — The O (engine-powered draft intelligence)")
    print("=" * 60)
    print()
    patch_file()
    print()
    print("Verify:")
    print("  1. npx tsc --noEmit")
    print("  2. Reload Expo, open the draft tab")
    print("  3. Start a draft with your Armchair league")
    print("  4. Top of board should match Rankings tab ordering")
    print("  5. If you've moved a player in My Rankings, they should move here too")
    print()
    print("Note: the tab label in app/(tabs)/_layout.tsx may still say 'Draft' or")
    print("'Draft Copilot' — rename there manually if you want it to match.")
