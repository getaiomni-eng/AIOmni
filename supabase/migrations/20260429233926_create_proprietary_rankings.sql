-- AIOmni proprietary rankings table.
-- Populated by supabase/functions/aiomni-rankings-engine on a weekly cron.
-- Read by the client (services/rankingsData.ts → fetchAIOmniProprietary).

CREATE TABLE IF NOT EXISTS nfl_proprietary_rankings (
  -- Composite key: per-format snapshot of the rankings
  format          text NOT NULL,                  -- 'PPR' | 'HALF' | 'STD' | 'SF' | 'DYN'
  rank            int  NOT NULL,                  -- 1..250 within the format
  gsis_id         text NOT NULL,
  name            text NOT NULL,
  position        text NOT NULL,
  team            text,
  pos_rank        int,                            -- per-position rank
  score           numeric(8,3) NOT NULL,          -- raw synthesis score
  tier            int,
  -- Component breakdowns -- used for the "why this rank" UI later
  baseline_2025   numeric(6,2),                   -- 2025 PPR/Half/Std avg per game
  age_adj         numeric(5,2),                   -- multiplier from age curve
  team_change_adj numeric(5,2),                   -- delta from FA/trade landing
  rookie_boost    numeric(5,2),                   -- 0 for vets, positive for 2026 draftees
  opportunity_adj numeric(5,2),                   -- snap share + target trend
  floor_protected boolean DEFAULT false,
  method          text,                            -- human-readable explanation
  computed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (format, rank)
);

CREATE INDEX IF NOT EXISTS idx_prop_rankings_gsis ON nfl_proprietary_rankings (gsis_id);
CREATE INDEX IF NOT EXISTS idx_prop_rankings_format_pos ON nfl_proprietary_rankings (format, position);

-- Allow anon read (rankings are public)
ALTER TABLE nfl_proprietary_rankings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read proprietary rankings" ON nfl_proprietary_rankings;
CREATE POLICY "anon read proprietary rankings"
  ON nfl_proprietary_rankings FOR SELECT
  TO anon, authenticated
  USING (true);

-- Only service role writes (only the edge function should populate)
DROP POLICY IF EXISTS "service writes proprietary rankings" ON nfl_proprietary_rankings;
CREATE POLICY "service writes proprietary rankings"
  ON nfl_proprietary_rankings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE nfl_proprietary_rankings IS
  'AIOmni-synthesized rankings. 75% aggressive (age, team, capital, opportunity), 25% anchored to 2025 finish. Recomputed weekly.';
