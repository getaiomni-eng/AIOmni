-- nfl_schedule already populated (272 games for 2026 via populate-schedule edge function),
-- but anon/auth users can't read it. This migration matches the proprietary_rankings pattern:
-- anyone can read, only service_role writes.

ALTER TABLE nfl_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read schedule" ON nfl_schedule;
CREATE POLICY "anon read schedule"
  ON nfl_schedule FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "service writes schedule" ON nfl_schedule;
CREATE POLICY "service writes schedule"
  ON nfl_schedule FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
