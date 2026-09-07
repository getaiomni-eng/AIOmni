# getaiomni.com

Source of truth for the marketing site. **This folder is what is live.**

    npx netlify deploy --prod --dir site --site 0c75d22b-56a4-4f22-8ad6-92249612e874

Do not deploy from `~/aiomni-landing` — it is the pre-launch one-pager whose
CTAs all say "Get Beta Access" and which advertises two tiers (Premium,
Dynasty Elite) that no longer exist. Deploying it would replace the download
button with a mailto link and 404 the privacy policy the App Store listing
depends on.

## Pages
index · features · leagues · rankings · pricing · privacy · terms · 404

## Live data
The ticker and the "Running right now" panel read `site-live`, a public edge
function (`supabase/functions/site-live`). It returns this week's games with
weather plus headlines from three RSS feeds, cached 15 minutes. API keys stay
server-side; nothing proprietary is exposed — no rankings, scores, method or
analyst content.

## Logo
`.wm` markup is a direct port of `app/components/AIOmniLogo.tsx` — the
Spectrum C Mark. Same radius, stroke, dash geometry and gradient stops. If the
app logo changes, change it here too.

## Claims that must stay true
Free is 10 prompts to start (not per week). Rankings $4.99, Pro $12.99. Yahoo
is NOT listed as a supported platform while it is gated on their side. No
ranking methodology or tuned parameters appear anywhere.
