-- Lock users.tier against client writes.
--
-- WHY: RLS allows users to UPDATE (and INSERT) their own row with no
-- column restrictions, and the app wrote tier from the client — so any
-- authenticated user could PATCH tier='pro' via PostgREST with the anon
-- key + their JWT and get Pro free (claude-proxy trusts users.tier for
-- quota). The same design caused the login tier-stomp bug.
--
-- Tier may now change ONLY via privileged roles: the RevenueCat webhook
-- edge function (service_role) and manual grants run as postgres.
-- PostgREST requests execute as `authenticated`/`anon` after SET ROLE,
-- so current_user cleanly distinguishes the two worlds. Client writes
-- don't error — tier silently keeps its old value so profile upserts
-- keep working unchanged.

create or replace function public.protect_tier_column()
returns trigger
language plpgsql
security definer
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tier := 'free';
  elsif new.tier is distinct from old.tier then
    new.tier := old.tier;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_tier on public.users;
create trigger trg_protect_tier
  before insert or update on public.users
  for each row execute function public.protect_tier_column();
