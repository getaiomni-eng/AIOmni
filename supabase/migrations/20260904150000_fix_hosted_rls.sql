-- Fix RLS recursion on hosted tables (2026-09-04).
-- hm_member_select subqueried hosted_members FROM a hosted_members policy;
-- every policy also subqueried hosted_members with that policy active.
-- Postgres detects the cycle (42P17) and the whole select fails — the hub
-- showed "No leagues yet" to a user who is in one. A SECURITY DEFINER
-- helper reads membership as the function owner, outside RLS, ending the
-- cycle.
CREATE OR REPLACE FUNCTION public.my_league_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT league_id FROM public.hosted_members
  WHERE user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION public.my_league_ids() TO authenticated;

DROP POLICY IF EXISTS hl_member_select  ON public.hosted_leagues;
DROP POLICY IF EXISTS hm_member_select  ON public.hosted_members;
DROP POLICY IF EXISTS hp_member_select  ON public.hosted_picks;
DROP POLICY IF EXISTS hws_member_select ON public.hosted_weekly_scores;

CREATE POLICY hl_member_select  ON public.hosted_leagues       FOR SELECT USING (id IN (SELECT public.my_league_ids()));
CREATE POLICY hm_member_select  ON public.hosted_members       FOR SELECT USING (league_id IN (SELECT public.my_league_ids()));
CREATE POLICY hp_member_select  ON public.hosted_picks         FOR SELECT USING (league_id IN (SELECT public.my_league_ids()));
CREATE POLICY hws_member_select ON public.hosted_weekly_scores FOR SELECT USING (league_id IN (SELECT public.my_league_ids()));
