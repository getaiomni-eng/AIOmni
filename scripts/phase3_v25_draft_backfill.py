#!/usr/bin/env python3
"""
AIOmni Phase 3 v2.5 prep — fix nflverse-daily-sync + backfill 2026 draft.

This script does THREE things:

  1. Patches nflverse-daily-sync/index.ts so future syncs preserve
     draft_round and draft_pick instead of writing null.

  2. Writes a NEW edge function: backfill-2026-draft. It takes the
     parsed draft data (embedded in the function as a TypeScript
     constant) and updates nfl_players with draft_round and draft_pick
     by name match.

  3. Prints deploy + trigger instructions.

After running this script you do:

  Step A: Deploy the daily-sync fix (so it doesn\\'t regress)
       supabase functions deploy nflverse-daily-sync

  Step B: Deploy the backfill function
       supabase functions deploy backfill-2026-draft

  Step C: Trigger the backfill
       curl -X POST .../backfill-2026-draft -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"

  Step D: Verify
       curl -s ".../nfl_players?select=full_name,draft_round,draft_pick&draft_year=eq.2026&order=draft_pick.asc.nullslast&limit=10" ...

Run from AIOmni repo root:
    python3 scripts/phase3_v25_draft_backfill.py
"""
from pathlib import Path
import sys
import re

ROOT = Path('.')
SUPA = ROOT / 'supabase' / 'functions'
DAILY = SUPA / 'nflverse-daily-sync' / 'index.ts'

if not DAILY.exists():
    print(f'[ERROR]    {DAILY} not found.')
    print('           Make sure you are running from AIOmni repo root.')
    sys.exit(1)

# ─── PART 1: Fix nflverse-daily-sync to preserve draft fields ─────────

print('Part 1: Patching nflverse-daily-sync...')
s = DAILY.read_text()

# Find the upsert block. We're looking for the spot where draft_round
# and draft_pick are set to null. The exact code probably looks like:
#   draft_round: null,
#   draft_pick: null,
# OR
#   draft_round: null, draft_pick: null,
# OR could be inside a mapping object with these explicit nulls.

# Two common patterns we'll handle:
patterns_fixed = 0

# Pattern A: explicit "draft_round: null,\n      draft_pick: null,"
pattern_a = re.compile(r'draft_round:\s*null,(\s*\n\s*)draft_pick:\s*null,', re.MULTILINE)
if pattern_a.search(s):
    s = pattern_a.sub(r'draft_round: i(r.draft_round),\1draft_pick: i(r.draft_pick),', s)
    patterns_fixed += 1
    print('  [APPLIED]  draft_round / draft_pick now read from CSV row')

# Pattern B: just draft_round null (in case formatted differently)
if patterns_fixed == 0:
    pattern_b = re.compile(r'draft_round:\s*null')
    pattern_c = re.compile(r'draft_pick:\s*null')
    if pattern_b.search(s):
        s = pattern_b.sub('draft_round: i(r.draft_round)', s)
        patterns_fixed += 1
        print('  [APPLIED]  draft_round patched')
    if pattern_c.search(s):
        s = pattern_c.sub('draft_pick: i(r.draft_pick)', s)
        patterns_fixed += 1
        print('  [APPLIED]  draft_pick patched')

if patterns_fixed == 0:
    print('  [WARN]     no draft_round / draft_pick null pattern found in nflverse-daily-sync')
    print('             The fields may already be populated correctly, OR the file was')
    print('             modified manually. Either way, the backfill function below will')
    print('             handle 2026 explicitly.')
else:
    DAILY.write_text(s)

# ─── PART 2: Build the backfill function ──────────────────────────────

print('\nPart 2: Building backfill-2026-draft function...')

# This is the parsed draft data, derived from the document Patrick pasted.
# Format: [pick, name, position, round]
# Round derivation: pick 1-32 = R1, 33-64 = R2, 65-100 = R3 (35 picks
# w/ comp), 101-140 = R4, 141-181 = R5, 182-216 = R6, 217-257 = R7.

DRAFT_DATA_TS = '''const DRAFT_2026 = [
  // Round 1 (picks 1-32)
  { p: 1, n: "Fernando Mendoza", pos: "QB", r: 1 },
  { p: 2, n: "David Bailey", pos: "LB", r: 1 },
  { p: 3, n: "Jeremiyah Love", pos: "RB", r: 1 },
  { p: 4, n: "Carnell Tate", pos: "WR", r: 1 },
  { p: 5, n: "Arvell Reese", pos: "LB", r: 1 },
  { p: 6, n: "Mansoor Delane", pos: "DB", r: 1 },
  { p: 7, n: "Sonny Styles", pos: "LB", r: 1 },
  { p: 8, n: "Jordyn Tyson", pos: "WR", r: 1 },
  { p: 9, n: "Spencer Fano", pos: "OT", r: 1 },
  { p: 10, n: "Francis Mauigoa", pos: "OT", r: 1 },
  { p: 11, n: "Caleb Downs", pos: "S", r: 1 },
  { p: 12, n: "Kadyn Proctor", pos: "OT", r: 1 },
  { p: 13, n: "Ty Simpson", pos: "QB", r: 1 },
  { p: 14, n: "Olaivavega Ioane", pos: "G", r: 1 },
  { p: 15, n: "Rueben Bain Jr.", pos: "EDGE", r: 1 },
  { p: 16, n: "Kenyon Sadiq", pos: "TE", r: 1 },
  { p: 17, n: "Blake Miller", pos: "OT", r: 1 },
  { p: 18, n: "Caleb Banks", pos: "DT", r: 1 },
  { p: 19, n: "Monroe Freeling", pos: "OT", r: 1 },
  { p: 20, n: "Makai Lemon", pos: "WR", r: 1 },
  { p: 21, n: "Max Iheanachor", pos: "OT", r: 1 },
  { p: 22, n: "Akheem Mesidor", pos: "EDGE", r: 1 },
  { p: 23, n: "Malachi Lawrence", pos: "EDGE", r: 1 },
  { p: 24, n: "KC Concepcion", pos: "WR", r: 1 },
  { p: 25, n: "Dillon Thieneman", pos: "S", r: 1 },
  { p: 26, n: "Keylan Rutledge", pos: "G", r: 1 },
  { p: 27, n: "Chris Johnson", pos: "CB", r: 1 },
  { p: 28, n: "Caleb Lomu", pos: "OT", r: 1 },
  { p: 29, n: "Peter Woods", pos: "DT", r: 1 },
  { p: 30, n: "Omar Cooper Jr.", pos: "WR", r: 1 },
  { p: 31, n: "Keldric Faulk", pos: "EDGE", r: 1 },
  { p: 32, n: "Jadarian Price", pos: "RB", r: 1 },
  // Round 2 (picks 33-64)
  { p: 33, n: "De'Zhaun Stribling", pos: "WR", r: 2 },
  { p: 34, n: "Chase Bisontis", pos: "G", r: 2 },
  { p: 35, n: "TJ Parker", pos: "EDGE", r: 2 },
  { p: 36, n: "Kayden McDonald", pos: "DT", r: 2 },
  { p: 37, n: "Colton Hood", pos: "CB", r: 2 },
  { p: 38, n: "Treydan Stukes", pos: "S", r: 2 },
  { p: 39, n: "Denzel Boston", pos: "WR", r: 2 },
  { p: 40, n: "R Mason Thomas", pos: "EDGE", r: 2 },
  { p: 41, n: "Cashius Howell", pos: "EDGE", r: 2 },
  { p: 42, n: "Christen Miller", pos: "DT", r: 2 },
  { p: 43, n: "Jacob Rodriguez", pos: "LB", r: 2 },
  { p: 44, n: "Derrick Moore", pos: "EDGE", r: 2 },
  { p: 45, n: "Zion Young", pos: "EDGE", r: 2 },
  { p: 46, n: "Josiah Trotter", pos: "LB", r: 2 },
  { p: 47, n: "Germie Bernard", pos: "WR", r: 2 },
  { p: 48, n: "Avieon Terrell", pos: "CB", r: 2 },
  { p: 49, n: "Lee Hunter", pos: "DT", r: 2 },
  { p: 50, n: "D'Angelo Ponds", pos: "CB", r: 2 },
  { p: 51, n: "Jake Golday", pos: "LB", r: 2 },
  { p: 52, n: "Brandon Cisse", pos: "CB", r: 2 },
  { p: 53, n: "CJ Allen", pos: "LB", r: 2 },
  { p: 54, n: "Eli Stowers", pos: "TE", r: 2 },
  { p: 55, n: "Gabe Jacas", pos: "EDGE", r: 2 },
  { p: 56, n: "Nate Boerkircher", pos: "TE", r: 2 },
  { p: 57, n: "Logan Jones", pos: "C", r: 2 },
  { p: 58, n: "Emmanuel McNeil-Warren", pos: "S", r: 2 },
  { p: 59, n: "Marlin Klein", pos: "TE", r: 2 },
  { p: 60, n: "Anthony Hill Jr.", pos: "LB", r: 2 },
  { p: 61, n: "Max Klare", pos: "TE", r: 2 },
  { p: 62, n: "Davison Igbinosun", pos: "CB", r: 2 },
  { p: 63, n: "Jake Slaughter", pos: "C", r: 2 },
  { p: 64, n: "Bud Clark", pos: "S", r: 2 },
  // Round 3 (picks 65-100)
  { p: 65, n: "Carson Beck", pos: "QB", r: 3 },
  { p: 66, n: "Tyler Onyedim", pos: "DT", r: 3 },
  { p: 67, n: "Keyron Crawford", pos: "EDGE", r: 3 },
  { p: 68, n: "Markell Bell", pos: "OT", r: 3 },
  { p: 69, n: "Sam Roush", pos: "TE", r: 3 },
  { p: 70, n: "Romello Height", pos: "EDGE", r: 3 },
  { p: 71, n: "Antonio Williams", pos: "WR", r: 3 },
  { p: 72, n: "Tacario Davis", pos: "CB", r: 3 },
  { p: 73, n: "Oscar Delp", pos: "TE", r: 3 },
  { p: 74, n: "Malachi Fields", pos: "WR", r: 3 },
  { p: 75, n: "Caleb Douglas", pos: "WR", r: 3 },
  { p: 76, n: "Drew Allar", pos: "QB", r: 3 },
  { p: 77, n: "Chris McLellan", pos: "DT", r: 3 },
  { p: 78, n: "AJ Haulcy", pos: "S", r: 3 },
  { p: 79, n: "Zachariah Branch", pos: "WR", r: 3 },
  { p: 80, n: "Ja'Kobi Lane", pos: "WR", r: 3 },
  { p: 81, n: "Albert Regis", pos: "DT", r: 3 },
  { p: 82, n: "Domonique Orange", pos: "DT", r: 3 },
  { p: 83, n: "Chris Brazzell II", pos: "WR", r: 3 },
  { p: 84, n: "Ted Hurst", pos: "WR", r: 3 },
  { p: 85, n: "Daylen Everette", pos: "CB", r: 3 },
  { p: 86, n: "Austin Barber", pos: "OT", r: 3 },
  { p: 87, n: "Will Kacmarek", pos: "TE", r: 3 },
  { p: 88, n: "Emmanuel Pregnon", pos: "G", r: 3 },
  { p: 89, n: "Zavion Thomas", pos: "WR", r: 3 },
  { p: 90, n: "Kaelon Black", pos: "RB", r: 3 },
  { p: 91, n: "Trey Zuhn III", pos: "C", r: 3 },
  { p: 92, n: "Jaishawn Barham", pos: "EDGE", r: 3 },
  { p: 93, n: "Keagan Trost", pos: "OT", r: 3 },
  { p: 94, n: "Chris Bell", pos: "WR", r: 3 },
  { p: 95, n: "Eli Raridon", pos: "TE", r: 3 },
  { p: 96, n: "Gennings Dunker", pos: "OT", r: 3 },
  { p: 97, n: "Caleb Tiernan", pos: "OT", r: 3 },
  { p: 98, n: "Jakobe Thomas", pos: "S", r: 3 },
  { p: 99, n: "Julian Neal", pos: "CB", r: 3 },
  { p: 100, n: "Jalen Huskey", pos: "CB", r: 3 },
  // Round 4 (picks 101-140)
  { p: 101, n: "Jermod McCoy", pos: "CB", r: 4 },
  { p: 102, n: "Jude Bowry", pos: "OT", r: 4 },
  { p: 103, n: "Darrell Jackson Jr.", pos: "DT", r: 4 },
  { p: 104, n: "Caleb Proctor", pos: "WR", r: 4 },
  { p: 105, n: "Brenen Thompson", pos: "WR", r: 4 },
  { p: 106, n: "Febechi Nwaiwu", pos: "G", r: 4 },
  { p: 107, n: "Gracen Halton", pos: "DT", r: 4 },
  { p: 108, n: "Jonah Coleman", pos: "RB", r: 4 },
  { p: 109, n: "Jadon Canady", pos: "S", r: 4 },
  { p: 110, n: "Cade Klubnik", pos: "QB", r: 4 },
  { p: 111, n: "Kage Casey", pos: "OT", r: 4 },
  { p: 112, n: "Drew Shelton", pos: "OT", r: 4 },
  { p: 113, n: "Jalen Farmer", pos: "G", r: 4 },
  { p: 114, n: "Devin Moore", pos: "CB", r: 4 },
  { p: 115, n: "Elijah Sarratt", pos: "WR", r: 4 },
  { p: 116, n: "Keionte Scott", pos: "CB", r: 4 },
  { p: 117, n: "Travis Burke", pos: "OT", r: 4 },
  { p: 118, n: "Jimmy Rolder", pos: "LB", r: 4 },
  { p: 119, n: "Wesley Williams", pos: "EDGE", r: 4 },
  { p: 120, n: "Dani Dennis-Sutton", pos: "EDGE", r: 4 },
  { p: 121, n: "Kaden Wetjen", pos: "WR", r: 4 },
  { p: 122, n: "Mike Washington Jr.", pos: "RB", r: 4 },
  { p: 123, n: "Wade Woodaz", pos: "LB", r: 4 },
  { p: 124, n: "Malik Muhammad", pos: "CB", r: 4 },
  { p: 125, n: "Skyler Bell", pos: "WR", r: 4 },
  { p: 126, n: "Kaleb Elarms-Orr", pos: "LB", r: 4 },
  { p: 127, n: "Carver Willis", pos: "OT", r: 4 },
  { p: 128, n: "Connor Lew", pos: "C", r: 4 },
  { p: 129, n: "Will Lee III", pos: "CB", r: 4 },
  { p: 130, n: "Trey Moore", pos: "EDGE", r: 4 },
  { p: 131, n: "Genesis Smith", pos: "S", r: 4 },
  { p: 132, n: "Jeremiah Wright", pos: "G", r: 4 },
  { p: 133, n: "Matthew Hibner", pos: "TE", r: 4 },
  { p: 134, n: "Kendal Daniels", pos: "LB", r: 4 },
  { p: 135, n: "Bryce Boettcher", pos: "LB", r: 4 },
  { p: 136, n: "Bryce Lance", pos: "WR", r: 4 },
  { p: 137, n: "LT Overton", pos: "EDGE", r: 4 },
  { p: 138, n: "Kyle Louis", pos: "S", r: 4 },
  { p: 139, n: "Ephesians Prysock", pos: "CB", r: 4 },
  { p: 140, n: "Colbie Young", pos: "WR", r: 4 },
  // Round 5 (picks 141-181)
  { p: 141, n: "Kamari Ramsey", pos: "S", r: 5 },
  { p: 142, n: "Fernando Carmona", pos: "G", r: 5 },
  { p: 143, n: "Reggie Virgil", pos: "WR", r: 5 },
  { p: 144, n: "Sam Hecht", pos: "C", r: 5 },
  { p: 145, n: "Nick Barrett", pos: "DT", r: 5 },
  { p: 146, n: "Parker Brailsford", pos: "C", r: 5 },
  { p: 147, n: "Joshua Josephs", pos: "EDGE", r: 5 },
  { p: 148, n: "Beau Stephens", pos: "G", r: 5 },
  { p: 149, n: "Justin Jefferson", pos: "LB", r: 5 },
  { p: 150, n: "Dalton Johnson", pos: "S", r: 5 },
  { p: 151, n: "Zakee Wheatley", pos: "S", r: 5 },
  { p: 152, n: "Justin Joly", pos: "TE", r: 5 },
  { p: 153, n: "Jager Burton", pos: "C", r: 5 },
  { p: 154, n: "Jaden Dugger", pos: "LB", r: 5 },
  { p: 155, n: "DeMonte Capehart", pos: "DT", r: 5 },
  { p: 156, n: "George Gumbs Jr.", pos: "EDGE", r: 5 },
  { p: 157, n: "Keith Abney II", pos: "CB", r: 5 },
  { p: 158, n: "Michael Taaffe", pos: "S", r: 5 },
  { p: 159, n: "Max Bredeson", pos: "TE", r: 5 },
  { p: 160, n: "Billy Schrauth", pos: "G", r: 5 },
  { p: 161, n: "Emmett Johnson", pos: "RB", r: 5 },
  { p: 162, n: "Chandler Rivers", pos: "CB", r: 5 },
  { p: 163, n: "Charles Demmings", pos: "CB", r: 5 },
  { p: 164, n: "Tanner Koziol", pos: "TE", r: 5 },
  { p: 165, n: "Nicholas Singleton", pos: "RB", r: 5 },
  { p: 166, n: "Keyshaun Elliott", pos: "LB", r: 5 },
  { p: 167, n: "Jalon Kilgore", pos: "S", r: 5 },
  { p: 168, n: "Kendrick Law", pos: "WR", r: 5 },
  { p: 169, n: "Riley Nowakowski", pos: "TE", r: 5 },
  { p: 170, n: "Joe Royer", pos: "TE", r: 5 },
  { p: 171, n: "Karon Prunty", pos: "CB", r: 5 },
  { p: 172, n: "Lorenzo Styles Jr.", pos: "S", r: 5 },
  { p: 173, n: "Josh Cuevas", pos: "TE", r: 5 },
  { p: 174, n: "Adam Randall", pos: "RB", r: 5 },
  { p: 175, n: "Hezekiah Masses", pos: "CB", r: 5 },
  { p: 176, n: "Cyrus Allen", pos: "WR", r: 5 },
  { p: 177, n: "Kevin Coleman Jr.", pos: "WR", r: 5 },
  { p: 178, n: "Cole Payton", pos: "QB", r: 5 },
  { p: 179, n: "Enrique Cruz Jr.", pos: "OT", r: 5 },
  { p: 180, n: "Seydou Traore", pos: "TE", r: 5 },
  { p: 181, n: "Zane Durant", pos: "DT", r: 5 },
  // Round 6 (picks 182-216)
  { p: 182, n: "Taylen Green", pos: "QB", r: 6 },
  { p: 183, n: "Karson Sharar", pos: "LB", r: 6 },
  { p: 184, n: "Jackie Marshall", pos: "DT", r: 6 },
  { p: 185, n: "Bauer Sharp", pos: "TE", r: 6 },
  { p: 186, n: "Bobby Jamison-Travis", pos: "DT", r: 6 },
  { p: 187, n: "Kaytron Allen", pos: "RB", r: 6 },
  { p: 188, n: "Anez Cooper", pos: "G", r: 6 },
  { p: 189, n: "Brian Parker II", pos: "OL", r: 6 },
  { p: 190, n: "Barrion Brown", pos: "WR", r: 6 },
  { p: 191, n: "Josh Cameron", pos: "WR", r: 6 },
  { p: 192, n: "J.C. Davis", pos: "OT", r: 6 },
  { p: 193, n: "Jack Kelly", pos: "LB", r: 6 },
  { p: 194, n: "Pat Coogan", pos: "C", r: 6 },
  { p: 195, n: "Malik Benson", pos: "WR", r: 6 },
  { p: 196, n: "Dametrious Crownover", pos: "OT", r: 6 },
  { p: 197, n: "CJ Daniels", pos: "WR", r: 6 },
  { p: 198, n: "Demond Claiborne", pos: "RB", r: 6 },
  { p: 199, n: "Emmanuel Henderson Jr.", pos: "WR", r: 6 },
  { p: 200, n: "DJ Campbell", pos: "G", r: 6 },
  { p: 201, n: "Domani Jackson", pos: "CB", r: 6 },
  { p: 202, n: "Logan Taylor", pos: "G", r: 6 },
  { p: 203, n: "CJ Williams", pos: "WR", r: 6 },
  { p: 204, n: "Lewis Bond", pos: "WR", r: 6 },
  { p: 205, n: "Skyler Gill-Howard", pos: "DT", r: 6 },
  { p: 206, n: "Alex Harkey", pos: "G", r: 6 },
  { p: 207, n: "Micah Morris", pos: "G", r: 6 },
  { p: 208, n: "Anterio Thompson", pos: "DT", r: 6 },
  { p: 209, n: "Matt Gulbin", pos: "C", r: 6 },
  { p: 210, n: "Gabriel Rubio", pos: "DT", r: 6 },
  { p: 211, n: "Ryan Eckley", pos: "P", r: 6 },
  { p: 212, n: "Namdi Obiazor", pos: "LB", r: 6 },
  { p: 213, n: "Jordan van den Berg", pos: "DT", r: 6 },
  { p: 214, n: "Caden Curry", pos: "EDGE", r: 6 },
  { p: 215, n: "Harold Perkins Jr.", pos: "LB", r: 6 },
  { p: 216, n: "Trey Smack", pos: "K", r: 6 },
  // Round 7 (picks 217-257)
  { p: 217, n: "Jayden Williams", pos: "OT", r: 7 },
  { p: 218, n: "Anthony Smith", pos: "WR", r: 7 },
  { p: 219, n: "TJ Hall", pos: "CB", r: 7 },
  { p: 220, n: "Toriano Pride Jr.", pos: "CB", r: 7 },
  { p: 221, n: "Jack Endries", pos: "TE", r: 7 },
  { p: 222, n: "Tyre West", pos: "EDGE", r: 7 },
  { p: 223, n: "Athan Kaliakmanis", pos: "QB", r: 7 },
  { p: 224, n: "Robert Spears-Jennings", pos: "S", r: 7 },
  { p: 225, n: "Jaren Kanak", pos: "TE", r: 7 },
  { p: 226, n: "Landon Robinson", pos: "DT", r: 7 },
  { p: 227, n: "Jackson Kuwatch", pos: "LB", r: 7 },
  { p: 228, n: "VJ Payne", pos: "S", r: 7 },
  { p: 229, n: "Brandon Cleveland", pos: "DT", r: 7 },
  { p: 230, n: "Eli Heidenreich", pos: "RB", r: 7 },
  { p: 231, n: "Ethan Onianwa", pos: "OT", r: 7 },
  { p: 232, n: "Tim Keenan III", pos: "DT", r: 7 },
  { p: 233, n: "Zach Durfee", pos: "EDGE", r: 7 },
  { p: 234, n: "Behren Morton", pos: "QB", r: 7 },
  { p: 235, n: "Gavin Gerhardt", pos: "C", r: 7 },
  { p: 236, n: "Andre Fuller", pos: "CB", r: 7 },
  { p: 237, n: "Seth McGowan", pos: "RB", r: 7 },
  { p: 238, n: "Max Llewellyn", pos: "EDGE", r: 7 },
  { p: 239, n: "Tommy Doman", pos: "P", r: 7 },
  { p: 240, n: "Parker Hughes", pos: "LB", r: 7 },
  { p: 241, n: "Ar'maj Reed-Adams", pos: "G", r: 7 },
  { p: 242, n: "Deven Eastern", pos: "DT", r: 7 },
  { p: 243, n: "Aiden Fisher", pos: "LB", r: 7 },
  { p: 244, n: "Cole Wisniewski", pos: "S", r: 7 },
  { p: 245, n: "Jam Miller", pos: "RB", r: 7 },
  { p: 246, n: "Miles Scott", pos: "S", r: 7 },
  { p: 247, n: "Quintayvious Hutchins", pos: "EDGE", r: 7 },
  { p: 248, n: "Carsen Ryan", pos: "TE", r: 7 },
  { p: 249, n: "Garrett Nussmeier", pos: "QB", r: 7 },
  { p: 250, n: "Rayshaun Benny", pos: "DT", r: 7 },
  { p: 251, n: "Uar Bernard", pos: "DT", r: 7 },
  { p: 252, n: "Keyshawn James-Newby", pos: "EDGE", r: 7 },
  { p: 253, n: "Evan Beerntsen", pos: "G", r: 7 },
  { p: 254, n: "Deion Burks", pos: "WR", r: 7 },
  { p: 255, n: "Michael Dansby", pos: "CB", r: 7 },
  { p: 256, n: "Dallen Bentley", pos: "TE", r: 7 },
  { p: 257, n: "Red Murdock", pos: "LB", r: 7 },
];
'''

BACKFILL_FN = f'''// supabase/functions/backfill-2026-draft/index.ts
// One-shot backfill of draft_round + draft_pick for the 2026 NFL Draft.
// Matches by case-insensitive normalized name against nfl_players.

import {{ serve }} from 'https://deno.land/std@0.168.0/http/server.ts';
import {{ createClient }} from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {{
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}};

{DRAFT_DATA_TS}

function normalize(name: string): string {{
  return name
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}}

serve(async (req) => {{
  if (req.method === 'OPTIONS') return new Response('ok', {{ headers: CORS }});

  try {{
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const startedAt = Date.now();

    // Pull all 2026 rookie players to attempt name matching
    const {{ data: players, error }} = await supabase
      .from('nfl_players')
      .select('gsis_id, full_name, position')
      .eq('draft_year', 2026);
    if (error) throw error;
    if (!players?.length) throw new Error('no 2026 players in nfl_players');

    // Build lookup: normalized name -> gsis_id (and remember position
    // for tiebreaker when names collide)
    const byName = new Map<string, {{ gsis_id: string; position: string }}>();
    for (const p of players) {{
      const key = normalize(p.full_name);
      byName.set(key, {{ gsis_id: p.gsis_id, position: p.position }});
    }}

    const matched: any[] = [];
    const unmatched: any[] = [];

    for (const pick of DRAFT_2026) {{
      const key = normalize(pick.n);
      const player = byName.get(key);
      if (player) {{
        matched.push({{
          gsis_id: player.gsis_id,
          name: pick.n,
          pick: pick.p,
          round: pick.r,
        }});
      }} else {{
        unmatched.push({{ name: pick.n, pick: pick.p, round: pick.r }});
      }}
    }}

    // Update matched players with draft_round and draft_pick
    let updated = 0;
    for (const m of matched) {{
      const {{ error: updErr }} = await supabase
        .from('nfl_players')
        .update({{ draft_round: m.round, draft_pick: m.pick }})
        .eq('gsis_id', m.gsis_id);
      if (updErr) {{
        console.error(`update failed for ${{m.name}}:`, updErr);
      }} else {{
        updated++;
      }}
    }}

    const duration = Math.round((Date.now() - startedAt) / 1000);
    return new Response(JSON.stringify({{
      ok: true,
      total_picks: DRAFT_2026.length,
      matched: matched.length,
      updated,
      unmatched: unmatched.length,
      unmatched_sample: unmatched.slice(0, 30),  // for debugging
      duration_seconds: duration,
    }}), {{ headers: {{ ...CORS, 'Content-Type': 'application/json' }} }});
  }} catch (err: any) {{
    console.error('backfill-2026-draft error:', err);
    return new Response(JSON.stringify({{ ok: false, error: err.message ?? String(err) }}), {{
      status: 500,
      headers: {{ ...CORS, 'Content-Type': 'application/json' }},
    }});
  }}
}});
'''

backfill_dir = SUPA / 'backfill-2026-draft'
backfill_dir.mkdir(parents=True, exist_ok=True)
(backfill_dir / 'index.ts').write_text(BACKFILL_FN)
print('  [APPLIED]  backfill-2026-draft function written (257 picks parsed)')

print('\n' + '=' * 70)
print('Done. Now run these commands in order:')
print('=' * 70)
print()
print('1. Deploy the daily-sync fix (so future runs preserve draft data):')
print('     supabase functions deploy nflverse-daily-sync')
print()
print('2. Deploy the backfill function:')
print('     supabase functions deploy backfill-2026-draft')
print()
print('3. Trigger the backfill:')
print('     TOKEN="<anon_key>"')
print('     curl -X POST "https://khoruzvsprxyocisuhet.supabase.co/functions/v1/backfill-2026-draft" \\\\')
print('          -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
print()
print('     Expected: ok:true, matched:~200-220, updated:~200-220, unmatched:~30-50.')
print('     Some unmatched names are expected (UDFAs, IDP-only positions, name')
print('     mismatches like "Drew Allar" vs "Andrew Allar").')
print()
print('4. Verify a few picks landed:')
print('     curl -s "https://khoruzvsprxyocisuhet.supabase.co/rest/v1/nfl_players?select=full_name,position,team,draft_year,draft_round,draft_pick&full_name=ilike.*jeremiyah%20love*" -H "apikey: $TOKEN" -H "Authorization: Bearer $TOKEN"')
print()
print('     Should show: Jeremiyah Love, RB, draft_round=1, draft_pick=3')
