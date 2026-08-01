-- Lock prompt_usage against quota tampering.
--
-- WHY: an "Allow all" policy (cmd ALL, USING true) let ANY user read and
-- rewrite EVERY user's prompt_usage row. claude-proxy enforces the weekly
-- paid-tier quota from prompts_used in this table — so a user could zero
-- their own counter (unlimited AI prompts, server enforcement defeated)
-- or inflate someone else's (DoS their quota). The narrower policies that
-- existed alongside were keyed on users.id while the app and proxy key
-- rows by auth.uid(), so they never matched — which is presumably why the
-- allow-all was added.
--
-- Design after this migration:
--   * Users can SELECT/INSERT/UPDATE only their OWN row (user_id = auth.uid()).
--   * prompts_used / reset_at are server-owned columns: a trigger blanks
--     any client-role change (claude-proxy writes via service_role and
--     passes through). free_lifetime_used stays client-writable — the
--     device-level counter is the real anti-farming control there and the
--     cloud value is best-effort sync.

-- 1. Drop the hole + the mis-keyed policies.
drop policy if exists "Allow all on prompt_usage" on public.prompt_usage;
drop policy if exists "Users can upsert own usage" on public.prompt_usage;
drop policy if exists "Users can read own usage" on public.prompt_usage;
drop policy if exists "Users can update own usage" on public.prompt_usage;

-- 2. Correctly-keyed owner policies.
create policy "prompt_usage_owner_select" on public.prompt_usage
  for select using (user_id = auth.uid());
create policy "prompt_usage_owner_insert" on public.prompt_usage
  for insert with check (user_id = auth.uid());
create policy "prompt_usage_owner_update" on public.prompt_usage
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 3. Server-owned columns protected from client roles.
create or replace function public.protect_prompt_usage_columns()
returns trigger
language plpgsql
security definer
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.prompts_used := 0;
    new.reset_at := null;
  else
    new.prompts_used := old.prompts_used;
    new.reset_at := old.reset_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_prompt_usage on public.prompt_usage;
create trigger trg_protect_prompt_usage
  before insert or update on public.prompt_usage
  for each row execute function public.protect_prompt_usage_columns();
