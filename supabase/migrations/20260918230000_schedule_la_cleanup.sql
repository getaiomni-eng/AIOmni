-- Remove duplicate Rams rows created by the first schedule sync (2026-09-18).
--
-- nflverse codes the Rams "LA"; every other table in this project says "LAR".
-- The first run of nfl-schedule-sync wrote nflverse codes through unmapped, so
-- each Rams HOME game got a second row under home_team='LA' sitting beside the
-- real 'LAR' one -- nine of them, all 2026.
--
-- Rams AWAY games needed no cleanup: those upsert on (season, week, home_team)
-- where the host code was already correct, so the bad away_team='LA' value was
-- simply overwritten with 'LAR' when the sync re-ran with the alias map.
--
-- The alias map in nfl-schedule-sync (LA/STL -> LAR, SD -> LAC, OAK -> LV,
-- WSH -> WAS) stops this recurring, including for backfills of older seasons.
--
-- Scoped hard to exactly the bad rows: home_team = 'LA' only. 'LAR' rows are
-- the real schedule and must survive.
DELETE FROM public.nfl_schedule
 WHERE home_team = 'LA';
