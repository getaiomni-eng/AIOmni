-- $0.99 AI credits (2026-09-02). ASC consumable com.getaiomni.ai.credit.v1
-- (IAP 6808053515) exists; this is the server half. Spec: roadmap + vault.
--
-- A credit is one AI analysis, spendable on ANY surface — claude-proxy spends
-- it when the weekly quota is exhausted, so trade/coach/draft/league all just
-- work. Balance lives on the account (consumables don't restore on reinstall).

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS ai_credits int NOT NULL DEFAULT 0;

-- RevenueCat retries webhooks; without dedupe one purchase credits twice.
CREATE TABLE IF NOT EXISTS public.processed_rc_events (
  event_id     text PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.processed_rc_events ENABLE ROW LEVEL SECURITY;

-- Same lockdown as tier: a client that can write its own balance has
-- infinite credits. Extends the existing trigger fn (service role passes).
CREATE OR REPLACE FUNCTION public.protect_tier_column()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- Atomic spend: two concurrent requests must not share one credit. The
-- single UPDATE with the guard in WHERE is the whole race-safety story.
CREATE OR REPLACE FUNCTION public.spend_ai_credit(p_auth_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
declare n int;
begin
  update public.users
     set ai_credits = ai_credits - 1, updated_at = now()
   where auth_id = p_auth_id and ai_credits > 0;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;
REVOKE ALL ON FUNCTION public.spend_ai_credit(uuid) FROM public, anon, authenticated;
-- The REVOKE from PUBLIC also strips service_role's inherited execute —
-- and service_role is exactly who calls this (claude-proxy). Grant it back.
GRANT EXECUTE ON FUNCTION public.spend_ai_credit(uuid) TO service_role;
