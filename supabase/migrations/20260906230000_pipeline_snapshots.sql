-- Game-day pipeline snapshots (2026-09-06).
--
-- Week 1 is the first time any in-season code path runs against live data.
-- The question we cannot answer today is simple: DOES anything actually
-- arrive during games, or does the whole pipeline only move on Tuesday when
-- nflverse-weekly-sync fires? Until real games are played there is no way to
-- know, and after they are played the moment is gone.
--
-- So: capture the state of the pipeline at four checkpoints around the
-- Sunday and Monday slates and keep the rows. Cheap, additive, read-only
-- against everything else, and it turns "I think scoring works" into a
-- timestamped record we can diff.
--
-- Deliberately server-side rather than a scheduled Claude agent: pg_cron
-- runs whether or not anyone has a session open, which is the entire point.

CREATE TABLE IF NOT EXISTS public.pipeline_snapshots (
  id          bigserial PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  label       text        NOT NULL,
  season      int,
  data        jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS pipeline_snapshots_captured_idx
  ON public.pipeline_snapshots (captured_at DESC);

ALTER TABLE public.pipeline_snapshots ENABLE ROW LEVEL SECURITY;
-- No client policy on purpose: this is operator data, service_role only.

-- Every metric sits in its own BEGIN/EXCEPTION block. A snapshot that loses
-- one number because a column was renamed is still worth having; a snapshot
-- that throws and writes nothing is worth nothing, and we only get one
-- chance at each of these moments.
CREATE OR REPLACE FUNCTION public.capture_pipeline_snapshot(p_label text)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  v_season int;
  v_data   jsonb := '{}'::jsonb;
  v_id     bigint;
  v_n      bigint;
  v_w      int;
  v_t      timestamptz;
  v_leagues jsonb;
begin
  begin
    v_season := public.nfl_season();
  exception when others then
    v_season := extract(year from now())::int;
  end;

  -- 1. The stats pipeline. If stats_max_week never moves during the Sunday
  --    checkpoints and only jumps Tuesday, that confirms the sync is the
  --    sole writer and nothing is live.
  begin
    select coalesce(max(week), 0), count(*) into v_w, v_n
      from public.nfl_weekly_stats
     where season = v_season and season_type = 'REG';
    v_data := v_data || jsonb_build_object('stats_max_week', v_w, 'stats_rows_season', v_n);
  exception when others then
    v_data := v_data || jsonb_build_object('stats_error', sqlerrm);
  end;

  -- 2. Best-ball scoring output.
  begin
    select count(*), coalesce(max(week), 0), max(computed_at)
      into v_n, v_w, v_t
      from public.hosted_weekly_scores where season = v_season;
    v_data := v_data || jsonb_build_object(
      'bestball_rows', v_n, 'bestball_max_week', v_w, 'bestball_last_computed', v_t);
  exception when others then
    v_data := v_data || jsonb_build_object('bestball_error', sqlerrm);
  end;

  -- 3. League activity, so scoring can be read against how much there was
  --    to score. Zero drafted leagues makes a zero score unremarkable.
  begin
    select coalesce(jsonb_object_agg(draft_status, n), '{}'::jsonb) into v_leagues
      from (select draft_status, count(*) n from public.hosted_leagues
             where season = v_season group by draft_status) q;
    v_data := v_data || jsonb_build_object('leagues_by_status', v_leagues);
  exception when others then
    v_data := v_data || jsonb_build_object('leagues_error', sqlerrm);
  end;

  begin
    select count(*) into v_n from public.hosted_picks;
    v_data := v_data || jsonb_build_object('picks_total', v_n);
  exception when others then null;
  end;

  begin
    select count(*) into v_n from public.hosted_members;
    v_data := v_data || jsonb_build_object('members_total', v_n);
  exception when others then null;
  end;

  -- 4. Demand side: are people actually using the AI on game day?
  begin
    select count(*) into v_n from public.ai_response_metadata
     where created_at > now() - interval '6 hours';
    v_data := v_data || jsonb_build_object('ai_calls_6h', v_n);
  exception when others then
    v_data := v_data || jsonb_build_object('ai_calls_6h', null);
  end;

  insert into public.pipeline_snapshots (label, season, data)
  values (p_label, v_season, v_data)
  returning id into v_id;
  return v_id;
end;
$$;
REVOKE ALL ON FUNCTION public.capture_pipeline_snapshot(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_pipeline_snapshot(text) TO service_role;

-- ── Schedules ───────────────────────────────────────────────────────────
-- pg_cron runs in UTC. These are Central (CDT, UTC-5) through 2026-11-01,
-- after which CST makes them fire one hour earlier in local terms. Shift
-- the UTC hours back by one at that point if the timing still matters.
--
--   Sun 16:00 CT  -> 21:00 UTC Sun   after the early window
--   Sun 19:00 CT  -> 00:00 UTC Mon   after the late afternoon window
--   Sun 23:59 CT  -> 05:00 UTC Mon   after Sunday night
--   Mon 23:59 CT  -> 05:00 UTC Tue   after Monday night, before the
--                                    Tuesday 08:00 UTC nflverse sync, so
--                                    the last Sunday row is a clean "before"
SELECT cron.unschedule('aiomni-snap-sun-late-afternoon') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-snap-sun-late-afternoon');
SELECT cron.unschedule('aiomni-snap-sun-evening') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-snap-sun-evening');
SELECT cron.unschedule('aiomni-snap-sun-midnight') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-snap-sun-midnight');
SELECT cron.unschedule('aiomni-snap-mon-midnight') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'aiomni-snap-mon-midnight');

SELECT cron.schedule('aiomni-snap-sun-late-afternoon', '0 21 * * 0',
  $$ SELECT public.capture_pipeline_snapshot('sun_4pm_ct'); $$);
SELECT cron.schedule('aiomni-snap-sun-evening', '0 0 * * 1',
  $$ SELECT public.capture_pipeline_snapshot('sun_7pm_ct'); $$);
SELECT cron.schedule('aiomni-snap-sun-midnight', '0 5 * * 1',
  $$ SELECT public.capture_pipeline_snapshot('sun_midnight_ct'); $$);
SELECT cron.schedule('aiomni-snap-mon-midnight', '0 5 * * 2',
  $$ SELECT public.capture_pipeline_snapshot('mon_midnight_ct'); $$);
