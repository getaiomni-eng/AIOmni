# Analyst Takes Pipeline (v1.1 flagship)

**Status: SPEC — do not build until build 190 clears App Store review.**
Committed direction (2026-08-03): podcast narrative extractor. This spec
generalizes it: one ingestion pipeline, two source types (article RSS +
podcast RSS), one output table, two consumers (Coach context, Pulse).

Marketing hook: *"the coach that listens to every fantasy podcast and
reads every column so you don't have to."*

## Goals / non-goals

- **Goal**: structured, attributable, recency-weighted analyst takes per
  player, injected into the Coach's context for the user's rostered
  players and waiver targets.
- **Goal**: every take carries source + analyst + date → the Coach can
  say "Berry was pounding the table for X on Tuesday's show."
- **Non-goal**: reproducing content. We store *signals* (player, stance,
  one-line claim), never article text or transcript passages beyond the
  claim itself. This is both the legal posture and the token budget.
- **Non-goal**: model training. "Learning" = data pipeline + (later)
  analyst hit-rate weighting, same philosophy as rankings recency
  weighting.
- **Non-goal (explicit, decided 2026-08-03)**: TikTok ingestion. No
  legal API, low signal density; Sleeper trending already captures
  social sentiment as behavior.

## Sources

| Source | Type | Access | Notes |
|---|---|---|---|
| Fantasy Footballers | podcast RSS | public | highest volume/quality |
| The Ringer Fantasy Football Show | podcast RSS | public | |
| The Athletic Football Show / Fantasy pods | podcast RSS | **public** | podcasts only — **The Athletic articles are paywalled; scraping them is a ToS violation. Never ingest their articles.** |
| ESPN Fantasy Focus | podcast RSS | public | |
| Late Round Podcast / Rotoworld pod / etc. | podcast RSS | public | start with 5, registry makes adding trivial |
| ESPN fantasy articles | article RSS | public | feed already in `services/newsFeed.ts` |
| The Ringer NFL/fantasy | article RSS | public | |
| Yahoo Sports fantasy | article RSS | public | |
| NBC/Rotoworld player news | article RSS | public | PFT feed already wired |
| CBS fantasy | article RSS | public | feed already wired |

Rule of thumb: **RSS or don't ingest.** No headless browsing, no
paywall circumvention, no per-site scrapers to maintain.

## Schema (migration `2026XXXXXXXXXX_analyst_takes.sql`)

```sql
-- Source registry: adding a source is an INSERT, not a deploy.
create table content_sources (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('podcast','article')),
  name         text not null,                -- 'Fantasy Footballers'
  feed_url     text not null unique,
  enabled      boolean not null default true,
  weight       numeric not null default 1.0, -- manual source quality knob
  last_polled_at timestamptz,
  created_at   timestamptz not null default now()
);

-- One row per episode/article. Dedupe anchor + processing state.
create table content_items (
  id           uuid primary key default gen_random_uuid(),
  source_id    uuid not null references content_sources(id),
  guid         text not null,                -- RSS guid/link
  title        text not null,
  url          text,
  published_at timestamptz not null,
  status       text not null default 'pending'
               check (status in ('pending','transcribing','extracting','done','failed','skipped')),
  error        text,
  -- podcasts only; article body is fetched transiently, never stored
  audio_url    text,
  duration_s   int,
  created_at   timestamptz not null default now(),
  unique (source_id, guid)
);
create index on content_items (status, published_at desc);

-- The product: one row per (item, player, claim).
create table analyst_takes (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references content_items(id) on delete cascade,
  source_id    uuid not null references content_sources(id),
  player_name  text not null,                -- as spoken/written
  player_key   text not null,                -- normalizePlayerName() output
  sleeper_id   text,                         -- resolved vs nfl_players; null if ambiguous
  position     text,
  nfl_team     text,
  analyst      text,                         -- speaker/byline if identifiable
  stance       text not null check (stance in ('buy','sell','hold','injury','usage','situation')),
  claim        text not null,                -- ONE sentence, extractor-authored (not quoted)
  format_note  text,                         -- 'dynasty only', 'PPR spike', null
  confidence   numeric not null default 0.5, -- extractor's own certainty 0-1
  published_at timestamptz not null,         -- denormalized for the hot query
  created_at   timestamptz not null default now()
);
create index on analyst_takes (player_key, published_at desc);
create index on analyst_takes (published_at desc);

-- RLS: client SELECT only (gate by tier if takes become a paid feature);
-- all writes via service_role from edge functions. Mirror rankings-gate.
```

Retention: takes are stale opinions after ~3 weeks. Weekly cron deletes
`analyst_takes` older than 45 days and `content_items` older than 90.

## Edge functions (all on the existing chassis; deploy with `--use-api`)

### 1. `content-poll` (cron: every 2h)
- For each enabled source: fetch RSS, upsert new `content_items`
  (`pending`). Articles: store url. Podcasts: store `enclosure` audio
  url + duration. Reuse the RSS regex parsing already proven in
  `services/newsFeed.ts` (port to Deno).

### 2. `content-extract-articles` (cron: every 2h, offset 15m)
- Claim up to N pending article items (status flip → `extracting`,
  optimistic, retry-safe).
- Fetch article HTML → strip tags → cap ~15k chars (transient, never
  stored).
- One Haiku call per article with the extraction prompt below →
  insert `analyst_takes` rows → `done`.

### 3. `content-transcribe` (cron: hourly)
- Claim up to 2 pending podcast items (→ `transcribing`).
- OpenAI Whisper API (`whisper-1`, ~$0.006/min ≈ $0.36/hr episode).
  Chunk if >25MB (Whisper's upload cap): download, split by silence or
  fixed 20-min segments via ffmpeg-wasm, concat transcripts.
- Store transcript to a private storage bucket (`transcripts/`,
  service-role only) → status `extracting`.

### 4. `content-extract-podcasts` (cron: hourly, offset 15m)
- Transcript (may be 8-10k words) → chunk ~6k tokens with 200 overlap →
  Haiku per chunk → merge + dedupe rows (same player_key + stance →
  keep higher confidence) → insert → `done`, delete transcript object.

### 5. Name resolution (shared util, in-function)
- `player_key = normalizePlayerName(player_name)` (port
  `services/util/normalizeName.ts` to the shared Deno util).
- Resolve against `nfl_players` by normalized name (+ position when the
  extractor captured it). 0 matches or 2+ matches → `sleeper_id null`;
  such takes are Pulse-visible but never injected into Coach context
  (wrong-player injection is worse than no injection).

## Extraction prompt (Haiku, both paths)

System:

```
You extract fantasy-football-relevant player takes from {an article |
a podcast transcript segment}. Return ONLY JSON matching the schema.

Rules:
- One entry per (player, distinct claim). Skip players merely name-dropped.
- "claim" is ONE sentence IN YOUR OWN WORDS stating the take. Never
  quote the source text. No hedging filler.
- "stance": buy (positive outlook/acquire), sell (negative/move off),
  hold (neutral/wait), injury (health news changes value), usage
  (role/snaps/targets/touches change), situation (depth chart, coaching,
  scheme, contract context).
- "analyst": the speaker or byline if identifiable from context, else null.
- "format_note": only when the take is format-specific (dynasty,
  superflex, TE-premium, best ball, PPR-specific), else null.
- "confidence": how firmly the analyst commits. Throwaway line 0.3,
  reasoned argument 0.6, table-pounding conviction 0.9.
- No team defenses, no kickers, no retired players, no college players
  unless explicitly a dynasty stash take.
- Empty array if nothing qualifies. That is a fine answer.
```

Output schema (enforce via tool-use/JSON mode):

```json
{ "takes": [ {
  "player_name": "string",
  "position": "QB|RB|WR|TE|null",
  "nfl_team": "string|null",
  "analyst": "string|null",
  "stance": "buy|sell|hold|injury|usage|situation",
  "claim": "string",
  "format_note": "string|null",
  "confidence": 0.0
} ] }
```

## Coach injection (`app/(tabs)/coach.tsx`)

New block per league in `buildSystemPrompt`, alongside SCORING RULES:

```
ANALYST BUZZ (from podcasts/columns the last 14 days — attribute when used):
- Puka Nacua (WR LAR): BUY — "target share is elite even with Stafford
  variance" (Fantasy Footballers, Aug 5) [+2 similar]
- Rachaad White (RB TB): SELL — "Irving is taking the early-down work"
  (ESPN Fantasy Focus, Aug 4)
```

- Query: takes for the league's rostered `sleeper_id`s + current
  waiver-pool preload, `published_at > now() - 14d`, scored by
  `confidence × source.weight × exp(-age_days/7)`, cap **12 takes /
  ~600 tokens** per league (drop-lowest).
- Fetch via a `takes-for-players` edge function (POST sleeper_ids →
  rows) or PostgREST `in()` — either is fine; keep it one round-trip,
  piggybacked on the existing 10-min context cache load.
- Directive line: "Cite the analyst+source in one clause when a take
  influences your answer. Takes are opinions, not facts — weigh against
  the scoring rules and roster context, and say when analysts disagree."
- Feature-gate: takes context is a Pro-tier enrichment (cheap lever,
  aligns with "gate expensive AI, never visibility").

## Pulse consumer (later, cheap)

Daily job: players with ≥3 same-stance takes from distinct sources in
7 days → heat alert candidate ("3 analysts flipped on X this week").
Reuses `notification-heat-alerts` dedupe pattern.

## Costs (15 podcasts ≈ 45 eps/wk + ~200 articles/wk)

| Item | Est. |
|---|---|
| Whisper: 45 hr/wk × $0.36 | ~$16/mo |
| Haiku extraction (pods + articles) | ~$3-5/mo |
| Storage (transcripts, transient) | ~0 |
| **Total** | **~$20/mo** |

## Build order (post-review, ~1 week)

1. **Day 1**: migration + `content-poll` + seed 5 article sources.
2. **Day 2**: `content-extract-articles` + name resolution. *Takes
   exist in the DB by end of day 2.*
3. **Day 3**: Coach injection + directive + Pro gate. *User-visible.*
4. **Day 4-5**: `content-transcribe` + `content-extract-podcasts` +
   seed 5 podcast sources.
5. **Later**: Pulse heat integration; analyst hit-rate weighting
   (takes vs. subsequent actual production — the real "learning").

## Open decisions (decide at build time)

- Whisper vs Deepgram (Deepgram ~$0.0043/min, faster, speaker
  diarization → better `analyst` attribution; Whisper simpler).
- Scheduler: pg_cron vs external trigger — match whatever
  `nflverse-daily-sync` uses today.
- Whether takes also feed the rankings engine as a low-weight source
  (v8.x question — keep out of v1.1 scope).
