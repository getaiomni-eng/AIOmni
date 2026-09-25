-- aiomni_blend shadow source (2026-09-24).
--
-- On the fair comparison -- same 97 players, same horizon -- our board is last
-- or next-to-last in both played weeks:
--
--            wk1    wk2
--   fpros    0.607  0.403
--   espn_pr  0.597  0.386
--   slp_pr   0.543  0.406
--   ours     0.432  0.246
--
-- Sweeping one blend weight over 369 player-weeks gives a smooth curve with an
-- INTERIOR maximum -- pure market 0.6188, pure us 0.5312, best 0.6374 at 30%
-- us. The interior peak is the whole point: it says our board holds something
-- the market does not, while the market is the better base. WR shows the gain
-- in both weeks and RB mildly; QB and TE contradict each other week to week on
-- ~30 players, so one global weight is used instead of four fitted ones.
--
-- SHADOW, NOT THE BOARD. A 6-way ensemble backtested at 0.6120 this month and
-- then scored 0.2163 -- dead last -- on the week it had not seen. Two weeks of
-- fit is not evidence. The app keeps reading aiomni_weekly until the blend
-- wins on a week nobody tuned against.
--
-- BUILT FROM LOCKED SNAPSHOTS, never from a live rebuild. Week 3's
-- aiomni_weekly was frozen 2026-09-23; rebuilding the board today to blend it
-- would hand the blend two extra days of injury news the frozen board never
-- saw, and any win measured that way is the clock, not the model. Reading
-- ranking_snapshots means every input was frozen at the same moment.
CREATE OR REPLACE FUNCTION public.build_blend_snapshot(
  p_season int, p_week int, p_weight numeric DEFAULT 0.30, p_format text DEFAULT 'ppr')
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare v_rows int := 0;
begin
  if exists (select 1 from public.ranking_snapshots
              where season = p_season and week = p_week
                and source = 'aiomni_blend' and format = p_format limit 1) then
    raise notice 'blend already built for % week %', p_season, p_week;
    return 0;
  end if;

  with ours as (
    select gsis_id, player_name, position, team, pos_rank
      from public.ranking_snapshots
     where season = p_season and week = p_week and source = 'aiomni_weekly'
       and format = p_format and pos_rank is not null
  ),
  mkt as (
    select gsis_id, position, avg(pos_rank)::numeric as r
      from public.ranking_snapshots
     where season = p_season and week = p_week and format = p_format
       and pos_rank is not null
       and source in ('fantasypros_ecr','espn_proj','sleeper_proj','espn_expert')
     group by gsis_id, position
  ),
  -- A player the market does not rank keeps our rank unblended. Substituting a
  -- default would invent an opinion no source actually holds.
  blended as (
    select o.gsis_id, o.player_name, o.position, o.team,
           case when m.r is null then o.pos_rank::numeric
                else p_weight * o.pos_rank + (1 - p_weight) * m.r end as b
      from ours o left join mkt m using (gsis_id, position)
  ),
  ranked as (
    select *, row_number() over (order by b) as ovr,
              row_number() over (partition by position order by b) as pr
      from blended
  )
  insert into public.ranking_snapshots
    (season, week, source, kind, format, gsis_id, player_name, position, team, rank, pos_rank)
  select p_season, p_week, 'aiomni_blend', 'weekly', p_format,
         gsis_id, player_name, position, team, ovr, pr
    from ranked
  on conflict (season, week, source, format, player_name) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

-- Weeks 1-3. Every input for all three was frozen before its own kickoff, so
-- these are honest retroactive builds rather than hindsight.
SELECT public.build_blend_snapshot(2026, 1);
SELECT public.build_blend_snapshot(2026, 2);
SELECT public.build_blend_snapshot(2026, 3);

-- Rescore the played weeks so blend and live board sit in one table.
SELECT public.score_ranking_week(2026, 1);
SELECT public.score_ranking_week(2026, 2);
