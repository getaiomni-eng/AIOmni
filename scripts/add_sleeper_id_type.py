#!/usr/bin/env python3
"""
Tiny followup: add sleeperId?: string to RankedPlayer interface.

The previous patch's regex didn't match this interface format. Adding
manually now. Optional field, doesn't break anything else, just makes
the type honest about what the data actually contains.
"""
from pathlib import Path
import sys

DATA = Path('services/rankingsData.ts')
if not DATA.exists():
    print(f'[ERROR] {DATA} not found.')
    sys.exit(1)

s = DATA.read_text()
orig = s

old = """export interface RankedPlayer {
  id: string;
  name: string;
  position: string;
  team: string;
  rank: number;
  adp: string;
  trend: 'up' | 'down' | 'flat';
  trendVal: number;
  tier: number;
  // Extended fields from live data
  posRank?: number;"""

new = """export interface RankedPlayer {
  id: string;
  sleeperId?: string;
  name: string;
  position: string;
  team: string;
  rank: number;
  adp: string;
  trend: 'up' | 'down' | 'flat';
  trendVal: number;
  tier: number;
  // Extended fields from live data
  posRank?: number;"""

if old in s:
    s = s.replace(old, new)
    DATA.write_text(s)
    print("[APPLIED] Added sleeperId?: string to RankedPlayer interface")
else:
    print("[ERROR] Interface block didn't match -- already patched? or format changed.")
    sys.exit(1)
