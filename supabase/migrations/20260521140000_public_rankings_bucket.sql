-- v5.14c (2026-05-21): public storage bucket for the rankings JSON file
-- consumed by the marketing site (site/rankings.html). The
-- regenerate-rankings-json edge function uploads the JSON here after each
-- engine rerun; the static HTML page fetches from this CDN URL on load.
--
-- Bucket is read-public (anyone with the URL can fetch) but write-restricted
-- to service-role (engine function).

INSERT INTO storage.buckets (id, name, public)
VALUES ('public-rankings', 'public-rankings', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Allow anon SELECT (CDN read). Writes are service-role only (default).
DROP POLICY IF EXISTS "public_rankings_read" ON storage.objects;
CREATE POLICY "public_rankings_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'public-rankings');
