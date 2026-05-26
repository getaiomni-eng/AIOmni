// services/util/normalizeName.ts
//
// Pure-string player-name normalization. Used everywhere we need to join
// player names across data sources (rankings blend, roster sync, draft
// pool filter, news scanner) so "James Cook" and "James Cook III" key to
// the same bucket.
//
// IMPORTANT: this used to be implemented as
//   .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '').replace(/[^a-z]/g, '')
// — a regex pattern with anchored alternation that triggers a Hermes
// HadesGC write-barrier crash on iOS (EXC_BAD_ACCESS in
// hermes::vm::JSObject::setNamedSlotValueUnsafe ← directRegExpExec ←
// stringPrototypeReplace, captured in build 157's crash report). The
// crash only manifests on app-update with cached league data; fresh
// installs avoided it because no data was there to normalize at scale.
//
// Rewritten with explicit endsWith + charCode loops — no regex at all.
// Slightly slower per call but zero chance of triggering the GC bug.

const SUFFIXES_SPACE = [
  ' jr', ' sr', ' ii', ' iii', ' iv', ' v',
  ' jr.', ' sr.', ' ii.', ' iii.', ' iv.', ' v.',
];

export function normalizePlayerName(name: string | null | undefined): string {
  let s = (name ?? '').toLowerCase().trim();

  for (const suf of SUFFIXES_SPACE) {
    if (s.endsWith(suf)) {
      s = s.slice(0, -suf.length).trim();
      break;
    }
  }

  // Strip everything that isn't a-z. charCode walk avoids the regex
  // engine entirely.
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 97 && c <= 122) out += s[i];
  }
  return out;
}
