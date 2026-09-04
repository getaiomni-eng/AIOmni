-- LeagueSafe dues link (2026-09-04). LeagueSafe has no API (verified on
-- their site): commissioners create the pot there and paste the link here.
-- Keeps the money-custody line bright: AIOmni never touches dues, it just
-- points at where they live.
ALTER TABLE public.hosted_leagues ADD COLUMN IF NOT EXISTS dues_url text;

CREATE OR REPLACE FUNCTION public.set_league_dues_url(p_league uuid, p_url text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_uid uuid;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_url is not null and p_url !~* '^https://(www\.)?leaguesafe\.com/' then
    raise exception 'only leaguesafe.com links are accepted';
  end if;
  update public.hosted_leagues
     set dues_url = p_url
   where id = p_league and creator_id = v_uid;
  if not found then raise exception 'only the league creator can set the dues link'; end if;
end;
$$;
GRANT EXECUTE ON FUNCTION public.set_league_dues_url(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.set_league_dues_url(uuid, text) FROM anon, public;
