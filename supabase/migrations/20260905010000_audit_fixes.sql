-- Audit fixes (2026-09-05). Six-lens adversarial audit; each item here was
-- hand-verified against the code before landing.

-- 1. NFL season != calendar year. compute_all_bestball and league creation
--    used extract(year from now()): in January the playoff weeks (17-18)
--    would look for season-2027 stats and score nothing, and January-created
--    leagues would be stamped with the wrong season.
CREATE OR REPLACE FUNCTION public.nfl_season()
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN extract(month from now()) >= 8
              THEN extract(year from now())::int
              ELSE extract(year from now())::int - 1 END;
$$;

-- 2. Cron scored only max(week): one missed Tuesday (or a late nflverse
--    release) permanently skipped a week. Scoring is idempotent, so score
--    every week up to the latest — 18 cheap upserts per league, no gaps.
CREATE OR REPLACE FUNCTION public.compute_all_bestball()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_season int; v_max int; v_lg record; v_w int; v_n int := 0;
begin
  v_season := public.nfl_season();
  select max(week) into v_max from public.nfl_weekly_stats
   where season = v_season and season_type = 'REG';
  if v_max is null then return 0; end if;
  for v_lg in select id from public.hosted_leagues
              where season = v_season and draft_status = 'complete' loop
    for v_w in 1..v_max loop
      perform public.compute_bestball_week(v_lg.id, v_season, v_w);
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
REVOKE ALL ON FUNCTION public.compute_all_bestball() FROM public, anon, authenticated;

-- 3. Rebuild create/join with the fixes the adversarial lens earned:
--    · season stamped via nfl_season()
--    · league/team names: control + zero-width chars stripped, length-capped
--      server-side (client caps are advisory only)
--    · invite alphabet truly unambiguous: base64 is upcased FIRST, then
--      I/L/O/0/1 mapped away (the old order left lowercase i/l/o to sneak
--      through the upper())
--    · create capped at 10 open leagues per user (spam + cron amplification)
--    · join is idempotent for existing members BEFORE the capacity check
--      (a member re-tapping a full league got "league is full")
CREATE OR REPLACE FUNCTION public.clean_display_name(p text, p_max int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(left(trim(regexp_replace(coalesce(p,''), '[[:cntrl:]​-‏‪-‮﻿]', '', 'g')), p_max), '');
$$;

CREATE OR REPLACE FUNCTION public.create_hosted_league(p_name text, p_team_count int DEFAULT 12)
RETURNS TABLE (league_id uuid, invite_code text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    v_code := translate(upper(substr(encode(gen_random_bytes(8),'base64'),1,8)), '+/=ILO01', 'ABCDEFGH');
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

CREATE OR REPLACE FUNCTION public.join_hosted_league(p_code text, p_team_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_uid uuid; v_league public.hosted_leagues%rowtype; v_n int;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_league from public.hosted_leagues
   where invite_code = upper(trim(p_code)) for update;
  if v_league.id is null then raise exception 'league not found'; end if;
  if exists (select 1 from public.hosted_members where league_id = v_league.id and user_id = v_uid) then
    return v_league.id;                       -- already in: idempotent success
  end if;
  if v_league.draft_status <> 'open' then raise exception 'draft already started'; end if;
  select count(*) into v_n from public.hosted_members where league_id = v_league.id;
  if v_n >= v_league.team_count then raise exception 'league is full'; end if;
  insert into public.hosted_members (league_id, user_id, team_name)
  values (v_league.id, v_uid,
          coalesce(public.clean_display_name(p_team_name, 30), 'Team ' || (v_n+1)));
  return v_league.id;
end;
$$;

-- 4. Leagues were immortal: no leave, no kick, no delete. All three, open
--    leagues only — once a draft runs, history is history.
CREATE OR REPLACE FUNCTION public.leave_hosted_league(p_league uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_uid uuid;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.hosted_leagues where id = p_league and creator_id = v_uid) then
    raise exception 'the creator cannot leave — delete the league instead';
  end if;
  delete from public.hosted_members m using public.hosted_leagues l
   where m.league_id = p_league and m.user_id = v_uid
     and l.id = m.league_id and l.draft_status = 'open';
  if not found then raise exception 'cannot leave after the draft has started'; end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.delete_hosted_league(p_league uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_uid uuid;
begin
  v_uid := public.my_app_id();
  delete from public.hosted_leagues
   where id = p_league and creator_id = v_uid and draft_status = 'open';
  if not found then raise exception 'only the creator can delete, and only before the draft'; end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.kick_hosted_member(p_league uuid, p_member uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_uid uuid;
begin
  v_uid := public.my_app_id();
  if not exists (select 1 from public.hosted_leagues
                  where id = p_league and creator_id = v_uid and draft_status = 'open') then
    raise exception 'only the creator can remove members, and only before the draft';
  end if;
  if p_member = v_uid then raise exception 'use delete for your own league'; end if;
  delete from public.hosted_members where league_id = p_league and user_id = p_member;
end;
$$;

-- 5. Stalled drafts: no pick clock in beta, so the human fallback — the
--    creator can pick on behalf of whoever is on the clock. Same validation
--    path as a normal pick, same row lock, just a different "who may ask".
CREATE OR REPLACE FUNCTION public.force_hosted_pick(p_league uuid, p_sleeper_id text)
RETURNS TABLE (overall int, round int, gsis_id text, player_name text, next_slot int, complete boolean)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_uid uuid; v_lg public.hosted_leagues%rowtype;
  v_overall int; v_turn int; v_total int; v_target uuid;
  v_gsis text; v_name text; v_round int;
begin
  v_uid := public.my_app_id();
  select * into v_lg from public.hosted_leagues where id = p_league for update;
  if v_lg.id is null or v_lg.creator_id <> v_uid then
    raise exception 'only the creator can force a pick';
  end if;
  if v_lg.draft_status <> 'drafting' then raise exception 'draft is not live'; end if;
  select count(*) + 1 into v_overall from public.hosted_picks where league_id = p_league;
  v_total := v_lg.rounds * v_lg.team_count;
  if v_overall > v_total then raise exception 'draft is complete'; end if;
  v_turn := public.snake_slot(v_overall, v_lg.team_count);
  select user_id into v_target from public.hosted_members
   where league_id = p_league and draft_slot = v_turn;
  select np.gsis_id, coalesce(np.full_name, np.display_name) into v_gsis, v_name
    from public.nfl_players np
   where np.sleeper_id = p_sleeper_id and np.position in ('QB','RB','WR','TE') limit 1;
  if v_gsis is null then raise exception 'unknown or undraftable player'; end if;
  v_round := ((v_overall - 1) / v_lg.team_count) + 1;
  insert into public.hosted_picks (league_id, overall, round, user_id, gsis_id)
  values (p_league, v_overall, v_round, v_target, v_gsis);
  if v_overall = v_total then
    update public.hosted_leagues set draft_status = 'complete' where id = p_league;
  end if;
  return query select v_overall, v_round, v_gsis, v_name,
    case when v_overall = v_total then 0 else public.snake_slot(v_overall + 1, v_lg.team_count) end,
    v_overall = v_total;
end;
$$;

GRANT EXECUTE ON FUNCTION public.leave_hosted_league(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_hosted_league(uuid)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.kick_hosted_member(uuid, uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.force_hosted_pick(uuid, text)      TO authenticated;
REVOKE ALL ON FUNCTION public.leave_hosted_league(uuid)      FROM anon, public;
REVOKE ALL ON FUNCTION public.delete_hosted_league(uuid)     FROM anon, public;
REVOKE ALL ON FUNCTION public.kick_hosted_member(uuid, uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.force_hosted_pick(uuid, text)  FROM anon, public;

-- 6. Pin search_path on every SECURITY DEFINER function (defense in depth;
--    Supabase's linter flags these for a reason).
ALTER FUNCTION public.my_app_id()                              SET search_path = public;
ALTER FUNCTION public.my_league_ids()                          SET search_path = public;
ALTER FUNCTION public.create_hosted_league(text, int)          SET search_path = public;
ALTER FUNCTION public.join_hosted_league(text, text)           SET search_path = public;
ALTER FUNCTION public.start_hosted_draft(uuid)                 SET search_path = public;
ALTER FUNCTION public.make_hosted_pick(uuid, text)             SET search_path = public;
ALTER FUNCTION public.force_hosted_pick(uuid, text)            SET search_path = public;
ALTER FUNCTION public.leave_hosted_league(uuid)                SET search_path = public;
ALTER FUNCTION public.delete_hosted_league(uuid)               SET search_path = public;
ALTER FUNCTION public.kick_hosted_member(uuid, uuid)           SET search_path = public;
ALTER FUNCTION public.set_league_dues_url(uuid, text)          SET search_path = public;
ALTER FUNCTION public.compute_bestball_week(uuid, int, int)    SET search_path = public;
ALTER FUNCTION public.compute_all_bestball()                   SET search_path = public;
ALTER FUNCTION public.consume_prompt(uuid, int)                SET search_path = public;
ALTER FUNCTION public.my_prompt_state()                        SET search_path = public;
ALTER FUNCTION public.spend_ai_credit(uuid)                    SET search_path = public;
ALTER FUNCTION public.sweep_expired_tiers()                    SET search_path = public;
