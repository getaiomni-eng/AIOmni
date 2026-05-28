-- v2 rankings table: identical schema to nfl_proprietary_rankings, used by
-- the parallel aiomni-rankings-engine-v2 function during the 6-layer rebuild.
-- Once v2 is verified defensible, we'll swap names + drop the v1 table.

CREATE TABLE IF NOT EXISTS nfl_proprietary_rankings_v2 (LIKE nfl_proprietary_rankings INCLUDING ALL);

ALTER TABLE nfl_proprietary_rankings_v2 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read rankings v2" ON nfl_proprietary_rankings_v2;
CREATE POLICY "anon read rankings v2"
  ON nfl_proprietary_rankings_v2 FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "service writes rankings v2" ON nfl_proprietary_rankings_v2;
CREATE POLICY "service writes rankings v2"
  ON nfl_proprietary_rankings_v2 FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
