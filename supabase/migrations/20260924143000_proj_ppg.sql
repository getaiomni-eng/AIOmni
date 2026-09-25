-- Per-game rate on the rankings table (2026-09-24).
--
-- The weekly board ranks players by the season board's rank, which is a SEASON
-- TOTAL: rate x expected games. For a season that is exactly right -- a player
-- who misses two games really does score less over the year. For ONE Sunday it
-- is wrong: he either plays or he does not, and if he plays only the rate
-- matters. The games multiplier is pure noise on a weekly board.
--
-- Measured on 2024+2025, 99 week-samples, predicting a single week:
--   rank by RATE (ppg)     0.5903
--   rank by TOTAL (cume)   0.5671
--   rate advantage        +0.0232
-- The largest single effect found in this engine so far -- bigger than the
-- opportunity blend (+0.017) and an order of magnitude above the 6-way
-- ensemble (+0.0017).
--
-- CeeDee Lamb is the visible case: 24.1 ppg, the second-best per-game rate on
-- the board, ranked WR8 while the market has him WR4, because 24.1 x 15.0
-- expected games loses to players with worse rates and fuller schedules.
--
-- NOT a double-count. Durability is applied ONCE, via expectedGamesV4 reducing
-- the games estimate; the baseline multiplier was deliberately disabled in May
-- 2026 ("DO NOT apply durability to baseline ... would double-count missed
-- games"). The season board is correct as it stands. Only the WEEKLY board is
-- reading the wrong number.
ALTER TABLE public.nfl_proprietary_rankings_v2
  ADD COLUMN IF NOT EXISTS proj_ppg numeric;

COMMENT ON COLUMN public.nfl_proprietary_rankings_v2.proj_ppg IS
  'Final projected points per game (score / expected games), after every adjustment pass. The weekly board ranks on this; the season board ranks on score. Durability belongs in one and not the other.';
