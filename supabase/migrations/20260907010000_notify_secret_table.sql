-- Move the hosted-notify secret out of a GUC and into a table (2026-09-07).
--
-- app.hosted_notify_secret was never set, so notify_hosted_event sent an
-- empty x-hosted-secret into a function that compares it against a real one.
-- Every push was rejected at the edge and the trigger's `exception when
-- others` swallowed the failure. Push has never been delivered, once.
--
-- Setting the GUC is possible but a bad fit: ALTER DATABASE only reaches NEW
-- connections, the pooler holds old ones, and current_setting(...) returning
-- null is indistinguishable from "not propagated yet". That ambiguity is how
-- this broke silently the first time. A row in a table is set by an INSERT
-- and confirmed by a SELECT, with no propagation semantics to reason about.

CREATE TABLE IF NOT EXISTS public.app_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
-- No policy: service_role and postgres only. Never reachable from a client.
REVOKE ALL ON TABLE public.app_settings FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.notify_hosted_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
declare v_type text; v_league uuid; v_secret text;
begin
  if tg_table_name = 'hosted_leagues' then
    if new.draft_status = old.draft_status then return new; end if;
    v_type := case new.draft_status when 'drafting' then 'draft_started'
                                    when 'complete' then 'draft_complete' else null end;
    v_league := new.id;
  else
    v_type := 'pick_made'; v_league := new.league_id;
  end if;
  if v_type is null then return new; end if;

  -- Table first, GUC as fallback so an already-set environment keeps working.
  select value into v_secret from public.app_settings where key = 'hosted_notify_secret';
  if v_secret is null then
    v_secret := current_setting('app.hosted_notify_secret', true);
  end if;

  perform net.http_post(
    url := 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/hosted-notify',
    headers := jsonb_build_object(
      'Content-Type',    'application/json',
      'apikey',          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw',
      'Authorization',   'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw',
      'x-hosted-secret', coalesce(v_secret, '')),
    body := jsonb_build_object('type', v_type, 'league_id', v_league)
  );
  return new;
exception when others then return new;  -- notifications never block the write
end;
$$;
