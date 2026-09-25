-- Manual weekly rankings: the fourth model in the weekly ensemble (2026-09-25).
--
-- The weekly board is being rebuilt as an ensemble of four independent
-- rankings. Three are computed (recency, matchup, context). The fourth is a
-- person: each week Patrick ranks the top 25 at every position by hand on a
-- hidden page (getaiomni.com/rank), which saves through the manual-rankings
-- edge function. Nothing else writes here.
--
-- WHAT READS IT. The weekly ensemble takes rank r for each listed player as
-- that model's vote. Players outside the 25 have no row -- how an unranked
-- player is scored is the ensemble's decision, deliberately not encoded here,
-- so it can change without a migration.
--
-- ONE ROW PER SLOT, keyed (season, week, position, rank), with a second unique
-- key on the player so the same person cannot hold two slots. Saving a position
-- REPLACES it whole through replace_manual_rankings(), in one transaction: a
-- delete-then-insert over REST is two requests, and a failure between them
-- would leave the position empty right before the ensemble reads it.
--
-- Write-once-per-week is NOT enforced: re-ranking on Sunday morning after the
-- inactives is the point. saved_at records when each slot was last written, so
-- a backtest can tell a pre-kickoff ranking from a late edit.
CREATE TABLE IF NOT EXISTS public.manual_weekly_rankings (
  season      integer     NOT NULL,
  week        integer     NOT NULL,
  position    text        NOT NULL CHECK (position IN ('QB','RB','WR','TE')),
  rank        integer     NOT NULL CHECK (rank BETWEEN 1 AND 25),
  gsis_id     text        NOT NULL,
  player_name text,
  team        text,
  saved_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, position, rank),
  UNIQUE (season, week, position, gsis_id)
);

COMMENT ON TABLE public.manual_weekly_rankings IS
  'Hand-ranked top 25 per position per week, entered on getaiomni.com/rank via the manual-rankings function. One input to the weekly ensemble; unranked players have no row and are handled by the ensemble.';

ALTER TABLE public.manual_weekly_rankings ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (the edge function) reads or writes.

-- Replace one position's ranking for one week, atomically.
-- p_rows: [{"gsis_id": "...", "player_name": "...", "team": "..."}, ...] in rank order.
CREATE OR REPLACE FUNCTION public.replace_manual_rankings(
  p_season integer, p_week integer, p_position text, p_rows jsonb
) RETURNS SETOF public.manual_weekly_rankings
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 25 THEN
    RAISE EXCEPTION 'p_rows must be an array of at most 25 players';
  END IF;

  DELETE FROM public.manual_weekly_rankings
   WHERE season = p_season AND week = p_week AND position = p_position;

  INSERT INTO public.manual_weekly_rankings (season, week, position, rank, gsis_id, player_name, team)
  SELECT p_season, p_week, p_position, r.ord::integer,
         r.elem->>'gsis_id', r.elem->>'player_name', r.elem->>'team'
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS r(elem, ord);

  RETURN QUERY
    SELECT * FROM public.manual_weekly_rankings
     WHERE season = p_season AND week = p_week AND position = p_position
     ORDER BY rank;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_manual_rankings(integer, integer, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_manual_rankings(integer, integer, text, jsonb) TO service_role;
