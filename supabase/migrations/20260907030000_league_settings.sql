-- League settings: roster shape, scoring, team count (2026-09-07).
--
-- The schema always had `starts` (jsonb) and `format` (text) and the
-- optimizer already read `starts` generically. Nothing ever WROTE either one,
-- so every league was 1QB/2RB/3WR/1TE/1FLEX PPR at 12 teams regardless. This
-- wires the existing columns up to league creation and teaches the optimizer
-- the one slot type it was missing.
--
-- Superflex is the reason this matters: it is the most common best-ball
-- format after standard, and its absence is the most likely reason someone
-- opens the league page and leaves.
--
-- Applies to NEW leagues only. Changing `starts` under a league that has
-- already drafted would silently rescore completed weeks against a roster
-- built for different rules.

-- ── Optimizer: SUPERFLEX + format-aware scoring ─────────────────────────
-- Slot fill order is most-restrictive-first: positional, then FLEX
-- (RB/WR/TE), then SUPERFLEX (QB/RB/WR/TE). Because SUPERFLEX is a strict
-- superset of FLEX, filling it last is optimal, not merely convenient.
CREATE OR REPLACE FUNCTION public.compute_bestball_week(p_league uuid, p_season int, p_week int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  v_member record;
  v_starts jsonb;
  v_format text;
  v_n int := 0;
  v_qb int; v_rb int; v_wr int; v_te int; v_flex int; v_sf int;
begin
  select starts, format into v_starts, v_format
    from public.hosted_leagues where id = p_league;
  if v_starts is null then raise exception 'league not found'; end if;

  -- Missing keys mean zero of that slot, never null-propagation into LIMIT.
  v_qb   := coalesce((v_starts->>'QB')::int, 0);
  v_rb   := coalesce((v_starts->>'RB')::int, 0);
  v_wr   := coalesce((v_starts->>'WR')::int, 0);
  v_te   := coalesce((v_starts->>'TE')::int, 0);
  v_flex := coalesce((v_starts->>'FLEX')::int, 0);
  v_sf   := coalesce((v_starts->>'SUPERFLEX')::int, 0);

  for v_member in select user_id from public.hosted_members where league_id = p_league loop
    with pool as (
      select hp.gsis_id,
             coalesce(np.full_name, hp.gsis_id) as name,
             np.position as pos,
             (case v_format
                when 'bestball_std'  then coalesce(w.fantasy_pts_std, 0)
                when 'bestball_half' then coalesce(w.fantasy_pts_half, 0)
                else                      coalesce(w.fantasy_pts_ppr, 0)
              end)::numeric(7,2) as pts
      from public.hosted_picks hp
      join public.nfl_players np on np.gsis_id = hp.gsis_id
      left join public.nfl_weekly_stats w
        on w.gsis_id = hp.gsis_id and w.season = p_season
       and w.week = p_week and w.season_type = 'REG'
      where hp.league_id = p_league and hp.user_id = v_member.user_id
    ),
    ranked as (
      select *, row_number() over (partition by pos order by pts desc) rn from pool
    ),
    starters as (
      select gsis_id, name, pos as slot, pts from ranked
      where (pos = 'QB' and rn <= v_qb)
         or (pos = 'RB' and rn <= v_rb)
         or (pos = 'WR' and rn <= v_wr)
         or (pos = 'TE' and rn <= v_te)
    ),
    flex as (
      select gsis_id, name, 'FLEX' as slot, pts from ranked
      where pos in ('RB','WR','TE')
        and not ((pos = 'RB' and rn <= v_rb)
              or (pos = 'WR' and rn <= v_wr)
              or (pos = 'TE' and rn <= v_te))
      order by pts desc
      limit v_flex
    ),
    superflex as (
      select r.gsis_id, r.name, 'SUPERFLEX' as slot, r.pts from ranked r
      where r.pos in ('QB','RB','WR','TE')
        and r.gsis_id not in (select s.gsis_id from starters s)
        and r.gsis_id not in (select f.gsis_id from flex f)
      order by r.pts desc
      limit v_sf
    ),
    lineup as (
      select * from starters
      union all select * from flex
      union all select * from superflex
    )
    insert into public.hosted_weekly_scores (league_id, user_id, season, week, points, lineup, computed_at)
    select p_league, v_member.user_id, p_season, p_week,
           coalesce(sum(pts), 0),
           coalesce(jsonb_agg(jsonb_build_object('slot', slot, 'gsis_id', gsis_id, 'name', name, 'pts', pts) order by slot), '[]'::jsonb),
           now()
    from lineup
    on conflict (league_id, user_id, season, week) do update
      set points = excluded.points, lineup = excluded.lineup, computed_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
REVOKE ALL ON FUNCTION public.compute_bestball_week(uuid, int, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_bestball_week(uuid, int, int) TO service_role;

-- ── create_hosted_league: roster shape, scoring, team count ─────────────
DROP FUNCTION IF EXISTS public.create_hosted_league(text, int, text, int);

CREATE OR REPLACE FUNCTION public.create_hosted_league(
  p_name text,
  p_team_count int DEFAULT 12,
  p_kind text DEFAULT 'season',
  p_pick_seconds int DEFAULT 28800,
  p_starts jsonb DEFAULT NULL,
  p_format text DEFAULT 'bestball_ppr')
RETURNS TABLE (league_id uuid, invite_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  v_uid uuid; v_code text; v_id uuid; v_name text; v_open int;
  v_sw int; v_ew int; v_rounds int; v_data_week int; v_pending int; v_secs int;
  v_starts jsonb; v_total int; v_k text;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  v_name := public.clean_display_name(p_name, 40);
  if v_name is null then raise exception 'league needs a name'; end if;
  if p_kind not in ('season','weekly') then raise exception 'unknown league kind'; end if;
  if p_format not in ('bestball_ppr','bestball_half','bestball_std') then
    raise exception 'unknown scoring format';
  end if;
  if p_team_count < 2 or p_team_count > 20 then
    raise exception 'leagues run from 2 to 20 teams';
  end if;

  v_secs := coalesce(p_pick_seconds, 28800);
  if v_secs < 30 or v_secs > 86400 then
    raise exception 'pick clock must be between 30 seconds and 24 hours';
  end if;

  v_starts := coalesce(p_starts, '{"QB":1,"RB":2,"WR":3,"TE":1,"FLEX":1}'::jsonb);
  -- Reject unknown slot keys rather than silently ignoring them: a typo that
  -- scores nothing all season is far worse than a create that fails loudly.
  for v_k in select jsonb_object_keys(v_starts) loop
    if v_k not in ('QB','RB','WR','TE','FLEX','SUPERFLEX') then
      raise exception 'unknown roster slot %', v_k;
    end if;
    if coalesce((v_starts->>v_k)::int, -1) < 0 or (v_starts->>v_k)::int > 4 then
      raise exception 'slot % must be between 0 and 4', v_k;
    end if;
  end loop;
  v_total := coalesce((v_starts->>'QB')::int,0) + coalesce((v_starts->>'RB')::int,0)
           + coalesce((v_starts->>'WR')::int,0) + coalesce((v_starts->>'TE')::int,0)
           + coalesce((v_starts->>'FLEX')::int,0) + coalesce((v_starts->>'SUPERFLEX')::int,0);
  if v_total < 4 or v_total > 12 then
    raise exception 'a lineup needs between 4 and 12 starters';
  end if;

  select count(*) into v_open from public.hosted_leagues
   where creator_id = v_uid and draft_status = 'open';
  if v_open >= 10 then raise exception 'you have too many undrafted leagues — draft or delete one first'; end if;

  select coalesce(max(week), 0) into v_data_week
    from public.nfl_weekly_stats where season = public.nfl_season() and season_type = 'REG';

  v_pending := greatest(v_data_week + 1, 1);
  while v_pending <= 18 and now() >= public.nfl_week_kickoff(public.nfl_season(), v_pending) loop
    v_pending := v_pending + 1;
  end loop;

  -- Rounds scale with the lineup so bench depth stays constant across
  -- formats. Standard (8 starters) reproduces the old 18 / 9 exactly.
  if p_kind = 'weekly' then
    if v_pending > 18 then
      raise exception 'The regular season is over — weekly runs return next year';
    end if;
    v_sw := v_pending; v_ew := v_sw; v_rounds := v_total + 1;
  else
    if v_data_week >= 8 then
      raise exception 'Season leagues return next year — start a weekly run instead';
    end if;
    v_sw := 1; v_ew := 18; v_rounds := v_total + 10;
  end if;

  for i in 1..5 loop
    v_code := substr(translate(upper(substr(encode(extensions.gen_random_bytes(8),'base64'),1,8)), '+/=ILO01', 'ABCDEFGH'), 1, 6);
    begin
      insert into public.hosted_leagues (name, invite_code, creator_id, season, team_count,
                                         league_kind, start_week, end_week, rounds,
                                         pick_seconds, starts, format)
      values (v_name, v_code, v_uid, public.nfl_season(), p_team_count, p_kind,
              v_sw, v_ew, v_rounds, v_secs, v_starts, p_format)
      returning id into v_id;
      exit;
    exception when unique_violation then v_id := null;
    end;
  end loop;
  if v_id is null then raise exception 'could not allocate invite code'; end if;
  insert into public.hosted_members (league_id, user_id, team_name) values (v_id, v_uid, 'Team 1');
  return query select v_id, v_code;
end;
$$;
GRANT EXECUTE ON FUNCTION public.create_hosted_league(text, int, text, int, jsonb, text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_hosted_league(text, int, text, int, jsonb, text) FROM anon, public;
