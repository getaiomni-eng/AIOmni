-- Fix RLS for nfl_dvp and nfl_season_win_totals.
-- Both had RLS enabled with ZERO policies, which silently blocks all
-- reads from the client (including legitimate AIOmni app traffic).
-- Brings them in line with the rest of the public reference tables
-- (nfl_schedule, nfl_players, etc.): anon SELECT, service_role ALL.
--
-- Applied to live DB 2026-05-23 via SQL Editor. DROP-then-CREATE makes
-- the migration idempotent so re-applying on a fresh DB (or rerunning
-- after this fix lands via db push) is a no-op rather than an error.

-- ── nfl_dvp ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon read nfl_dvp"      ON public.nfl_dvp;
DROP POLICY IF EXISTS "service writes nfl_dvp" ON public.nfl_dvp;

CREATE POLICY "anon read nfl_dvp"
  ON public.nfl_dvp
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "service writes nfl_dvp"
  ON public.nfl_dvp
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── nfl_season_win_totals ──────────────────────────────────────────────
DROP POLICY IF EXISTS "anon read nfl_season_win_totals"      ON public.nfl_season_win_totals;
DROP POLICY IF EXISTS "service writes nfl_season_win_totals" ON public.nfl_season_win_totals;

CREATE POLICY "anon read nfl_season_win_totals"
  ON public.nfl_season_win_totals
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "service writes nfl_season_win_totals"
  ON public.nfl_season_win_totals
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
