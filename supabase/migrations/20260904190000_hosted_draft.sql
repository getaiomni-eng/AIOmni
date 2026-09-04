-- Hosted draft: start, pick, realtime (2026-09-04). P1 increment 2.
--
-- The draft is the product's beating heart: N phones in one room, snake
-- order, every pick visible to everyone instantly. Realtime rides
-- supabase_realtime postgres_changes on hosted_picks (RLS-scoped, so only
-- members receive a league's events). All writes stay server-side:
-- make_hosted_pick validates membership, turn, and availability in one
-- statement — the client can only ASK.

-- Draft slots are assigned at start; draft order = joined members shuffled.
CREATE OR REPLACE FUNCTION public.start_hosted_draft(p_league uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_uid uuid; v_lg public.hosted_leagues%rowtype; v_n int;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_lg from public.hosted_leagues where id = p_league for update;
  if v_lg.id is null then raise exception 'league not found'; end if;
  if v_lg.creator_id <> v_uid then raise exception 'only the creator can start the draft'; end if;
  if v_lg.draft_status <> 'open' then raise exception 'draft already started'; end if;
  select count(*) into v_n from public.hosted_members where league_id = p_league;
  if v_n < 2 then raise exception 'need at least 2 teams to draft'; end if;

  with shuffled as (
    select user_id, row_number() over (order by random()) as slot
    from public.hosted_members where league_id = p_league
  )
  update public.hosted_members m
     set draft_slot = s.slot
    from shuffled s
   where m.league_id = p_league and m.user_id = s.user_id;

  update public.hosted_leagues
     set draft_status = 'drafting', team_count = v_n
   where id = p_league;
  return v_n;
end;
$$;

-- Whose turn is pick #overall (1-based) in a snake draft of n teams?
CREATE OR REPLACE FUNCTION public.snake_slot(p_overall int, p_teams int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN (((p_overall - 1) / p_teams) % 2) = 0
              THEN ((p_overall - 1) % p_teams) + 1
              ELSE p_teams - ((p_overall - 1) % p_teams) END;
$$;

CREATE OR REPLACE FUNCTION public.make_hosted_pick(p_league uuid, p_sleeper_id text)
RETURNS TABLE (overall int, round int, gsis_id text, player_name text, next_slot int, complete boolean)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_uid uuid; v_lg public.hosted_leagues%rowtype;
  v_slot int; v_overall int; v_turn int; v_total int;
  v_gsis text; v_name text; v_round int;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  -- Serialize the whole pick under the league row lock: two simultaneous
  -- taps cannot both pass the turn check.
  select * into v_lg from public.hosted_leagues where id = p_league for update;
  if v_lg.id is null then raise exception 'league not found'; end if;
  if v_lg.draft_status <> 'drafting' then raise exception 'draft is not live'; end if;

  select draft_slot into v_slot from public.hosted_members
   where league_id = p_league and user_id = v_uid;
  if v_slot is null then raise exception 'not a member of this draft'; end if;

  select count(*) + 1 into v_overall from public.hosted_picks where league_id = p_league;
  v_total := v_lg.rounds * v_lg.team_count;
  if v_overall > v_total then raise exception 'draft is complete'; end if;
  v_turn := public.snake_slot(v_overall, v_lg.team_count);
  if v_turn <> v_slot then raise exception 'not your turn (pick % belongs to slot %)', v_overall, v_turn; end if;

  select np.gsis_id, coalesce(np.full_name, np.display_name) into v_gsis, v_name
    from public.nfl_players np
   where np.sleeper_id = p_sleeper_id and np.position in ('QB','RB','WR','TE')
   limit 1;
  if v_gsis is null then raise exception 'unknown or undraftable player'; end if;

  v_round := ((v_overall - 1) / v_lg.team_count) + 1;
  insert into public.hosted_picks (league_id, overall, round, user_id, gsis_id)
  values (p_league, v_overall, v_round, v_uid, v_gsis);   -- UNIQUE(league,gsis) rejects taken players

  if v_overall = v_total then
    update public.hosted_leagues set draft_status = 'complete' where id = p_league;
  end if;

  return query select v_overall, v_round, v_gsis, v_name,
    case when v_overall = v_total then 0 else public.snake_slot(v_overall + 1, v_lg.team_count) end,
    v_overall = v_total;
end;
$$;
GRANT EXECUTE ON FUNCTION public.start_hosted_draft(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.make_hosted_pick(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.start_hosted_draft(uuid) FROM anon, public;
REVOKE ALL ON FUNCTION public.make_hosted_pick(uuid, text) FROM anon, public;

-- Realtime: members receive pick inserts + league status flips live.
ALTER PUBLICATION supabase_realtime ADD TABLE public.hosted_picks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.hosted_leagues;

-- start_hosted_draft snapshots team_count to the joined-member count, and a
-- 2- or 3-person league is legitimate (and how every test league starts).
-- The original 4..20 check made any small league CRASH at draft start.
ALTER TABLE public.hosted_leagues DROP CONSTRAINT hosted_leagues_team_count_check;
ALTER TABLE public.hosted_leagues ADD CONSTRAINT hosted_leagues_team_count_check CHECK (team_count BETWEEN 2 AND 20);
