// Player↔text matching that can't be embarrassed (2026-09-05).
//
// The previous matchers used raw substring includes(lastName):
//   · "St. Brown" matched every Cleveland BROWNS headline
//   · "Caleb Williams" matched a Quinnen WILLIAMS article
//   · the injury matcher had the same disease, so injury flags could
//     attach to the wrong player entirely
//
// Rules here:
//   1. Full name match (punctuation-flexible) → yes.
//   2. Last name as a WHOLE WORD (word boundary kills Brown≠Browns) AND
//      corroboration: the first name appears, or the player's team
//      (city or nickname) appears. A bare surname is never enough.

const TEAM_WORDS: Record<string, string[]> = {
  ARI: ['cardinals', 'arizona'], ATL: ['falcons', 'atlanta'], BAL: ['ravens', 'baltimore'],
  BUF: ['bills', 'buffalo'], CAR: ['panthers', 'carolina'], CHI: ['bears', 'chicago'],
  CIN: ['bengals', 'cincinnati'], CLE: ['browns', 'cleveland'], DAL: ['cowboys', 'dallas'],
  DEN: ['broncos', 'denver'], DET: ['lions', 'detroit'], GB: ['packers', 'green bay'],
  HOU: ['texans', 'houston'], IND: ['colts', 'indianapolis'], JAX: ['jaguars', 'jacksonville'],
  KC: ['chiefs', 'kansas city'], LV: ['raiders', 'las vegas'], LAC: ['chargers'],
  LAR: ['rams'], LA: ['rams'], MIA: ['dolphins', 'miami'], MIN: ['vikings', 'minnesota'],
  NE: ['patriots', 'new england'], NO: ['saints', 'new orleans'], NYG: ['giants'],
  NYJ: ['jets'], PHI: ['eagles', 'philadelphia'], PIT: ['steelers', 'pittsburgh'],
  SF: ['49ers', 'niners', 'san francisco'], SEA: ['seahawks', 'seattle'],
  TB: ['buccaneers', 'bucs', 'tampa'], TEN: ['titans', 'tennessee'], WAS: ['commanders', 'washington'],
};

const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function textMentionsPlayer(text: string, fullName: string, team?: string | null): boolean {
  const hay = ` ${text.toLowerCase()} `;
  const tokens = fullName.toLowerCase().replace(/[.']/g, '').split(/[\s-]+/).filter(Boolean);
  if (!tokens.length) return false;

  // 1. Full name, tolerant of hyphens/periods between tokens
  const fullPattern = new RegExp(`\\b${tokens.map(esc).join("[\\s.'\\-]+")}\\b`, 'i');
  if (fullPattern.test(text.replace(/[.']/g, ''))) return true;
  if (fullPattern.test(text)) return true;

  // 2. Whole-word surname + corroboration
  // A multi-token surname ("St. Brown") is distinctive enough on its own.
  if (tokens.length >= 3) {
    const suffix = new RegExp(`\\b${tokens.slice(-2).map(esc).join("[\\s.'\\-]+")}\\b`, 'i');
    if (suffix.test(text) || suffix.test(text.replace(/[.']/g, ''))) return true;
  }
  const last = tokens[tokens.length - 1];
  if (last.length < 4) return false;
  if (!new RegExp(`\\b${esc(last)}\\b`, 'i').test(text)) return false;
  const first = tokens[0];
  if (first.length >= 3 && new RegExp(`\\b${esc(first)}\\b`, 'i').test(text)) return true;
  for (const w of TEAM_WORDS[(team ?? '').toUpperCase()] ?? []) {
    if (hay.includes(` ${w} `) || hay.includes(` ${w}'`) || hay.includes(` ${w},`) || hay.includes(` ${w}.`)) return true;
  }
  return false;
}

// Name↔name comparison (injury lists, Rotowire items): normalized equality,
// or same surname (whole token) + same first initial.
export function sameNameLoose(a: string, b: string): boolean {
  const norm = (n: string) => n.toLowerCase().replace(/[.']/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').trim();
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(/[\s-]+/), tb = nb.split(/[\s-]+/);
  const la = ta[ta.length - 1], lb = tb[tb.length - 1];
  return la === lb && la.length >= 4 && ta[0][0] === tb[0][0];
}
