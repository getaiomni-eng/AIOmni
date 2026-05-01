#!/usr/bin/env python3
"""
Yahoo proxy client wiring + KTC source removal.

After yahoo-rankings-proxy is deployed and the OAuth flow is complete,
this patch wires the proxy into the client and drops KTC.

Three changes:

  1. fetchYahooADP() in services/rankingsData.ts now PREFERS the
     server-side proxy. Falls back to per-user token if proxy unavailable.

  2. Removes the fleaflicker case from the source dispatcher in
     services/rankingsData.ts.

  3. Removes the KeepTradeCut entry from BASE_SOURCES in
     app/(tabs)/rankings.tsx.

Run from AIOmni repo root:
    python3 scripts/yahoo_wiring_v2.py
"""
from pathlib import Path
import sys

ROOT = Path('.')
DATA = ROOT / 'services' / 'rankingsData.ts'
TSX  = ROOT / 'app' / '(tabs)' / 'rankings.tsx'

if not DATA.exists():
    print(f'[ERROR]    {DATA} not found')
    sys.exit(1)
if not TSX.exists():
    print(f'[ERROR]    {TSX} not found')
    sys.exit(1)

applied = []
warnings = []

# ─── PATCH 1: fetchYahooADP -- prefer proxy, fallback to per-user ──

s = DATA.read_text()
orig = s

# Match the function start through its closing brace. Use a unique
# anchor (the opening try block) to find the function.
old1 = "export async function fetchYahooADP(): Promise<RankedPlayer[]> {\n  try {\n    const { getValidYahooToken } = require('./yahoo');\n    const token = await getValidYahooToken();\n    if (!token) return [];"

new1 = """export async function fetchYahooADP(): Promise<RankedPlayer[]> {
  // 1) Try the server-side service-account proxy first.
  //    Always available, no per-user auth required.
  try {
    const proxyUrl = `${SUPABASE_URL}/functions/v1/yahoo-rankings-proxy`;
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && Array.isArray(data.players)) {
        return data.players as RankedPlayer[];
      }
    }
  } catch (e) {
    console.log('fetchYahooADP proxy error, falling back to per-user token:', e);
  }

  // 2) Fallback: per-user Yahoo token (works only when user is signed in).
  try {
    const { getValidYahooToken } = require('./yahoo');
    const token = await getValidYahooToken();
    if (!token) return [];"""

if old1 in s:
    s = s.replace(old1, new1)
    applied.append('fetchYahooADP: prefers server-side proxy with per-user fallback')
else:
    warnings.append('fetchYahooADP block not found -- maybe already patched')

# ─── PATCH 2: drop fleaflicker dispatcher case ──────────────────────

old2 = "    case 'mfl':         return fetchMFLADP(leagueType, scoringRules);\n    case 'fleaflicker': return fetchFleaflickerADP(leagueType, scoringRules);"

new2 = "    case 'mfl':         return fetchMFLADP(leagueType, scoringRules);\n    // KeepTradeCut source removed -- using Yahoo + Sleeper + MFL instead"

if old2 in s:
    s = s.replace(old2, new2)
    applied.append('rankingsData.ts: removed fleaflicker dispatcher case')
else:
    warnings.append("dispatcher case for fleaflicker not found")

if s != orig:
    DATA.write_text(s)

# ─── PATCH 3: drop KeepTradeCut from BASE_SOURCES ───────────────────

s2 = TSX.read_text()
orig2 = s2

# Try the most common shape first (with the exact subtitle we set)
old3a = "  { key: 'mfl', label: 'MFL ADP', sub: 'MyFantasyLeague consensus', color: '#f59e0b' },\n  { key: 'fleaflicker', label: 'KeepTradeCut', sub: 'Dynasty community gold standard', color: '#ec4899' },"

new3 = "  { key: 'mfl', label: 'MFL ADP', sub: 'MyFantasyLeague consensus', color: '#f59e0b' },"

if old3a in s2:
    s2 = s2.replace(old3a, new3)
    applied.append('rankings.tsx: removed KeepTradeCut from BASE_SOURCES')
else:
    # Fallback: search for any line containing fleaflicker key
    import re
    pattern = r"\s*\{\s*key:\s*'fleaflicker'.*?\n"
    if re.search(pattern, s2):
        s2 = re.sub(pattern, "\n", s2)
        applied.append('rankings.tsx: removed fleaflicker BASE_SOURCES entry (regex match)')
    else:
        warnings.append("KeepTradeCut entry not found in BASE_SOURCES")

if s2 != orig2:
    TSX.write_text(s2)

# ─── Done ────────────────────────────────────────────────────────────

print()
print('=' * 60)
for a in applied:
    print(f'[APPLIED]  {a}')
for w in warnings:
    print(f'[WARN]     {w}')
print('=' * 60)
print()

if not warnings:
    print('All 3 changes applied cleanly. Now verify:')
    print('  npx tsc --noEmit  # should pass clean')
elif len(applied) > 0:
    print(f'{len(applied)} of 3 applied. Manual cleanup may be needed for warnings.')
    print('Diffs:')
    print('  git diff services/rankingsData.ts')
    print('  git diff app/(tabs)/rankings.tsx')
else:
    print('Nothing applied. Files may already be patched, or anchors drifted.')
    print('Check manually:')
    print('  grep -n yahoo-rankings-proxy services/rankingsData.ts')
    print('  grep -n fleaflicker app/(tabs)/rankings.tsx services/rankingsData.ts')
