-- The app's weekly rankings ARE the ensemble now (2026-09-25).
--
-- Owner's call: replace the weekly board with the ensemble (recency + matchup
-- + context + manual top 25). The app reads public_weekly_board, never the
-- table, so redefining the view switches every user on the next refresh with
-- no app release.
--
-- On 2026 weeks 1-2, graded on the players each market source ranks, the
-- ensemble scored .474 on FantasyPros' set (old board .402, FantasyPros .462)
-- and .387 on ESPN's (old board .341, ESPN .361). Held-out 2025: .326 vs .258
-- for a last-8-games baseline.
--
-- WHAT STAYS FROM THE OLD BOARD. weekly-board keeps running for two reasons:
--   * proj_pts and market_pos_rank are the MARKET's numbers (Sleeper), which
--     the UI shows as "vs CLE . 10.5 (mkt WR43)" -- ours is the rank, theirs
--     is the projection. They come from nfl_weekly_board by gsis_id.
--   * FALLBACK. Any week the ensemble has not built yet is served from the
--     old board, so the tab can never go blank because one cron failed.
--
-- rank is the ensemble's overall order (value over a replacement-level
-- starter, never contradicting position order); see ensemble.ts overallRanks.

ALTER TABLE public.weekly_rankings ADD COLUMN IF NOT EXISTS rank integer;

CREATE OR REPLACE VIEW public.public_weekly_board AS
SELECT w.season,
       w.week,
       'ppr'::text                          AS format,
       w.gsis_id,
       w.player_name,
       w.position,
       w.team,
       w.opponent,
       w.rank,
       w.pos_rank,
       w.injury_status,
       b.weather_note,
       true                                 AS startable,
       COALESCE(w.sleeper_id, b.sleeper_id) AS sleeper_id,
       b.proj_pts,
       b.market_pos_rank
  FROM public.weekly_rankings w
  LEFT JOIN public.nfl_weekly_board b
    ON b.season = w.season AND b.week = w.week AND b.format = 'ppr' AND b.gsis_id = w.gsis_id
 WHERE w.rank IS NOT NULL
UNION ALL
SELECT b.season, b.week, b.format, b.gsis_id, b.player_name, b.position, b.team, b.opponent,
       b.rank, b.pos_rank, b.injury_status, b.weather_note, b.startable, b.sleeper_id,
       b.proj_pts, b.market_pos_rank
  FROM public.nfl_weekly_board b
 WHERE NOT EXISTS (
   SELECT 1 FROM public.weekly_rankings w
    WHERE w.season = b.season AND w.week = b.week AND w.rank IS NOT NULL);

-- Same exposure as before: the view is the only public door to either table.
ALTER VIEW public.public_weekly_board SET (security_invoker = off);
GRANT SELECT ON public.public_weekly_board TO anon, authenticated;
