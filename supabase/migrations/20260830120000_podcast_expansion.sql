-- Podcast expansion + honest source weights (2026-08-30)
--
-- 1. EIGHT new podcast feeds. Every URL below was resolved through the
--    Apple Podcasts lookup API and then fetched directly to confirm it is
--    live, carries <enclosure> audio, and has episodes from the last week.
--    Two candidates were REJECTED for exactly that reason and are recorded
--    here so nobody re-adds them:
--      · "Prospects To Pros" (The Athletic, Brugler/Zierlein) — the show
--        the draft content was expected to live in. Feed is real but its
--        last episode is Jan 2022. Dead.
--      · "PFF Fantasy Football Podcast" — last episode Mar 2026. Stale.
--
--    The Athletic's draft/prospect material is NOT a separate Tuesday
--    show; it runs inside the main Athletic Football Show feed (roughly 1
--    in 10 episodes — "Building the Beast", rookie-class reviews, draft
--    retrospectives). Adding the one feed captures both the general NFL
--    knowledge and the prospect episodes.
--
--    Dynasty was the real gap: the original five had zero dynasty-specific
--    shows despite dynasty being a first-class format in the app. FFT
--    Dynasty, Dynasty Nerds and DLF close it.
--
-- 2. ALL source weights flattened to 1.0. The previous 0.9–1.2 spread was
--    never justified anywhere in the repo, and it barely functioned:
--    score = confidence x weight x exp(-ageDays/7), so the biggest weight
--    edge (1.2 vs 1.0, +20%) is erased by ~1.5 days of age, while
--    confidence alone spans 0.3–0.9 (3x). Ranking was already effectively
--    by conviction and recency. Weights return only when they can be
--    EARNED from measured accuracy — see open-questions.md.

INSERT INTO content_sources (kind, name, feed_url, weight) VALUES
  -- General NFL knowledge + prospect/draft episodes
  ('podcast', 'The Athletic Football Show', 'https://feeds.acast.com/public/shows/681cc905bdc60241406b737f', 1.0),
  -- High-volume daily fantasy
  ('podcast', 'Fantasy Football Today',     'https://rss.amperwave.net/v2/feed/audacynetwork/38ad78ba12adc2acec34b47b1a455b85', 1.0),
  ('podcast', 'Yahoo Fantasy Forecast',     'https://feeds.simplecast.com/s3ulbOAs',                        1.0),
  ('podcast', 'Establish The Run',          'https://anchor.fm/s/60e53980/podcast/rss',                     1.0),
  ('podcast', 'Fantasy Points',             'https://feeds.megaphone.fm/fantasypoints2',                    1.0),
  -- Dynasty — the format the app supports and had no coverage for
  ('podcast', 'Fantasy Football Today Dynasty', 'https://rss.amperwave.net/v2/feed/audacynetwork/fftdynasty', 1.0),
  ('podcast', 'Dynasty Nerds',              'https://feeds.megaphone.fm/dynastynerdspodcast',               1.0),
  ('podcast', 'DLF Dynasty',                'https://feeds.simplecast.com/lOKrN4k0',                        1.0)
ON CONFLICT (feed_url) DO NOTHING;

-- Weights are not a quality signal until they're measured. Flatten.
UPDATE content_sources SET weight = 1.0 WHERE weight <> 1.0;

-- Transcription cadence: one chunk per 5 min instead of 10.
--
-- Thirteen feeds is roughly 8-9 episodes/day in steady state (~34 chunks),
-- comfortably inside even the old 144-chunk/day ceiling. The reason to
-- double capacity is the FIRST poll: each new feed ingests its last 7 days
-- at once (the poller's lookback window), a one-time burst of ~100
-- episodes that would otherwise take about three days to drain. The job
-- only transcribes when there is queued work, so a faster cadence costs
-- nothing while idle.
SELECT cron.unschedule('aiomni-content-transcribe');
SELECT cron.schedule(
  'aiomni-content-transcribe',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/content-transcribe',
    headers := '{"apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw", "Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
