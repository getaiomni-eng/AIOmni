-- P1 finishing wave (2026-09-05): recaps, pick clock + autopick, weekly
-- runs, notification triggers, join preview. Built the morning after the
-- platform's first real two-phone draft proved the core.

-- ── Weekly runs + pick clock columns ─────────────────────────────────────
ALTER TABLE public.hosted_leagues
  ADD COLUMN IF NOT EXISTS league_kind  text NOT NULL DEFAULT 'season'
    CHECK (league_kind IN ('season','weekly')),
  ADD COLUMN IF NOT EXISTS start_week   int  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS end_week     int  NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS pick_seconds int  NOT NULL DEFAULT 28800,   -- 8h slow-draft clock
  ADD COLUMN IF NOT EXISTS pick_deadline timestamptz;

-- ── Recaps ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hosted_recaps (
  league_id  uuid NOT NULL REFERENCES public.hosted_leagues(id) ON DELETE CASCADE,
  season     int NOT NULL,
  week       int NOT NULL,
  content    text NOT NULL,
  model      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, season, week)
);
ALTER TABLE public.hosted_recaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY hr_member_select ON public.hosted_recaps FOR SELECT
  USING (league_id IN (SELECT public.my_league_ids()));

-- ── create v3: league kind + the week-8 season funnel ────────────────────
DROP FUNCTION IF EXISTS public.create_hosted_league(text, int);
CREATE OR REPLACE FUNCTION public.create_hosted_league(
  p_name text, p_team_count int DEFAULT 12, p_kind text DEFAULT 'season')
RETURNS TABLE (league_id uuid, invite_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare
  v_uid uuid; v_code text; v_id uuid; v_name text; v_open int;
  v_sw int; v_ew int; v_rounds int; v_data_week int;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  v_name := public.clean_display_name(p_name, 40);
  if v_name is null then raise exception 'league needs a name'; end if;
  if p_kind not in ('season','weekly') then raise exception 'unknown league kind'; end if;
  select count(*) into v_open from public.hosted_leagues
   where creator_id = v_uid and draft_status = 'open';
  if v_open >= 10 then raise exception 'you have too many undrafted leagues — draft or delete one first'; end if;

  select coalesce(max(week), 0) into v_data_week
    from public.nfl_weekly_stats where season = public.nfl_season() and season_type = 'REG';

  if p_kind = 'weekly' then
    v_sw := least(v_data_week + 1, 18); v_ew := v_sw; v_rounds := 9;
  else
    -- The week-8 funnel: a half-missed season league is a bad product;
    -- late arrivals become weekly players instead of bounces.
    if v_data_week >= 8 then
      raise exception 'Season leagues return next year — start a weekly run instead';
    end if;
    v_sw := 1; v_ew := 18; v_rounds := 18;
  end if;

  for i in 1..5 loop
    v_code := substr(translate(upper(substr(encode(extensions.gen_random_bytes(8),'base64'),1,8)), '+/=ILO01', 'ABCDEFGH'), 1, 6);
    begin
      insert into public.hosted_leagues (name, invite_code, creator_id, season, team_count, league_kind, start_week, end_week, rounds)
      values (v_name, v_code, v_uid, public.nfl_season(), p_team_count, p_kind, v_sw, v_ew, v_rounds)
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
GRANT EXECUTE ON FUNCTION public.create_hosted_league(text, int, text) TO authenticated;
REVOKE ALL ON FUNCTION public.create_hosted_league(text, int, text) FROM anon, public;

-- ── Pick clock: deadline set at start and rolled on every pick ───────────
CREATE OR REPLACE FUNCTION public.roll_pick_deadline()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
begin
  update public.hosted_leagues
     set pick_deadline = now() + make_interval(secs => pick_seconds)
   where id = new.league_id and draft_status = 'drafting';
  return new;
end;
$$;
DROP TRIGGER IF EXISTS trg_roll_deadline ON public.hosted_picks;
CREATE TRIGGER trg_roll_deadline AFTER INSERT ON public.hosted_picks
  FOR EACH ROW EXECUTE FUNCTION public.roll_pick_deadline();

CREATE OR REPLACE FUNCTION public.start_hosted_draft(p_league uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  update public.hosted_members m set draft_slot = s.slot
    from shuffled s where m.league_id = p_league and m.user_id = s.user_id;
  update public.hosted_leagues
     set draft_status = 'drafting', team_count = v_n,
         pick_deadline = now() + make_interval(secs => pick_seconds)
   where id = p_league;
  return v_n;
end;
$$;

-- ── Autopick: cron sweeps stalled drafts, picks best available off
--    AIOmni's own PPR board (falls back to last season's points). ─────────
CREATE OR REPLACE FUNCTION public.autopick_stalled()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_lg record; v_overall int; v_turn int; v_target uuid; v_gsis text; v_total int; v_n int := 0;
begin
  for v_lg in select * from public.hosted_leagues
              where draft_status = 'drafting' and pick_deadline < now()
              for update skip locked loop
    select count(*) + 1 into v_overall from public.hosted_picks where league_id = v_lg.id;
    v_total := v_lg.rounds * v_lg.team_count;
    if v_overall > v_total then continue; end if;
    v_turn := public.snake_slot(v_overall, v_lg.team_count);
    select user_id into v_target from public.hosted_members
     where league_id = v_lg.id and draft_slot = v_turn;
    -- best available: AIOmni PPR board first, then last season's PPR points
    select r.gsis_id into v_gsis
      from public.nfl_proprietary_rankings r
     where r.format = 'PPR' and r.position in ('QB','RB','WR','TE') and r.gsis_id is not null
       and not exists (select 1 from public.hosted_picks hp where hp.league_id = v_lg.id and hp.gsis_id = r.gsis_id)
     order by r.rank limit 1;
    if v_gsis is null then
      select p.player_id into v_gsis
        from public.player_profiles p
        join public.nfl_players np on np.gsis_id = p.player_id and np.position in ('QB','RB','WR','TE')
       where not exists (select 1 from public.hosted_picks hp where hp.league_id = v_lg.id and hp.gsis_id = p.player_id)
       order by p.total_points desc limit 1;
    end if;
    if v_gsis is null then continue; end if;
    insert into public.hosted_picks (league_id, overall, round, user_id, gsis_id)
    values (v_lg.id, v_overall, ((v_overall - 1) / v_lg.team_count) + 1, v_target, v_gsis);
    if v_overall = v_total then
      update public.hosted_leagues set draft_status = 'complete' where id = v_lg.id;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
REVOKE ALL ON FUNCTION public.autopick_stalled() FROM public, anon, authenticated;
SELECT cron.unschedule('aiomni-autopick')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-autopick');
SELECT cron.schedule('aiomni-autopick', '*/5 * * * *', $$ SELECT public.autopick_stalled(); $$);

-- ── Weekly-run scoring window ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_all_bestball()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_season int; v_max int; v_lg record; v_w int; v_n int := 0;
begin
  v_season := public.nfl_season();
  select max(week) into v_max from public.nfl_weekly_stats
   where season = v_season and season_type = 'REG';
  if v_max is null then return 0; end if;
  for v_lg in select * from public.hosted_leagues
              where season = v_season and draft_status = 'complete' loop
    for v_w in greatest(v_lg.start_week, 1)..least(v_lg.end_week, v_max) loop
      perform public.compute_bestball_week(v_lg.id, v_season, v_w);
    end loop;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
REVOKE ALL ON FUNCTION public.compute_all_bestball() FROM public, anon, authenticated;

-- ── Join preview: name + occupancy for a code, no membership required.
--    Deliberately tiny surface — a code holder could join anyway. ─────────
CREATE OR REPLACE FUNCTION public.hosted_league_preview(p_code text)
RETURNS TABLE (name text, league_kind text, team_count int, joined int, draft_status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.name, l.league_kind, l.team_count,
         (SELECT count(*)::int FROM public.hosted_members m WHERE m.league_id = l.id),
         l.draft_status
    FROM public.hosted_leagues l
   WHERE l.invite_code = upper(trim(p_code));
$$;
GRANT EXECUTE ON FUNCTION public.hosted_league_preview(text) TO authenticated, anon;

-- ── Notification triggers → edge function (fire-and-forget) ──────────────
CREATE OR REPLACE FUNCTION public.notify_hosted_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare v_type text; v_league uuid;
begin
  if tg_table_name = 'hosted_leagues' then
    if new.draft_status = old.draft_status then return new; end if;
    v_type := case new.draft_status when 'drafting' then 'draft_started'
                                    when 'complete' then 'draft_complete' else null end;
    v_league := new.id;
  else
    v_type := 'pick_made'; v_league := new.league_id;
  end if;
  if v_type is null then return new; end if;
  perform net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/hosted-notify',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-hosted-secret', current_setting('app.hosted_notify_secret', true)),
    body := jsonb_build_object('type', v_type, 'league_id', v_league)
  );
  return new;
exception when others then return new;  -- notifications never block the write
end;
$$;
DROP TRIGGER IF EXISTS trg_notify_league ON public.hosted_leagues;
CREATE TRIGGER trg_notify_league AFTER UPDATE ON public.hosted_leagues
  FOR EACH ROW EXECUTE FUNCTION public.notify_hosted_event();
DROP TRIGGER IF EXISTS trg_notify_pick ON public.hosted_picks;
CREATE TRIGGER trg_notify_pick AFTER INSERT ON public.hosted_picks
  FOR EACH ROW EXECUTE FUNCTION public.notify_hosted_event();
