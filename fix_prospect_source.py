#!/usr/bin/env python3
import os

path = 'services/rankingsData.ts'
with open(path, 'r') as f:
    content = f.read()

# Swap the dedupe logic: seed is primary (curated NFL prospects),
# CFBD /recruiting/players returns high schoolers so we skip it entirely.
old = """export async function fetchDedupedProspects(year = 2026): Promise<CollegeProspect[]> {
  let prospects = await fetchCFBDProspects(year);
  // Fallback to seed if CFBD is down
  if (prospects.length === 0) prospects = [...PROSPECT_SEED_2026];
  const sleeperPlayers = await getSleeperPlayers();"""

new = """export async function fetchDedupedProspects(year = 2026): Promise<CollegeProspect[]> {
  // Use curated NFL draft prospect list (PROSPECT_SEED_2026).
  // CFBD's /recruiting/players returns HIGH SCHOOL recruits committing to college —
  // wrong pool for NFL dynasty rookie drafts. Swap in a real NFL prospects source later.
  const prospects = [...PROSPECT_SEED_2026];
  const sleeperPlayers = await getSleeperPlayers();"""

if old in content:
    content = content.replace(old, new)
    with open(path, 'w') as f:
        f.write(content)
    print("✓ Prospect source switched to curated seed")
else:
    print("✗ Pattern not found — may already be patched")
