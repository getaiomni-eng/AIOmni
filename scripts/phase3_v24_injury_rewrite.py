#!/usr/bin/env python3
"""
AIOmni Phase 3 v2.4 — injury parser rewrite + single-season penalty.

Two fixes:

1. INJURY PARSER (was broken). ESPN's response shape is:
     entry.status                 -- top-level "Out"/"Doubtful"/"Questionable"
     entry.shortComment           -- string with injury context
     entry.longComment            -- longer string with full medical detail
   There is NO entry.injury or entry.injuries[0].type. My v2.3 parser
   was reading from a path that didn\\'t exist, so:
     - injury type rendered as "[object Object]"
     - status fell through to default 1.0x then got reassigned to 0.85x
       somehow elsewhere in the chain

   The new parser:
     - reads entry.status directly
     - searches BOTH comments for medical keywords (achilles, acl, etc)
     - OVERRIDES "Questionable" status when comment text mentions a
       tear/surgery — covers cases like Kittle (officially Questionable
       but actually recovering from torn Achilles)

2. SINGLE-SEASON CONFIDENCE PENALTY. Players with only 1 year of NFL
   data get a 0.90x score multiplier. Reflects that a 1-year sample
   (especially a rookie hot streak) carries less signal than 2-3 years
   of established production. Stops Skattebo-style overrankings.

Run from AIOmni repo root:
    python3 scripts/phase3_v24_injury_rewrite.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
ENGINE = ROOT / 'supabase' / 'functions' / 'aiomni-rankings-engine' / 'index.ts'

if not ENGINE.exists():
    print('[ERROR]    engine not found.')
    sys.exit(1)

s = ENGINE.read_text()
orig = s

# ─── FIX 1a: Replace the entire injury helper block ──────────────────

# Match from "// ─── INJURY DATA" comment header through the closing of
# fetchInjuryMap function. We replace the whole thing with a corrected
# version that reads ESPN\\'s actual shape.

# Find the start of the injury helpers and the end (the closing '}' of
# fetchInjuryMap, which is followed by an empty line and then the
# buildFormat declaration).

start_marker = '// ─── INJURY DATA (ESPN feed) ──'
end_marker = '\nasync function buildFormat(format: Format, supabase: any): Promise<RankedRow[]> {'

start_idx = s.find(start_marker)
end_idx = s.find(end_marker, start_idx) if start_idx != -1 else -1

if start_idx == -1 or end_idx == -1:
    print('[ERROR]    could not locate injury helper block boundaries')
    print(f'           start_idx={start_idx} end_idx={end_idx}')
    sys.exit(1)

NEW_HELPERS = '''// ─── INJURY DATA (ESPN feed) ──────────────────────────────────────────
// Aggressive discount: serious injuries (ACL/Achilles/Lisfranc/etc) drop
// a player\\'s score by 90%, effectively pushing them to bottom 50.
//
// ESPN shape (verified April 2026):
//   entry.status         -- "Out" | "Doubtful" | "Questionable" | "Day-To-Day"
//   entry.shortComment   -- one-sentence summary (search for injury keywords)
//   entry.longComment    -- full paragraph, also searched for keywords
//
// Important: ESPN sometimes lists "Questionable" for players whose injury
// is actually season-affecting (e.g. Kittle Achilles tear is listed
// Questionable because they are "hopeful for Week 1"). We override the
// status to a stricter discount when comment text indicates tear/surgery.

interface InjuryStatus {
  status: string;
  injury: string;
  multiplier: number;
}

const SERIOUS_INJURY_KEYWORDS = [
  'achilles', 'acl', 'lisfranc',
  'torn', 'tear', 'ruptured',
  'broken leg', 'broken tibia', 'broken fibula',
  'hip surgery', 'hip labrum',
  'pectoral', 'patellar', 'meniscus',
  'spinal', 'neck surgery',
  'foot surgery',
];

function detectInjuryFromText(...texts: (string | undefined)[]): string {
  // Returns a short label like "Achilles" or "ACL" if found in the text;
  // empty string if nothing matched.
  const blob = texts.filter(Boolean).join(' ').toLowerCase();
  if (!blob) return '';
  if (blob.includes('achilles')) return 'Achilles';
  if (blob.includes('acl')) return 'ACL';
  if (blob.includes('lisfranc')) return 'Lisfranc';
  if (blob.includes('pectoral')) return 'Pectoral';
  if (blob.includes('patellar')) return 'Patellar';
  if (blob.includes('meniscus')) return 'Meniscus';
  if (blob.includes('hip surgery') || blob.includes('hip labrum')) return 'Hip surgery';
  if (blob.includes('foot surgery')) return 'Foot surgery';
  if (blob.includes('broken leg') || blob.includes('broken tibia') || blob.includes('broken fibula')) return 'Broken leg';
  if (blob.includes('hamstring')) return 'Hamstring';
  if (blob.includes('shoulder')) return 'Shoulder';
  if (blob.includes('ankle')) return 'Ankle';
  if (blob.includes('knee')) return 'Knee';
  if (blob.includes('back')) return 'Back';
  if (blob.includes('concussion')) return 'Concussion';
  return '';
}

function isSeriousFromText(...texts: (string | undefined)[]): boolean {
  const blob = texts.filter(Boolean).join(' ').toLowerCase();
  return SERIOUS_INJURY_KEYWORDS.some(kw => blob.includes(kw));
}

function injuryMultiplier(status: string, isSerious: boolean): number {
  const s = (status || '').trim();
  if (s === 'Out' || s === 'Injured Reserve') {
    return isSerious ? 0.10 : 0.70;
  }
  if (s === 'Doubtful') {
    return isSerious ? 0.20 : 0.50;
  }
  if (s === 'Questionable') {
    // Override: even Questionable status gets aggressive discount when
    // comment text reveals a serious tear/surgery underneath.
    return isSerious ? 0.30 : 0.85;
  }
  if (s === 'Day-To-Day' || s === 'Day-to-Day') return 0.95;
  return 1.0;
}

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
        if (!athlete?.displayName) continue;
        const status = entry?.status ?? '';
        if (!status) continue;
        const longC = entry?.longComment ?? '';
        const shortC = entry?.shortComment ?? '';
        const injury = detectInjuryFromText(shortC, longC) || 'Unspecified';
        const isSerious = isSeriousFromText(shortC, longC);
        const mult = injuryMultiplier(status, isSerious);
        if (mult < 1.0) {
          const key = athlete.displayName.toLowerCase().replace(/[^a-z]/g, '');
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

s = s[:start_idx] + NEW_HELPERS + s[end_idx + 1:]
print('[APPLIED]  injury helper block rewritten with correct ESPN shape parser')

# ─── FIX 1b: Replace the broken `injuryNote` template literal that
# referenced injInfo.injury (which was an object before, will be a clean
# string now). The line is fine as-is but let me verify it survived. ──
if "injuryNote = `INJURY: ${injInfo.injury} (${injuryMult.toFixed(2)}x)`;" not in s:
    print('[WARN]     injury template literal not found, may need manual review')

# ─── FIX 2: Single-season sample-size penalty ────────────────────────
# Insert right after the volatility penalty block.

old_post_volatility = '''    let volatilityMult = 1.0;
    if (a25 && a25.games >= 8 && a25.volatility > 0.7) {
      volatilityMult = 0.92;
      highVolatility = true;
      baseline = baseline * volatilityMult;
    }

    // ── Injury discount ──'''

new_post_volatility = '''    let volatilityMult = 1.0;
    if (a25 && a25.games >= 8 && a25.volatility > 0.7) {
      volatilityMult = 0.92;
      highVolatility = true;
      baseline = baseline * volatilityMult;
    }

    // ── Sample-size confidence penalty ──
    // Players with only 1 year of meaningful data (typically rookies
    // who flashed late) get a 0.90x multiplier. Reflects that 1-season
    // samples carry less signal than 2-3 year track records.
    let sampleSizePenalty = false;
    const yearsOfData = (has25 ? 1 : 0) + (has24 ? 1 : 0) + (has23 ? 1 : 0);
    if (yearsOfData === 1 && !isRookie) {
      baseline = baseline * 0.90;
      sampleSizePenalty = true;
    }

    // ── Injury discount ──'''

if old_post_volatility in s:
    s = s.replace(old_post_volatility, new_post_volatility)
    print('[APPLIED]  single-season sample-size penalty added (0.90x for 1-yr data)')
else:
    print('[WARN]     could not insert single-season penalty (anchor not found)')

# Surface in method string
old_method_anchor = '''    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);
    if (injuryNote) parts.push(injuryNote);'''

new_method_anchor = '''    if (Math.abs(oppAdj) >= 0.03) parts.push(`opp ${oppAdj > 0 ? '+' : ''}${(oppAdj * 100).toFixed(0)}%`);
    if (sampleSizePenalty) parts.push('1yr sample (0.90x)');
    if (injuryNote) parts.push(injuryNote);'''

if old_method_anchor in s:
    s = s.replace(old_method_anchor, new_method_anchor)
    print('[APPLIED]  method string surfaces sample-size penalty')

if s != orig:
    ENGINE.write_text(s)
    print()
    print('Done. Redeploy + recompute:')
    print('  supabase functions deploy aiomni-rankings-engine')
    print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
    print()
    print('Then verify Kittle (should be ~0.30x with Questionable+Achilles override):')
    print('  curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_proprietary_rankings?format=eq.PPR&select=rank,pos_rank,name,score,method&name=ilike.*kittle*" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool')
else:
    print('[SKIP]     no changes')
