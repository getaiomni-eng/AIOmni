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
--
-- AND THE HORIZON MATTERS AS MUCH AS THE TIMING. A season-long board and a
-- weekly board answer different questions, and scoring the first against one
-- week measures variance rather than skill: McBride can be correctly TE1 for
-- the season and finish TE14 in week 1 because Arizona got blown out. ADP
-- boards are season-long too, so scoring them weekly would rank four
-- season-long boards on weekly noise and declare a winner.
--
-- So: 'season' boards are scored on CUMULATIVE points through week N, which
-- is the question they actually answer and which sharpens as the year goes
-- on. 'weekly' boards are scored on that week alone.

CREATE TABLE IF NOT EXISTS public.ranking_snapshots (
  id          bigserial PRIMARY KEY,
  season      int         NOT NULL,
  week        int         NOT NULL,
  source      text        NOT NULL,   -- 'aiomni_formula' | 'sleeper_adp' | ...
  -- 'season'  = rest-of-season value (ADP boards, the Formula). Answers
  --             "who should I own", so it must be scored on CUMULATIVE
  --             points, not one week.
  -- 'weekly'  = matchup-adjusted for this week. Answers "who should I
  --             start", and is the only kind a single week can fairly judge.
  kind        text        NOT NULL DEFAULT 'season' CHECK (kind IN ('season','weekly')),
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
  -- 'week'       = predicted this week's finish (weekly boards only)
  -- 'cumulative' = predicted points banked through this week (season boards)
  horizon      text NOT NULL DEFAULT 'week',
  n            int  NOT NULL,          -- players scored
  mae_rank     numeric(6,2),           -- mean absolute positional-rank error
  top12_hit    numeric(5,3),           -- share of predicted top 12 that finished top 12
  spearman     numeric(5,3),           -- rank correlation, -1..1
  scored_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, source, format, position, horizon)
);

ALTER TABLE public.ranking_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ranking_accuracy  ENABLE ROW LEVEL SECURITY;
-- Operator data. No client policies; service_role only.

-- ── scoring ─────────────────────────────────────────────────────────────
-- Two horizons because two questions.
--
--   weekly boards  -> did you pick this week's best starters?
--   season boards  -> did the players you said to own actually bank points?
--
-- Only players a source ranked AND who have a stat line are scored, so a
-- source is never punished for someone who did not play -- nor rewarded for
-- ranking someone who never appears.
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
  -- This week alone: the fair test for a matchup-adjusted board.
  actual_week as (
    select gsis_id, position,
           row_number() over (partition by position order by pts desc nulls last) as act
      from pts where week = p_week
  ),
  -- Everything banked so far: the fair test for a rest-of-season board.
  -- It is deliberately cumulative rather than per-week, so a season board is
  -- judged on the thing it claimed and the measure sharpens as weeks add up.
  actual_cum as (
    select gsis_id, position,
           row_number() over (partition by position order by total desc nulls last) as act
      from (select gsis_id, position, sum(pts) as total from pts group by gsis_id, position) t
  ),
  paired as (
    select s.source, s.position, s.pos_rank as pred, a.act, 'week'::text as horizon
      from public.ranking_snapshots s
      join actual_week a on a.gsis_id = s.gsis_id
     where s.season = p_season and s.week = p_week and s.format = p_format
       and s.kind = 'weekly' and s.pos_rank is not null and s.gsis_id is not null
    union all
    select s.source, s.position, s.pos_rank, a.act, 'cumulative'
      from public.ranking_snapshots s
      join actual_cum a on a.gsis_id = s.gsis_id
     where s.season = p_season and s.week = p_week and s.format = p_format
       and s.kind = 'season' and s.pos_rank is not null and s.gsis_id is not null
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
        spearman = excluded.spearman, scored_at = now();

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
REVOKE ALL ON FUNCTION public.score_ranking_week(int, int, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.score_ranking_week(int, int, text) TO service_role;

-- ── the leaderboard, for a weekly look ──────────────────────────────────
-- Compare like with like: never mix a weekly board's weekly score against a
-- season board's cumulative score in one ranking.
CREATE OR REPLACE VIEW public.ranking_scoreboard AS
  SELECT season, week, horizon, source, n, mae_rank, top12_hit, spearman
    FROM public.ranking_accuracy
   WHERE position = 'ALL'
   ORDER BY season DESC, week DESC, horizon, mae_rank ASC;


-- ── the weekly board ────────────────────────────────────────────────────
-- The Formula answers "who should I own". This answers "who should I start",
-- which is a different question and the only one a single week can judge.
--
-- ros_score is adjusted by two things the season board deliberately averages
-- away: the specific defence a player faces, and how many points Vegas thinks
-- his team will score. Multipliers are kept modest on purpose -- a matchup
-- moves a player, it does not replace talent. Worst case ~0.79x, best ~1.23x.
CREATE TABLE IF NOT EXISTS public.nfl_weekly_board (
  season       int         NOT NULL,
  week         int         NOT NULL,
  format       text        NOT NULL DEFAULT 'ppr',
  gsis_id      text        NOT NULL,
  player_name  text        NOT NULL,
  position     text        NOT NULL,
  team         text,
  opponent     text,
  ros_score    numeric(8,3),
  dvp_rank     int,                    -- opponent's rank vs this position, 1 = toughest
  dvp_mult     numeric(5,3),
  implied_total numeric(5,2),
  total_mult   numeric(5,3),
  week_score   numeric(8,3) NOT NULL,
  rank         int          NOT NULL,
  pos_rank     int          NOT NULL,
  computed_at  timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, format, gsis_id)
);
CREATE INDEX IF NOT EXISTS nfl_weekly_board_lookup
  ON public.nfl_weekly_board (season, week, format, rank);

ALTER TABLE public.nfl_weekly_board ENABLE ROW LEVEL SECURITY;

-- Public projection, same pattern as public_rankings: the board is the
-- product, the multipliers that produced it are not.
CREATE OR REPLACE VIEW public.public_weekly_board AS
  SELECT season, week, format, gsis_id, player_name, position, team, opponent,
         rank, pos_rank
    FROM public.nfl_weekly_board;
ALTER VIEW public.public_weekly_board SET (security_invoker = off);
GRANT SELECT ON public.public_weekly_board TO anon, authenticated;

-- Thursday 12:30 UTC — after the ranking snapshot, before kickoff.
SELECT cron.unschedule('aiomni-weekly-board') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-weekly-board');
SELECT cron.schedule('aiomni-weekly-board', '30 12 * * 4',
  $$ SELECT public.kick_edge_function('weekly-board'); $$);

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
