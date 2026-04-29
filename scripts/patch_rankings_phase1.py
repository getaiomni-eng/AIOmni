#!/usr/bin/env python3
"""
AIOmni Phase 1 cleanup for services/rankingsData.ts.

Run from AIOmni repo root:
    python3 scripts/patch_rankings_phase1.py

Idempotent. Safe to run multiple times.
"""
from pathlib import Path
import re
import sys

DATA = Path('services/rankingsData.ts')
if not DATA.exists():
    print('[ERROR]    services/rankingsData.ts not found.')
    print('           Run this from the AIOmni repo root, e.g.:')
    print('             cd ~/AIOmni && python3 scripts/patch_rankings_phase1.py')
    sys.exit(1)

s = DATA.read_text()
orig = s
applied = []

# ─── Import getCurrentStatsSeason from nflPlayers ──────────────────────
old_import = "import { getActiveSleeperIds } from './nflPlayers';"
new_import = "import { getActiveSleeperIds, getCurrentStatsSeason } from './nflPlayers';"
if old_import in s and 'getCurrentStatsSeason' not in s:
    s = s.replace(old_import, new_import)
    applied.append('imported getCurrentStatsSeason')

# ─── ITEM 2: getCurrentDraftSeason helper, before SLEEPER section ──────
sleeper_marker = '// ─── SLEEPER ────────────────────────────────────────────────'
helper_block = '''// ─── DYNAMIC SEASON HELPERS ─────────────────────────────────

// Returns the NFL season identifier ESPN/Sleeper/Yahoo expect for
// "current ADP". Rule: March-Dec returns current calendar year (upcoming
// or in-progress season). Jan-Feb returns previous calendar year (Super
// Bowl is in February of year N for season N).
function getCurrentDraftSeason(): number {
  const now = new Date();
  return now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
}

// ─── SLEEPER ────────────────────────────────────────────────'''

if 'getCurrentDraftSeason' not in s and sleeper_marker in s:
    s = s.replace(sleeper_marker, helper_block)
    applied.append('added getCurrentDraftSeason() helper')

# ─── ITEM 2 cont: ESPN URL switches to dynamic season ──────────────────
old_espn = "'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/0?view=kona_player_info'"
new_espn = "`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${getCurrentDraftSeason()}/segments/0/leagues/0?view=kona_player_info`"
if old_espn in s:
    s = s.replace(old_espn, new_espn)
    applied.append('ESPN URL now uses getCurrentDraftSeason()')

# ─── ITEM 1: fetchSnapCounts dynamic season ─────────────────────────────
old_snaps = (
    'async function fetchSnapCounts(season = 2024): Promise<Map<string, number>> {\n'
    '  const map = new Map<string, number>();\n'
    '  try {\n'
    '    const url = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;'
)
new_snaps = (
    'async function fetchSnapCounts(seasonOverride?: number): Promise<Map<string, number>> {\n'
    '  const map = new Map<string, number>();\n'
    '  try {\n'
    '    const season = seasonOverride ?? await getCurrentStatsSeason();\n'
    '    const url = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;'
)
if old_snaps in s:
    s = s.replace(old_snaps, new_snaps)
    applied.append('fetchSnapCounts now uses getCurrentStatsSeason()')

# ─── ITEM 3: empty PROSPECT_SEED_2026 (2026 draft was Apr 23-25, 2026) ──
prospect_pattern = re.compile(
    r'const PROSPECT_SEED_2026: CollegeProspect\[\] = \[.*?\n\];',
    re.DOTALL
)
prospect_new = '''// 2026 NFL Draft completed April 23-25, 2026. Every previously-listed
// 2026 college prospect is now an NFL player (rookie). Until a 2027
// prospect dataset is curated, this seed is empty -- fetchDedupedProspects
// returns [] and the UI shows "No prospects available right now."
// TODO: source 2027 NFL Draft prospects (current college juniors/seniors)
const PROSPECT_SEED_2026: CollegeProspect[] = [];'''

m = prospect_pattern.search(s)
if m and 'CollegeProspect[] = [];' not in m.group(0):
    s = prospect_pattern.sub(prospect_new, s, count=1)
    applied.append('emptied PROSPECT_SEED_2026 (post-draft)')

# ─── ITEM 4: trend calc -- kill the spread=0 dead code ──────────────────
old_trend = """    // Trend direction
    // We no longer track per-source ranks individually after the weighted
    // blend, so spread defaults to 0 (will be replaced with a proper
    // disagreement metric when Piece 2 ships per-source rank tracking).
    const spread = 0;
    const trend: 'up' | 'down' | 'flat' =
      adds > drops * 2 ? 'up' :
      drops > adds * 2 ? 'down' :
      spread <= 5 ? 'up' : spread <= 15 ? 'flat' : 'down';"""

new_trend = """    // Trend direction -- based purely on Sleeper add/drop velocity.
    // (Was using a hardcoded spread=0 placeholder which made the
    // fallback always 'up'. Per-source rank dispersion lands later.)
    const trend: 'up' | 'down' | 'flat' =
      adds > drops * 2 ? 'up' :
      drops > adds * 2 ? 'down' :
      'flat';"""

if old_trend in s:
    s = s.replace(old_trend, new_trend)
    applied.append('fixed trend calc (was always "up")')

# ─── Write ──────────────────────────────────────────────────────────────
if s != orig:
    DATA.write_text(s)
    for a in applied:
        print(f'[APPLIED]  {a}')
    print(f'\nDone. services/rankingsData.ts: {len(applied)} change(s).')
    print('Next: npx tsc --noEmit')
else:
    print('[SKIP]     no changes (already patched?)')
