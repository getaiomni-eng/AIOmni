-- Hosted leagues, P1: best ball (2026-09-04). The platform spine.
--
-- Plan B activated 2026-09-02 (vault: decisions.md, league-platform-spec).
-- Best ball first because it needs no waivers, no lineups, no trades: the
-- only moving parts are a draft (THE O's engine already exists client-side)
-- and weekly auto-scoring (nfl_weekly_stats already holds per-week PPR).
--
-- Integrity model: clients NEVER write these tables directly. Creation and
-- joining go through SECURITY DEFINER RPCs (atomic invite-code handling);
-- picks/scores are written by the service role. Members read their league's
-- rows via membership-scoped RLS.

CREATE TABLE public.hosted_leagues (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  invite_code   text NOT NULL UNIQUE,
  creator_id    uuid NOT NULL,             -- users.id (app id)
  season        int  NOT NULL,
  format        text NOT NULL DEFAULT 'bestball_ppr',
  team_count    int  NOT NULL DEFAULT 12 CHECK (team_count BETWEEN 4 AND 20),
  rounds        int  NOT NULL DEFAULT 18,
  -- What counts each week. v1 classic best ball.
  starts        jsonb NOT NULL DEFAULT '{"QB":1,"RB":2,"WR":3,"TE":1,"FLEX":1}',
  draft_status  text NOT NULL DEFAULT 'open'    -- open | drafting | complete
                CHECK (draft_status IN ('open','drafting','complete')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.hosted_members (
  league_id  uuid NOT NULL REFERENCES public.hosted_leagues(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,                -- users.id
  team_name  text NOT NULL,
  draft_slot int,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id)
);

-- The draft log is the roster: best ball rosters never change after the
-- draft, so there is no separate rosters table to drift out of sync.
CREATE TABLE public.hosted_picks (
  league_id  uuid NOT NULL REFERENCES public.hosted_leagues(id) ON DELETE CASCADE,
  overall    int  NOT NULL,
  round      int  NOT NULL,
  user_id    uuid NOT NULL,
  gsis_id    text NOT NULL,                -- joins nfl_players / nfl_weekly_stats
  made_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, overall),
  UNIQUE (league_id, gsis_id)
);

CREATE TABLE public.hosted_weekly_scores (
  league_id  uuid NOT NULL REFERENCES public.hosted_leagues(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  season     int  NOT NULL,
  week       int  NOT NULL,
  points     numeric(7,2) NOT NULL,
  lineup     jsonb NOT NULL,               -- [{slot, gsis_id, name, pts}]
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id, season, week)
);

-- ── RLS: members see their league, nobody writes from the client ─────────
ALTER TABLE public.hosted_leagues       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_picks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hosted_weekly_scores ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.my_app_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid();
$$;

CREATE POLICY hl_member_select ON public.hosted_leagues FOR SELECT USING (
  id IN (SELECT league_id FROM public.hosted_members WHERE user_id = public.my_app_id())
);
CREATE POLICY hm_member_select ON public.hosted_members FOR SELECT USING (
  league_id IN (SELECT league_id FROM public.hosted_members WHERE user_id = public.my_app_id())
);
CREATE POLICY hp_member_select ON public.hosted_picks FOR SELECT USING (
  league_id IN (SELECT league_id FROM public.hosted_members WHERE user_id = public.my_app_id())
);
CREATE POLICY hws_member_select ON public.hosted_weekly_scores FOR SELECT USING (
  league_id IN (SELECT league_id FROM public.hosted_members WHERE user_id = public.my_app_id())
);

-- ── Create / join (atomic, invite-code based) ────────────────────────────
CREATE OR REPLACE FUNCTION public.create_hosted_league(p_name text, p_team_count int DEFAULT 12)
RETURNS TABLE (league_id uuid, invite_code text)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_uid uuid; v_code text; v_id uuid;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  -- 6-char code, unambiguous alphabet, retry on the rare collision
  for i in 1..5 loop
    v_code := upper(substr(translate(encode(gen_random_bytes(8),'base64'),'+/=lIO01','ABCDEFGH'),1,6));
    begin
      insert into public.hosted_leagues (name, invite_code, creator_id, season, team_count)
      values (trim(p_name), v_code, v_uid, extract(year from now())::int, p_team_count)
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
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_uid uuid; v_league public.hosted_leagues%rowtype; v_n int;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  select * into v_league from public.hosted_leagues
   where invite_code = upper(trim(p_code)) for update;
  if v_league.id is null then raise exception 'league not found'; end if;
  if v_league.draft_status <> 'open' then raise exception 'draft already started'; end if;
  select count(*) into v_n from public.hosted_members where league_id = v_league.id;
  if v_n >= v_league.team_count then raise exception 'league is full'; end if;
  insert into public.hosted_members (league_id, user_id, team_name)
  values (v_league.id, v_uid, coalesce(nullif(trim(p_team_name),''), 'Team ' || (v_n+1)))
  on conflict (league_id, user_id) do nothing;
  return v_league.id;
end;
$$;
GRANT EXECUTE ON FUNCTION public.create_hosted_league(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_hosted_league(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_hosted_league(text, int) FROM anon, public;
REVOKE ALL ON FUNCTION public.join_hosted_league(text, text) FROM anon, public;

-- ── The scoring brain: best lineup, automatically, in SQL ────────────────
-- For each member: rank their drafted players' PPR for the week, take the
-- best QB, 2 RB, 3 WR, 1 TE per `starts`, then the best remaining RB/WR/TE
-- as FLEX. Deterministic, idempotent, no AI involved — the AI writes the
-- recap, never the score.
CREATE OR REPLACE FUNCTION public.compute_bestball_week(p_league uuid, p_season int, p_week int)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_member record; v_starts jsonb; v_n int := 0;
begin
  select starts into v_starts from public.hosted_leagues where id = p_league;
  if v_starts is null then raise exception 'league not found'; end if;

  for v_member in select user_id from public.hosted_members where league_id = p_league loop
    with pool as (
      select hp.gsis_id,
             coalesce(np.full_name, hp.gsis_id) as name,
             np.position as pos,
             coalesce(w.fantasy_pts_ppr, 0)::numeric(7,2) as pts
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
      where (pos = 'QB' and rn <= (v_starts->>'QB')::int)
         or (pos = 'RB' and rn <= (v_starts->>'RB')::int)
         or (pos = 'WR' and rn <= (v_starts->>'WR')::int)
         or (pos = 'TE' and rn <= (v_starts->>'TE')::int)
    ),
    flex as (
      select gsis_id, name, 'FLEX' as slot, pts from ranked
      where pos in ('RB','WR','TE')
        and not ((pos = 'RB' and rn <= (v_starts->>'RB')::int)
              or (pos = 'WR' and rn <= (v_starts->>'WR')::int)
              or (pos = 'TE' and rn <= (v_starts->>'TE')::int))
      order by pts desc
      limit (v_starts->>'FLEX')::int
    ),
    lineup as (select * from starters union all select * from flex)
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
