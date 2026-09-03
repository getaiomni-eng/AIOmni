-- Judgment-capture schema (2026-09-02) — the Plan B moat, finally landed.
--
-- Documented 2026-05-04 in the vault as "must happen during Plan A
-- regardless of activation": the AI-commissioner product is only credible on
-- accumulated judgment data, and that capture cannot be retrofitted. Plan B
-- was ACTIVATED 2026-09-02 (own platform, $5/member, LeagueSafe for dues).
-- Every week of live users without these tables is lost training signal.
--
-- Only ai_response_metadata is WIRED today (claude-proxy writes it, one row
-- per AI call). The others land now so features fill them as they ship, and
-- so the columns exist from the earliest possible date.

CREATE TABLE IF NOT EXISTS ai_response_metadata (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  user_id       uuid,                 -- users.id when known
  feature       text,                 -- 'coach' | 'trade' | 'draft' | 'league' | 'home' | edge fn name
  model         text NOT NULL,
  input_tokens  int,
  output_tokens int,
  cache_read_tokens  int,
  cache_write_tokens int,
  latency_ms    int,
  http_status   int,
  tier          text                  -- caller's tier at call time
);
CREATE INDEX IF NOT EXISTS idx_arm_created ON ai_response_metadata (created_at);
CREATE INDEX IF NOT EXISTS idx_arm_feature ON ai_response_metadata (feature, created_at);

CREATE TABLE IF NOT EXISTS rule_interpretation_queries (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  user_id      uuid,
  league_ref   text,                  -- platform league id ("sleeper:123..."), free-form
  category     text,                  -- 'scoring' | 'waivers' | 'trade-rules' | 'playoffs' | 'other'
  question     text NOT NULL,
  ai_answer    text,
  ai_confidence numeric,              -- 0..1 self-reported
  followup     text                   -- what the user did next, when observable
);

CREATE TABLE IF NOT EXISTS trade_disputes (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at     timestamptz NOT NULL DEFAULT now(),
  league_ref     text,
  trade_payload  jsonb NOT NULL,      -- both sides, as graded
  reason_codes   text[],
  ai_ruling      text,                -- 'approve' | 'flag' | 'reject'
  ai_confidence  numeric,
  ai_rationale   text,
  final_outcome  text,                -- what actually happened
  complaint_after boolean
);

CREATE TABLE IF NOT EXISTS veto_events (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at    timestamptz NOT NULL DEFAULT now(),
  league_ref    text,
  trade_dispute_id bigint REFERENCES trade_disputes(id),
  votes_for     int,
  votes_against int,
  ai_recommendation text,
  ai_confidence numeric,
  outcome       text
);

-- The most important table: every human override of an AI recommendation is
-- a labeled example of miscalibration.
CREATE TABLE IF NOT EXISTS commissioner_overrides (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  league_ref      text,
  domain          text,                -- 'trade' | 'waiver' | 'penalty' | 'rule' | 'other'
  ai_recommendation jsonb NOT NULL,
  ai_confidence   numeric,
  human_action    jsonb NOT NULL,
  override_reason text
);

CREATE TABLE IF NOT EXISTS bylaws_drafts (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  league_ref   text,
  version      int NOT NULL DEFAULT 1,
  bylaws       jsonb NOT NULL,
  generated_by text                   -- model id or 'human'
);

-- Server-owned: service role writes, clients read nothing (no policies).
ALTER TABLE ai_response_metadata       ENABLE ROW LEVEL SECURITY;
ALTER TABLE rule_interpretation_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_disputes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE veto_events                ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissioner_overrides     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bylaws_drafts              ENABLE ROW LEVEL SECURITY;
