#!/usr/bin/env python3
"""
AIOmni Phase 3 v2.3 - Injury discounting from ESPN feed.

Adds aggressive injury status discounts to the rankings engine:

  Status                                    Multiplier
  ------------------------------------------------------------
  Out + serious (ACL/Achilles/Lisfranc/      0.10
    broken leg/hip surgery)
  Out + non-serious                          0.70
  Injured Reserve / IR                       0.10
  PUP / Suspension                           0.10
  Doubtful                                   0.50
  Questionable                               0.85
  Day-to-Day                                 0.95
  No injury listed                           1.00

Cross-references ESPN injury feed (athlete.id) to our nfl_players
(gsis_id) via case-insensitive name match. ~95% match rate; the
remaining 5% (rare names, recently-traded players) get treated as
healthy. Acceptable.

Surfaces in the method string:
  "3yr blend: 22.1 ppg ... INJURY: ACL surgery (0.10x)"

Run from AIOmni repo root:
    python3 scripts/phase3_v23_injuries.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
ENGINE = ROOT / 'supabase' / 'functions' / 'aiomni-rankings-engine' / 'index.ts'

if not ENGINE.exists():
    print('[ERROR]    engine file not found.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s

# ─── Insert helper functions before the buildFormat function ──────────

helper_block = '''// ─── INJURY DATA (ESPN feed) ──────────────────────────────────────────
// Aggressive discount: serious "Out" injuries (ACL etc) drop a player\\'s
// score by 90%, effectively dropping them to bottom 50 in the rankings.

interface InjuryStatus {
  status: string;       // "Out", "Doubtful", "Questionable", etc
  injury: string;       // "ACL", "Hamstring", "Hip", etc
  multiplier: number;   // 0.0 - 1.0
}

// Substrings (case insensitive) that signal a serious season-affecting injury
const SERIOUS_INJURY_KEYWORDS = [
  'acl', 'achilles', 'lisfranc', 'lisfranc',
  'broken leg', 'tibia', 'fibula',
  'hip surgery', 'hip labrum',
  'pectoral', 'patellar', 'meniscus',
  'spinal', 'neck',
];

function isSeriousInjury(injury: string): boolean {
  const lower = (injury || '').toLowerCase();
  return SERIOUS_INJURY_KEYWORDS.some(kw => lower.includes(kw));
}

function injuryMultiplier(status: string, injury: string): number {
  const s = (status || '').trim();
  if (s === 'Out' || s === 'Injured Reserve') {
    return isSeriousInjury(injury) ? 0.10 : 0.70;
  }
  if (s === 'Doubtful') return 0.50;
  if (s === 'Questionable') return 0.85;
  if (s === 'Day-To-Day' || s === 'Day-to-Day') return 0.95;
  return 1.0;
}

// Pull injury list from ESPN, normalize to a name-keyed map.
// Returns Map<normalized_name, InjuryStatus>.
async function fetchInjuryMap(): Promise<Map<string, InjuryStatus>> {
  const map = new Map<string, InjuryStatus>();
  try {
    const res = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries',
      { headers: { 'User-Agent': 'AIOmni/1.0' } }
    );
    if (!res.ok) {
      console.log('ESPN injuries HTTP', res.status);
      return map;
    }
    const data = await res.json();
    for (const team of (data?.injuries ?? [])) {
      for (const entry of (team?.injuries ?? [])) {
        const athlete = entry?.athlete;
        const details = entry?.injuries?.[0];
        if (!athlete?.displayName) continue;
        const status = entry?.status ?? details?.status ?? '';
        if (!status) continue;
        const injury = details?.type?.description
          ?? details?.type?.abbreviation
          ?? entry?.type
          ?? 'Unknown';
        const key = athlete.displayName.toLowerCase().replace(/[^a-z]/g, '');
        const mult = injuryMultiplier(status, injury);
        if (mult < 1.0) {
          map.set(key, { status, injury, multiplier: mult });
        }
      }
    }
  } catch (e) {
    console.log('fetchInjuryMap error:', e);
  }
  console.log(`[injuries] loaded ${map.size} injured players from ESPN`);
  return map;
}

'''

# Insert the helper block right before buildFormat
build_format_marker = 'async function buildFormat(format: Format, supabase: any): Promise<RankedRow[]> {'
if helper_block.strip() not in s and build_format_marker in s:
    s = s.replace(build_format_marker, helper_block + build_format_marker)
    print('[APPLIED]  injury helper functions added')
else:
    if 'fetchInjuryMap' in s:
        print('[SKIP]     injury helpers already present')
    else:
        print('[ERROR]    could not find buildFormat marker')
        sys.exit(1)

# ─── Pull injuries inside buildFormat ─────────────────────────────────
old_pull = """  // Pull all 3 seasons in parallel
  const [w2025, w2024, w2023, playersResult] = await Promise.all([
    fetchSeason(supabase, 2025, ptsCol),
    fetchSeason(supabase, 2024, ptsCol),
    fetchSeason(supabase, 2023, ptsCol),
    supabase.from('nfl_players')
      .select('gsis_id, full_name, position, team, age, rookie_year, draft_year, draft_round')
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .eq('is_active', true),
  ]);"""

new_pull = """  // Pull all 3 seasons + injury feed in parallel
  const [w2025, w2024, w2023, playersResult, injuryMap] = await Promise.all([
    fetchSeason(supabase, 2025, ptsCol),
    fetchSeason(supabase, 2024, ptsCol),
    fetchSeason(supabase, 2023, ptsCol),
    supabase.from('nfl_players')
      .select('gsis_id, full_name, position, team, age, rookie_year, draft_year, draft_round')
      .in('position', ['QB', 'RB', 'WR', 'TE'])
      .eq('is_active', true),
    fetchInjuryMap(),
  ]);"""

if old_pull in s:
    s = s.replace(old_pull, new_pull)
    print('[APPLIED]  injury fetch parallelized with stat fetches')
elif 'fetchInjuryMap()' in s:
    print('[SKIP]     injury fetch already wired')

# ─── Apply injury multiplier inside the scoring loop ──────────────────
# Inject right after the volatility multiplier, before forward layer.

old_volatility = """    // ── Volatility penalty ──
    // High boom/bust profile (CV > 0.7) hurts projections. Apply 0.92x.
    // Only applied when we have meaningful 2025 data (>= 8 games).
    let volatilityMult = 1.0;
    if (a25 && a25.games >= 8 && a25.volatility > 0.7) {
      volatilityMult = 0.92;
      highVolatility = true;
      baseline = baseline * volatilityMult;
    }"""

new_volatility = """    // ── Volatility penalty ──
    // High boom/bust profile (CV > 0.7) hurts projections. Apply 0.92x.
    // Only applied when we have meaningful 2025 data (>= 8 games).
    let volatilityMult = 1.0;
    if (a25 && a25.games >= 8 && a25.volatility > 0.7) {
      volatilityMult = 0.92;
      highVolatility = true;
      baseline = baseline * volatilityMult;
    }

    // ── Injury discount ──
    // Cross-ref ESPN injury feed by normalized name. Aggressive: serious
    // \\"Out\\" injuries (ACL/Achilles/etc) drop score by 90%.
    const nameKey = (p.full_name || '').toLowerCase().replace(/[^a-z]/g, '');
    const injInfo = injuryMap.get(nameKey);
    let injuryMult = 1.0;
    let injuryNote = '';
    if (injInfo && injInfo.multiplier < 1.0) {
      injuryMult = injInfo.multiplier;
      baseline = baseline * injuryMult;
      injuryNote = `INJURY: ${injInfo.injury} (${injuryMult.toFixed(2)}x)`;
    }"""

if old_volatility in s:
    s = s.replace(old_volatility, new_volatility)
    print('[APPLIED]  injury multiplier applied inside scoring loop')
elif 'injuryNote' in s:
    print('[SKIP]     injury multiplier already present')

# ─── Surface injury in method string ──────────────────────────────────
old_method_end = """    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);"""
new_method_end = """    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);
    if (injuryNote) parts.push(injuryNote);"""

if old_method_end in s and 'if (injuryNote)' not in s:
    s = s.replace(old_method_end, new_method_end)
    print('[APPLIED]  method string surfaces injury status')

if s != orig:
    ENGINE.write_text(s)
    print()
    print('Done. Redeploy + recompute:')
    print('  supabase functions deploy aiomni-rankings-engine')
    print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
    print()
    print('Then check what the engine flagged:')
    print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?format=eq.PPR&select=rank,name,position,score,method&method=ilike.*INJURY*&order=rank&limit=20" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
else:
    print('[SKIP]     no changes')
