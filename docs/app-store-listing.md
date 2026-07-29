# AIOmni — App Store Listing (draft v1, 2026-07-29)

Everything to paste into App Store Connect when submitting. Character
limits noted; all fields verified against ASC's current caps.

---

## 1. App Name (30 chars max)

> **AIOmni: AI Fantasy Football**

27 chars. Brand + the two highest-volume search words. Do NOT add
platform names (ESPN/Yahoo/Sleeper) — guideline 5.2.1 rejection trap.

## 2. Subtitle (30 chars max)

> **Every league. One AI coach.**

27 chars. Sells the differentiator (aggregation + AI) in one line.
Alternates if you want to test later:
- "AI coach for all your leagues" (29)
- "Draft. Trade. Win. All AI." (26)

## 3. Promotional Text (170 chars, editable without review)

> Draft season is here. Snap a photo of your live draft board and let
> your AI coach call the next pick — grounded in every roster in your
> league. (147)

## 4. Keywords (100 chars, comma-separated, invisible to users)

> draft,assistant,trade,analyzer,dynasty,rankings,waiver,wire,lineup,start,sit,helper,cheat,sheet,sim

99 chars. Notes:
- "fantasy", "football", "ai", "coach" are already indexed from
  name/subtitle — repeating them here would waste chars.
- NO trademarked platform names. Apple scans keywords hard.

## 5. Description (4,000 chars max — this is ~2,100)

> **Stop tabbing between five apps to manage your fantasy empire.**
>
> AIOmni connects every league you play — Sleeper, ESPN, Yahoo,
> MyFantasyLeague, and Fleaflicker — into one dashboard with a
> personalized AI coach that actually knows your teams.
>
> **YOUR AI COACH KNOWS EVERY ROSTER**
> Not generic advice. The coach loads your leagues, your rosters, your
> opponents' rosters, your scoring format, and live player news — then
> answers like a sharp friend who's seen your whole league. Ask who to
> start, who to target, who's the buy-low the market's sleeping on.
>
> **📸 LIVE DRAFT SUPERPOWER**
> In a draft? Screenshot the board and send it. The AI reads every pick
> off the image, knows who's gone, and tells you who to take — factoring
> your roster build and your league's format.
>
> **TRADE ANALYZER WITH TEETH**
> Paste a trade or screenshot the offer. Get letter grades for both
> sides, market math from real dynasty values, and a verdict with
> conviction — "smash accept" or "they're robbing you," never mush.
>
> **SEASON SIMULATIONS**
> The coach runs your league forward using every team's actual roster:
> projected standings, your title odds, and the one move that raises
> them most.
>
> **RANKINGS BUILT, NOT BORROWED**
> AIOmni Pulse blends draft data from every major platform, weighted by
> where the sharpest players actually draft — plus a proprietary
> projection engine and format-correct dynasty values (1QB and
> Superflex treated like the different games they are).
>
> **EVERYTHING ELSE YOU'D EXPECT**
> • Top-25 waiver targets at every position, every platform
> • Live news, injuries, and trade feeds
> • Custom rankings you can edit per format — synced to the cloud
> • Standings, matchups, and roster spy for every league
>
> **FREE TO START**
> Connect a league and get free AI prompts to feel the difference.
> Upgrade for weekly prompt allowances and the full rankings suite:
> • Rankings — $4.99/mo or $39.99/yr
> • Pro — $12.99/mo or $99.99/yr (50 AI prompts/week)
>
> Subscriptions auto-renew until cancelled. Terms:
> https://getaiomni.com/terms · Privacy: https://getaiomni.com/privacy
>
> One dashboard. Every league. See everything. Know everyone. Win always.

## 6. What's New (v1.0)

> Welcome to AIOmni — every fantasy league you play, one AI coach.
> Connect Sleeper, ESPN, Yahoo, MFL, or Fleaflicker and meet the
> assistant that knows your whole league.

## 7. Category & Rating

- **Primary category:** Sports
- **Secondary:** Entertainment
- **Age rating questionnaire:** all "None" → lands at **4+**.
  (Vegas implied totals are informational sports context, not gambling
  content — standard for sports apps. No real-money wagering, no links
  to sportsbooks.)

## 8. URLs

- **Support URL:** https://getaiomni.com
- **Marketing URL (optional):** https://getaiomni.com
- **Privacy Policy URL (required):** https://getaiomni.com/privacy

## 9. App Privacy (nutrition labels)

Enter everything in `docs/privacy-nutrition-labels.md` — it's accurate —
**plus one amendment**:

### Photos or Videos — COLLECTED  *(amendment 2026-07-29)*
Users can attach screenshots (draft boards, trade offers) that are
transmitted off-device to the AI for reading. Not stored server-side,
not used for tracking.
- Linked to user: No (image content isn't tied to identity records)
- Used for tracking: No
- Purpose: **App Functionality** — reading draft boards and trade
  screenshots the user chooses to share.

(Alternative: Apple's optional-disclosure exemption covers ephemeral,
user-initiated, non-tracking uploads — but declaring is the safe play
and costs nothing.)

## 10. App Review Notes (paste into "Notes" box)

> AIOmni is a fantasy sports assistant. To experience the full app:
>
> 1. Sign in with the demo account:
>    Email: [CREATE: aiomni.review@getaiomni.com]
>    Password: [SET ONE — pre-confirm the email server-side]
> 2. On the Home tab, tap SLEEPER and connect the demo Sleeper
>    username: [CREATE a Sleeper account in a public mock league —
>    Sleeper connect needs only a username, no password]
> 3. Leagues, rankings, and the AI Coach populate from there. The
>    "Continue without account" path is also available from sign-in.
>
> Content rights: All player statistics displayed are unprotectable
> facts under C.B.C. Distribution v. MLBAM (8th Cir. 2007). Player
> images are hotlinked from the fantasy platforms users connect their
> own accounts to; no images are rehosted. No NFL or team logos are
> used. News items display headline + source attribution + link only.
>
> Account deletion: Settings → Delete Account (fully removes the
> server-side account, verified).
>
> AI content: coach responses are generated via the Anthropic API with
> user-initiated prompts; prompt quotas prevent abuse.

## 11. Screenshot Plan (capture on 6.9" — iPhone 16 Pro Max sim or device; ASC scales the rest)

Order matters — first two get 90% of views:
1. **AI Coach mid-conversation** — the season-sim answer with standings
   (shows personalization + intelligence)
2. **Draft board camera** — the "[Live draft board I just read]" moment
   (the unique feature; consider a caption overlay "Snap your draft.
   Get the pick.")
3. **Home multi-league dashboard** — all 5 platform pills + league cards
4. **Trade analyzer verdict** — the letter grades + "hard pass" verdict
5. **Rankings** — dynasty board with tiers
6. **Waivers** — position-filtered top-25
Caption style: 3-5 word benefit headlines, your dark theme, no device
frames needed.

## 12. Pre-submission checklist (the non-listing stuff)

- [ ] EIN → LLC bank OR Apple banking on SSN (Paid Apps agreement)
- [ ] IAP products created in ASC (2 tiers × monthly+annual) + RevenueCat
      offerings verified against product IDs
- [ ] Custom SMTP for Supabase auth emails (Resend/Postmark) — built-in
      sender is rate-limited and spam-filtered
- [ ] Demo accounts created (Supabase + Sleeper) and noted above
- [ ] Sandbox purchase + Restore tested once banking clears
- [ ] Merge `fix/espn-dynamic-season` → main before the submission build
- [ ] Final build with legal links (188+) is the one submitted
