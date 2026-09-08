-- Stop publishing the ranking model to anonymous callers (2026-09-07).
--
-- BOTH ranking tables grant anon SELECT on every column, including `method` --
-- a readable derivation carrying the tuned parameters. One unauthenticated
-- request returns the whole board with a method string on every row.
--
-- nfl_proprietary_rankings_v2 is the LIVE table (recomputed daily; the app
-- repointed to it 2026-06-02) and its method strings describe the CURRENT
-- model, e.g. "3yr v3 blend + 3-qual-vet (+6%) ... [age/exp 1.10x] ...
-- [role/share 1.03x]". The legacy nfl_proprietary_rankings is stale but
-- equally exposed. Both are covered here.
--
-- The rankings themselves are the product and are meant to be seen. The
-- parameters are not. They were being served together.
--
-- The client fetches `method` into a field it never renders (rankingsData.ts
-- :1054 -- nothing in rankings.tsx or the components reads it), so dropping
-- it from the public projection costs the app nothing.
--
-- TWO STEPS ON PURPOSE. This migration only creates and grants the views.
-- Revoking on the base tables before the app is shipped against the view
-- would break the rankings tab for signed-out users, who read as anon.
-- Run the REVOKE block at the bottom AFTER the OTA has landed.

CREATE OR REPLACE VIEW public.public_rankings AS
  SELECT format, rank, gsis_id, name, position, team, pos_rank, score, tier
    FROM public.nfl_proprietary_rankings_v2;
-- security_invoker = OFF on purpose. The view must run as its owner: that is
-- what lets anon read these columns WITHOUT holding SELECT on the base table,
-- which is the entire point. With invoker rights the view breaks the moment
-- the base-table grant is revoked -- which is exactly what happened on first
-- deploy (2026-09-08: "permission denied for table
-- nfl_proprietary_rankings_v2" on signed-out Rankings).
ALTER VIEW public.public_rankings SET (security_invoker = off);
GRANT SELECT ON public.public_rankings TO anon, authenticated;

CREATE OR REPLACE VIEW public.public_rankings_legacy AS
  SELECT format, rank, gsis_id, name, position, team, pos_rank, score, tier
    FROM public.nfl_proprietary_rankings;
ALTER VIEW public.public_rankings_legacy SET (security_invoker = off);
GRANT SELECT ON public.public_rankings_legacy TO anon, authenticated;

COMMENT ON VIEW public.public_rankings IS
  'Public projection of nfl_proprietary_rankings_v2. Deliberately omits method, baseline_2025, age_adj, team_change_adj, rookie_boost, opportunity_adj, floor_protected and computed_at -- the tuned model parameters. Anything added here becomes world-readable via the bundled anon key.';

-- ── STEP 2 — run only AFTER the app ships reading public_rankings ───────
-- Verify first: open the rankings tab while signed OUT and confirm it loads.
-- Then:
--
--   REVOKE SELECT ON public.nfl_proprietary_rankings_v2 FROM anon;
--   REVOKE SELECT ON public.nfl_proprietary_rankings     FROM anon;
--
-- service_role jobs and the rankings engine are unaffected; only
-- unauthenticated access to the full column set goes away.
