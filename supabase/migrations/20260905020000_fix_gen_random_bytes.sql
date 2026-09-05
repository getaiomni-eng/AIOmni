-- The audit's search_path = public pin (defense in depth) cut off the
-- extensions schema, where Supabase installs pgcrypto — so
-- gen_random_bytes() stopped resolving and league creation failed the
-- moment a real phone tried it. Schema-qualify the call; keep the pin.
CREATE OR REPLACE FUNCTION public.create_hosted_league(p_name text, p_team_count int DEFAULT 12)
RETURNS TABLE (league_id uuid, invite_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_uid uuid; v_code text; v_id uuid; v_name text; v_open int;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  v_name := public.clean_display_name(p_name, 40);
  if v_name is null then raise exception 'league needs a name'; end if;
  select count(*) into v_open from public.hosted_leagues
   where creator_id = v_uid and draft_status = 'open';
  if v_open >= 10 then raise exception 'you have too many undrafted leagues — draft or delete one first'; end if;
  for i in 1..5 loop
    v_code := translate(upper(substr(encode(extensions.gen_random_bytes(8),'base64'),1,8)), '+/=ILO01', 'ABCDEFGH');
    v_code := substr(v_code, 1, 6);
    begin
      insert into public.hosted_leagues (name, invite_code, creator_id, season, team_count)
      values (v_name, v_code, v_uid, public.nfl_season(), p_team_count)
      returning id into v_id;
      exit;
    exception when unique_violation then v_id := null;
    end;
  end loop;
  if v_id is null then raise exception 'could not allocate invite code'; end if;
  insert into public.hosted_members (league_id, user_id, team_name)
  values (v_id, v_uid, 'Team 1');
  return query select v_id, v_code;
end;
$$;
