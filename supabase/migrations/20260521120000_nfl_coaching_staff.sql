-- v5.14b (2026-05-21): track NFL head coaches per season so we never
-- silently have stale coaching data again. Populated daily from ESPN's
-- core API by supabase/functions/coaching-staff-sync.
--
-- Engine consumers can join this table at deploy time (or read it during
-- the engine run) to validate that COACHING_CHANGES_2026 entries reflect
-- the actual 2026 HCs.

CREATE TABLE IF NOT EXISTS nfl_coaching_staff (
  team text NOT NULL,
  season integer NOT NULL,
  hc_name text,
  hc_espn_id text,
  hc_first_year_with_team boolean DEFAULT false,
  last_synced_at timestamptz DEFAULT now(),
  PRIMARY KEY (team, season)
);

CREATE INDEX IF NOT EXISTS idx_nfl_coaching_staff_season
  ON nfl_coaching_staff (season);

-- Public read (used by engine via service-role internally, but also handy
-- for admin debugging).
ALTER TABLE nfl_coaching_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coaching_staff_read_all"
  ON nfl_coaching_staff FOR SELECT TO public USING (true);
