-- Server-side prompt quota: make it real (2026-09-03)
--
-- Found because a user saw 40/50 on phone and 50/50 on web. The truth was
-- worse: claude-proxy read/wrote columns prompts_used/reset_at, but this
-- table's real columns are count/week_start/free_lifetime_used. Every write
-- errored silently (result ignored), every read produced undefined, and
-- undefined >= limit is false — so the server has NEVER blocked a prompt.
-- prompt_usage had zero rows in production. Device-local counters were the
-- only enforcement; a second device meant a second allowance. The Aug 1
-- "lock" migration protected the imaginary columns, and its RLS select
-- policy compared user_id (an app users.id per the FK) to auth.uid() — so
-- clients could not read their own row either.
--
-- One RPC now owns consumption: race-safe weekly increment via
-- ON CONFLICT ... WHERE count < limit, with the $0.99 credit spent as the
-- fallback when the week is exhausted. Weeks start Sunday 00:00 UTC.

-- 1. Trigger: guard the REAL columns.
CREATE OR REPLACE FUNCTION public.protect_prompt_usage_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- 2. Owner-read that matches the FK (users.id, not auth.uid()).
DROP POLICY IF EXISTS "prompt_usage_owner_select" ON public.prompt_usage;
CREATE POLICY "prompt_usage_owner_select" ON public.prompt_usage
  FOR SELECT USING (
    user_id IN (SELECT id FROM public.users WHERE auth_id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.current_quota_week()
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (date_trunc('week', now() + interval '1 day') - interval '1 day')::date;
$$;

-- 3. The consumption RPC. Returns what happened; claude-proxy just obeys.
CREATE OR REPLACE FUNCTION public.consume_prompt(p_auth_id uuid, p_limit int)
RETURNS TABLE (allowed boolean, used int, credit_spent boolean)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare
  v_uid uuid;
  v_row public.prompt_usage%rowtype;
begin
  select id into v_uid from public.users where auth_id = p_auth_id;
  if v_uid is null then
    -- No account row: fail open (the request already authenticated).
    return query select true, 0, false; return;
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

  -- Week exhausted: a purchased credit covers one analysis.
  if public.spend_ai_credit(p_auth_id) then
    return query select true, p_limit, true; return;
  end if;
  return query select false, p_limit, false;
end;
$$;
REVOKE ALL ON FUNCTION public.consume_prompt(uuid, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_prompt(uuid, int) TO service_role;

-- 4. Client-readable state for displays: one number on every device.
CREATE OR REPLACE FUNCTION public.my_prompt_state()
RETURNS TABLE (used int, week_start date, ai_credits int)
LANGUAGE plpgsql SECURITY DEFINER AS $$
declare v_uid uuid; v_credits int;
begin
  select id, users.ai_credits into v_uid, v_credits
    from public.users where auth_id = auth.uid();
  if v_uid is null then return query select 0, public.current_quota_week(), 0; return; end if;
  return query
    select coalesce(pu.count, 0), public.current_quota_week(), coalesce(v_credits, 0)
    from (select 1) one
    left join public.prompt_usage pu
      on pu.user_id = v_uid and pu.week_start = public.current_quota_week();
end;
$$;
GRANT EXECUTE ON FUNCTION public.my_prompt_state() TO authenticated;
