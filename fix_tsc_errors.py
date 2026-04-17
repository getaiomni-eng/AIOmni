#!/usr/bin/env python3
import os, re

# ═══════════════════════════════════════════════════════════
# 1. waivers.ts — fix my inflight check + yahoo team cast
# ═══════════════════════════════════════════════════════════
path = 'services/waivers.ts'
with open(path) as f: content = f.read()

# inflight[key] type issue — wrap in 'in' check
old1 = "  if (inflight[key]) return inflight[key];"
new1 = "  if (key in inflight) return inflight[key];"
if old1 in content:
    content = content.replace(old1, new1)
    print("✓ waivers.ts: inflight check")

# Yahoo faab_balance — cast to any[]
old2 = """    const faabRemaining = result.team?.[0]?.find?.((x: any) => x.faab_balance)?.faab_balance
      ? parseInt(result.team[0].find((x: any) => x.faab_balance).faab_balance, 10)
      : faabBudget;"""
new2 = """    const teamArr: any = (result.team as any);
    const faabEntry = Array.isArray(teamArr?.[0]) ? teamArr[0].find((x: any) => x?.faab_balance) : null;
    const faabRemaining = faabEntry?.faab_balance
      ? parseInt(faabEntry.faab_balance, 10)
      : faabBudget;"""
if old2 in content:
    content = content.replace(old2, new2)
    print("✓ waivers.ts: yahoo faab cast")

with open(path,'w') as f: f.write(content)

# ═══════════════════════════════════════════════════════════
# 2. app/(tabs)/index.tsx — ESPN null guards
# ═══════════════════════════════════════════════════════════
path = 'app/(tabs)/index.tsx'
with open(path) as f: content = f.read()

# Add early return if creds is null. Find the block starting at line ~130.
old = """            creds.leagueId = leagues[0].id;"""
# Only patch if not already guarded
if old in content and "if (!creds)" not in content[content.find(old)-200:content.find(old)]:
    # Find the start of the try block and add a guard
    # Instead of complex AST, just add a creds check at top of whatever function uses it
    idx = content.find(old)
    # Find nearest "const creds" above it
    prior = content.rfind("const creds", 0, idx)
    if prior > 0:
        # Find end of that line
        line_end = content.find("\n", prior)
        guard = "\n      if (!creds) return [];"
        if "if (!creds)" not in content[prior:line_end+200]:
            content = content[:line_end] + guard + content[line_end:]
            print("✓ index.tsx: added creds null guard")

# Fix leagueId possibly undefined — narrow type
content = content.replace(
    "const leagueData = await getESPNLeague(creds.leagueId, creds, parseInt(year));",
    "if (!creds.leagueId) return [];\n      const leagueData = await getESPNLeague(creds.leagueId, creds, parseInt(year));"
)
# Avoid duplicate patches
content = content.replace(
    "if (!creds.leagueId) return [];\n      if (!creds.leagueId) return [];",
    "if (!creds.leagueId) return [];"
)
print("✓ index.tsx: added leagueId guard")

with open(path,'w') as f: f.write(content)

# ═══════════════════════════════════════════════════════════
# 3. app/(tabs)/trade.tsx — duplicate fontFamily keys
# ═══════════════════════════════════════════════════════════
path = 'app/(tabs)/trade.tsx'
with open(path) as f: lines = f.readlines()

# Lines 268 and 274 (0-indexed: 267, 273) are duplicate fontFamily in same object
# Strategy: look at each flagged line, check if fontFamily appears earlier in same StyleSheet block
new_lines = []
seen_ff_in_block = False
brace_depth = 0
for i, line in enumerate(new_lines, start=0):
    pass  # placeholder

# Simpler: just comment out duplicate fontFamily lines if another fontFamily exists 3 lines above
out = []
recent_ff_lines = []  # track line numbers where fontFamily was written
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped.startswith('fontFamily:'):
        # Check last 8 lines for another fontFamily inside what looks like the same block
        # (no closing brace between them)
        has_dup = False
        for j in range(max(0, i-8), i):
            if 'fontFamily:' in lines[j] and '}' not in '\n'.join(lines[j+1:i]):
                has_dup = True
                break
        if has_dup:
            # Skip this duplicate
            print(f"✓ trade.tsx: removed duplicate fontFamily at line {i+1}")
            continue
    out.append(line)

with open(path,'w') as f: f.writelines(out)

# ═══════════════════════════════════════════════════════════
# 4. season.ts — null coalesce
# ═══════════════════════════════════════════════════════════
path = 'services/season.ts'
with open(path) as f: content = f.read()

old = """    await AsyncStorage.setItem('nfl_season', cachedSeason);
    return cachedSeason;"""
new = """    if (cachedSeason) {
      await AsyncStorage.setItem('nfl_season', cachedSeason);
      return cachedSeason;
    }"""
if old in content:
    content = content.replace(old, new)
    print("✓ season.ts: null guard")
    with open(path,'w') as f: f.write(content)

# ═══════════════════════════════════════════════════════════
# 5. theme.tsx — widen theme type
# ═══════════════════════════════════════════════════════════
path = 'app/constants/theme.tsx'
with open(path) as f: content = f.read()

# Find "theme: Theme" in the context type declaration and make it accept union
# Easier: change dark/light consts from `as const` on inner fields
# The error says light theme (bg: #f0f5f6) doesn't match dark theme's literal "#0a1214"
# Fix: add explicit type annotation to Theme that uses string not literal

# Check if Theme is defined as a type alias of typeof dark
if "export type Theme = typeof" in content or "type Theme = typeof" in content:
    # Replace typeof with a union or with a widened shape
    content = re.sub(
        r"(export )?type Theme = typeof \w+;",
        """export type Theme = {
  bg: string;
  surface: string;
  card: string;
  text: string;
  textSub: string;
  textMuted: string;
  border: string;
  borderLight: string;
  navBg: string;
  inputBg: string;
};""",
        content
    )
    print("✓ theme.tsx: widened Theme type")
    with open(path,'w') as f: f.write(content)
else:
    print("✗ theme.tsx: Theme type not found — may need manual fix")

print("\n✓ Done. Run `npx tsc --noEmit` to verify.")
