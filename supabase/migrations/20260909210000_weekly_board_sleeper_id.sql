-- Player photos on the weekly board (2026-09-09).
--
-- PlayerPhoto builds its image URL from a SLEEPER id
-- (sleepercdn.com/content/nfl/players/thumb/<id>.jpg) and explicitly refuses
-- to try a gsis_id, because raw gsis ids 404 there. The weekly board carried
-- only gsis_id, so every row fell through to the "?" placeholder while PULSE
-- -- which comes from a source that already has sleeper ids -- showed real
-- headshots. Same screen, two different-looking boards.
ALTER TABLE public.nfl_weekly_board
  ADD COLUMN IF NOT EXISTS sleeper_id text;

-- sleeper_id is APPENDED, not inserted after gsis_id where it reads better.
-- CREATE OR REPLACE VIEW can only add columns at the END: inserting one
-- mid-list shifts every position after it and Postgres rejects the change as
-- a rename ("cannot change name of view column player_name to sleeper_id").
-- Dropping the view would work but takes the board offline for the moment
-- between drop and create, and column order is irrelevant to callers that
-- select by name.
CREATE OR REPLACE VIEW public.public_weekly_board AS
  SELECT season, week, format, gsis_id, player_name, position, team,
         opponent, rank, pos_rank, injury_status, weather_note, startable,
         sleeper_id
    FROM public.nfl_weekly_board;
ALTER VIEW public.public_weekly_board SET (security_invoker = off);
GRANT SELECT ON public.public_weekly_board TO anon, authenticated;

COMMENT ON COLUMN public.nfl_weekly_board.sleeper_id IS
  'For the player headshot. Null for players nfl_players has not yet cross-mapped -- mostly 2026 rookies awaiting the id backfill -- who correctly render a placeholder rather than a broken image.';
