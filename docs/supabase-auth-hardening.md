# Supabase Auth Hardening — Dashboard Settings to Flip

Settings that can't be set from code (live in the Supabase project
dashboard). Walk through these once.

URL: https://supabase.com/dashboard/project/khoruzvsprxyocisuhet

---

## 1. Email confirmation required

**Where**: Authentication → Providers → Email

**Toggle ON**: "Confirm email"

**Why**: stops sign-up fraud (Apple / RevenueCat counts a sign-up
toward your conversion metrics; a bot army inflating signups will mess
with your funnel analysis and could trigger Anthropic refund chargebacks
from associated AI prompt abuse).

**Side effect**: existing users with unverified emails will lose access
until they verify. Mitigate by either (a) auto-verifying all existing
rows before flipping the switch, or (b) sending a "please verify" email
campaign first.

---

## 2. JWT expiration time

**Where**: Authentication → Settings → JWT expiry

**Set to**: `3600` (1 hour) for access tokens.

**Why**: shorter access-token life means a stolen JWT expires soon.
Refresh-token rotation (next setting) handles the user-experience side.

**Default**: 3600 already. Verify it isn't been changed to something
absurd like 31536000 (1 year).

---

## 3. Refresh token rotation

**Where**: Authentication → Settings → Refresh Token Reuse Interval

**Set to**: `10` seconds.

**Why**: every time the client uses a refresh token, Supabase issues a
new one and revokes the old. Reuse detection — if the same refresh token
is used twice outside the 10s window, the session is killed and the user
is forced to re-login. Stops cookie-theft attacks cold.

**Plus**: enable "Detect and revoke potentially compromised refresh tokens."

---

## 4. Site URL + Redirect URLs

**Where**: Authentication → URL Configuration

**Site URL**: `https://www.getaiomni.com`

**Additional Redirect URLs** (allowlist for OAuth + password-reset redirects):
- `aiomnifantasy://` (the app's expo-router scheme — pulled from `app.json`)
- `https://www.getaiomni.com/auth/callback`
- `https://getaiomni.com/auth/callback`

**Why**: stops OAuth callback hijacking. A malicious page can't initiate
a Supabase password-reset that redirects to its own domain to steal
the reset token.

---

## 5. Password requirements

**Where**: Authentication → Providers → Email → Password Requirements

**Set**:
- Minimum length: **10**
- Required character classes: **at least 1 uppercase + 1 number** (don't
  require special chars — Apple's password policy is weaker, mismatched
  policies frustrate users)
- Reject leaked passwords: **ON** (Supabase checks against the
  HaveIBeenPwned hash list)

---

## 6. Auth provider scope

**Where**: Authentication → Providers

**Disable any provider you don't actually use** (Google, GitHub,
Facebook, etc. shipped enabled with new projects). Only Email should
be on.

**Why**: every enabled provider is another attack surface; if Google
OAuth is on but the redirect URL isn't tightly configured, an attacker
could craft a sign-in flow that returns the wrong account.

---

## 7. Rate limit on email + SMS auth attempts

**Where**: Authentication → Rate Limits

**Set**:
- Email signup: **10 per hour per IP**
- Email signin: **30 per hour per IP**
- Password recovery: **5 per hour per IP**

**Why**: defaults are 30 / 100 / 5 — the signup default lets one IP
register 30 accounts per hour, plenty for a botnet to grind through.

---

## 8. CAPTCHA on signup (optional — recommend for v1.1)

**Where**: Authentication → Settings → CAPTCHA

**Recommend**: hCaptcha after the first incident of bot signup. Skip
for v1 unless you see >50 signups per hour you can't explain.

---

## 9. Verify the JWT secret hasn't been exposed

**Where**: Settings → API → JWT Settings

**Action**: confirm `JWT_SECRET` is not in any git commit, Slack
message, environment file, or screenshot. If even possibly leaked,
rotate it (will sign every user out — major UX impact).

---

## 10. Database backups

**Where**: Database → Backups

**Verify**: daily backups are enabled. Currently free tier gets 7 days
of backups. Test a restore once before launch — verify the .dump file
actually contains data and can be loaded into a fresh project.

---

## 11. Edge function logs retention

**Where**: Edge Functions → Logs

**Verify**: logs are accessible for at least the last 24 hours. If you
have Pro plan, retention is 7 days; on free it's a few hours. For
post-incident forensics you want at least 24h. Worth upgrading to Pro
before launch if you can.

---

## After flipping all of the above

Sign out + sign back in on your own account to verify nothing broke.
Try a wrong password 31 times to verify rate limit triggers. Try to
reuse a refresh token to verify reuse detection kicks in.

Document the date these were enabled in the project README so future-you
remembers what's set up.
