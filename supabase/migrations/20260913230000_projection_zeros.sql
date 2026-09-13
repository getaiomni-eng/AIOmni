-- Stop scoring fabricated zero projections (2026-09-13).
--
-- Time-sensitive: aiomni-score-projections fires Tuesday at 10:20 UTC and
-- writes the FIRST EVER row of projection_accuracy. Without this, that row
-- is wrong in a way that looks like a finding rather than a bug.
--
-- nfl_projections week 1 holds 3,026 rows for source 'sleeper', of which
-- 2,635 (87%) have pts_ppr = 0. Those are not projections. Sleeper returns a
-- row for every player alive but publishes pts_ppr for only the startable
-- subset -- 470 of 3,304 in week 1 -- and weekly-board ingested them with
-- `Number(st.pts_ppr ?? 0)`, turning "no projection" into "projected zero".
-- That ingest is fixed in the same commit as this migration.
--
-- score_projections filters `p.pts_ppr is not null`, which does not exclude
-- zero. It joins actuals from nfl_weekly_stats, so every backup who took a
-- snap and scored would be graded as "predicted 0.0, actual 4.2" -- an
-- inflated MAE and a strongly negative bias that reads as "Sleeper
-- systematically under-projects". That false baseline is exactly what an
-- AIOmni projection model would later be measured against.
--
-- The function below is the original from 20260909230000_projections.sql
-- with ONE line added (`and p.pts_ppr > 0`). It is reproduced in full rather
-- than patched because CREATE OR REPLACE needs the whole body, and rewriting
-- it from memory instead of from the original dropped the no-stats early
-- exit, the nfl_players join, the extensions search_path, and the
-- service_role grant.
--
-- `> 0` rather than `<> 0`: a projection cannot be negative, and treating a
-- genuine 0.0 as unpublished costs nothing, since nobody starts a player the
-- market projects for zero.

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
       and p.pts_ppr > 0
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

-- ── Remove the rows that were never projections ────────────────────────
-- Deleted rather than left in place for the scorer to filter: anything else
-- reading this table -- a future model's training set, a hand-written query,
-- the parlay tooling being scoped -- would otherwise have to know to exclude
-- them, and one of those will forget.
DELETE FROM public.nfl_projections
 WHERE source = 'sleeper'
   AND COALESCE(pts_ppr, 0)  <= 0
   AND COALESCE(pts_half, 0) <= 0
   AND COALESCE(pts_std, 0)  <= 0;
