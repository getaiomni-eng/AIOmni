-- Daily social posting: queue, veto window, copy-paste pack (2026-09-26).
--
-- Owner's rules: automate every network that can be automated; everything else
-- is a copy-paste post with numbered steps on getaiomni.com/rank (Posts tab).
-- Automated posts wait in a VETO WINDOW (3h, 90 min on Sundays) and publish
-- unless the owner taps Hold.
--
--   generator  scripts/social/generate.ts  (GitHub Actions, daily)
--              builds the day's posts + media, inserts rows here
--   publisher  supabase/functions/social-publisher  (pg_cron, every 10 min)
--              publishes due 'auto' rows; uploads 'semi' rows (YouTube, private)
--   phone      manual-rankings ?view=posts + actions -> Posts tab on /rank
--
-- mode:   auto    publisher posts it (bluesky, threads, facebook, instagram, x)
--         semi    publisher uploads PRIVATE, owner flips public (youtube)
--         manual  owner copy-pastes (tiktok, reddit)
-- status: queued -> publishing -> posted | failed      (auto/semi)
--         held   (owner vetoed; 'release' puts it back to queued)
--         ready  -> done                               (manual)
--         skipped (network not connected yet, or kill switch)

CREATE TABLE IF NOT EXISTS public.social_posts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_date   date   NOT NULL,                 -- US/Eastern calendar day
  theme       text   NOT NULL,                 -- hits | report_card | rankings | tnf | injuries | disagree | final_calls
  network     text   NOT NULL CHECK (network IN ('bluesky','threads','facebook','instagram','x','youtube','tiktok','reddit')),
  mode        text   NOT NULL CHECK (mode IN ('auto','semi','manual')),
  status      text   NOT NULL DEFAULT 'queued'
              CHECK (status IN ('queued','held','publishing','posted','failed','ready','done','skipped')),
  publish_at  timestamptz,                     -- auto/semi only
  title       text,                            -- reddit / youtube
  body        text   NOT NULL,                 -- post text or caption, final and ready to publish
  thread      jsonb,                           -- X / Threads / Bluesky follow-up posts: ["...", "..."]
  media       jsonb  NOT NULL DEFAULT '[]',    -- [{kind:'image'|'video', url, width, height, alt}]
  link        text,
  extra       jsonb  NOT NULL DEFAULT '{}',    -- {steps:[...], subreddit, subreddit_note, ...}
  posted_url  text,
  posted_at   timestamptz,
  error       text,
  attempts    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_date, theme, network)
);
CREATE INDEX IF NOT EXISTS social_posts_due_idx ON public.social_posts (status, publish_at);
ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;   -- service role only

COMMENT ON TABLE public.social_posts IS
  'One row per network per day. Written by scripts/social/generate.ts, published by social-publisher, held/released/marked done from the /rank Posts tab.';

-- Master switch, flipped from the Posts tab. 'off' = publisher does nothing.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('social_autopost', 'on', now())
ON CONFLICT (key) DO NOTHING;

-- Public bucket for post media: Instagram and Threads fetch images by URL,
-- and the owner downloads TikTok/Reddit media to his phone from it.
INSERT INTO storage.buckets (id, name, public)
VALUES ('social', 'social', true)
ON CONFLICT (id) DO NOTHING;
