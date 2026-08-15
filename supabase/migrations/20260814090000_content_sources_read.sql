-- Let authenticated clients read content_sources metadata (name, weight).
-- The Coach's ANALYST BUZZ block attributes takes to their source
-- ("Rotowire, Aug 14") and weights them by source quality — both require
-- the FK join from analyst_takes to resolve for clients. Feed metadata
-- is not sensitive; content_items (pipeline state) stays server-only.
CREATE POLICY content_sources_read ON content_sources
  FOR SELECT TO authenticated USING (true);
