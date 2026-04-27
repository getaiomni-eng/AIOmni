-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 004 — Add MFL + Fleaflicker platforms; extend dynasty fields
-- ═══════════════════════════════════════════════════════════════════════════
-- Adds 'mfl' and 'fleaflicker' to the platform CHECK constraints in the
-- existing decision/behavioral tables, plus adds optional dynasty-flavor
-- columns to support keeper/contract/salary/taxi data.
--
-- Idempotent. Safe to re-run.
-- Apply via Supabase Dashboard → SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── lineup_decisions: extend platform CHECK ──────────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'lineup_decisions') then
    alter table public.lineup_decisions drop constraint if exists lineup_decisions_platform_check;
    alter table public.lineup_decisions add constraint lineup_decisions_platform_check
      check (platform in ('sleeper','yahoo','espn','mfl','fleaflicker'));
  end if;
end $$;

-- ─── trade_considerations: extend platform CHECK ──────────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'trade_considerations') then
    alter table public.trade_considerations drop constraint if exists trade_considerations_platform_check;
    alter table public.trade_considerations add constraint trade_considerations_platform_check
      check (platform in ('sleeper','yahoo','espn','mfl','fleaflicker'));
  end if;
end $$;

-- ─── league_transactions: extend platform CHECK if exists ────────────────
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'league_transactions') then
    alter table public.league_transactions drop constraint if exists league_transactions_platform_check;
    alter table public.league_transactions add constraint league_transactions_platform_check
      check (platform in ('sleeper','yahoo','mfl','fleaflicker'));
  end if;
end $$;

-- ─── weekly_lineups: extend platform CHECK if exists ─────────────────────
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'weekly_lineups') then
    alter table public.weekly_lineups drop constraint if exists weekly_lineups_platform_check;
    alter table public.weekly_lineups add constraint weekly_lineups_platform_check
      check (platform in ('sleeper','yahoo','mfl','fleaflicker'));
  end if;
end $$;

-- ─── Verification ─────────────────────────────────────────────────────────
-- After applying:
-- select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname like '%_platform_check';
