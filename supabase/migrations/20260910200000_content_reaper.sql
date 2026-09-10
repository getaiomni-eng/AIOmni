-- Content pipeline: unwedge stale claims, retry transient failures, and
-- triple article throughput (2026-09-10).
--
-- Found by reading content_items grouped by kind+status:
--
--   article | pending    | 6191 |                        |
--   article | done       | 2511 |                        |
--   article | extracting |    1 | 2026-08-23  <- wedged 18 days
--   podcast | done       |  203 |                        |
--   podcast | failed     |    1 | anthropic HTTP 529     <- lost to a blip
--
-- Two bugs and one sizing mistake.
--
-- 1. STALE CLAIMS. In content-extract-articles and content-extract-podcasts
--    the status flip IS the claim ("a concurrent run that races us just
--    claims a different set next tick"). That is a sound claim strategy and
--    has exactly one failure mode: a run that dies between claiming and
--    finishing leaves the row in 'extracting'/'transcribing' forever. One
--    article has been wedged since 2026-08-23.
--
-- 2. TRANSIENT FAILURES ARE PERMANENT. The one failed podcast died on
--    'anthropic HTTP 529' — Anthropic briefly overloaded, the most
--    recoverable error there is — and nothing ever retries it. Its
--    transcript chunks are still sitting in transcript_chunks too, because
--    content-extract-podcasts only deletes them on success. That single
--    orphan is the entire reason transcript_chunks reads 1 row.
--
-- 3. ARTICLE THROUGHPUT. BATCH_SIZE 8 every 2h = 96 articles/day, against
--    an intake that has built a 6,191-item backlog. Ordering is newest-first
--    so fresh content is never blocked, but everything below the daily cut
--    is deleted unread at 90 days. Raised to 12/run hourly = 288/day.
--    Frequency rather than batch size because the extraction loop is
--    sequential and batch size maps onto wall-clock.

-- ── Why a new column ───────────────────────────────────────────────────
-- content_items has created_at (when it was POLLED) and no updated_at, so
-- there is no way to ask how long a row has been claimed. Using created_at
-- as a proxy would be worse than doing nothing: the backlog is full of rows
-- created weeks ago, so a reaper keyed on created_at would un-claim items
-- that a run is actively working on and produce duplicate analyst_takes.
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS retry_count       int         NOT NULL DEFAULT 0;

-- ADD COLUMN stamped every existing row with now(), which would make the
-- 18-day-old wedged article look freshly claimed and hide it from the very
-- sweep added below. created_at is the best available approximation of when
-- these rows last moved.
UPDATE public.content_items SET status_changed_at = created_at
 WHERE status_changed_at > created_at;

CREATE OR REPLACE FUNCTION public.touch_content_status()
RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;

DROP TRIGGER IF EXISTS trg_touch_content_status ON public.content_items;
CREATE TRIGGER trg_touch_content_status
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_content_status();

CREATE INDEX IF NOT EXISTS idx_content_items_stuck
  ON public.content_items (status, status_changed_at)
  WHERE status IN ('extracting', 'transcribing', 'failed');

-- ── The reaper ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.requeue_stuck_content()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
declare v_unstuck int; v_retried int;
begin
  -- Stale claims. 2 hours is far longer than any real run: articles are 12
  -- sequential items (~70s) and podcasts are one item per run.
  update public.content_items
     set status = 'pending', retry_count = retry_count + 1
   where status in ('extracting', 'transcribing')
     and status_changed_at < now() - interval '2 hours'
     and retry_count < 3;
  get diagnostics v_unstuck = row_count;

  -- Transient failures only. Matching on 'HTTP 5xx' / 'HTTP 429' is precise
  -- because both extractors format errors that way ('anthropic HTTP 529',
  -- 'deepgram HTTP 402: ...'). A bare 5[0-9][0-9] would also match a 500 in
  -- a URL, and re-queueing a genuinely bad item forever is how you turn a
  -- retry into a bill.
  --
  -- retry_count < 3 caps it, and the 7-day window means a failure nobody
  -- fixed stops being retried rather than cycling indefinitely.
  update public.content_items
     set status = 'pending', error = null, retry_count = retry_count + 1
   where status = 'failed'
     and retry_count < 3
     and status_changed_at > now() - interval '7 days'
     and (error ~ 'HTTP (5[0-9][0-9]|429)'
          or error ilike '%timeout%'
          or error ilike '%overloaded%');
  get diagnostics v_retried = row_count;

  return jsonb_build_object('unstuck', v_unstuck, 'retried', v_retried);
end;
$$;
REVOKE ALL ON FUNCTION public.requeue_stuck_content() FROM public, anon, authenticated;

-- ── One-time cleanup of what is wedged right now ───────────────────────
-- The Aug 23 article predates the 7-day retry window the reaper enforces,
-- and the Sept 2 podcast may too by the time this runs. Free them once,
-- explicitly, rather than widening the recurring rule to catch them.
UPDATE public.content_items
   set status = 'pending', error = null
 WHERE status IN ('extracting', 'transcribing')
   AND status_changed_at < now() - interval '2 hours';

UPDATE public.content_items
   set status = 'pending', error = null
 WHERE status = 'failed'
   AND error ~ 'HTTP (5[0-9][0-9]|429)';

-- ── Schedule ───────────────────────────────────────────────────────────
SELECT cron.schedule('aiomni-content-reaper', '50 * * * *',
  $job$ SELECT public.requeue_stuck_content(); $job$);

-- Articles hourly instead of every 2h.
--
-- alter_job changes ONLY the schedule and leaves the command untouched.
-- Restating the command here would mean re-transcribing the net.http_post
-- block, and a transcription error in a job that runs unattended is the kind
-- of thing nobody notices for a week. This also keeps the command in exactly
-- one place: 20260910000000_cron_inventory.sql.
SELECT cron.alter_job(jobid, schedule := '20 * * * *')
  FROM cron.job WHERE jobname = 'aiomni-content-extract-articles';
