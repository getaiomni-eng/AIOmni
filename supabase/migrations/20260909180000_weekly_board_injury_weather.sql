-- Injury and weather on the weekly board (2026-09-09).
--
-- The board adjusted for defence and Vegas total but ignored whether a player
-- could actually play, which is the first thing anyone setting a lineup looks
-- at. ESPN's public injury feed carries the weekly designation that
-- nfl_players.status does not (that has IR and CUT, never Questionable).
--
-- Out / IR / Suspended players are EXCLUDED from the board rather than
-- demoted: ranking an unavailable player 40th is a worse answer than omitting
-- him, because appearing at all implies he is an option.
ALTER TABLE public.nfl_weekly_board
  ADD COLUMN IF NOT EXISTS injury_status  text,
  ADD COLUMN IF NOT EXISTS injury_shift   numeric(5,2),
  ADD COLUMN IF NOT EXISTS weather_note   text,
  ADD COLUMN IF NOT EXISTS weather_shift  numeric(5,2),
  -- false for Out and Doubtful. Those stay ON the board -- the user is
  -- actively wondering about them -- but sort below every healthy player and
  -- are labelled, never quietly ranked into a startable slot.
  ADD COLUMN IF NOT EXISTS startable      boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.nfl_weekly_board.injury_status IS
  'ESPN weekly designation. IR/PUP/Suspension are excluded from the board (roster-level, not a lineup decision). Out and Doubtful appear with startable=false. Doubtful counts as unstartable because in NFL usage it means roughly 25% to play.';
COMMENT ON COLUMN public.nfl_weekly_board.startable IS
  'false for Out/Doubtful. pos_rank only counts startable players, so TE5 always means the fifth tight end you could actually play.';
COMMENT ON COLUMN public.nfl_weekly_board.weather_shift IS
  'Rank places from conditions at the venue. Wind over 15mph is the reliable signal; cold is overstated until freezing and light rain is folklore, so both are weighted lightly.';

-- The public view carries the designation so the app can show it, but not the
-- shift maths behind it.
CREATE OR REPLACE VIEW public.public_weekly_board AS
  SELECT season, week, format, gsis_id, player_name, position, team, opponent,
         rank, pos_rank, injury_status, weather_note, startable
    FROM public.nfl_weekly_board;
ALTER VIEW public.public_weekly_board SET (security_invoker = off);
GRANT SELECT ON public.public_weekly_board TO anon, authenticated;
