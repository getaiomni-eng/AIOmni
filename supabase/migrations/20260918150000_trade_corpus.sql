-- Trade corpus + market-value snapshots (2026-09-18).
--
-- WHY: the Trade Analyzer grades a trade against KTC and calls anything past
-- FLAG_THRESHOLD_PCT (25) "lopsided". That 25 was hand-picked. Measured
-- against 22 real ACCEPTED 2026 trades pulled from Sleeper's public API, the
-- gap distribution on trades two managers both said yes to is:
--
--     min 2   p25 8   median 19   p75 31   p90 39   max 100
--
-- so 25 flags 41% of ordinary, mutually-agreed trades as a fleecing. The
-- threshold should come from what managers actually accept, not from a guess.
-- These two tables are what make that possible.
--
-- WHY A VALUE SNAPSHOT IS THE URGENT HALF: KTC only ever serves TODAY's
-- market. 173 historical trades are reachable via previous_league_id chains,
-- and every one of them is currently unpriceable -- pricing a 2023 trade with
-- 2026 values is nonsense, since half those players have since busted or
-- broken out. Nothing can recover the prices that existed then. Every week
-- without a snapshot is a week of trades that can never be properly priced,
-- which is why this ships before the analysis that consumes it.

-- ── the corpus ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.trade_corpus (
  platform        text        NOT NULL,
  league_id       text        NOT NULL,
  transaction_id  text        NOT NULL,
  season          integer,
  week            integer,
  accepted_at     timestamptz,
  -- Roster slots WITHIN a league ("1", "2"). Deliberately not usernames or
  -- user ids: the corpus needs to know a trade had two sides, never who they
  -- were. Nothing here should be able to re-identify a person.
  roster_a        text        NOT NULL,
  roster_b        text        NOT NULL,
  -- [{kind:'player'|'pick', name, position?, team?, season?, round?}]
  side_a          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  side_b          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  has_picks       boolean     NOT NULL DEFAULT false,
  discovered_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform, league_id, transaction_id)
);

COMMENT ON TABLE public.trade_corpus IS
  'Completed two-sided trades harvested from public league APIs. Ground truth for what managers actually accept, used to calibrate the Trade Analyzer lopsided threshold. Service role only.';

CREATE INDEX IF NOT EXISTS trade_corpus_season_idx ON public.trade_corpus (season, week);

-- RLS on, NO policies. This is other people's league activity aggregated
-- across leagues. Public on Sleeper one league at a time is not the same as
-- queryable in bulk by any signed-in client, so nothing but the service role
-- reads it.
ALTER TABLE public.trade_corpus ENABLE ROW LEVEL SECURITY;

-- ── market value over time ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ktc_value_snapshots (
  captured_on date    NOT NULL,
  format      text    NOT NULL CHECK (format IN ('dynasty','redraft')),
  asset_name  text    NOT NULL,          -- player name, or a pick like '2027 Early 1st'
  one_qb      integer,
  superflex   integer,
  position    text,
  team        text,
  PRIMARY KEY (captured_on, format, asset_name)
);

COMMENT ON TABLE public.ktc_value_snapshots IS
  'Weekly KeepTradeCut value snapshot. Exists so a trade can later be priced at the market that existed WHEN IT HAPPENED. KTC serves only current values, so history not captured here is lost permanently.';

ALTER TABLE public.ktc_value_snapshots ENABLE ROW LEVEL SECURITY;

-- ── schedule ────────────────────────────────────────────────────────────
-- Tuesday 11:00 UTC: after score-rankings (10:15) and score-projections
-- (10:20), so a heavy harvest never contends with the accuracy jobs that
-- actually gate Tuesday's numbers.
--
-- NOT on kick_edge_function: that helper hardcodes a 60s timeout, and a
-- harvest sweeping every known league is comfortably past it. Same reason the
-- rankings rerun posts directly.
SELECT cron.unschedule('aiomni-trade-corpus')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-trade-corpus');

SELECT cron.schedule(
  'aiomni-trade-corpus',
  '0 11 * * 2',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/trade-corpus-harvest',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'apikey',        (SELECT value FROM public.app_settings WHERE key = 'anon_key'),
      'Authorization', 'Bearer ' || (SELECT value FROM public.app_settings WHERE key = 'anon_key')),
    body := '{"mode":"incremental"}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
