-- Close anon write (and read) access to the accuracy tables (2026-09-14).
--
-- 20260908120000 and 20260909230000 both state the intent plainly: "Operator
-- data. No client policies; service_role only." RLS is on with zero policies
-- on ranking_accuracy and projection_accuracy, so the tables themselves are
-- sealed regardless of the blanket grants Supabase hands to anon by default.
--
-- public.projection_scoreboard undoes that. It is a VIEW, and a view created
-- without security_invoker runs with OWNER privileges, so it reads straight
-- past the RLS on projection_accuracy. anon holds SELECT, INSERT, UPDATE and
-- DELETE on it, and the view is a single-table SELECT with only a WHERE and
-- an ORDER BY -- which Postgres considers auto-updatable. So the public anon
-- key, which ships inside the app bundle, could read and delete the accuracy
-- record through it.
--
-- Same class as the public_weekly_board security_invoker question earlier
-- this month, but the opposite intent: that view is MEANT to be public, this
-- one is not.
--
-- Nothing is broken by locking it: ranking_accuracy and projection_accuracy
-- are still empty (first rows land Tuesday), and no client surface reads
-- either. If accuracy is published later -- and "we keep score publicly" is
-- a good story -- it should be a deliberate, read-only view granting SELECT
-- and nothing else, not this one reopened by accident.

REVOKE ALL ON public.projection_scoreboard FROM anon, authenticated;

-- Defense in depth on the base tables. RLS already blocks these, but a grant
-- that only fails because of a policy is one policy change away from working,
-- and "operator only" should be true at the grant layer too.
REVOKE ALL ON public.ranking_accuracy    FROM anon, authenticated;
REVOKE ALL ON public.projection_accuracy FROM anon, authenticated;
REVOKE ALL ON public.ranking_snapshots   FROM anon, authenticated;

GRANT ALL ON public.ranking_accuracy    TO service_role;
GRANT ALL ON public.projection_accuracy TO service_role;
GRANT ALL ON public.ranking_snapshots   TO service_role;
GRANT SELECT ON public.projection_scoreboard TO service_role;

-- NOT DONE HERE, on purpose: Supabase's default privileges re-grant ALL to
-- anon on every NEW table in public, which is how this happened without
-- anyone deciding it. The tempting one-liner is
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
-- and it is a bad trade. It silently changes every future table in the
-- schema, it only applies to objects created by the role that ran it, and
-- the failure mode is a table that is mysteriously unreadable weeks later
-- with nothing in the migration that created it to explain why.
--
-- A narrow fix for a known problem beats a broad one for a hypothetical.
-- The durable version is a checklist item: every new operator table gets
-- RLS plus an explicit REVOKE in the migration that creates it.
