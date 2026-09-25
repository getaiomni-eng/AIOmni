-- aiomni_anchored: market-anchored base, our weekly reasoning on top (2026-09-24).
--
-- DIAGNOSIS. Our weekly board loses to the market, and the weekly layer is not
-- why. Measured over weeks 1-2:
--
--   * OUR SEASON BASE is the hole. aiomni_formula scores 0.446 / 0.243.
--     espn_adp -- a frozen draft-day average that never updates all season --
--     scores 0.578 / 0.326. We are ~0.10 spearman behind before any weekly
--     code runs.
--   * THE WEEKLY LAYER IS FINE. Correlation between our weekly adjustment and
--     the actual outcome is 0.267 against FantasyPros' 0.382. Weaker, but
--     genuinely additive -- it is not the thing to rip out.
--   * WE SWING TOO HARD. Max weekly move 176 spots vs the market's 78; WR
--     error sd 37.6 vs 33.8; and the gap is worst in the top 12 (MAE 13.5 vs
--     10.6), which is exactly where a user notices.
--
-- MECHANISM. The engine builds baseline from prior seasons and corrects
-- in-season at w = games/(games+7): 12% current-season weight at week 2, 22%
-- at week 3. So a "2026" ranking is mostly 2025 production, while ADP encodes
-- the whole offseason -- free agency, depth charts, draft capital, camp. Every
-- top-12 blowup was an ascending player whose role outran his prior line:
-- Isaiah Likely (we had TE43, he finished TE1), Kincaid twice, McConkey,
-- Coker, Tuten, Bateman, Tre Tucker.
--
-- FIX. Market consensus becomes the ANCHOR; the engine expresses DEVIATION
-- from it. Base = 25% engine + 75% ADP consensus, then our existing weekly
-- shift is applied unchanged. Sweeping the weight showed pure engine (k=1.0)
-- is the worst point in both weeks, and the curve is flat from 0.1 to 0.5 --
-- 0.25 sits in the middle of that plateau rather than on a fitted peak.
--
-- On the 131/125 players every source ranks:
--            wk1     wk2
--   live     0.5472  0.5511
--   adp      0.6047  0.4805
--   fpros    0.6255  0.5598
--   anchored 0.5998  0.5641   <- parity with the best market source
--
-- STILL A SHADOW. A 6-way ensemble backtested at 0.6120 this month and scored
-- 0.2163 -- dead last -- on the week it had not seen. Two weeks of fit is not
-- evidence. The app keeps reading aiomni_weekly until this wins on a week
-- nobody tuned against.
--
-- NOT APPLIED TO THE SEASON BOARD, deliberately. aiomni_formula also feeds the
-- draft and trade tools, and anchoring those to ADP would make the draft tool
-- advise drafting at ADP -- circular, and worthless as a differentiator. The
-- weekly start/sit board is where accuracy matters and where the anchor is not
-- self-referential.
--
-- READS LOCKED SNAPSHOTS ONLY. Never rebuilds the board: recomputing today to
-- anchor a board frozen last Thursday would hand it days of injury news the
-- frozen board never saw, and any win measured that way is the clock, not the
-- model.
CREATE OR REPLACE FUNCTION public.build_anchored_snapshot(
  p_season int, p_week int, p_k numeric DEFAULT 0.25, p_format text DEFAULT 'ppr')
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare v_rows int := 0;
begin
  if exists (select 1 from public.ranking_snapshots
              where season = p_season and week = p_week
                and source = 'aiomni_anchored' and format = p_format limit 1) then
    raise notice 'anchored already built for % week %', p_season, p_week;
    return 0;
  end if;

  with wk as (
    select gsis_id, player_name, position, team, pos_rank
      from public.ranking_snapshots
     where season = p_season and week = p_week and source = 'aiomni_weekly'
       and format = p_format and pos_rank is not null),
  fo as (
    select gsis_id, position, pos_rank
      from public.ranking_snapshots
     where season = p_season and week = p_week and source = 'aiomni_formula'
       and format = p_format and pos_rank is not null),
  mk as (
    select gsis_id, position, avg(pos_rank)::numeric as r
      from public.ranking_snapshots
     where season = p_season and week = p_week and format = p_format
       and pos_rank is not null and source in ('espn_adp','sleeper_adp')
     group by gsis_id, position),
  -- A player missing either the engine base or a market anchor keeps our
  -- weekly rank untouched. Substituting a default would invent an opinion no
  -- source actually holds.
  scored as (
    select w.gsis_id, w.player_name, w.position, w.team,
           case when fo.pos_rank is null or mk.r is null then w.pos_rank::numeric
                else (p_k * fo.pos_rank + (1 - p_k) * mk.r) - (fo.pos_rank - w.pos_rank)
           end as b
      from wk w
      left join fo on fo.gsis_id = w.gsis_id and fo.position = w.position
      left join mk on mk.gsis_id = w.gsis_id and mk.position = w.position),
  ranked as (
    select *, row_number() over (order by b) ovr,
              row_number() over (partition by position order by b) pr
      from scored)
  insert into public.ranking_snapshots
    (season, week, source, kind, format, gsis_id, player_name, position, team, rank, pos_rank)
  select p_season, p_week, 'aiomni_anchored', 'weekly', p_format,
         gsis_id, player_name, position, team, ovr, pr
    from ranked
  on conflict (season, week, source, format, player_name) do nothing;

  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

SELECT public.build_anchored_snapshot(2026, 1);
SELECT public.build_anchored_snapshot(2026, 2);
SELECT public.build_anchored_snapshot(2026, 3);

SELECT public.score_ranking_week(2026, 1);
SELECT public.score_ranking_week(2026, 2);

-- Thursday 12:50 UTC, twenty minutes after aiomni-weekly-board locks the week
-- at 12:30. Late enough that the board and the ADP captures are frozen, early
-- enough to be well clear of kickoff.
SELECT cron.unschedule('aiomni-anchored-board')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-anchored-board');

SELECT cron.schedule(
  'aiomni-anchored-board',
  '50 12 * * 4',
  $$
  SELECT public.build_anchored_snapshot(
    public.nfl_season(),
    (SELECT COALESCE(MAX(week),0) + 1 FROM public.nfl_weekly_stats
      WHERE season = public.nfl_season() AND season_type = 'REG'));
  $$
);
