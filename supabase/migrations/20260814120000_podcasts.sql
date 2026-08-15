-- Analyst-takes pipeline phase 2: podcasts.
-- Adds transcription progress tracking, transcript storage, the five
-- podcast sources (feed URLs verified live via iTunes canonical lookup,
-- 2026-08-14), and the transcribe/extract crons.

-- Resumable transcription: episodes are processed in byte-range chunks
-- (Whisper caps uploads at 25MB; edge functions cap wall-clock), one
-- chunk per invocation. bytes_done/total_bytes track the cursor.
ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS bytes_done  bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bytes bigint;

CREATE TABLE IF NOT EXISTS transcript_chunks (
  item_id    uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  idx        int  NOT NULL,
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, idx)
);
ALTER TABLE transcript_chunks ENABLE ROW LEVEL SECURITY;  -- service-role only

-- ── Podcast sources ───────────────────────────────────────────────────
-- The Athletic joins HERE (public podcast feed) — its articles stay out.
INSERT INTO content_sources (kind, name, feed_url, weight) VALUES
  ('podcast', 'Fantasy Footballers',      'https://feeds.simplecast.com/sw7PGWfw',                    1.2),
  ('podcast', 'Ringer Fantasy Football',  'https://feeds.megaphone.fm/ringer-fantasy-football-show',  1.1),
  ('podcast', 'ESPN Fantasy Focus',       'https://feeds.megaphone.fm/ESP7699980268',                 1.1),
  ('podcast', 'Harris Fantasy Football',  'https://harrisfootball.libsyn.com/rss',                    1.0),
  ('podcast', 'FantasyPros Podcast',      'https://rss.pdrl.fm/8516fd/www.omnycontent.com/d/playlist/e73c998e-6e60-432f-8610-ae210140c5b1/a425ba31-4316-4647-847e-b0030136e912/0afc299b-d04e-4bd7-91a8-b0030136e938/podcast.rss', 1.0)
ON CONFLICT (feed_url) DO NOTHING;

-- ── Crons ─────────────────────────────────────────────────────────────
-- Transcribe advances one chunk every 10 min (an hour episode = ~4
-- chunks = ~40 min end-to-end). Podcast extraction runs every 30 min.
SELECT cron.schedule(
  'aiomni-content-transcribe',
  '*/10 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/content-transcribe',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

SELECT cron.schedule(
  'aiomni-content-extract-podcasts',
  '3,33 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/content-extract-podcasts',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);

-- Retention: transcripts are intermediate data; the extract step deletes
-- per-item on success, this catches failures.
SELECT cron.schedule(
  'aiomni-transcripts-retention',
  '30 6 * * 0',
  $$
  DELETE FROM transcript_chunks WHERE created_at < now() - interval '14 days';
  $$
);
