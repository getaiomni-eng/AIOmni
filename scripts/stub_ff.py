#!/usr/bin/env python3
"""Stub the orphaned fetchFleaflickerADP function so tsc passes."""
from pathlib import Path
import re

p = Path('services/rankingsData.ts')
s = p.read_text()

# Use regex to match the whole function regardless of whitespace details.
# Pattern: from "export async function fetchFleaflickerADP" through
# the matching closing brace at column 0.
pattern = re.compile(
    r'export async function fetchFleaflickerADP\([^)]*\)[^{]*\{.*?^\}',
    re.DOTALL | re.MULTILINE
)

replacement = """export async function fetchFleaflickerADP(
  _leagueType: LeagueType = 'redraft',
  _scoringRules: ScoringRules = 'ppr'
): Promise<RankedPlayer[]> {
  // KeepTradeCut source removed (scraping concerns). Stub returns [].
  return [];
}"""

new_s, n = pattern.subn(replacement, s)
if n == 0:
    print('[ERROR]    fetchFleaflickerADP not found')
elif n > 1:
    print(f'[ERROR]    matched {n} times -- aborting to avoid corruption')
else:
    p.write_text(new_s)
    print('[OK]       fetchFleaflickerADP stubbed')
