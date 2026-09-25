-- Re-freeze week 3's ensemble snapshot (2026-09-25).
--
-- The first production run of weekly-rankings happened after ATL@GB kicked
-- off, and two bugs landed in the frozen record:
--   * The Odds API returned IN-GAME lines for the game in progress; ATL's
--     implied total read 16.25 against a 19.5 pregame line.
--   * ATL and GB had no week-3 depth chart (the sync was deployed after their
--     kickoff), so the context model treated their players as deep backups.
-- Net: Bijan Robinson RB5 instead of RB2. Both are fixed in code. The
-- snapshot is write-once, so the buggy rows must be removed for the next run
-- to freeze the corrected board. Rankings use only pre-week-3 stats, so
-- re-freezing after TNF kickoff does not leak its result into the record.
DELETE FROM public.ranking_snapshots
 WHERE source = 'aiomni_ensemble' AND season = 2026 AND week = 3;
