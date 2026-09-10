-- Wire the judgment-capture tables (2026-09-09).
--
-- 20260902120000 created six tables for the AI-commissioner dataset. Exactly
-- one of them, ai_response_metadata, has ever received a row -- claude-proxy
-- writes it on every AI call. The other five have no writer anywhere in
-- services/, app/ or supabase/functions/. They have been collecting nothing
-- for a week while looking, from the schema, like they were collecting.
--
-- Two of the five have a live surface that can feed them TODAY:
--   rule_interpretation_queries  <- app/(tabs)/coach.tsx:1583
--   trade_disputes               <- app/(tabs)/trade.tsx:635
-- Those get RPCs here. The other three are not wired, and not because of
-- an oversight -- see the note at the bottom.
--
-- WHY RPCs AND NOT CLIENT INSERTS
-- RLS is on with no policies, so nothing but service_role or a definer
-- function can write. That is the right posture and is kept: this is
-- training data, and a client-writable dataset is a poisonable one. The
-- functions below fill user_id from my_app_id() server-side (never from an
-- argument), clamp every text field, and cap volume per caller.

-- ── 1. Correct a comment that makes analysis silently wrong ────────────
-- claude-proxy inserts auth.getUser().id -- the AUTH uid -- into
-- ai_response_metadata.user_id. The column comment said "users.id when
-- known". Those are different columns, so a join to users.id returns zero
-- rows and reads as "no data yet" rather than erroring. Fix the comment,
-- not the data: auth_id is a perfectly good join key and rewriting a week
-- of rows would only move the trap somewhere else.
COMMENT ON COLUMN public.ai_response_metadata.user_id IS
  'AUTH uid (auth.users.id). Join public.users.auth_id -- NOT public.users.id.';

-- ── 2. rule_interpretation_queries ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_rule_query(
  p_league_ref  text,
  p_category    text,
  p_question    text,
  p_answer      text,
  p_confidence  numeric DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  v_uid   uuid;
  v_cat   text;
  v_today int;
begin
  -- Every failure path is a silent no-op. Capture must never surface to the
  -- user, and never block the answer they actually asked for.
  v_uid := public.my_app_id();
  if v_uid is null then return; end if;
  if p_question is null or length(btrim(p_question)) = 0 then return; end if;

  v_cat := case when p_category in ('scoring','waivers','trade-rules','playoffs')
                then p_category else 'other' end;

  -- Volume guard. A real user asks a handful of rules questions a week;
  -- 100/day is far above human use and far below what would matter as
  -- dataset poisoning.
  select count(*) into v_today
    from public.rule_interpretation_queries
   where user_id = v_uid and created_at > now() - interval '24 hours';
  if v_today >= 100 then return; end if;

  insert into public.rule_interpretation_queries
    (user_id, league_ref, category, question, ai_answer, ai_confidence)
  values (
    v_uid,
    left(p_league_ref, 120),
    v_cat,
    left(p_question, 2000),
    left(p_answer, 8000),
    -- The Coach does not self-report confidence today, so this is normally
    -- NULL. Left in place rather than fabricated from a proxy signal.
    case when p_confidence >= 0 and p_confidence <= 1 then p_confidence end
  );
end;
$$;
REVOKE ALL ON FUNCTION public.log_rule_query(text,text,text,text,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_rule_query(text,text,text,text,numeric) TO authenticated;

-- ── 3. trade_disputes ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_trade_dispute(
  p_league_ref   text,
  p_payload      jsonb,
  p_reason_codes text[] DEFAULT '{}'::text[],
  p_ruling       text   DEFAULT NULL,
  p_rationale    text   DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare
  v_uid   uuid;
  v_ref   text;
  v_today int;
  v_id    bigint;
begin
  v_uid := public.my_app_id();
  if v_uid is null then return null; end if;
  if p_payload is null then return null; end if;
  -- 16 KB is roughly 10x the largest real trade payload. Anything past it
  -- is not a trade.
  if pg_column_size(p_payload) > 16384 then return null; end if;

  v_ref := left(coalesce(nullif(btrim(p_league_ref), ''), 'general'), 120);

  -- trade_disputes has no user_id column, by design: the row is about the
  -- trade, not the person who graded it. So the volume guard keys on
  -- league_ref instead of the caller.
  select count(*) into v_today
    from public.trade_disputes
   where league_ref = v_ref and created_at > now() - interval '24 hours';
  if v_today >= 200 then return null; end if;

  insert into public.trade_disputes
    (league_ref, trade_payload, reason_codes, ai_ruling, ai_rationale)
  values (
    v_ref,
    p_payload,
    coalesce(p_reason_codes, '{}'::text[]),
    -- 'approve' | 'flag' only. The app grades trades, it does not veto
    -- them, so it must never claim to have ruled 'reject'. Anything else
    -- the client sends is discarded rather than stored as a fake ruling.
    case when p_ruling in ('approve','flag') then p_ruling end,
    left(p_rationale, 4000)
  )
  returning id into v_id;
  return v_id;
end;
$$;
REVOKE ALL ON FUNCTION public.log_trade_dispute(text,jsonb,text[],text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_trade_dispute(text,jsonb,text[],text,text) TO authenticated;

-- ── 4. Operator read views ─────────────────────────────────────────────
-- The tables are service_role-only. These exist so the dataset can be read
-- back without loosening RLS on the base tables.
CREATE OR REPLACE FUNCTION public.rule_query_summary()
RETURNS TABLE (category text, queries bigint, users bigint, newest timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT category, count(*), count(DISTINCT user_id), max(created_at)
  FROM public.rule_interpretation_queries GROUP BY category ORDER BY 2 DESC;
$$;
REVOKE ALL ON FUNCTION public.rule_query_summary() FROM public, anon, authenticated;

-- ── NOT WIRED, and why ─────────────────────────────────────────────────
-- veto_events            needs a league vote flow. Hosted leagues have
--                        members and picks but no voting surface at all.
-- commissioner_overrides needs an AI recommendation a human can overrule.
--                        Nothing in the app issues a commissioner ruling
--                        yet, so there is nothing to override.
-- bylaws_drafts          needs a bylaws generator. Does not exist.
--
-- All three need product that has not been built, not a missing INSERT.
-- Wiring them now would mean inventing the events they record, which is
-- worse than an empty table: a table of fabricated rows looks like evidence.
