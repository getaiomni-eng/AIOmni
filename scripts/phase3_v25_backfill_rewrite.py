#!/usr/bin/env python3
"""
AIOmni Phase 3 v2.5 prep — backfill REWRITE.

The first attempt failed with 257/257 unmatched because nfl_players only
contains 12 rookies from the 2026 class (all UDFAs). The actual drafted
players don\\'t exist in the table at all -- nflverse sync hasn\\'t pushed
them yet.

This rewrite:
  1. INSERTS a new nfl_players row for every drafted player not already
     present, with synthetic gsis_id like "2026_pick_NNN".
  2. Sets draft_year=2026, draft_round, draft_pick, position, team,
     rookie_year=2026, is_active=true.
  3. When nflverse-daily-sync eventually picks them up with their real
     gsis_id, we can either dedupe or live with both rows for now.

Note: the engine reads draft data via gsis_id but joins to weekly stats
the same way. Synthetic gsis_ids will have NO weekly stats (since they
haven\\'t played pro football yet), so the engine\\'s rookie-only baseline
logic will fire correctly.
"""
from pathlib import Path
import sys
import re

ROOT = Path('.')
SUPA = ROOT / 'supabase' / 'functions'
BACKFILL = SUPA / 'backfill-2026-draft' / 'index.ts'

if not BACKFILL.exists():
    print(f'[ERROR]    {BACKFILL} not found. Run the first backfill script first.')
    sys.exit(1)

# Need to also parse team from your draft document. I'll embed the
# pick-to-team mapping here, derived from the document Patrick pasted.
# Format: pick number -> team abbreviation.

PICK_TO_TEAM = {
    1: 'LV', 2: 'NYJ', 3: 'ARI', 4: 'TEN', 5: 'NYG', 6: 'KC',
    7: 'WAS', 8: 'NO', 9: 'CLE', 10: 'NYG', 11: 'DAL', 12: 'MIA',
    13: 'LAR', 14: 'BAL', 15: 'TB', 16: 'NYJ', 17: 'DET', 18: 'MIN',
    19: 'CAR', 20: 'PHI', 21: 'PIT', 22: 'LAC', 23: 'DAL', 24: 'CLE',
    25: 'CHI', 26: 'HOU', 27: 'MIA', 28: 'NE', 29: 'KC', 30: 'NYJ',
    31: 'TEN', 32: 'SEA',
    # R2
    33: 'SF', 34: 'ARI', 35: 'BUF', 36: 'HOU', 37: 'NYG', 38: 'LV',
    39: 'CLE', 40: 'KC', 41: 'CIN', 42: 'NO', 43: 'MIA', 44: 'DET',
    45: 'BAL', 46: 'TB', 47: 'PIT', 48: 'ATL', 49: 'CAR', 50: 'NYJ',
    51: 'MIN', 52: 'GB', 53: 'IND', 54: 'PHI', 55: 'NE', 56: 'JAX',
    57: 'CHI', 58: 'CLE', 59: 'HOU', 60: 'TEN', 61: 'LAR', 62: 'BUF',
    63: 'LAC', 64: 'SEA',
    # R3
    65: 'ARI', 66: 'DEN', 67: 'LV', 68: 'PHI', 69: 'CHI', 70: 'SF',
    71: 'WAS', 72: 'CIN', 73: 'NO', 74: 'KC', 75: 'MIA', 76: 'PIT',
    77: 'TB', 78: 'IND', 79: 'ATL', 80: 'BAL', 81: 'JAX', 82: 'MIN',
    83: 'CAR', 84: 'TB', 85: 'PIT', 86: 'CLE', 87: 'MIA', 88: 'JAX',
    89: 'CHI', 90: 'SF', 91: 'LV', 92: 'DAL', 93: 'LAR', 94: 'MIA',
    95: 'NE', 96: 'PIT', 97: 'MIN', 98: 'MIN', 99: 'SEA', 100: 'JAX',
    # R4
    101: 'LV', 102: 'BUF', 103: 'NYJ', 104: 'ARI', 105: 'LAC', 106: 'HOU',
    107: 'SF', 108: 'DEN', 109: 'KC', 110: 'NYJ', 111: 'DEN', 112: 'DAL',
    113: 'IND', 114: 'DAL', 115: 'BAL', 116: 'TB', 117: 'LAC', 118: 'DET',
    119: 'CAR', 120: 'GB', 121: 'PIT', 122: 'LV', 123: 'HOU', 124: 'CHI',
    125: 'BUF', 126: 'BUF', 127: 'SF', 128: 'CIN', 129: 'CAR', 130: 'MIA',
    131: 'LAC', 132: 'NO', 133: 'BAL', 134: 'ATL', 135: 'IND', 136: 'NO',
    137: 'DAL', 138: 'MIA', 139: 'SF', 140: 'CIN',
    # R5
    141: 'HOU', 142: 'TEN', 143: 'ARI', 144: 'CAR', 145: 'LAC', 146: 'CLE',
    147: 'WAS', 148: 'SEA', 149: 'CLE', 150: 'LV', 151: 'CAR', 152: 'DEN',
    153: 'GB', 154: 'SF', 155: 'TB', 156: 'IND', 157: 'DET', 158: 'MIA',
    159: 'MIN', 160: 'TB', 161: 'KC', 162: 'BAL', 163: 'MIN', 164: 'JAX',
    165: 'TEN', 166: 'CHI', 167: 'BUF', 168: 'DET', 169: 'PIT', 170: 'CLE',
    171: 'NE', 172: 'NO', 173: 'BAL', 174: 'BAL', 175: 'LV', 176: 'KC',
    177: 'MIA', 178: 'PHI', 179: 'SF', 180: 'MIA', 181: 'BUF',
    # R6
    182: 'CLE', 183: 'ARI', 184: 'TEN', 185: 'TB', 186: 'NYG', 187: 'WAS',
    188: 'NYJ', 189: 'CIN', 190: 'NO', 191: 'JAX', 192: 'NYG', 193: 'NYG',
    194: 'TEN', 195: 'LV', 196: 'NE', 197: 'LAR', 198: 'MIN', 199: 'SEA',
    200: 'MIA', 201: 'GB', 202: 'LAC', 203: 'JAX', 204: 'HOU', 205: 'DET',
    206: 'LAC', 207: 'PHI', 208: 'ATL', 209: 'WAS', 210: 'PIT', 211: 'BAL',
    212: 'NE', 213: 'CHI', 214: 'IND', 215: 'ATL', 216: 'GB',
    # R7
    217: 'ARI', 218: 'DAL', 219: 'NO', 220: 'BUF', 221: 'CIN', 222: 'DET',
    223: 'WAS', 224: 'PIT', 225: 'TEN', 226: 'CIN', 227: 'CAR', 228: 'NYJ',
    229: 'LV', 230: 'PIT', 231: 'ATL', 232: 'LAR', 233: 'JAX', 234: 'NE',
    235: 'MIN', 236: 'SEA', 237: 'IND', 238: 'MIA', 239: 'BUF', 240: 'JAX',
    241: 'BUF', 242: 'SEA', 243: 'HOU', 244: 'PHI', 245: 'NE', 246: 'DEN',
    247: 'NE', 248: 'CLE', 249: 'KC', 250: 'BAL', 251: 'PHI', 252: 'PHI',
    253: 'BAL', 254: 'IND', 255: 'SEA', 256: 'DEN', 257: 'DEN',
}

# Read the existing backfill function
s = BACKFILL.read_text()

# Build a TS literal of the pick->team map
team_map_ts = 'const PICK_TO_TEAM: Record<number, string> = {\n'
for pick in sorted(PICK_TO_TEAM.keys()):
    team_map_ts += f'  {pick}: "{PICK_TO_TEAM[pick]}",\n'
team_map_ts += '};\n\n'

# Find the existing serve handler and replace it with one that handles inserts
# We replace from the `serve(async (req)` line onward.

new_serve_block = team_map_ts + '''function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const startedAt = Date.now();

    // Pull ALL nfl_players to attempt name matching across the whole table
    // (not just draft_year=2026, since nflverse may not have synced these yet).
    const allPlayers: any[] = [];
    const CHUNK = 1000;
    let offset = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('nfl_players')
        .select('gsis_id, full_name, position')
        .range(offset, offset + CHUNK - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allPlayers.push(...data);
      if (data.length < CHUNK) break;
      offset += CHUNK;
      if (offset > 10000) break;
    }

    const byName = new Map<string, { gsis_id: string; position: string }>();
    for (const p of allPlayers) {
      if (p.full_name) byName.set(normalize(p.full_name), { gsis_id: p.gsis_id, position: p.position });
    }

    let updated = 0;
    let inserted = 0;
    const failures: string[] = [];

    for (const pick of DRAFT_2026) {
      const key = normalize(pick.n);
      const existing = byName.get(key);
      const team = PICK_TO_TEAM[pick.p] ?? null;

      if (existing) {
        // Update existing row with draft data
        const { error } = await supabase
          .from('nfl_players')
          .update({
            draft_year: 2026,
            draft_round: pick.r,
            draft_pick: pick.p,
            rookie_year: 2026,
            team,
          })
          .eq('gsis_id', existing.gsis_id);
        if (error) {
          failures.push(`update ${pick.n}: ${error.message}`);
        } else {
          updated++;
        }
      } else {
        // Insert new row with synthetic gsis_id
        const synthId = `2026_pick_${String(pick.p).padStart(3, '0')}`;
        const { error } = await supabase
          .from('nfl_players')
          .insert({
            gsis_id: synthId,
            full_name: pick.n,
            position: pick.pos,
            team,
            draft_year: 2026,
            draft_round: pick.r,
            draft_pick: pick.p,
            rookie_year: 2026,
            is_active: true,
            years_exp: 0,
          });
        if (error) {
          failures.push(`insert ${pick.n}: ${error.message}`);
        } else {
          inserted++;
        }
      }
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    return new Response(JSON.stringify({
      ok: true,
      total_picks: DRAFT_2026.length,
      updated,
      inserted,
      failures: failures.length,
      failure_sample: failures.slice(0, 10),
      duration_seconds: duration,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('backfill-2026-draft error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
'''

# Replace from "function normalize(" through end of file
serve_start = s.find('function normalize(')
if serve_start == -1:
    print('[ERROR]    could not find normalize() function in existing backfill')
    sys.exit(1)

s = s[:serve_start] + new_serve_block

BACKFILL.write_text(s)
print('[APPLIED]  backfill-2026-draft rewritten to INSERT new players + UPDATE existing ones')
print('           Includes pick-to-team mapping for all 257 picks.')
print()
print('Now redeploy + re-trigger:')
print('  supabase functions deploy backfill-2026-draft')
print('  curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/backfill-2026-draft" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
print()
print('Expected: ok:true, updated:0-12 (existing UDFAs), inserted:245+, failures:few or zero.')
