# Deploy: week-1 hardening (commit 2ce57f1)

Run these in order. **The migration must land first** — the new client and the
new proxy call `consume_prompt` and `create_hosted_league` with parameters that
do not exist until it does. Shipping the OTA first breaks league creation.

## 1. Migration

    cd ~/AIOmni && supabase db push

Then set the notify secret once (any long random string; must match the
`HOSTED_NOTIFY_SECRET` the edge function reads):

    supabase secrets list | grep -i hosted     # check what's already there

If `app.hosted_notify_secret` has never been set on the database, the trigger
sends an empty header and hosted-notify will reject it. Set it in the SQL
editor with the same value as the function secret:

    ALTER DATABASE postgres SET app.hosted_notify_secret = '<same value>';

## 2. Edge functions

    supabase functions deploy claude-proxy
    supabase functions deploy revenuecat-webhook

## 3. OTA (both runtime versions, so installed 1.0.1 and 1.0.2 builds get it)

    npx eas update --branch production --message "Week-1 hardening"
    python3 -c "import json,pathlib;p=pathlib.Path('app.json');d=json.loads(p.read_text());d['expo']['version']='1.0.1';p.write_text(json.dumps(d,indent=2)+'\n')"
    npx eas update --branch production --message "Week-1 hardening"
    git checkout app.json

## 4. Web

    npx expo export --platform web --output-dir /tmp/webbuild
    npx netlify deploy --prod --dir /tmp/webbuild --site <app.getaiomni.com site id>

## Verify after deploying

    -- the security hole is closed: this should now COERCE, not apply
    -- (run as an ordinary signed-in user, not the SQL editor's postgres role)

    -- free tier is lifetime, not weekly
    select auth_id, tier from users where tier = 'free' limit 1;
    select user_id, week_start, count, free_lifetime_used from prompt_usage
     order by updated_at desc limit 5;

    -- audit for anyone who already exploited the open tier column
    select auth_id, tier, ai_credits, updated_at from users
     where tier <> 'free' or ai_credits > 0 order by updated_at desc;

Cross-check that last list against RevenueCat. Anyone with a paid tier or
credits who has no matching RevenueCat transaction set it themselves.

## Smoke test on device (5 minutes)

1. Create a league — pick a 90-second clock. Confirms `create_hosted_league`
   accepts the new parameter and that the picker writes it.
2. Open the draft room — the banner should show a live countdown.
3. Ask the Draft Copilot something, then tap ASK again immediately. The
   second tap must do nothing (button greys out).
4. Check the board has no players that error when drafted.
