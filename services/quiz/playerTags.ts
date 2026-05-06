// Curated player tags for dimensions not derivable from existing fields:
// volume vs efficiency style, pass-catching RB profile, pure rusher profile.
//
// v1 ships with a starter set (~20 entries covering the top RBs/WRs).
// Untagged players default to neutral — they get no volume_efficiency or
// pass_catching_rb adjustment. Their dimension scores still influence the
// user's DNA labels on the reveal screen.
//
// Keys are Sleeper player IDs (the canonical identifier).
// TODO: Patrick to extend this map to ~80 entries before launch.

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
};
