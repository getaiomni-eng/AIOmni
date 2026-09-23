-- Re-take the week 3 aiomni snapshot after the injury-collision fix (2026-09-23).
--
-- The weekly board's injury map was keyed on NAME ALONE. Justin Jefferson
-- (WR, MIN) is healthy; a LINEBACKER of the same name on Cleveland is out on a
-- coach's decision. The loop skips players with no status, so the only
-- "justinjefferson" entry ever written was the linebacker's -- deterministic,
-- not a race. A top-5 WR was buried at 10_000 + rank and marked unstartable on
-- every build, and the week 3 GRADED SNAPSHOT captured him at WR177 while all
-- 19 experts had him WR2-8.
--
-- Same bug fixed in aiomni-rankings-engine-v2 on 2026-09-16. The weekly board
-- has its own injury path and never got it.
--
-- WHY RE-TAKING IS LEGITIMATE HERE, given this project has twice been burned
-- by snapshots moving: the corrected board was diffed against the captured
-- snapshot across all 230 players. EXACTLY ONE moved -- Jefferson, 177 -> 2.
-- Every other player is identical. So this imports no new injury news and no
-- information the experts' Tuesday snapshot lacked; it corrects a misread of
-- data we already held at capture time. A snapshot that says a healthy WR1 is
-- the 177th-best receiver is not a prediction worth grading.
--
-- The write-once lock stays exactly as it is. This deletes so the next build
-- can re-lock, rather than weakening the rule.
DELETE FROM public.ranking_snapshots
 WHERE season = 2026 AND week = 3 AND source = 'aiomni_weekly' AND format = 'ppr';

DELETE FROM public.expert_weekly_rankings
 WHERE season = 2026 AND week = 3 AND provider = 'aiomni';
