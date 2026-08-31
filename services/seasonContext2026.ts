// services/seasonContext2026.ts
// 2026 NFL season context for the AIOmni Coach.
// Mirrors the same coaching/movement/injury data the rankings engine uses,
// formatted as English prose so Claude can reason about scheme shifts.
// Update at the start of each season and after major in-season trades.

export const COACHING_CHANGES_2026_TEXT = `
=== 2026 NFL COACHING CHANGES ===

Major head-coach + offensive-coordinator changes for the 2026 season.
These affect scheme, target distribution, and projected fantasy output:

ATL — Stefanski (HC) + Tommy Rees (OC). TE-friendly 12-personnel scheme,
  run-culture, play-action heavy. Big boost for Kyle Pitts and Bijan
  Robinson. Drake London target share likely dilutes slightly.

BUF — Joe Brady (HC) + Pete Carmichael Jr. (OC). Saints-style aggressive
  passing concepts. Allen and the WR room remain primary.

MIA — Hafley (HC) + Slowik (OC). Shanahan tree under a defensive HC.
  Willis as QB is a downgrade vs Tua. Tyreek/Waddle production caps.

CLE — Monken (HC) + Switzer (OC). Stefanski's TE scheme EXITS with him
  to ATL. Aggressive deep-ball passing. Fannin Jr. loses his rookie-year
  scheme amplification.

BAL — Minter (HC) + Doyle (OC). Pass-friendlier than Harbaugh era.
  Andrews/Likely and Flowers benefit. Henry runs less central.

TEN — Saleh (HC). Defensive-minded, offensive identity uncertain.

PIT — McCarthy (HC) + Angelichio (OC). Veteran balance, slight pass tilt.

LV — Klint Kubiak (HC) + Janocko (OC). Zone-blocking, Kubiak-family
  TE-friendly. Bowers benefits; Walker arrives as RB1.

ARI — LaFleur (HC) + Hackett (OC). Hackett mixed track record, scheme
  uncertainty for McBride/Harrison Jr./Conner.

NYG — Harbaugh (HC) + Nagy (OC). Big change, Nagy pass-spread offense.
  Dart year-2 jump possible.

NYJ — Reich (OC). Geno Smith acquired as QB. Accuracy-based vet under
  proven OC.

LAC — McDaniel (OC) under Jim Harbaugh. Wide-open passing scheme. Herbert
  gets a major boost. Ladd McConkey/Quentin Johnston upside.

PHI — Mannion (OC). Limited track record, scheme uncertainty for Hurts.

DET — Petzing (OC, replaces Morton). Mid-tier swap. NOTE: Ben Johnson left
  to be CHI HC AFTER the 2024 season — DET's 2025 was already post-Johnson
  under Morton. The 2026 change is Morton → Petzing, NOT Johnson leaving.

TB — Zac Robinson (OC). McVay tree, pass concepts.

CARRIED-OVER 2025 HIRES (now incumbent, not 2026 changes — already
captured by 2025 personnel/stat data):
  CHI Ben Johnson HC · NE Vrabel + McDaniels · NO Kellen Moore HC ·
  NYJ Aaron Glenn HC · DAL Schottenheimer · JAX Liam Coen
`.trim();

export const PLAYER_MOVES_2026_TEXT = `
=== NOTABLE 2026 PLAYER MOVES ===

QBs:
  Tua Tagovailoa: MIA → ATL (new QB1 in Stefanski's scheme)
  Malik Willis: MIA signing (likely competing for starter role)
  Kirk Cousins: ATL → LV (Carroll's veteran option)
  Kyler Murray: ARI → MIN (Vikings' new QB)
  Geno Smith: LV → NYJ (Reich's accuracy-based offense)
  Justin Fields: NYJ → KC (Mahomes injury insurance)

RBs:
  Travis Etienne: JAX → NO (pass-catching RB joins Kellen Moore's offense)
  Brian Robinson: SF → ATL (handcuff to Bijan)
  David Montgomery: DET → HOU (returns to Texans)
  Kenneth Walker: SEA → LV (RB1 in Kubiak's scheme)

WRs:
  D.J. Moore: CHI → BUF (target dilution warning for Moore)
  Jaylen Waddle: MIA → DEN (Sean Payton's deep-ball WR)
  Wan'Dale Robinson: NYG → TEN (Saleh's slot WR)
  K.J. Osborn: → TEN (depth signing)
  George Pickens: PIT → DAL (WR2 behind Lamb — likely 18-22% target share)
  Mike Evans: TB → SF (Shanahan adds veteran possession WR)
  Jahan Dotson: PHI → ATL (WR2 behind Drake London)
  Davante Adams: NYJ → LA (Rams' veteran WR3, McVay-system fit)

TEs:
  Austin Hooper: NE → ATL (TE2 behind Pitts in Stefanski's TE-heavy offense)

Rookies of note (R1 picks affecting depth charts):
  Jordyn Tyson (NO, R1 #8 WR) — will dilute Olave's target share
  Jeremiyah Love (ARI, R1 RB) — pushes James Conner workload
  Carnell Tate (TEN, R1 WR)
  Colston Loveland (CHI, TE — beneficiary of Ben Johnson scheme)
  Tyler Warren (IND, TE)
  Cam Ward (TEN, R1 #1 QB)
  Jaxson Dart (NYG, R1 QB)
  Fernando Mendoza (LV, R1 QB)
  Bryce Young (CAR) — Year-3 development
`.trim();

// The single source of truth for "who is a rookie in 2026". Derived from
// nfl_players.draft_year — not from model memory, which is exactly what was
// getting this wrong. The 2025 draft happened BEFORE the training cutoff, so
// the model knows these names but keeps their rookie framing attached and
// calls them rookies a year late (observed: Luther Burden III, 2025 R2 #39,
// described as a rookie-pick asset in a 2026 trade grade).
//
// Every screen that asks the model about players must ship this block.
export const CLASS_OF_2025_TEXT = `
=== CLASS YEARS — 2026 SEASON (CANONICAL) ===

"Rookie" in 2026 means the 2026 NFL Draft class ONLY.

The 2025 NFL Draft class are SECOND-YEAR pros. Never call them rookies,
never call them "this year's rookie class", never treat them as rookie-draft
picks or unproven prospects. They have a full NFL season of tape. Referring
to any name below as a rookie is a factual error.

2025 draft class (2nd-year in 2026), fantasy-relevant:
QB — Cam Ward, Jaxson Dart, Tyler Shough, Jalen Milroe, Dillon Gabriel
RB — Ashton Jeanty, Omarion Hampton, Quinshon Judkins, TreVeyon Henderson,
     RJ Harvey, Kaleb Johnson, Bhayshul Tuten, Cam Skattebo, Trevor Etienne,
     Woody Marks, Jarquez Hunter
WR — Travis Hunter, Tetairoa McMillan, Emeka Egbuka, Matthew Golden,
     Jayden Higgins, Luther Burden III, Tre Harris, Jack Bech, Kyle Williams,
     Isaac TeSlaa, Pat Bryant, Jaylin Noel, Savion Williams, Tai Felton,
     Chimere Dike, Dont'e Thornton Jr., Arian Smith
TE — Colston Loveland, Tyler Warren, Mason Taylor, Terrance Ferguson,
     Elijah Arroyo, Harold Fannin Jr.
`.trim();

// Standalone export of just the 2026 rookie list so the Coach
// system prompt can hoist it to the top — the AI was burying the
// list inside the larger season-context block and hallucinating
// 2025 rookies (Jeanty, Hunter, Ward) from training data instead.
export const ROOKIE_BOARD_2026_TEXT = `
=== 2026 DYNASTY ROOKIE BOARD (CANONICAL — do not substitute) ===

These are the ONLY names valid for 2026 rookie-draft recommendations.
The 2026 NFL Draft (April 2026) occurred AFTER your training cutoff,
so any rookie name you "remember" from training is a 2025 rookie —
they are sophomores now, not rookies. Source 1.01-onward picks ONLY
from this list:

Jordyn Tyson (NO, R1 #8 WR) — dilutes Olave's target share
Jeremiyah Love (ARI, R1 RB) — pushes James Conner's workload
Carnell Tate (TEN, R1 WR)
Fernando Mendoza (LV, R1 QB)

If the user asks about a rookie not on this list, say "I'd need to
check the live rookie board for that name" rather than guessing.
Players from the 2025 NFL Draft are NOT 2026 rookies — they are
2nd-year pros. The full list is in CLASS YEARS below; that list is
canonical and complete, so do not extend it from memory.
`.trim();

export const INJURY_NOTES_2026_TEXT = `
=== 2026 INJURY STATUS NOTES ===

George Kittle (SF TE) — Achilles tear, expected to miss ~half the season
  (~9 games). Even when back, reduced capacity. Treat as TE2/3 cap, not
  TE1 unless durability proves out by mid-season.

Michael Penix Jr. (ATL QB2) — Significant injury, likely out extended
  time. Tua is QB1 unless Penix returns and Stefanski changes plans.

Aaron Rodgers (PIT QB) — Veteran, late-career. Use as backup option only.

Christopher Olave (NO WR) — Chronic concussion history. Engine durability
  penalty (0.88x) reflects this; treat as boom-bust WR1.
`.trim();

export const TEAM_SCHEME_TENDENCIES_2025_TEXT = `
=== 2025 TEAM PERSONNEL TENDENCIES ===

For context when projecting 2026 — these scheme identities largely carry
over for teams without HC changes, and SHIFT for teams with new coaches.

Heavy 11-personnel (3 WR, favors WR3-WR4 target volume):
  TEN 70% · TB 69% · NYJ 67% · NO 67% · DAL 66% · HOU 66% · CAR 65%
  JAX 65% · CIN 64% · DEN 63% · IND 63% · MIN 64% · BUF 61% · NYG 61%
  → boost for WRs on these teams

Heavy 12-personnel (2 TE, favors TE volume):
  CLE 41% · ATL 38% · BAL 36% · LV 34% · GB 34% · CHI 33% · NYG 33%
  CIN 29% · SEA 30% · ARI 29% · DET 23%
  → boost for TEs on these teams

Heavy 13-personnel (3 TE — rare, big TE boost):
  LAR 30% (McVay's signature) · PIT 14% · ARI 11% · IND 10%
  → notable TE3+ usage

Heavy 21/22-personnel (2 RB, favors RB workload):
  SF 36% 21p · MIA 25% 21p · BAL 19% 21p · NE 15% 21p · BUF 13% 22p
  → boost for handcuff RBs / pass-catching RBs

NOTES:
  - SF is the league's 21-personnel outlier (Shanahan FB usage).
  - LAR's 30% 13-personnel is unprecedented — Higbee/Allen high usage.
  - BAL runs both heavy 12 AND 21 — multi-back, multi-TE attack.
`.trim();

export const TEAM_SOS_2026_TEXT = `
=== 2026 STRENGTH OF SCHEDULE ===

Source: ESPN, based on 2025 opponent win-loss %. Rank 1 = hardest, 32 = easiest.
This is OVERALL team SOS (combined opponent W%), not positional. It's a blunt
signal — a team with "soft" SOS may still face tough pass defenses. Treat as
secondary context, not a primary driver.

HARDEST 5 (treat their offensive players with mild SOS caution):
  1. CHI  .550   2. MIA  .542   3. ARI  .538   4. GB   .538   5. KC   .536

EASIEST 5 (treat their offensive players with mild SOS tailwind):
  32. CLE .429   31. NO  .434   30. CIN .450   29. ATL .465   28. IND .465

FULL RANK ORDER (hardest → easiest):
  1 CHI  2 MIA  3 ARI  4 GB   5 KC   6 NE   7 LV   8 BUF
  9 LAC  10 CAR 11 MIN 12 NYJ 13 LAR 14 SEA 15 DEN 16 WAS
  17 NYG 18 SF  19 PIT 20 DAL 21 TB  22 JAX 23 PHI 24 BAL
  25 TEN 26 HOU 27 DET 28 IND 29 ATL 30 CIN 31 NO  32 CLE

NOTES:
  - 2025-based: doesn't account for 2026 team changes (coaching, free agency).
  - Burrow/Chase/Higgins benefit from a soft CIN slate (rank 30).
  - Mahomes/Worthy/Kelce face a tougher KC slate (rank 5).
  - Stroud/Diggs face the easiest paper schedule among contenders (HOU 26).
  - Positional SOS (vs QB / vs RB / vs WR / vs TE) is a better signal and
    will replace this once scraped.
`.trim();

/**
 * Combined 2026 season context block for injection into AI Coach system prompt.
 * Roughly 4-5 KB; modest token cost (~1500 tokens) for substantial scheme
 * awareness. Should be appended AFTER league/roster context, BEFORE live data.
 */
export function getSeasonContext2026(): string {
  return [
    COACHING_CHANGES_2026_TEXT,
    '',
    PLAYER_MOVES_2026_TEXT,
    '',
    INJURY_NOTES_2026_TEXT,
    '',
    TEAM_SCHEME_TENDENCIES_2025_TEXT,
    '',
    TEAM_SOS_2026_TEXT,
  ].join('\n');
}
