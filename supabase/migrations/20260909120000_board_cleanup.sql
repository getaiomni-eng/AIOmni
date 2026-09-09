-- Board cleanup (2026-09-09).
--
-- 1. DUPLICATE PLAYERS ON THE RANKINGS BOARD
--    nfl_proprietary_rankings_v2 ships 250 rows for 246 distinct players.
--    Four 2026 rookies appear twice with different ids, e.g. Jadarian Price:
--
--      gsis_id 2026_pick_032   rank  74   score 33.81   (draft-pick placeholder)
--      gsis_id 00-0041512      rank 102   score  3.20   (the actual player)
--
--    The engine values a rookie as draft capital before he has a gsis_id and
--    as a player after, and both rows survive onto a REDRAFT board where
--    draft capital does not belong. It also broke every downstream upsert
--    keyed on player identity with Postgres 21000.
--
--    Fixed here at the view so every consumer benefits at once. The engine
--    should stop emitting the placeholder for players who now have a real
--    gsis_id, but that is a change to a 3,600-line function and this is the
--    safe half.
--
-- 2. STALE COLUMN NAMES ON THE WEEKLY BOARD
--    dvp_mult and total_mult were multipliers. They now carry RANK SHIFTS,
--    because multiplying broke on negative scores. Names should say so.

-- ── 1. one row per real fantasy player, per format ──────────────────────
--
-- TWO distinct bugs produce duplicate names on the board, and they need
-- different fixes:
--
--   a) SAME PERSON, TWO IDS. A 2026 rookie is valued as draft capital
--      (gsis 2026_pick_032, score 33.81) and again as a player once he has a
--      real id (00-0041512, score 3.20). Both survive onto a REDRAFT board.
--
--   b) TWO PEOPLE, SAME NAME. Justin Jefferson the Vikings WR (00-0036322)
--      and Justin Jefferson the Browns rookie LINEBACKER (00-0041075). The
--      engine matches identity by name, so it emitted the linebacker as a
--      WR2 with Minnesota's team attached. Deduping by name alone would have
--      silently deleted a real player -- and kept the wrong one half the time.
--
-- So: filter to genuine fantasy positions FIRST, using the position on the
-- player record rather than the one the ranking row claims. That removes the
-- linebacker outright. Only then collapse remaining same-name rows, keeping
-- the real NFL id over a draft-pick placeholder.
--
-- The engine should key identity on gsis_id rather than name; this is the
-- containment, not the cure.
CREATE OR REPLACE VIEW public.public_rankings AS
  SELECT DISTINCT ON (r.format, r.name)
         r.format, r.rank, r.gsis_id, r.name, r.position, r.team,
         r.pos_rank, r.score, r.tier
    FROM public.nfl_proprietary_rankings_v2 r
    LEFT JOIN public.nfl_players p ON p.gsis_id = r.gsis_id
   WHERE
     -- Keep pick placeholders (no player record yet) and anyone whose real
     -- position is fantasy-relevant. Drop players the roster says are not.
     (p.gsis_id IS NULL OR p.position IN ('QB','RB','WR','TE','K','DEF','DST'))
     -- And never trust a ranking row whose claimed position contradicts the
     -- player record; that is the name-collision signature.
     AND (p.position IS NULL OR r.position = p.position)
   ORDER BY r.format, r.name, (r.gsis_id LIKE '00-%') DESC, r.rank ASC;
ALTER VIEW public.public_rankings SET (security_invoker = off);
GRANT SELECT ON public.public_rankings TO anon, authenticated;

-- ── 2. say what the columns actually hold ───────────────────────────────
ALTER TABLE public.nfl_weekly_board RENAME COLUMN dvp_mult   TO dvp_shift;
ALTER TABLE public.nfl_weekly_board RENAME COLUMN total_mult TO total_shift;

COMMENT ON COLUMN public.nfl_weekly_board.dvp_shift IS
  'Rank places gained (+) or lost (-) from the opponent''s defence vs this position. Bounded to about +/-12. NOT a multiplier: Formula scores go negative past ~rank 105, so multiplying inverted the adjustment for most of the board.';
COMMENT ON COLUMN public.nfl_weekly_board.total_shift IS
  'Rank places from the team''s Vegas implied total, bounded to about +/-6.';
COMMENT ON COLUMN public.nfl_weekly_board.week_score IS
  'Effective rank after adjustment. LOWER IS BETTER, unlike ros_score.';

-- The public view is unchanged in shape but must be recreated to follow the
-- renamed columns cleanly.
CREATE OR REPLACE VIEW public.public_weekly_board AS
  SELECT season, week, format, gsis_id, player_name, position, team, opponent,
         rank, pos_rank
    FROM public.nfl_weekly_board;
ALTER VIEW public.public_weekly_board SET (security_invoker = off);
GRANT SELECT ON public.public_weekly_board TO anon, authenticated;
