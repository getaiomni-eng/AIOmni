-- Analyst-takes pipeline (v1.1) — podcasts + articles → structured takes.
-- Spec: docs/analyst-takes-pipeline.md. Three tables:
--   content_sources  — feed registry; adding a source is an INSERT, not a deploy
--   content_items    — one row per episode/article; dedupe anchor + state machine
--   analyst_takes    — the product: one row per (item, player, claim)
--
-- Writes happen ONLY via service-role edge functions (content-poll,
-- content-extract-articles). Clients may read analyst_takes (the Coach
-- context builder needs it); the two pipeline tables stay server-only.

CREATE TABLE IF NOT EXISTS content_sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL CHECK (kind IN ('podcast', 'article')),
  name           text NOT NULL,
  feed_url       text NOT NULL UNIQUE,
  enabled        boolean NOT NULL DEFAULT true,
  -- Manual source-quality knob; multiplies into the Coach's recency score.
  weight         numeric NOT NULL DEFAULT 1.0,
  last_polled_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL REFERENCES content_sources(id) ON DELETE CASCADE,
  guid         text NOT NULL,
  title        text NOT NULL,
  url          text,
  published_at timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','transcribing','extracting','done','failed','skipped')),
  error        text,
  -- Podcasts only. Article bodies are fetched transiently, never stored.
  audio_url    text,
  duration_s   int,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, guid)
);
CREATE INDEX IF NOT EXISTS idx_content_items_status
  ON content_items (status, published_at DESC);

CREATE TABLE IF NOT EXISTS analyst_takes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  source_id    uuid NOT NULL REFERENCES content_sources(id),
  player_name  text NOT NULL,               -- as written/spoken in the source
  player_key   text NOT NULL,               -- normalized (lowercase a-z only)
  sleeper_id   text,                        -- resolved vs nfl_players; NULL if ambiguous
  position     text,
  nfl_team     text,
  analyst      text,                        -- byline/speaker when identifiable
  stance       text NOT NULL CHECK (stance IN ('buy','sell','hold','injury','usage','situation')),
  claim        text NOT NULL,               -- ONE extractor-authored sentence, never a quote
  format_note  text,                        -- 'dynasty only', 'PPR spike', NULL
  confidence   numeric NOT NULL DEFAULT 0.5,
  published_at timestamptz NOT NULL,        -- denormalized for the hot query
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_analyst_takes_player
  ON analyst_takes (player_key, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_analyst_takes_recency
  ON analyst_takes (published_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────
-- Pipeline tables: RLS on, no policies → only service_role can touch them.
ALTER TABLE content_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items   ENABLE ROW LEVEL SECURITY;
-- Takes: authenticated clients read (Coach context); writes stay server-only.
ALTER TABLE analyst_takes   ENABLE ROW LEVEL SECURITY;
CREATE POLICY analyst_takes_read ON analyst_takes
  FOR SELECT TO authenticated USING (true);

-- ── Seed sources (articles first — day-2 win; podcasts join in phase 2) ──
-- "RSS or don't ingest": every URL here is a public feed. The Athletic is
-- deliberately absent from articles (paywalled — ToS); its public podcast
-- feeds can be added to the podcast rows later.
INSERT INTO content_sources (kind, name, feed_url, weight) VALUES
  ('article', 'ESPN NFL',            'https://www.espn.com/espn/rss/nfl/news',              1.0),
  -- The Ringer removed public RSS entirely (verified 2026-08-12); their
  -- content joins via podcast feeds in phase 2. Rotowire replaces them —
  -- pure fantasy signal, and the same feed newsFeed.ts has used since May.
  ('article', 'Rotowire NFL',        'https://www.rotowire.com/rss/news.php?sport=NFL',     1.1),
  ('article', 'Yahoo Sports NFL',    'https://sports.yahoo.com/nfl/rss/',                   1.0),
  ('article', 'CBS Sports NFL',      'https://www.cbssports.com/rss/headlines/nfl/',        0.9),
  ('article', 'NBC ProFootballTalk', 'https://www.nbcsports.com/profootballtalk.rss',       0.9)
ON CONFLICT (feed_url) DO NOTHING;

-- ── Retention (weekly, Sunday 06:00 UTC) ──────────────────────────────
-- Takes are stale opinions after ~3 weeks; keep 45 days for trend views.
SELECT cron.schedule(
  'aiomni-takes-retention',
  '0 6 * * 0',
  $$
  DELETE FROM analyst_takes WHERE published_at < now() - interval '45 days';
  DELETE FROM content_items WHERE created_at   < now() - interval '90 days';
  $$
);

-- ── Pipeline crons ────────────────────────────────────────────────────
-- Poll feeds every 2h; extract 15 min later so fresh items are visible.
-- Header pattern (public anon JWT) matches 20260521000000_schedule_daily_syncs.
SELECT cron.schedule(
  'aiomni-content-poll',
  '5 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/content-poll',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

SELECT cron.schedule(
  'aiomni-content-extract-articles',
  '20 */2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/content-extract-articles',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
