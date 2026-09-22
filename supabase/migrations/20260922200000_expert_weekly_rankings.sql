-- Expert weekly rankings corpus (2026-09-22).
--
-- We need a real opponent for the weekly board. espn_adp is a DRAFT signal and
-- grading a matchup-adjusted weekly board against it answers the wrong
-- question. This table holds what the industry actually publishes each week.
--
-- TWO SHAPES, deliberately in one table:
--   INDIVIDUAL analysts -- ESPN exposes ~8 named rank sources per week and they
--     genuinely disagree (week 1 Josh Allen: QB1 from one, QB6 from another).
--     One row per analyst per player, so the spread is preserved rather than
--     averaged away before we ever see it.
--   CONSENSUS with spread -- FantasyPros ECR aggregates 11 experts and gives
--     best/worst/mean/stddev. Stored as a single expert_id 'ecr' with the
--     spread columns populated.
--
-- rank_std is the column most likely to earn its keep. It marks the players the
-- experts cannot agree on, and disagreement is the only place a model can add
-- value: matching consensus on a player everyone ranks identically proves
-- nothing.
--
-- CAPTURE OR LOSE IT. ESPN does not retain past weeks -- on 2026-09-22 week 3
-- was fully published and week 2 was already gone, leaving a few unpublished
-- rows with nonsense ranks. There is no backfill for any of this. A week not
-- captured before kickoff is gone permanently, which is why this ships with a
-- cron rather than as an on-demand script.

CREATE TABLE IF NOT EXISTS public.expert_weekly_rankings (
  season      integer     NOT NULL,
  week        integer     NOT NULL,
  format      text        NOT NULL DEFAULT 'ppr',
  provider    text        NOT NULL,              -- 'espn' | 'fantasypros'
  expert_id   text        NOT NULL,              -- ESPN rankSourceId, or 'ecr' for a consensus row
  gsis_id     text        NOT NULL,
  player_name text,
  position    text,
  team        text,
  rank        integer,                           -- overall rank within the provider's board
  pos_rank    integer,
  rank_best   integer,                           -- consensus rows only
  rank_worst  integer,
  rank_std    numeric,
  n_experts   integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season, week, format, provider, expert_id, gsis_id)
);

COMMENT ON TABLE public.expert_weekly_rankings IS
  'Weekly expert rankings harvested from public providers, one row per expert per player. Individual analyst rows (ESPN) keep the disagreement; consensus rows (FantasyPros ECR) carry best/worst/stddev. Neither provider retains history, so gaps here are permanent.';

COMMENT ON COLUMN public.expert_weekly_rankings.rank_std IS
  'Spread of expert opinion. High values mark the players worth having a view on -- agreeing with consensus where consensus is unanimous demonstrates nothing.';

CREATE INDEX IF NOT EXISTS expert_weekly_week_idx
  ON public.expert_weekly_rankings (season, week, provider);
CREATE INDEX IF NOT EXISTS expert_weekly_player_idx
  ON public.expert_weekly_rankings (gsis_id, season, week);

-- Service role only. This is harvested third-party editorial content used for
-- internal benchmarking, not something to expose to clients.
ALTER TABLE public.expert_weekly_rankings ENABLE ROW LEVEL SECURITY;

-- Thursday 12:45 UTC, matching the ESPN expert snapshot: after the 12:30 board
-- build and before Thursday night football, so every ranking in play is frozen
-- at roughly the same moment. That symmetry matters more than any modelling
-- difference -- an extra day of injury news is what made week 2's
-- aiomni_weekly number unusable.
SELECT cron.unschedule('aiomni-expert-harvest')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-expert-harvest');

SELECT cron.schedule(
  'aiomni-expert-harvest',
  '45 12 * * 4',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/expert-rankings-harvest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := jsonb_build_object('season', public.nfl_season(), 'week',
              (SELECT COALESCE(MAX(week),0) + 1 FROM public.nfl_weekly_stats
                WHERE season = public.nfl_season() AND season_type = 'REG')),
    timeout_milliseconds := 180000
  );
  $$
);
