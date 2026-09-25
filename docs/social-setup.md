# Social posting: one-time account setup

Connect each network once. Anything you skip stays "not connected": its posts
are marked skipped and everything else keeps working, so do these in any order.

When you have a network's values, open the **Terminal app** and run:

    cd ~/AIOmni && bash scripts/social/set_secrets.sh

It asks network by network, hides what you paste, and saves to Supabase.
Values show up once on each site, so paste them straight into the helper.

| # | Network | Time | Device |
|---|---|---|---|
| 1 | Bluesky | 5 min | phone |
| 2 | Netlify token (fixes site auto-deploy) | 5 min | phone |
| 3 | X | 30 min | computer |
| 4 | Facebook + Instagram + Threads | 45 min | computer + phone |
| 5 | YouTube | 40 min | computer |

---

## 1. Bluesky (`bluesky`)

1. Bluesky app: **Settings → Privacy and Security → App Passwords** (or bsky.app/settings/app-passwords).
2. **Add App Password**, name it `aiomni-poster`, **Create**.
3. Copy the `xxxx-xxxx-xxxx-xxxx` value. It is shown once.

Paste into the helper:
- `BLUESKY_HANDLE`: your full handle, e.g. `aiomni.bsky.social`.
- `BLUESKY_APP_PASSWORD`: the value from step 3. Never your real password.

## 2. Netlify token (GitHub secret, not Supabase)

1. app.netlify.com → avatar → **User settings → Applications → Personal access tokens → New access token**.
2. Name it `github-actions-deploy`, pick the **longest expiry**, then generate and copy it. A short expiry is probably what killed the last one.
3. github.com/getaiomni-eng/AIOmni → **Settings → Secrets and variables → Actions → Secrets** tab → the existing `NETLIFY_AUTH_TOKEN` → **Update**, then paste.

## 3. X (`x`): pay-per-use, about $0.20 per post with a link

X charges per post: $0.015 plain, $0.20 when the post has a link. Posts fail
when your balance hits $0, so turn on auto-recharge.

1. On a computer, **logged in as the AIOmni X account**, go to console.x.com and accept the developer agreement.
2. **Billing:** add a card and a small credit, then turn on auto-recharge.
3. **New App**, named `AIOmni Publisher`.
4. **Set permissions before making tokens:** App → Settings → User authentication settings → Edit. Set **App permissions** to **Read and Write**, then Save.
5. Open **Keys and tokens**:
   - **Consumer Keys** → `X_API_KEY` and `X_API_SECRET`
   - **Access Token and Secret → Generate** → `X_ACCESS_TOKEN` and `X_ACCESS_SECRET`

**Pitfall:** tokens made while the app was read-only stay read-only, and posts fail with 403. If that happens, **Regenerate** them after step 4.

## 4. Facebook Page + Instagram + Threads (`meta`, then `threads`)

These use one Meta developer app in **Development mode**, with you as its admin.
Posting to your own accounts needs **no App Review**.

**Before you start, on your phone:**
- Instagram must be a **Professional** account.
- It must be linked to the AIOmni Facebook Page: Instagram → Settings → Account → Linked accounts.

**App:**
1. developers.facebook.com → **My Apps → Create App**, type **Business**.
2. Add the use cases **Instagram API with Facebook Login** and **Threads API**.

**Page token (`META_PAGE_ID`, `META_PAGE_TOKEN`), on a computer:**
1. developers.facebook.com/tools/explorer → pick your app. Under **Add a Permission**, add:
   `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`
2. **Generate Access Token** and approve as the Page admin.
3. Open developers.facebook.com/tools/debug/accesstoken, paste the token, **Debug**, then **Extend Access Token**. That gives a 60-day user token.
4. Back in the Explorer, with that long-lived token, run `me/accounts`. Find the AIOmni Page:
   - `id` → `META_PAGE_ID`
   - `access_token` → `META_PAGE_TOKEN`
5. Paste that Page token into the Debug tool. **Expires** should say **Never**.

**Instagram id (`IG_USER_ID`):** in the Explorer, run `{META_PAGE_ID}?fields=instagram_business_account`. The nested `id` is `IG_USER_ID`. An empty result means Instagram isn't linked or isn't a Professional account.

**Threads (`THREADS_USER_ID`, `THREADS_TOKEN`):**
1. App dashboard → **App roles → Roles → Add People → Threads Tester** → your Threads username.
2. On your phone, open Threads → Settings → Account and accept the invite. Look for "Website permissions" or "Invites". If it doesn't appear, make the account public temporarily.
3. The Threads use case has its **own App ID and Secret**. Use those, not the main app's.
   In the Threads use case settings, set **Redirect Callback URL** to `https://getaiomni.com/`.
   This is where Threads sends you back with the code.
4. In a browser, open this, with your Threads App ID and the app's redirect URL:
   `https://threads.net/oauth/authorize?client_id=THREADS_APP_ID&redirect_uri=https://getaiomni.com/&scope=threads_basic,threads_content_publish&response_type=code`
   Approve, then copy the `code` from the address you land on.
5. Trade the code for a token. Claude can run this exchange for you: send it the code within an hour. That gives `THREADS_USER_ID` and a 60-day `THREADS_TOKEN`. The publisher refreshes the token on its own after that.

## 5. YouTube (`youtube`): uploads land private, you tap Public

1. console.cloud.google.com → **New Project** `AIOmni Publisher` → **APIs & Services → Library** → **YouTube Data API v3 → Enable**.
2. **OAuth consent screen:**
   - User type **External**, fill in the required fields.
   - Add scope `https://www.googleapis.com/auth/youtube.upload`.
   - Set **Publishing status to "In production"**. If you leave it on Testing, the token dies after 7 days.
3. **Credentials → Create credentials → OAuth client ID**:
   - Type: **Web application**. Not Desktop.
   - Authorized redirect URI: `https://developers.google.com/oauthplayground`
   - Copy the Client ID and Secret → `YT_CLIENT_ID` and `YT_CLIENT_SECRET`.
4. developers.google.com/oauthplayground:
   - Click the gear, tick **Use your own OAuth credentials**, and paste the ID and Secret.
   - Enter the scope above, then **Authorize APIs**. Sign in as the channel owner.
   - "Google hasn't verified this app" is expected for your own app: **Advanced → Go to …**
   - **Exchange authorization code for tokens**. The `refresh_token` is `YT_REFRESH_TOKEN`.

Why private: Google keeps uploads from unaudited apps private. The Posts tab
reminds you to open YouTube Studio and switch each one to Public, which takes
three taps.

---

Official sources: X pricing docs.x.com/x-api/getting-started/pricing ·
Meta access levels developers.facebook.com/docs/graph-api/overview/access-levels ·
Threads tokens developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions ·
Google refresh-token expiry developers.google.com/identity/protocols/oauth2#expiration ·
YouTube private uploads developers.google.com/youtube/v3/docs/videos/insert
