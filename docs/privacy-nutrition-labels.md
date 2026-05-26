# AIOmni — App Store Privacy Nutrition Labels

What to enter in **App Store Connect → AIOmni → App Privacy → Edit**.

Apple groups data into 14 categories. For each one, declare:
- Whether it's collected
- Whether it's linked to the user's identity
- Whether it's used for tracking
- The specific purpose

Below is the complete list of data the app currently collects, with the
ASC-mapped category in **bold** and the answer for each prompt.

---

## Contact Info

### Email Address — COLLECTED

- Linked to user: **Yes** (it's the account identifier)
- Used for tracking: **No**
- Purposes:
  - **App Functionality** — authentication, password reset
  - **Customer Support** — replying to support emails

---

## User Content

### Other User Content — COLLECTED

Covers user-typed prompts sent to the AI Coach and Trade Analyzer.

- Linked to user: **Yes** (tied to auth_id in `prompt_usage` for quota tracking)
- Used for tracking: **No**
- Purposes:
  - **App Functionality** — answering the user's question via Claude
  - **Analytics** — aggregate prompt counts (not content) for tier sizing

---

## Identifiers

### User ID — COLLECTED

The Supabase auth UUID. Tied to every row the user creates.

- Linked to user: **Yes** (by definition)
- Used for tracking: **No**
- Purposes:
  - **App Functionality** — authentication, league sync, prompt quota

### Device ID — COLLECTED

The Expo push token registered after the user grants notification permission.

- Linked to user: **Yes** (stored in `users.push_token`)
- Used for tracking: **No**
- Purposes:
  - **App Functionality** — delivering player news / lineup / Pulse push alerts

---

## Usage Data

### Product Interaction — COLLECTED

- `prompt_usage.prompts_used` — how many AI prompts the user has consumed this week
- `behavioralSync` — Sleeper / Yahoo league refresh timestamps

- Linked to user: **Yes**
- Used for tracking: **No**
- Purposes:
  - **App Functionality** — enforce tier quota, throttle redundant syncs
  - **Analytics** — measure feature engagement

### Advertising Data — NOT COLLECTED

### Other Usage Data — NOT COLLECTED

---

## Diagnostics

### Crash Data — COLLECTED

Via Sentry (DSN in `app/_layout.tsx`).

- Linked to user: **Yes** (Sentry.setUser sets the auth_id)
- Used for tracking: **No**
- Purposes:
  - **App Functionality** — debugging
  - **Analytics** — crash-rate monitoring

### Performance Data — COLLECTED

Sentry tracesSampleRate = 1.0 — collects spans for every interaction.

- Linked to user: **Yes**
- Used for tracking: **No**
- Purposes:
  - **App Functionality** — performance debugging

### Other Diagnostic Data — NOT COLLECTED

---

## Other Data

### League Credentials — COLLECTED

Sleeper username, ESPN session cookies (espn_s2/SWID — stored in iOS
Keychain), Yahoo OAuth tokens (Keychain), MFL/Fleaflicker league IDs.

This isn't a built-in ASC category — declare under **Other Data Types**
with the description: "Third-party fantasy platform credentials used to
read the user's leagues."

- Linked to user: **Yes**
- Used for tracking: **No**
- Purposes:
  - **App Functionality** — reading the user's leagues, rosters, matchups

---

## Categories explicitly NOT collected

- Health & Fitness
- Financial Info (payments handled by Apple StoreKit / RevenueCat — those go to Apple, not to AIOmni)
- Location
- Sensitive Info
- Contacts
- Search History
- Browsing History
- Audio Data
- Photos or Videos
- Gameplay Content
- Customer Support (other than email replies)

---

## "Tracking" decision

**AIOmni does not track users.** Apple defines tracking as "linking
user or device data collected from your app with user or device data
collected from other companies' apps, websites, or offline properties
for targeted advertising or advertising measurement purposes, or sharing
user or device data with data brokers."

We don't:
- Share data with any advertising or analytics SDK
- Use IDFA
- Link data across other apps/sites
- Sell data to brokers

So the "Used for tracking" answer is **No** for every category above.
This means **no ATT (App Tracking Transparency) prompt** is required.

---

## Submission checklist

- [ ] Enter every category above in App Store Connect → App Privacy
- [ ] Add the privacy policy URL (Settings → App → Privacy Policy must
      point to the same URL hosted publicly)
- [ ] Verify your Sentry DSN region matches the privacy policy's
      "data location" statement (EU vs US)
- [ ] Re-check this doc anytime you add a new data collection point
      (new third-party SDK, new push notification type, new database
      column that holds user-supplied content)
