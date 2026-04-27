#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════════════
THE O — rename + copy clarity patch
═══════════════════════════════════════════════════════════════════════════

The product surface is renamed from "Draft Copilot" to "The O", but several
user-facing strings still say "Draft Copilot" and the platform-picker copy
risks confusing users into thinking The O REPLACES their draft (it doesn't).

This script makes 5 changes:

  1. app/(tabs)/draft.tsx
     - Subtitle for 'platform' step changes from
         "Choose your platform"
       to two-line stack:
         "Runs alongside your real draft"
         "Choose where your draft is happening"
     - ESPN/Yahoo platform card descriptions clarified:
         "Companion mode — mark picks as they happen"
       becomes
         "Open ESPN to draft — tap picks here as they happen" (and Yahoo)

  2. services/draft.ts
     - File header comment: "Draft Copilot" → "The O"
     - AI prompt template: "AIOmni Draft Copilot" → "The O, AIOmni's
       AI draft co-pilot" (so Claude introduces itself correctly)

  3. services/purchases.ts
     - Paywall feature list: "Draft Copilot" → "The O — AI draft co-pilot"

  4. Internal code comments left as-is on purpose:
     - aiomniEngineBridge.ts:36
     - aiomniEngine.ts:7
     - draft.tsx:105 (function name DraftCopilotScreen)
     These are non-user-facing; renaming risks router/import breakage.

Idempotent. Safe to re-run.

Run from /Users/patrickmeyer/AIOmni:
    python3 scripts/the_o_rename.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DRAFT_TSX = ROOT / "app" / "(tabs)" / "draft.tsx"
DRAFT_TS = ROOT / "services" / "draft.ts"
PURCHASES_TS = ROOT / "services" / "purchases.ts"


# ─── PATCH 1: draft.tsx subtitle + platform card copy ──────────────────────

# Subtitle change. The platform-step subtitle is currently a single string.
# We need to render TWO lines (tagline + instruction). We'll change just the
# 'platform' step entry while leaving the others alone.
OLD_SUBTITLE_LINE = "          {step === 'platform' && 'Choose your platform'}"

NEW_SUBTITLE_LINE = """          {step === 'platform' && (
            <>
              {'Runs alongside your real draft'}
              {'\\n'}
              <Text style={{ color: '#7a9eaa' }}>{'Choose where your draft is happening'}</Text>
            </>
          )}"""

# Platform card descriptions. Sleeper + Offline stay; ESPN + Yahoo get
# clearer copy that names the user action ("Open X to draft").
OLD_ESPN_DESC = "{ key: 'espn', label: 'ESPN', desc: 'Companion mode — mark picks as they happen', color: '#e52534', live: false },"
NEW_ESPN_DESC = "{ key: 'espn', label: 'ESPN', desc: 'Open ESPN to draft — tap picks here as they happen', color: '#e52534', live: false },"

OLD_YAHOO_DESC = "{ key: 'yahoo', label: 'YAHOO', desc: 'Companion mode — mark picks as they happen', color: '#7c3aed', live: false },"
NEW_YAHOO_DESC = "{ key: 'yahoo', label: 'YAHOO', desc: 'Open Yahoo to draft — tap picks here as they happen', color: '#7c3aed', live: false },"


def patch_draft_tsx():
    print("PATCH 1 — draft.tsx subtitle + platform copy")
    if not DRAFT_TSX.exists():
        print(f"  [SKIPPED]  {DRAFT_TSX} not found")
        return False

    s = DRAFT_TSX.read_text()
    original = s
    any_change = False

    # Idempotency
    if "Runs alongside your real draft" in s and "Open ESPN to draft" in s:
        print("  [ALREADY]  draft.tsx copy already updated")
        return False

    if OLD_SUBTITLE_LINE in s:
        s = s.replace(OLD_SUBTITLE_LINE, NEW_SUBTITLE_LINE)
        print("  [APPLIED]  subtitle now reads 'Runs alongside your real draft'")
        any_change = True
    elif "Runs alongside your real draft" in s:
        print("  [ALREADY]  subtitle already updated")
    else:
        print("  [WARN]     subtitle anchor not found — manual review")

    if OLD_ESPN_DESC in s:
        s = s.replace(OLD_ESPN_DESC, NEW_ESPN_DESC)
        print("  [APPLIED]  ESPN card now says 'Open ESPN to draft'")
        any_change = True
    elif "Open ESPN to draft" in s:
        print("  [ALREADY]  ESPN card already updated")

    if OLD_YAHOO_DESC in s:
        s = s.replace(OLD_YAHOO_DESC, NEW_YAHOO_DESC)
        print("  [APPLIED]  Yahoo card now says 'Open Yahoo to draft'")
        any_change = True
    elif "Open Yahoo to draft" in s:
        print("  [ALREADY]  Yahoo card already updated")

    if any_change:
        DRAFT_TSX.write_text(s)
        print(f"  ✓ {DRAFT_TSX.name} updated")
    return any_change


# ─── PATCH 2: services/draft.ts header + AI prompt ─────────────────────────

OLD_DRAFT_HEADER = "// AIOmni Draft Copilot — Unified Draft Service"
NEW_DRAFT_HEADER = "// The O — AIOmni's AI Draft Co-Pilot — Unified Draft Service"

# The AI prompt template tells Claude "You are AIOmni Draft Copilot." Change
# so the AI introduces itself by the new product name when it greets the user.
OLD_AI_PROMPT_LINE = "  return `You are AIOmni Draft Copilot. You are advising a fantasy football manager during a live ${settings.draftType} draft."
NEW_AI_PROMPT_LINE = "  return `You are The O, AIOmni's AI draft co-pilot. You are advising a fantasy football manager during a live ${settings.draftType} draft."


def patch_draft_ts():
    print()
    print("PATCH 2 — services/draft.ts header + AI prompt")
    if not DRAFT_TS.exists():
        print(f"  [SKIPPED]  {DRAFT_TS} not found")
        return False

    s = DRAFT_TS.read_text()
    original = s
    any_change = False

    if OLD_DRAFT_HEADER in s:
        s = s.replace(OLD_DRAFT_HEADER, NEW_DRAFT_HEADER)
        print("  [APPLIED]  file header renamed to The O")
        any_change = True
    elif "The O — AIOmni's AI Draft Co-Pilot" in s:
        print("  [ALREADY]  file header already renamed")

    if OLD_AI_PROMPT_LINE in s:
        s = s.replace(OLD_AI_PROMPT_LINE, NEW_AI_PROMPT_LINE)
        print("  [APPLIED]  AI prompt now introduces self as 'The O'")
        any_change = True
    elif "You are The O, AIOmni's AI draft co-pilot" in s:
        print("  [ALREADY]  AI prompt already updated")

    if any_change:
        DRAFT_TS.write_text(s)
        print(f"  ✓ {DRAFT_TS.name} updated")
    return any_change


# ─── PATCH 3: purchases.ts paywall feature copy ────────────────────────────

OLD_PURCHASES_LINE = "      'Draft Copilot',"
NEW_PURCHASES_LINE = "      'The O — AI draft co-pilot',"


def patch_purchases_ts():
    print()
    print("PATCH 3 — services/purchases.ts paywall copy")
    if not PURCHASES_TS.exists():
        print(f"  [SKIPPED]  {PURCHASES_TS} not found")
        return False

    s = PURCHASES_TS.read_text()
    if OLD_PURCHASES_LINE in s:
        s = s.replace(OLD_PURCHASES_LINE, NEW_PURCHASES_LINE)
        PURCHASES_TS.write_text(s)
        print("  [APPLIED]  paywall now lists 'The O — AI draft co-pilot'")
        print(f"  ✓ {PURCHASES_TS.name} updated")
        return True
    elif "The O — AI draft co-pilot" in s:
        print("  [ALREADY]  paywall already updated")
        return False
    else:
        print("  [WARN]     paywall line not found at expected location")
        return False


# ─── MAIN ──────────────────────────────────────────────────────────────────

def main():
    print("=" * 72)
    print("THE O — rename + copy clarity patch")
    print("=" * 72)
    print()

    a = patch_draft_tsx()
    b = patch_draft_ts()
    c = patch_purchases_ts()

    print()
    print("=" * 72)
    if a or b or c:
        print("✓ Patches applied")
    else:
        print("(no changes — patches may already be applied)")
    print("=" * 72)
    print()
    print("Verify:")
    print("  npx tsc --noEmit")
    print()
    print("If clean, commit:")
    print("  git add -A")
    print("  git commit -m 'The O: rename + clarify alongside-real-draft copy'")
    print("  git push")
    print()
    print("NOT changed by this script (intentional):")
    print("  - DraftCopilotScreen function name (router/import risk)")
    print("  - Internal comments in aiomniEngine.ts / aiomniEngineBridge.ts")
    print("  - Marketing site index.html — update separately when deploying")


if __name__ == "__main__":
    main()
