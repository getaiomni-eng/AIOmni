// Curated player tags for dimensions not derivable from existing fields:
// volume vs efficiency style, pass-catching RB profile, pure rusher profile.
//
// v1 ships with a starter set (~20 entries covering the top RBs/WRs).
// Untagged players default to neutral — they get no volume_efficiency or
// pass_catching_rb adjustment. Their dimension scores still influence the
// user's DNA labels on the reveal screen.
//
// Keys are Sleeper player IDs (the canonical identifier).
// 2026-08-02: extended to ~80 entries (top RBs + WRs, curated archetypes).

export interface PlayerTag {
  style?: 'volume' | 'efficiency';
  pcRb?: boolean;
  pureRusher?: boolean;
}

export const PLAYER_TAGS: Record<string, PlayerTag> = {
  // ─── RBs ────────────────────────────────────────────────────
  '4866':  { style: 'volume',     pureRusher: true },           // Saquon Barkley
  '11620': { style: 'efficiency', pcRb: true },                  // De'Von Achane
  '11574': { style: 'efficiency', pcRb: true },                  // Bucky Irving
  '9509':  { style: 'volume',     pcRb: true },                  // Bijan Robinson
  '9226':  { style: 'volume',     pureRusher: true },            // Kenneth Walker III
  '7588':  { style: 'volume',     pureRusher: true },            // Najee Harris
  '7611':  { style: 'efficiency', pcRb: true },                  // Jaylen Warren
  '7594':  { style: 'volume',     pureRusher: true },            // Chuba Hubbard
  '12527': { style: 'volume',     pcRb: true },                  // Ashton Jeanty (Year 2, LV — three-down)
  '4034':  { style: 'efficiency', pcRb: true },                  // Christian McCaffrey
  '6813':  { style: 'volume',     pureRusher: true },            // Josh Jacobs
  '7567':  { style: 'efficiency', pcRb: true },                  // James Cook
  '4137':  { style: 'efficiency', pureRusher: true },            // Aaron Jones
  '4039':  { style: 'volume',     pureRusher: true },            // Derrick Henry
  '8155':  { style: 'efficiency', pcRb: true },                  // Breece Hall
  '8146':  { style: 'volume',     pureRusher: true },            // Kyren Williams

  // ─── WRs (style/pcRb mostly N/A; only flagged if relevant for cross-pos) ───
  // Most WR adjustments come from established_ascending, injury_discount
  // (handled via existing trend / injuryStatus / years_exp).

  // ─── TEs (no style tagging — te_premium handles this dimension) ───

  // ─── QBs (no style tagging — qb_urgency handles this dimension) ───

  // ─── RBs (curated 2026-08, generated + founder-reviewed) ───
  '9221':   { style: 'efficiency', pcRb: true },           // Jahmyr Gibbs (DET)
  '6790':   { style: 'efficiency', pcRb: true },           // D'Andre Swift (CHI)
  '7543':   { style: 'efficiency', pcRb: true },           // Travis Etienne (NO)
  '5892':   { style: 'volume', pureRusher: true },         // David Montgomery (HOU)
  '4035':   { style: 'volume', pcRb: true },               // Alvin Kamara (NO)
  '4018':   { style: 'volume', pureRusher: true },         // Joe Mixon (FA)
  '5967':   { style: 'efficiency', pcRb: true },           // Tony Pollard (TEN)
  '8205':   { style: 'volume', pureRusher: true },         // Isiah Pacheco (DET)
  '9753':   { style: 'volume', pcRb: true },               // Zach Charbonnet (SEA)
  '9508':   { style: 'efficiency', pcRb: true },           // Tyjae Spears (TEN)
  '11643':  { style: 'efficiency', pureRusher: true },     // Jaylen Wright (MIA)
  '11576':  { style: 'volume', pureRusher: true },         // Braelon Allen (NYJ)
  '11655':  { style: 'efficiency', pcRb: true },           // Tyrone Tracy (NYG)
  '12512':  { style: 'volume', pureRusher: true },         // Quinshon Judkins (CLE)
  '12529':  { style: 'efficiency', pcRb: true },           // TreVeyon Henderson (NE)
  '12507':  { style: 'volume', pcRb: true },               // Omarion Hampton (LAC)
  '12489':  { style: 'efficiency', pcRb: true },           // RJ Harvey (DEN)
  '12504':  { style: 'volume', pureRusher: true },         // Kaleb Johnson (PIT)
  '13287':  { style: 'efficiency', pcRb: true },           // Jeremiyah Love (ARI)
  '4988':   { style: 'volume', pureRusher: true },         // Nick Chubb (FA)
  '8136':   { style: 'volume', pcRb: true },               // Rachaad White (WAS)

  // ─── WRs (style only — pcRb/pureRusher are RB concepts) ───
  '7564':   { style: 'volume' },                           // Ja'Marr Chase (CIN)
  '6786':   { style: 'volume' },                           // CeeDee Lamb (DAL)
  '6794':   { style: 'volume' },                           // Justin Jefferson (MIN)
  '7547':   { style: 'volume' },                           // Amon-Ra St. Brown (DET)
  '9493':   { style: 'volume' },                           // Puka Nacua (LAR)
  '11632':  { style: 'volume' },                           // Malik Nabers (NYG)
  '11631':  { style: 'volume' },                           // Brian Thomas (JAX)
  '8112':   { style: 'volume' },                           // Drake London (ATL)
  '11628':  { style: 'volume' },                           // Marvin Harrison (ARI)
  '2133':   { style: 'volume' },                           // Davante Adams (LAR)
  '6801':   { style: 'volume' },                           // Tee Higgins (CIN)
  '2216':   { style: 'volume' },                           // Mike Evans (SF)
  '4983':   { style: 'volume' },                           // DJ Moore (BUF)
  '4981':   { style: 'volume' },                           // Calvin Ridley (TEN)
  '5045':   { style: 'volume' },                           // Courtland Sutton (DEN)
  '9488':   { style: 'volume' },                           // Jaxon Smith-Njigba (SEA)
  '10229':  { style: 'volume' },                           // Rashee Rice (KC)
  '8144':   { style: 'volume' },                           // Chris Olave (NO)
  '2449':   { style: 'volume' },                           // Stefon Diggs (FA)
  '12526':  { style: 'volume' },                           // Tetairoa McMillan (CAR)
  '12514':  { style: 'volume' },                           // Emeka Egbuka (TB)
  '5859':   { style: 'efficiency' },                       // A.J. Brown (NE)
  '7569':   { style: 'efficiency' },                       // Nico Collins (HOU)
  '3321':   { style: 'efficiency' },                       // Tyreek Hill (FA)
  '7525':   { style: 'efficiency' },                       // DeVonta Smith (PHI)
  '7526':   { style: 'efficiency' },                       // Jaylen Waddle (DEN)
  '9997':   { style: 'efficiency' },                       // Zay Flowers (BAL)
  '8148':   { style: 'efficiency' },                       // Jameson Williams (DET)
  '11624':  { style: 'efficiency' },                       // Xavier Worthy (KC)
  '11635':  { style: 'efficiency' },                       // Ladd McConkey (LAC)
  '9756':   { style: 'efficiency' },                       // Jordan Addison (MIN)
  '8137':   { style: 'efficiency' },                       // George Pickens (DAL)
  '10222':  { style: 'efficiency' },                       // Jayden Reed (GB)
  '5872':   { style: 'efficiency' },                       // Deebo Samuel (SF)
  '12530':  { style: 'efficiency' },                       // Travis Hunter (JAX)
  '12501':  { style: 'efficiency' },                       // Matthew Golden (GB)
  '12519':  { style: 'efficiency' },                       // Luther Burden (CHI)
  '5846':   { style: 'efficiency' },                       // DK Metcalf (PIT)
  '11637':  { style: 'efficiency' },                       // Keon Coleman (BUF)
};
