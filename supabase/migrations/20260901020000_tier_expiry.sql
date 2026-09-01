-- Comped tiers that expire on their own (2026-09-01)
--
-- WHY: users.tier had no expiry. Granting someone "a month of Pro" meant a
-- manual UPDATE plus a calendar reminder to revert it, and a missed reminder
-- is unlimited Opus on the house forever. First real grant
-- (matt.holzem@icloud.com, 2026-08-31) is backfilled below.
--
-- DESIGN: tier_expires_at NULL means "no expiry" — that is every genuine
-- RevenueCat subscriber, whose lifecycle the webhook already owns. The sweep
-- only ever touches rows where the column is NOT NULL and in the past, so a
-- paying customer can never be downgraded by this.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS tier_expires_at timestamptz;

COMMENT ON COLUMN public.users.tier_expires_at IS
  'Comped-tier expiry. NULL = no expiry (RevenueCat-managed or free). When set and elapsed, the nightly sweep reverts tier to free.';

-- Same lockdown as tier itself: a client that can write its own expiry can
-- grant itself Pro forever. Mirrors protect_tier_column's role check.
CREATE OR REPLACE FUNCTION public.protect_tier_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tier := 'free';
    new.tier_expires_at := null;
  else
    if new.tier is distinct from old.tier then
      new.tier := old.tier;
    end if;
    if new.tier_expires_at is distinct from old.tier_expires_at then
      new.tier_expires_at := old.tier_expires_at;
    end if;
  end if;
  return new;
end;
$$;

-- Idempotent, and safe to run more than once a day.
CREATE OR REPLACE FUNCTION public.sweep_expired_tiers()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare n integer;
begin
  update public.users
     set tier = 'free', tier_expires_at = null, updated_at = now()
   where tier_expires_at is not null
     and tier_expires_at < now()
     and tier <> 'free';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Hourly, not daily: a daily sweep leaves up to 24h of free Pro after expiry.
SELECT cron.unschedule('aiomni-sweep-expired-tiers')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aiomni-sweep-expired-tiers');

SELECT cron.schedule(
  'aiomni-sweep-expired-tiers',
  '5 * * * *',
  $$ SELECT public.sweep_expired_tiers(); $$
);

-- Backfill the grant that prompted this. 30 days from the grant.
UPDATE public.users
   SET tier_expires_at = timestamptz '2026-09-30 23:59:59+00'
 WHERE lower(email) = 'matt.holzem@icloud.com'
   AND tier = 'pro';
