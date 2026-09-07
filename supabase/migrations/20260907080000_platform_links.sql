-- Platform links that follow the account, and a free trial that cannot be
-- farmed by making new profiles (2026-09-07).
--
-- BEFORE THIS: every platform link lived in device storage. That cost users
-- a full reconnect on the web app and on any second device -- and bought no
-- abuse protection at all, because AsyncStorage is not scoped per account and
-- sign-out never cleared it. Signing out and signing up again left the
-- leagues connected and handed over a fresh 10-prompt trial. Device binding
-- made the farming path EASIER, not harder.
--
-- AFTER: the safe identifiers follow the account, so the web app just works.
-- Abuse control moves onto the league identity, which is a far better
-- fingerprint than a device: it survives reinstalls and new phones, and it is
-- the thing actually being reused.
--
-- ONLY non-secret identifiers live here. ESPN (espn_s2 + SWID) and Yahoo hold
-- live session cookies that would let a database reader act as the user on
-- that platform, so those deliberately stay on-device.

CREATE TABLE IF NOT EXISTS public.user_platform_links (
  user_id     uuid        NOT NULL,
  platform    text        NOT NULL CHECK (platform IN ('sleeper','mfl','fleaflicker')),
  external_id text        NOT NULL,
  meta        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform, external_id)
);
-- The lookup that answers "has anyone else already claimed this?"
CREATE INDEX IF NOT EXISTS user_platform_links_claim_idx
  ON public.user_platform_links (platform, external_id);

ALTER TABLE public.user_platform_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "own links read" ON public.user_platform_links;
CREATE POLICY "own links read" ON public.user_platform_links
  FOR SELECT TO authenticated USING (user_id = public.my_app_id());

-- No client INSERT policy on purpose: claiming goes through the RPC below so
-- the first-claim check can never be skipped by writing the row directly.
DROP POLICY IF EXISTS "own links delete" ON public.user_platform_links;
CREATE POLICY "own links delete" ON public.user_platform_links
  FOR DELETE TO authenticated USING (user_id = public.my_app_id());

-- Explicit and readable, rather than poisoning the usage counter with a
-- sentinel value. A support agent can see exactly why a trial is gone.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS free_trial_forfeited boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.free_trial_forfeited IS
  'Set when this account claimed a platform link another account had already claimed. The free lifetime trial belongs to the first account to claim a given league identity.';

-- ── claim ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_platform_link(
  p_platform text, p_external_id text, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (linked boolean, trial_forfeited boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  v_uid   uuid;
  v_prior uuid;
  v_tier  text;
  v_forf  boolean;
begin
  v_uid := public.my_app_id();
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_platform not in ('sleeper','mfl','fleaflicker') then
    raise exception 'unsupported platform %', p_platform;
  end if;
  if coalesce(trim(p_external_id), '') = '' then
    raise exception 'missing platform identifier';
  end if;

  select tier, free_trial_forfeited into v_tier, v_forf
    from public.users where id = v_uid for update;

  -- Anyone else already holding this exact league identity?
  select l.user_id into v_prior
    from public.user_platform_links l
   where l.platform = p_platform
     and l.external_id = p_external_id
     and l.user_id <> v_uid
   limit 1;

  insert into public.user_platform_links (user_id, platform, external_id, meta)
  values (v_uid, p_platform, p_external_id, coalesce(p_meta, '{}'::jsonb))
  on conflict (user_id, platform, external_id)
    do update set meta = excluded.meta;

  -- Paid accounts are never touched: someone who bought a subscription is
  -- not farming a 10-prompt trial, and a shared household should not be
  -- punished for it either.
  if v_prior is not null and v_tier = 'free' and not v_forf then
    update public.users set free_trial_forfeited = true, updated_at = now()
     where id = v_uid;
    v_forf := true;
  end if;

  return query select true, coalesce(v_forf, false);
end;
$$;
REVOKE ALL ON FUNCTION public.claim_platform_link(text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.claim_platform_link(text, text, jsonb) TO authenticated;

-- ── read back on a new device / the web app ─────────────────────────────
CREATE OR REPLACE FUNCTION public.my_platform_links()
RETURNS TABLE (platform text, external_id text, meta jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.platform, l.external_id, l.meta
    FROM public.user_platform_links l
   WHERE l.user_id = public.my_app_id()
   ORDER BY l.claimed_at;
$$;
GRANT EXECUTE ON FUNCTION public.my_platform_links() TO authenticated;

CREATE OR REPLACE FUNCTION public.unlink_platform(p_platform text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.user_platform_links
   WHERE user_id = public.my_app_id() AND platform = p_platform;
$$;
GRANT EXECUTE ON FUNCTION public.unlink_platform(text) TO authenticated;

-- ── enforcement: a forfeited trial has no prompts left ──────────────────
CREATE OR REPLACE FUNCTION public.consume_prompt(
  p_auth_id uuid, p_limit int, p_lifetime boolean DEFAULT false)
RETURNS TABLE (allowed boolean, used int, credit_spent boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  v_uid  uuid;
  v_row  public.prompt_usage%rowtype;
  v_life int;
  v_forf boolean;
begin
  select id, free_trial_forfeited into v_uid, v_forf
    from public.users where auth_id = p_auth_id;
  if v_uid is null then
    return query select true, 0, false; return;
  end if;

  if p_lifetime then
    perform 1 from public.users where id = v_uid for update;

    -- Trial already spent by the account that claimed this league first.
    -- A purchased credit still works: they paid for that one.
    if coalesce(v_forf, false) then
      if public.spend_ai_credit(p_auth_id) then
        return query select true, p_limit, true; return;
      end if;
      return query select false, p_limit, false; return;
    end if;

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
      set free_lifetime_used = prompt_usage.free_lifetime_used + 1, updated_at = now();

    return query select true, v_life + 1, false; return;
  end if;

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
