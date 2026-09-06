-- Week-1 hardening (2026-09-06). Seven fixes found by a full-codebase audit
-- three days before kickoff. Every one is a real, reachable defect; see the
-- per-section notes for the failure each prevents.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. The tier/credit lockdown has never done anything.
--
-- protect_tier_column() was declared SECURITY DEFINER. Inside a SECURITY
-- DEFINER function current_user is the FUNCTION OWNER (postgres), never the
-- caller — so the allow-list on the first line matched on every single
-- invocation and returned before any protection ran. Anyone holding the
-- anon key (it ships in the JS bundle) plus their own JWT could
-- PATCH /users with tier:'pro', ai_credits:9999.
--
-- A BEFORE trigger needs no elevated privilege: it only rewrites NEW. Drop
-- SECURITY DEFINER and current_user becomes the real caller.
--
-- Deliberately NOT using REVOKE UPDATE (tier): a column revoke would fail
-- the whole upsert, and services/supabase.ts writes the users row on every
-- sign-in. Coercing the value back is silent and keeps that path working.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.protect_tier_column()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tier := 'free';
    new.tier_expires_at := null;
    new.ai_credits := 0;
  else
    if new.tier is distinct from old.tier then new.tier := old.tier; end if;
    if new.tier_expires_at is distinct from old.tier_expires_at then new.tier_expires_at := old.tier_expires_at; end if;
    if new.ai_credits is distinct from old.ai_credits then new.ai_credits := old.ai_credits; end if;
  end if;
  return new;
end;
$$;

-- Same bug, same fix: the quota columns were equally unprotected.
CREATE OR REPLACE FUNCTION public.protect_prompt_usage_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.count := 0;
    new.free_lifetime_used := 0;
  else
    new.count := old.count;
    new.free_lifetime_used := old.free_lifetime_used;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Refund a prompt (or a real $0.99 credit) when the AI call fails.
--
-- claude-proxy spends BEFORE it calls Anthropic and returns the upstream
-- status verbatim. Anthropic 429/529 peaks at 1pm ET Sunday — exactly when
-- the app is busiest — so users were charged for calls that never produced
-- a token, while the client told them "(Your prompt was not charged.)"
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refund_prompt(
  p_auth_id uuid, p_credit boolean DEFAULT false, p_lifetime boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare v_uid uuid;
begin
  select id into v_uid from public.users where auth_id = p_auth_id;
  if v_uid is null then return; end if;

  -- A spent credit is real money: give the credit back, not a free prompt.
  if p_credit then
    update public.users
       set ai_credits = ai_credits + 1, updated_at = now()
     where id = v_uid;
    return;
  end if;

  if p_lifetime then
    update public.prompt_usage
       set free_lifetime_used = greatest(free_lifetime_used - 1, 0), updated_at = now()
     where user_id = v_uid and week_start = public.current_quota_week();
  else
    update public.prompt_usage
       set count = greatest(count - 1, 0), updated_at = now()
     where user_id = v_uid and week_start = public.current_quota_week();
  end if;
end;
$$;
REVOKE ALL ON FUNCTION public.refund_prompt(uuid, boolean, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_prompt(uuid, boolean, boolean) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Free tier was 10 per WEEK, not 10 lifetime.
--
-- consume_prompt bucketed every tier by current_quota_week(), and the
-- free_lifetime_used column was written by the client and read by nobody.
-- Free accounts renewed their trial every Sunday — recurring Opus cost per
-- signup and no forcing function into the paywall, during the biggest
-- signup week of the year.
--
-- The counter column lives on the per-(user, week) row, so the true
-- lifetime total is the SUM across every week the account has existed.
-- The users-row lock matters: without it two concurrent requests both read
-- 9/10 and both charge.
--
-- Signature change: the old 2-arg version must be dropped or a 2-arg call
-- becomes ambiguous. Existing deployed callers pass named args and resolve
-- to this one via the default, so the old edge function keeps working
-- through the deploy window.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.consume_prompt(uuid, int);

CREATE OR REPLACE FUNCTION public.consume_prompt(
  p_auth_id uuid, p_limit int, p_lifetime boolean DEFAULT false)
RETURNS TABLE (allowed boolean, used int, credit_spent boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  v_uid  uuid;
  v_row  public.prompt_usage%rowtype;
  v_life int;
begin
  select id into v_uid from public.users where auth_id = p_auth_id;
  if v_uid is null then
    -- No account row: fail open (the request already authenticated).
    return query select true, 0, false; return;
  end if;

  if p_lifetime then
    perform 1 from public.users where id = v_uid for update;

    select coalesce(sum(pu.free_lifetime_used), 0) into v_life
      from public.prompt_usage pu where pu.user_id = v_uid;

    if v_life >= p_limit then
      if public.spend_ai_credit(p_auth_id) then
        return query select true, v_life, true; return;
      end if;
      return query select false, v_life, false; return;
    end if;

    insert into public.prompt_usage (user_id, week_start, count, free_lifetime_used, updated_at)
    values (v_uid, public.current_quota_week(), 0, 1, now())
    on conflict (user_id, week_start) do update
      set free_lifetime_used = prompt_usage.free_lifetime_used + 1,
          updated_at = now();

    return query select true, v_life + 1, false; return;
  end if;

  -- Paid tiers: weekly bucket, atomic conditional update.
  insert into public.prompt_usage (user_id, week_start, count, updated_at)
  values (v_uid, public.current_quota_week(), 1, now())
  on conflict (user_id, week_start) do update
    set count = prompt_usage.count + 1, updated_at = now()
    where prompt_usage.count < p_limit
  returning * into v_row;

  if v_row.user_id is not null then
    return query select true, v_row.count, false; return;
  end if;

  if public.spend_ai_credit(p_auth_id) then
    return query select true, p_limit, true; return;
  end if;
  return query select false, p_limit, false;
end;
$$;
REVOKE ALL ON FUNCTION public.consume_prompt(uuid, int, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_prompt(uuid, int, boolean) TO service_role;

-- The client needs the lifetime number to render "N left" for free users.
-- Return type changes, so the old function has to go first.
DROP FUNCTION IF EXISTS public.my_prompt_state();
CREATE OR REPLACE FUNCTION public.my_prompt_state()
RETURNS TABLE (used int, week_start date, ai_credits int, lifetime_used int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare v_uid uuid; v_credits int; v_life int;
begin
  select id, users.ai_credits into v_uid, v_credits
    from public.users where auth_id = auth.uid();
  if v_uid is null then
    return query select 0, public.current_quota_week(), 0, 0; return;
  end if;
  select coalesce(sum(pu.free_lifetime_used), 0)::int into v_life
    from public.prompt_usage pu where pu.user_id = v_uid;
  return query
    select coalesce(pu.count, 0), public.current_quota_week(), coalesce(v_credits, 0), v_life
    from (select 1) one
    left join public.prompt_usage pu
      on pu.user_id = v_uid and pu.week_start = public.current_quota_week();
end;
$$;
GRANT EXECUTE ON FUNCTION public.my_prompt_state() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Weekly runs could be created for a week whose games already kicked off.
--
-- start_week was derived from max(week) in nfl_weekly_stats, which only
-- advances when the Tuesday 08:00 UTC sync lands. A weekly run created
-- Sunday afternoon therefore started at the week already in progress and
-- "scored" games that had finished hours earlier. This fires every Sunday
-- and Monday of the season, starting immediately.
--
-- nfl_schedule holds no kickoff timestamps (season/week/home/away only), so
-- the week boundary is derived from the calendar instead: the NFL opener is
-- the Thursday after Labor Day (the first Monday on/after Sep 1), and each
-- later week starts seven days on. The 23:00 UTC offset lands before the
-- ~00:15 UTC Thursday-night kickoff, so the roll always errs early — it
-- will never place a league in a week that has already started.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.nfl_week_kickoff(p_season int, p_week int)
RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  select (
    (
      make_date(p_season, 9, 1)
        + ((8 - extract(isodow from make_date(p_season, 9, 1))::int) % 7)  -- Labor Day
        + 3                                                               -- opener Thursday
        + (p_week - 1) * 7
    )::timestamp + interval '23 hours'
  ) at time zone 'UTC';
$$;
GRANT EXECUTE ON FUNCTION public.nfl_week_kickoff(int, int) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Draft pick clock is now settable (it was a hardcoded, invisible 8h).
--
-- pick_seconds defaulted to 28800 with no way to set it and no countdown
-- rendered anywhere, so one idle drafter froze everyone else with no timer,
-- no push and no explanation. The default stays 28800 here on purpose —
-- silently dropping live leagues to 90s would autopick for people who
-- expect a slow draft. The client now passes an explicit value chosen at
-- creation, and the draft room renders the deadline.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_hosted_league(text, int, text);

CREATE OR REPLACE FUNCTION public.create_hosted_league(
  p_name text,
  p_team_count int DEFAULT 12,
  p_kind text DEFAULT 'season',
  p_pick_seconds int DEFAULT 28800)
RETURNS TABLE (league_id uuid, invite_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  v_uid uuid; v_code text; v_id uuid; v_name text; v_open int;
  v_sw int; v_ew int; v_rounds int; v_data_week int; v_pending int; v_secs int;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  v_name := public.clean_display_name(p_name, 40);
  if v_name is null then raise exception 'league needs a name'; end if;
  if p_kind not in ('season','weekly') then raise exception 'unknown league kind'; end if;

  v_secs := coalesce(p_pick_seconds, 28800);
  if v_secs < 30 or v_secs > 86400 then
    raise exception 'pick clock must be between 30 seconds and 24 hours';
  end if;

  select count(*) into v_open from public.hosted_leagues
   where creator_id = v_uid and draft_status = 'open';
  if v_open >= 10 then raise exception 'you have too many undrafted leagues — draft or delete one first'; end if;

  select coalesce(max(week), 0) into v_data_week
    from public.nfl_weekly_stats where season = public.nfl_season() and season_type = 'REG';

  -- First week whose games have NOT begun. Covers both gaps in max(week):
  -- the Sunday/Monday window while a week is being played, and the
  -- Monday-night-to-Tuesday-sync window after it has finished.
  v_pending := greatest(v_data_week + 1, 1);
  while v_pending <= 18 and now() >= public.nfl_week_kickoff(public.nfl_season(), v_pending) loop
    v_pending := v_pending + 1;
  end loop;

  if p_kind = 'weekly' then
    if v_pending > 18 then
      raise exception 'The regular season is over — weekly runs return next year';
    end if;
    v_sw := v_pending; v_ew := v_sw; v_rounds := 9;
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
      insert into public.hosted_leagues (name, invite_code, creator_id, season, team_count, league_kind, start_week, end_week, rounds, pick_seconds)
      values (v_name, v_code, v_uid, public.nfl_season(), p_team_count, p_kind, v_sw, v_ew, v_rounds, v_secs)
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
GRANT EXECUTE ON FUNCTION public.create_hosted_league(text, int, text, int) TO authenticated;
REVOKE ALL ON FUNCTION public.create_hosted_league(text, int, text, int) FROM anon, public;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. Draft push notifications have never been delivered.
--
-- notify_hosted_event posted to hosted-notify with only x-hosted-secret and
-- no apikey/Authorization header. hosted-notify has no config.toml block,
-- so it defaults to verify_jwt = true and rejected every call at the edge.
-- The trigger's `exception when others` then swallowed the failure, so the
-- feature looked wired up and silently delivered nothing. Same header set
-- the other crons already use.
-- ─────────────────────────────────────────────────────────────────────────
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
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'apikey',          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw',
      'Authorization',   'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw',
      'x-hosted-secret', current_setting('app.hosted_notify_secret', true)),
    body := jsonb_build_object('type', v_type, 'league_id', v_league)
  );
  return new;
exception when others then return new;  -- notifications never block the write
end;
$$;
