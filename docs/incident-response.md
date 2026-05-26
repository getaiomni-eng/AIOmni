# AIOmni — Incident Response Playbook

When something goes wrong, run the playbook for that scenario before
posting publicly, before talking to users, before talking to investors.
The order of operations matters: stop the bleeding first, then triage.

---

## 🩸 0. Generic "stop the bleeding" pattern

For every incident, before deep investigation:

1. **Snapshot the state** — `pg_dump` of Supabase + `git log` on the
   currently-shipping commit. You'll want it for the postmortem.
2. **Pause the cron jobs** if they could amplify the issue:
   ```sql
   UPDATE cron.job SET active = false;
   -- Re-enable selectively after fix
   ```
3. **Drop a "we're aware" message in TestFlight notes** if it's
   user-visible.
4. **Open an incident channel** (Slack thread / Discord / Linear ticket)
   so timeline is captured.

---

## 🔑 1. Leaked API key or secret

**Signal**: a key shows up in a public IPA, a screenshot, GitHub search,
or your provider sends an abuse notice.

**Steps**:
1. **Rotate immediately** at the provider:
   - **Anthropic**: console.anthropic.com → Keys → revoke + create
   - **OpenWeather**: home.openweathermap.org/api_keys
   - **Odds API**: the-odds-api.com → account → reset key
   - **CFBD**: collegefootballdata.com → API → regenerate
   - **RevenueCat shared secret**: app.revenuecat.com → project →
     Integrations → App Store Connect → Reset
   - **Supabase service-role key** (if leaked): Settings → API → Generate new
2. **Push new value to Supabase secrets**:
   ```sh
   supabase secrets set ANTHROPIC_API_KEY=sk-new...
   supabase functions deploy --project-ref khoruzvsprxyocisuhet
   ```
3. **Audit Anthropic usage dashboard** for the prior 30 days. Any
   spend you can't explain → assume the key was used by an attacker.
4. **File chargeback claims** if abuse cost is material. All three
   third-party APIs honor "key was compromised, not us" with proof
   (the timestamp it left the repo).
5. **Postmortem**: how did it leak? client bundle? git commit?
   contractor leak? Add a CI check that fails the build if the new
   key shows up in client code.

---

## 💸 2. Anthropic spend spike

**Signal**: Anthropic email "you've hit 80% of your monthly cap" or
your daily-spend chart suddenly tripled.

**Steps**:
1. **Set hard cap immediately** at console.anthropic.com → Settings →
   Billing → Usage limits.
2. **Pull the last hour's `security_events`**:
   ```sql
   SELECT kind, COUNT(*), array_agg(DISTINCT ip)
   FROM public.security_events
   WHERE created_at > now() - INTERVAL '1 hour'
     AND scope = 'claude-proxy'
   GROUP BY kind
   ORDER BY 2 DESC;
   ```
3. **Pull `prompt_usage` outliers**:
   ```sql
   SELECT user_id, prompts_used, reset_at
   FROM public.prompt_usage
   WHERE prompts_used > 50
   ORDER BY prompts_used DESC LIMIT 20;
   ```
   If you see a user at 1000+ → the limit isn't being enforced. Bug.
4. **Tighten the per-IP rate limit** in claude-proxy from 60/min →
   30/min temporarily, redeploy.
5. **If the spike is a real attacker (anonymous floods)**: deploy
   Cloudflare in front of your Supabase project for WAF + bot
   blocking. Takes ~30 min.

---

## 🔓 3. Supabase RLS bypass (data leak)

**Signal**: user reports "I see someone else's data" OR a security
researcher emails.

**Steps**:
1. **Identify the affected table** from the report.
2. **Re-run the RLS audit query** from the security audit (paste into
   SQL Editor):
   ```sql
   -- see "RLS audit" earlier in chat history
   ```
3. **If a table shows policy_count = 0 or RLS not enabled**: enable
   immediately:
   ```sql
   ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;
   CREATE POLICY <owner_only> ON public.<table>
     FOR ALL TO authenticated
     USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
   ```
4. **Audit what data could have been read** during the bypass window.
   Query Supabase's `auth.audit_log_entries` and edge function logs
   for the time range.
5. **If PII was exposed**: notify affected users within 72 hours per
   GDPR. Apple also recommends notification under data-breach guidance.
6. **Postmortem**: every table needs a written RLS policy + a test
   that verifies a different user can't read it.

---

## 📱 4. Push notification abuse

**Signal**: users report receiving notifications about players they
don't own, or notifications spike unexpectedly.

**Steps**:
1. **Pause the cron jobs**:
   ```sql
   UPDATE cron.job
   SET active = false
   WHERE jobname LIKE 'aiomni-notification-%';
   ```
2. **Query `notification_log`** for the last hour:
   ```sql
   SELECT kind, COUNT(*), MIN(sent_at), MAX(sent_at)
   FROM public.notification_log
   WHERE sent_at > now() - INTERVAL '1 hour'
   GROUP BY kind;
   ```
3. **Spot-check a few rows** — are they targeted at the right users?
4. **If it's a logic bug** (e.g., dedupe failure): fix in code, ship,
   re-enable crons.
5. **If it's spam from a compromised admin**: rotate service-role key,
   investigate how it got out.

---

## 👤 5. Account takeover report

**Signal**: user emails "I can't log in" or "someone changed my email."

**Steps**:
1. **Disable the account** in Supabase Dashboard → Authentication →
   Users → find by email → ban.
2. **Pull the user's recent activity**:
   ```sql
   SELECT * FROM auth.audit_log_entries
   WHERE actor_id = '<uid>'
   ORDER BY created_at DESC LIMIT 50;
   ```
3. **Reset their password** via the dashboard, send the reset email.
4. **Rotate any league credentials** they have stored (in iOS Keychain
   on their device — they'd need to reconnect).
5. **Check for related accounts** — same email pattern, same IP,
   same device — could be a compromised credential reuse from another
   service.

---

## 🐛 6. Crash flood post-deploy

**Signal**: Sentry issues spike to 100+/hour after a TestFlight push.

**Steps**:
1. **Identify the crash signature** in Sentry (top of the issues list).
2. **Revert the last commit** locally:
   ```sh
   git revert HEAD --no-edit
   git push origin main
   eas build --platform ios --profile testflight --auto-submit --non-interactive
   ```
3. **TestFlight users won't auto-update** until they manually do; the
   crashing build keeps crashing until they update. Post a quick note
   in the TestFlight build description.
4. **Postmortem**: add a test that would have caught it.

---

## 📞 Contacts

- **Anthropic** — support@anthropic.com (acct issues), security@anthropic.com (vuln)
- **Supabase** — Slack support (paid plan) or support@supabase.io
- **Apple** — Developer Support via App Store Connect → Contact Us
- **RevenueCat** — Discord support or hi@revenuecat.com
- **Sentry** — support@sentry.io

## After every incident

Within 7 days, write a postmortem with:
1. Timeline (when it started, when it was detected, when it was mitigated)
2. Root cause
3. Why monitoring didn't catch it sooner
4. Three concrete prevention items
5. Three concrete detection items

Save it in `docs/incidents/YYYY-MM-DD-<slug>.md`. Even if no one else
reads it, you'll have it for the next investor diligence question
about "how do you handle security."
