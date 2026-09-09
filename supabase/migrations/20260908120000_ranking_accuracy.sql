-- Weekly ranking accuracy tracking (2026-09-08).
--
-- Registers what every source believed BEFORE a week is played, then scores
-- it against what actually happened. The point is a defensible answer to
-- "are our rankings better than ESPN's", measured rather than asserted.
--
-- Two tables because the questions are different: snapshots are predictions
-- and must be immutable once the week starts, scores are derived and can be
-- recomputed as the methodology improves.
--
-- Timing is the whole game. A snapshot taken after kickoff is not a
-- prediction, so capture runs Thursday morning and scoring runs the
-- following Tuesday once nflverse has landed.

CREATE TABLE IF NOT EXISTS public.ranking_snapshots (
  id          bigserial PRIMARY KEY,
  season      int         NOT NULL,
  week        int         NOT NULL,
  source      text        NOT NULL,   -- 'aiomni_formula' | 'sleeper_adp' | ...
  format      text        NOT NULL DEFAULT 'ppr',
  gsis_id     text,                   -- null when a source cannot be mapped
  player_name text        NOT NULL,
  position    text,
  team        text,
  rank        int         NOT NULL,   -- overall rank within the source
  pos_rank    int,
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ranking_snapshots_uniq
  ON public.ranking_snapshots (season, week, source, format, player_name);
CREATE INDEX IF NOT EXISTS ranking_snapshots_lookup
  ON public.ranking_snapshots (season, week, source);

CREATE TABLE IF NOT EXISTS public.ranking_accuracy (
  season       int  NOT NULL,
  week         int  NOT NULL,
  source       text NOT NULL,
  format       text NOT NULL DEFAULT 'ppr',
  position     text NOT NULL,          -- 'ALL' for the combined figure
  n            int  NOT NULL,          -- players scored
  mae_rank     numeric(6,2),           -- mean absolute positional-rank error
  top12_hit    numeric(5,3),           -- share of predicted top 12 that finished top 12
  spearman     numeric(5,3),           -- rank correlation, -1..1
  scored_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, source, format, position)
);

ALTER TABLE public.ranking_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_accuracy  ENABLE ROW LEVEL SECURITY;
-- Operator data. No client policies; service_role only.

-- ── scoring ─────────────────────────────────────────────────────────────
-- Compares each source's predicted positional order against the actual
-- fantasy finish for that week. Only players the source ranked AND who have
-- a stat line are scored, so a source is never punished for a player who
-- did not play -- but it is also not rewarded for ranking someone who never
-- appears.
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

  with actual as (
    -- What actually happened, ranked within position for the week.
    select w.gsis_id, np.position,
           (case p_format
              when 'std'  then w.fantasy_pts_std
              when 'half' then w.fantasy_pts_half
              else             w.fantasy_pts_ppr end)::numeric as pts,
           row_number() over (
             partition by np.position
             order by (case p_format
                         when 'std'  then w.fantasy_pts_std
                         when 'half' then w.fantasy_pts_half
                         else             w.fantasy_pts_ppr end) desc nulls last
           ) as actual_pos_rank
      from public.nfl_weekly_stats w
      join public.nfl_players np on np.gsis_id = w.gsis_id
     where w.season = p_season and w.week = p_week and w.season_type = 'REG'
       and np.position in ('QB','RB','WR','TE')
  ),
  paired as (
    select s.source, s.position, s.pos_rank as pred, a.actual_pos_rank as act
      from public.ranking_snapshots s
      join actual a on a.gsis_id = s.gsis_id
     where s.season = p_season and s.week = p_week and s.format = p_format
       and s.pos_rank is not null and s.gsis_id is not null
  ),
  per_pos as (
    select source, position,
           count(*) as n,
           avg(abs(pred - act))::numeric(6,2) as mae,
           avg(case when pred <= 12 and act <= 12 then 1.0
                    when pred <= 12 then 0.0 end)::numeric(5,3) as hit12,
           corr(pred::numeric, act::numeric)::numeric(5,3) as rho
      from paired group by source, position
  ),
  combined as (
    select source, 'ALL' as position, count(*) as n,
           avg(abs(pred - act))::numeric(6,2) as mae,
           avg(case when pred <= 12 and act <= 12 then 1.0
                    when pred <= 12 then 0.0 end)::numeric(5,3) as hit12,
           corr(pred::numeric, act::numeric)::numeric(5,3) as rho
      from paired group by source
  ),
  merged as (select * from per_pos union all select * from combined)
  insert into public.ranking_accuracy (season, week, source, format, position, n, mae_rank, top12_hit, spearman, scored_at)
  select p_season, p_week, source, p_format, position, n, mae, hit12, rho, now()
    from merged
  on conflict (season, week, source, format, position) do update
    set n = excluded.n, mae_rank = excluded.mae_rank, top12_hit = excluded.top12_hit,
        spearman = excluded.spearman, scored_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
REVOKE ALL ON FUNCTION public.score_ranking_week(int, int, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.score_ranking_week(int, int, text) TO service_role;

-- ── the leaderboard, for a weekly look ──────────────────────────────────
CREATE OR REPLACE VIEW public.ranking_scoreboard AS
  SELECT season, week, source, position, n, mae_rank, top12_hit, spearman
    FROM public.ranking_accuracy
   WHERE position = 'ALL'
   ORDER BY season DESC, week DESC, mae_rank ASC;

-- ── schedules ───────────────────────────────────────────────────────────
-- Thursday 13:00 UTC (08:00 CT) -- before any week's first kickoff.
SELECT cron.unschedule('aiomni-snapshot-rankings') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-snapshot-rankings');
SELECT cron.schedule('aiomni-snapshot-rankings', '0 13 * * 4',
  $$ SELECT public.kick_edge_function('snapshot-rankings'); $$);

-- Tuesday 10:15 UTC -- after nflverse (08:00) and best-ball scoring (09:00).
SELECT cron.unschedule('aiomni-score-rankings') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-score-rankings');
SELECT cron.schedule('aiomni-score-rankings', '15 10 * * 2',
  $$ SELECT public.score_ranking_week(
       public.nfl_season(),
       (SELECT COALESCE(MAX(week), 0) FROM public.nfl_weekly_stats
         WHERE season = public.nfl_season() AND season_type = 'REG')); $$);
