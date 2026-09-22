-- Make the ranking scoreboard actually comparable (2026-09-22).
--
-- The numbers we have been steering by had TWO independent apples-to-oranges
-- faults, and between them they invented a positional story that is not real.
--
-- FAULT 1 -- COVERAGE. Each source was scored over ITS OWN ranked set, and the
-- sets are different sizes. Spearman rewards coverage: correctly ordering a
-- long tail of players who reliably score nothing is easy, and it lifts the
-- number. Week 2 coverage was ours 55 TEs vs ESPN 34, and ours 63 RBs vs ESPN
-- 90. That alone produced the headline "we beat ESPN at TE by +0.375 and lose
-- RB by -0.16". On the 31 TEs BOTH rank, ESPN is actually marginally ahead
-- (0.095 vs 0.076) and both are near random. The TE edge was an artefact of
-- ranking 21 players ESPN does not list.
--
-- FAULT 2 -- HORIZON. kind decided the horizon, so aiomni_weekly (kind
-- 'weekly') was graded on the WEEK while aiomni_formula, espn_adp and
-- sleeper_adp (kind 'season') were graded CUMULATIVELY. Those are different
-- tasks -- a two-week total has less variance than a single week and is
-- easier to predict -- yet the four sat in one table and got compared.
--
-- FIX. Every source is now scored on BOTH horizons, and each horizon also gets
-- a _common variant restricted to players EVERY source ranked. The common rows
-- are the only ones that answer "who orders the same players better"; the
-- open rows still answer "who covers more ground", which is a real question
-- but a different one. Reading them as the same number is what went wrong.
--
-- kind is now informational. It no longer decides what a source is graded on.

CREATE OR REPLACE FUNCTION public.score_ranking_week(p_season int, p_week int, p_format text DEFAULT 'ppr')
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare v_rows int := 0;
begin
  if not exists (
    select 1 from public.nfl_weekly_stats
     where season = p_season and week = p_week and season_type = 'REG' limit 1) then
    raise notice 'no stats for % week % yet', p_season, p_week;
    return 0;
  end if;

  with pts as (
    select w.gsis_id, w.week, np.position,
           (case p_format
              when 'std'  then w.fantasy_pts_std
              when 'half' then w.fantasy_pts_half
              else             w.fantasy_pts_ppr end)::numeric as pts
      from public.nfl_weekly_stats w
      join public.nfl_players np on np.gsis_id = w.gsis_id
     where w.season = p_season and w.season_type = 'REG' and w.week <= p_week
       and np.position in ('QB','RB','WR','TE')
  ),
  actual_week as (
    select gsis_id, position,
           row_number() over (partition by position order by pts desc nulls last) as act
      from pts where week = p_week
  ),
  actual_cum as (
    select gsis_id, position,
           row_number() over (partition by position order by total desc nulls last) as act
      from (select gsis_id, position, sum(pts) as total from pts group by gsis_id, position) t
  ),
  snap as (
    select source, position, gsis_id, pos_rank
      from public.ranking_snapshots
     where season = p_season and week = p_week and format = p_format
       and pos_rank is not null and gsis_id is not null
  ),
  -- Players EVERY source ranked. Anything else is a coverage comparison
  -- wearing a skill comparison's clothes.
  src_count as (select count(distinct source) as k from snap),
  common_ids as (
    select gsis_id from snap group by gsis_id
     having count(distinct source) = (select k from src_count)
  ),
  paired as (
    select s.source, s.position, s.pos_rank as pred, a.act, 'week'::text as horizon
      from snap s join actual_week a using (gsis_id, position)
    union all
    select s.source, s.position, s.pos_rank, a.act, 'cumulative'
      from snap s join actual_cum a using (gsis_id, position)
    union all
    select s.source, s.position, s.pos_rank, a.act, 'week_common'
      from snap s join actual_week a using (gsis_id, position)
     where s.gsis_id in (select gsis_id from common_ids)
    union all
    select s.source, s.position, s.pos_rank, a.act, 'cumulative_common'
      from snap s join actual_cum a using (gsis_id, position)
     where s.gsis_id in (select gsis_id from common_ids)
  ),
  per_pos as (
    select source, horizon, position, count(*) n,
           avg(abs(pred - act))::numeric(6,2) mae,
           avg(case when pred <= 12 and act <= 12 then 1.0 when pred <= 12 then 0.0 end)::numeric(5,3) hit12,
           corr(pred::numeric, act::numeric)::numeric(5,3) rho
      from paired group by source, horizon, position
  ),
  combined as (
    select source, horizon, 'ALL' as position, count(*) n,
           avg(abs(pred - act))::numeric(6,2) mae,
           avg(case when pred <= 12 and act <= 12 then 1.0 when pred <= 12 then 0.0 end)::numeric(5,3) hit12,
           corr(pred::numeric, act::numeric)::numeric(5,3) rho
      from paired group by source, horizon
  ),
  merged as (select * from per_pos union all select * from combined)
  insert into public.ranking_accuracy
    (season, week, source, format, position, horizon, n, mae_rank, top12_hit, spearman, scored_at)
  select p_season, p_week, source, p_format, position, horizon, n, mae, hit12, rho, now()
    from merged
  on conflict (season, week, source, format, position, horizon) do update
    set n = excluded.n, mae_rank = excluded.mae_rank, top12_hit = excluded.top12_hit,
        spearman = excluded.spearman, scored_at = excluded.scored_at;

  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Rescore both played weeks so the corrected numbers replace the misleading ones.
SELECT public.score_ranking_week(2026, 1);
SELECT public.score_ranking_week(2026, 2);
