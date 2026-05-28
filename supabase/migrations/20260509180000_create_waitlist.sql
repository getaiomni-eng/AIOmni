-- Waitlist table for getaiomni.com landing page signups.
-- Idempotent — adds columns if the table already exists.
CREATE TABLE IF NOT EXISTS waitlist (
  id           bigserial PRIMARY KEY,
  email        text NOT NULL UNIQUE,
  source       text,
  signed_up_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS source       text,
  ADD COLUMN IF NOT EXISTS signed_up_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_waitlist_signed_up_at
  ON waitlist (signed_up_at DESC);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;

-- Anon can INSERT only (no SELECT/UPDATE/DELETE).
DROP POLICY IF EXISTS waitlist_anon_insert ON waitlist;
CREATE POLICY waitlist_anon_insert
  ON waitlist FOR INSERT
  TO anon
  WITH CHECK (true);

-- Authenticated users (service role) can do everything.
DROP POLICY IF EXISTS waitlist_service_all ON waitlist;
CREATE POLICY waitlist_service_all
  ON waitlist FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
