#!/usr/bin/env python3
"""
AIOmni Prospects tab UX fix.

Two issues observed post-Phase-1:
  1. Empty PROSPECT_SEED_2026 (correct, since 2026 draft happened) was
     being treated as a fetch failure -- showed red "COULDN'T LOAD" UI
     with a useless "TRY AGAIN" button.
  2. Prospects mode rendered without the navigation Header, leaving
     users stranded (had to tap another bottom tab to escape).

Fixes:
  A. handleProspectsTab no longer calls setProspectsError() on empty
     data. It just sets prospects = [] and lets the rendering layer
     decide what to show.
  B. New "OFFSEASON" empty-state branch in the prospects rendering
     between loading and the .map. Shows correct post-draft copy.
  C. Wraps the entire prospects mode in a ScrollView with Header at
     the top so the COMMUNITY / MY RANKINGS / PROSPECTS toggle is
     always reachable.

Run from AIOmni repo root:
    python3 scripts/fix_prospects_ux.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
TSX  = ROOT / 'app' / '(tabs)' / 'rankings.tsx'

if not TSX.exists():
    print(f'[ERROR]    {TSX} not found.')
    print('           Run from AIOmni repo root:')
    print('             cd ~/AIOmni && python3 scripts/fix_prospects_ux.py')
    sys.exit(1)

s = TSX.read_text()
orig = s
applied = []

# ── FIX A: empty data is not an error ──────────────────────────────────

old_handle = """        if (data.length > 0) {
          setProspects(data);
        } else {
          setProspectsError('No prospects available right now. Check back closer to the NFL Draft.');
        }"""

new_handle = """        // Empty data is the offseason state, not a fetch failure. Real
        // errors (timeout, network) throw and hit the catch block where
        // "TRY AGAIN" makes sense. Empty just renders the offseason state.
        setProspects(data);"""

if old_handle in s:
    s = s.replace(old_handle, new_handle)
    applied.append('handleProspectsTab no longer treats empty data as an error')

# ── FIX B: add OFFSEASON empty state branch ────────────────────────────

old_loading_to_final = """              <Text style={{ color: dark.textMuted, fontFamily: F.body, marginTop: 12 }}>Loading prospects...</Text>
            </View>
          ) : (
            prospects.filter(p =>"""

new_with_empty_state = """              <Text style={{ color: dark.textMuted, fontFamily: F.body, marginTop: 12 }}>Loading prospects...</Text>
            </View>
          ) : prospects.length === 0 ? (
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 14, color: dark.textMuted, letterSpacing: 2, marginBottom: 12 }}>OFFSEASON</Text>
              <Text style={{ color: dark.textMuted, fontFamily: F.body, fontSize: 13, lineHeight: 20, textAlign: 'center' }}>
                2026 NFL Draft complete — those rookies now appear in your regular rankings. The 2027 prospect class will be ranked closer to the season.
              </Text>
            </View>
          ) : (
            prospects.filter(p =>"""

if old_loading_to_final in s:
    s = s.replace(old_loading_to_final, new_with_empty_state)
    applied.append('added OFFSEASON empty-state branch with post-draft copy')

# ── FIX C: wrap prospects mode in ScrollView + Header ──────────────────

old_prospects_open = """        {mode === 'prospects' && (
          prospectsGated ? ("""

new_prospects_open = """        {mode === 'prospects' && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: SP[3], paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            <Header />
            {prospectsGated ? ("""

if old_prospects_open in s:
    s = s.replace(old_prospects_open, new_prospects_open)
    applied.append('wrapped prospects mode in ScrollView with navigation Header')

old_prospects_close = """              );
            })
          )
        )}"""

new_prospects_close = """              );
            })
          )}
          </ScrollView>
        )}"""

if old_prospects_close in s:
    s = s.replace(old_prospects_close, new_prospects_close)
    applied.append('closed ScrollView wrapper')

# ── Write ───────────────────────────────────────────────────────────────

if s != orig:
    TSX.write_text(s)
    for a in applied:
        print(f'[APPLIED]  {a}')
    print(f'\nDone. {len(applied)} change(s).')
    print('Next: npx tsc --noEmit')
else:
    print('[SKIP]     no changes (already patched?)')
