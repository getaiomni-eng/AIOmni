-- Stop publishing the ranking model (2026-09-07).
--
-- nfl_proprietary_rankings grants anon SELECT on EVERY column, including
-- `method` -- a human-readable derivation carrying the tuned parameters:
-- scarcity multipliers, coaching percentages, stabilizer thresholds,
-- baselines. A single unauthenticated request returns 1,000 rows with a full
-- method string on each. Measured 2026-09-07: 108 distinct parameters
-- readable with the anon key that ships inside the JS bundle.
--
-- The rankings themselves are marketing and are meant to be seen. The
-- parameters are the product. Those are different things and were being
-- served together.
--
-- The public rankings page requests exactly six columns
-- (name, position, team, pos_rank, score, tier) and has never needed the
-- rest, so this costs the site nothing.
--
-- ORDER OF OPERATIONS MATTERS. This migration creates and grants the view
-- only. The REVOKE on the base table is deliberately NOT here: revoking
-- before the deployed rankings page is updated to read the view would break
-- the live page. Apply this, ship the page, then run the revoke block at the
-- bottom as a separate step.

CREATE OR REPLACE VIEW public.public_rankings AS
  SELECT format, rank, name, position, team, pos_rank, score, tier
    FROM public.nfl_proprietary_rankings;

-- security_invoker keeps the view honest: it runs with the CALLER's rights,
-- so it can never become a privilege-escalation path back into the base
-- table the way a definer view would.
ALTER VIEW public.public_rankings SET (security_invoker = on);

GRANT SELECT ON public.public_rankings TO anon, authenticated;

COMMENT ON VIEW public.public_rankings IS
  'Public projection of nfl_proprietary_rankings. Deliberately omits method, baseline_2025, age_adj, team_change_adj, rookie_boost, opportunity_adj, floor_protected and computed_at -- the tuned model parameters. Anything added here becomes world-readable via the bundled anon key.';

-- ── STEP 2, run only AFTER the rankings page reads the view ─────────────
-- Uncomment and apply once https://getaiomni.com/rankings is confirmed
-- working against public_rankings:
--
--   REVOKE SELECT ON public.nfl_proprietary_rankings FROM anon;
--
-- The app's own authenticated reads and every service_role job keep working;
-- only unauthenticated access to the full column set goes away.
