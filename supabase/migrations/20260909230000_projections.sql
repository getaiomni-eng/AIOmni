-- Projection storage and scoring (2026-09-09).
--
-- Two purposes, and the second is why this exists now rather than later:
--
--   1. Carry a POINT projection alongside the rank, so the app can say
--      "Sleeper projects 10.5, we have him WR6" -- the disagreement, which is
--      more interesting than either number alone.
--
--   2. Give a future AIOmni projection model somewhere to land and something
--      to be judged against. Source is a column, not a table name, so our
--      model is scored by exactly the same function as Sleeper's from its
--      first week. Nothing about the harness has to change when it arrives.
--
-- History cannot be back-filled -- a projection is only meaningful before the
-- game -- so ingestion starts now even though we have no model yet. By the
-- time there is one there will be weeks of a baseline to beat.

CREATE TABLE IF NOT EXISTS public.nfl_projections (
  season      int         NOT NULL,
  week        int         NOT NULL,
  source      text        NOT NULL,          -- 'sleeper' | 'aiomni_v1' | ...
  gsis_id     text,
  sleeper_id  text,
  player_name text        NOT NULL,
  position    text,
  team        text,
  pts_ppr     numeric(6,2),
  pts_half    numeric(6,2),
  pts_std     numeric(6,2),
  -- Whatever a model used to get there. Free-form on purpose: Sleeper gives
  -- us none, ours will give volume and efficiency terms, and neither should
  -- force a schema change on the other.
  components  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, source, player_name)
);
CREATE INDEX IF NOT EXISTS nfl_projections_lookup
  ON public.nfl_projections (season, week, source, sleeper_id);

ALTER TABLE public.nfl_projections ENABLE ROW LEVEL SECURITY;
-- Operator data. The app reads projections off the weekly board, not here.

CREATE TABLE IF NOT EXISTS public.projection_accuracy (
  season    int  NOT NULL,
  week      int  NOT NULL,
  source    text NOT NULL,
  position  text NOT NULL,               -- 'ALL' for the combined figure
  n         int  NOT NULL,
  mae       numeric(6,2),                -- mean absolute error in POINTS
  bias      numeric(6,2),                -- signed: positive = over-projects
  rmse      numeric(6,2),
  scored_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, source, position)
);
ALTER TABLE public.projection_accuracy ENABLE ROW LEVEL SECURITY;

-- ── scoring ─────────────────────────────────────────────────────────────
-- Bias is tracked separately from MAE because they fail differently. A model
-- can be accurate on average and systematically high on every star, which is
-- exactly the flaw in a naive rank-to-points conversion: calibrating on the
-- MEDIAN OF REALIZED FINISHES implies WR1 is worth 34.8 points, when 34.8 is
-- what whoever exploded that week scored -- not anyone's expectation.
CREATE OR REPLACE FUNCTION public.score_projections(p_season int, p_week int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare v_rows int := 0;
begin
  if not exists (select 1 from public.nfl_weekly_stats
                  where season = p_season and week = p_week and season_type = 'REG' limit 1) then
    raise notice 'no stats for % week % yet', p_season, p_week;
    return 0;
  end if;

  with actual as (
    select w.gsis_id, np.position, w.fantasy_pts_ppr::numeric as pts
      from public.nfl_weekly_stats w
      join public.nfl_players np on np.gsis_id = w.gsis_id
     where w.season = p_season and w.week = p_week and w.season_type = 'REG'
       and np.position in ('QB','RB','WR','TE')
  ),
  paired as (
    -- Joined on gsis_id, so a projection with no id is simply not scored
    -- rather than silently matched to the wrong player by name.
    select p.source, a.position, p.pts_ppr as pred, a.pts as act
      from public.nfl_projections p
      join actual a on a.gsis_id = p.gsis_id
     where p.season = p_season and p.week = p_week and p.pts_ppr is not null
  ),
  per_pos as (
    select source, position, count(*) n,
           avg(abs(pred-act))::numeric(6,2) mae,
           avg(pred-act)::numeric(6,2) bias,
           sqrt(avg(power(pred-act,2)))::numeric(6,2) rmse
      from paired group by source, position
  ),
  combined as (
    select source, 'ALL' as position, count(*) n,
           avg(abs(pred-act))::numeric(6,2) mae,
           avg(pred-act)::numeric(6,2) bias,
           sqrt(avg(power(pred-act,2)))::numeric(6,2) rmse
      from paired group by source
  ),
  merged as (select * from per_pos union all select * from combined)
  insert into public.projection_accuracy (season, week, source, position, n, mae, bias, rmse, scored_at)
  select p_season, p_week, source, position, n, mae, bias, rmse, now() from merged
  on conflict (season, week, source, position) do update
    set n = excluded.n, mae = excluded.mae, bias = excluded.bias,
        rmse = excluded.rmse, scored_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
REVOKE ALL ON FUNCTION public.score_projections(int, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.score_projections(int, int) TO service_role;

CREATE OR REPLACE VIEW public.projection_scoreboard AS
  SELECT season, week, source, n, mae, bias, rmse
    FROM public.projection_accuracy
   WHERE position = 'ALL'
   ORDER BY season DESC, week DESC, mae ASC;

-- The board carries the market number and where the market has him, so the
-- app can show the disagreement rather than just our own opinion.
ALTER TABLE public.nfl_weekly_board
  ADD COLUMN IF NOT EXISTS proj_pts        numeric(6,2),
  ADD COLUMN IF NOT EXISTS market_pos_rank int;

CREATE OR REPLACE VIEW public.public_weekly_board AS
  SELECT season, week, format, gsis_id, player_name, position, team,
         opponent, rank, pos_rank, injury_status, weather_note, startable,
         sleeper_id, proj_pts, market_pos_rank
    FROM public.nfl_weekly_board;
ALTER VIEW public.public_weekly_board SET (security_invoker = off);
GRANT SELECT ON public.public_weekly_board TO anon, authenticated;

-- Tuesday 10:20 UTC, alongside the ranking scoring.
SELECT cron.unschedule('aiomni-score-projections') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-score-projections');
SELECT cron.schedule('aiomni-score-projections', '20 10 * * 2',
  $$ SELECT public.score_projections(
       public.nfl_season(),
       (SELECT COALESCE(MAX(week),0) FROM public.nfl_weekly_stats
         WHERE season = public.nfl_season() AND season_type = 'REG')); $$);
