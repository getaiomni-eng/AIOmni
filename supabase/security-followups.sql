-- ============================================================================
-- AIOmni — Security follow-ups from the 2026-06-11 audit
-- Run these in the Supabase SQL Editor (Dashboard → SQL). They need DB-owner
-- access, which the assistant deliberately does NOT have (and shouldn't).
-- READ THE SEQUENCING NOTES — a couple of these break older app builds if run
-- too early.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1) HIGH — Hide the engine's secret sauce (`method`) from the public anon key.
--
--    The `method` column spells out the engine's multipliers/logic and is
--    readable by anyone with the anon key (which is extractable from the IPA).
--    The app NEVER displays it (build 176+ also stops requesting it).
--
--    ⚠️ SEQUENCING: run this ONLY AFTER build 176 (which drops `method` from the
--    client query) is the dominant installed version. Older builds (≤175) still
--    request `method`; a column REVOKE makes their WHOLE rankings query 403,
--    so their in-app rankings would break until they update. Give it ~1–2 weeks
--    of adoption, or check your analytics for ≤175 usage first.
-- ────────────────────────────────────────────────────────────────────────────
REVOKE SELECT (method) ON public.nfl_proprietary_rankings_v2 FROM anon, authenticated;
-- (Service role — used by the engine, regen, and any gated function — is
--  unaffected, so internal pipelines keep full access.)


-- ────────────────────────────────────────────────────────────────────────────
-- 2) MEDIUM — Stop anonymous bulk-scraping of the rankings VALUES.
--
--    Even without `method`, the anon key can dump all 8 formats × 250 players.
--    The values are semi-public (shown in-app + on the site), so this is lower
--    priority — but if you want to throttle wholesale scraping, the right move
--    is to serve the app through a JWT-gated edge function (like rankings-gate
--    does for the site) and then REVOKE table SELECT from anon entirely:
--
--      -- ⚠️ Only after the app reads via a gated function (a 176+ change):
--      -- REVOKE SELECT ON public.nfl_proprietary_rankings_v2 FROM anon;
--      -- ALTER TABLE public.nfl_proprietary_rankings_v2 ENABLE ROW LEVEL SECURITY;
--
--    Leave this commented until that app change ships, or the app breaks.


-- ────────────────────────────────────────────────────────────────────────────
-- 3) MEDIUM — Lock the anon-invokable, expensive edge functions.
--
--    aiomni-rankings-engine-v2, regenerate-rankings-json, and ktc-values can be
--    triggered by anyone with the anon key → cost-abuse / DoS (someone spams
--    expensive rebuilds). They're called by pg_cron, which currently passes the
--    anon key. To lock them:
--
--    a) Set a shared secret (already have RANKINGS_GATE_HMAC; reuse or make new):
--         supabase secrets set ENGINE_TRIGGER_SECRET=<random>   (CLI, not SQL)
--    b) Have each function require it (a header/param check) — an edge-function
--       change, then redeploy.
--    c) Update the cron jobs to send it. Find them:
--         SELECT jobid, jobname, schedule, command FROM cron.job;
--       Then re-schedule each with the secret in the net.http_post headers/body,
--       e.g.:
--         SELECT cron.unschedule('aiomni-rankings-rerun');
--         SELECT cron.schedule('aiomni-rankings-rerun','0 8 * * *', $$
--           SELECT net.http_post(
--             url    := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/aiomni-rankings-engine-v2',
--             headers:= jsonb_build_object('Content-Type','application/json','x-trigger', '<secret>'),
--             body   := '{}'::jsonb);
--         $$);
--
--    NOTE: the engine SELF-CHAINS (calls itself for format batches), so its own
--    self-call must also send the secret — coordinate the function change with
--    this. Do NOT add a naive per-IP rate limit to the engine; it would block
--    the self-chain.


-- ────────────────────────────────────────────────────────────────────────────
-- VERIFIED-GOOD (no action needed):
--   • RLS is ON for users / memories / prompt_usage / security_events
--     (anon sees 0 rows). User data is protected.
--   • Third-party API keys are server-side (edge function env), not in the client.
--   • TLS everywhere; claude-proxy requires a real user JWT + rate-limits.
-- ============================================================================
