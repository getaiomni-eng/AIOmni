-- Weekly auto-scoring for all hosted leagues (2026-09-04).
-- Tuesdays 09:00 UTC: stats for the completed week are in nfl_weekly_stats
-- by Tuesday (nflverse weekly sync); score every drafted hosted league for
-- the latest week that has data. Idempotent all the way down.
CREATE OR REPLACE FUNCTION public.compute_all_bestball()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_season int; v_week int; v_lg record; v_n int := 0;
begin
  v_season := extract(year from now())::int;
  select max(week) into v_week from public.nfl_weekly_stats
   where season = v_season and season_type = 'REG';
  if v_week is null then return 0; end if;
  for v_lg in select id from public.hosted_leagues
              where season = v_season and draft_status = 'complete' loop
    perform public.compute_bestball_week(v_lg.id, v_season, v_week);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
REVOKE ALL ON FUNCTION public.compute_all_bestball() FROM public, anon, authenticated;

SELECT cron.unschedule('aiomni-bestball-weekly')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-bestball-weekly');
SELECT cron.schedule('aiomni-bestball-weekly', '0 9 * * 2',
  $$ SELECT public.compute_all_bestball(); $$);
