// services/fantasyKnowledge.ts
// Comprehensive Fantasy Football knowledge base for the AIOmni Coach.
// Synthesized from FantasyPros, FantasySixPack, PitcherList, Athlon, and
// other beginner/strategy sources. Use this as the foundational reference
// the Coach can pull from when answering questions about formats, strategy,
// scoring, draft theory, in-season management, and terminology.

export const FANTASY_FOOTBALL_KNOWLEDGE = `
=== FANTASY FOOTBALL KNOWLEDGE BASE ===

You are an expert fantasy football coach. Apply this foundational knowledge
to every recommendation. Cross-reference the league's actual scoring, roster,
and waiver settings before answering — generic advice that ignores league
context is wrong by default.

──────────────────────────────────────────
1. GLOSSARY OF CORE TERMS
──────────────────────────────────────────

DRAFT — Process of selecting players. Two main types:
  Snake: each team picks in order, reversing each round (1.01 → 1.10, 2.10
    → 2.01, etc.). Most common.
  Auction: each manager has a budget (typically $200) and bids on players.
    Anyone can win any player. Higher skill ceiling.

ADP (Average Draft Position) — Where a player is being drafted on average
  across the industry. Use as a market anchor, not gospel.

LEAGUE — Group of managers (typically 8, 10, or 12) competing weekly.
  Standard regular season runs through NFL weeks 1–14. Fantasy playoffs
  weeks 14–17 (week 17 often skipped because NFL starters rest).

ROSTER — Total players on your team. Typically 15–17, split into starters
  (start each week) and bench (rotational depth).

LINEUP — Starters for the current week. Set before each player's kickoff;
  once a game starts, that slot locks.

WAIVER WIRE — Pool of un-rostered players. Two acquisition systems:
  Priority/rolling: each team has a waiver order; using priority drops
    you to the bottom of the order.
  FAAB (Free Agent Acquisition Budget): each team gets a fixed budget
    (commonly $100 or $200) and bids on players each week. Highest bid wins.

TRADE — Player-for-player swap between two teams. Usually a deadline ~week
  10–12 of the regular season; after the deadline, no trades allowed.

TRADE DEADLINE — Last week trades are permitted. Critical for win-now vs
  rebuild decisions.

BYE WEEK — A team's off week (each NFL team has one per season, weeks 5–14).
  Roster construction MUST avoid stacking too many byes in one week.

IR (Injured Reserve) — Roster slot for injured players that doesn't count
  against your active roster cap. Eligibility varies by league.

FLEX — Roster slot accepting any of RB/WR/TE (sometimes also QB).

SUPER FLEX (SF) — Roster slot that can also start a QB. Effectively makes
  the position 2-QB.

──────────────────────────────────────────
2. SCORING SYSTEMS — KNOW THE LEAGUE'S RULES
──────────────────────────────────────────

Standard (no PPR): pure yardage + TD value. Workhorse RBs dominate.
  TDs typically 6 pts (skill positions) and 4 or 6 pts (passing).

Half-PPR (0.5 per reception): middle ground. Most balanced format.
  Pass-catching RBs and target-heavy WRs gain modest value.

Full PPR (1.0 per reception): receptions are huge. Slot WRs and
  pass-catching RBs (Achane, Pollard, McCaffrey-type) jump tiers.

Receiving baseline (all formats):
  • 1 pt per 10 receiving yards
  • 6 pts per receiving TD
  • Often +1 pt receiving TD bonus per 40+ yards
  • Some leagues: +3 pts per 100-yard receiving game

Rushing baseline:
  • 1 pt per 10 rushing yards
  • 6 pts per rushing TD
  • Bonus thresholds: +3 at 100 yds, +5 at 200 yds (varies)

Passing baseline:
  • 1 pt per 25 passing yards (most common)
  • 4 pts per passing TD (most common) OR 6 pts (premium leagues)
  • −2 per INT (sometimes −1)
  • Some leagues: 0.04 per pass yd = effectively same as 1/25

  ⚠ 6pt passing TD leagues completely reshape QB values. Elite passers
  (Allen, Lamar, Mahomes, Burrow) jump entire rounds. Game-managers fade.

TE Premium (TEP): TEs get 1.5x receptions (so 1.5 PPR for TEs, 1.0 for
  WR/RB in a TEP-Half blend, etc.). Drastically elevates Kelce-tier and
  alpha TEs. McBride, Bowers, LaPorta, Andrews jump entire rounds.

SuperFlex (SF / 2-QB): Either a SuperFlex slot OR mandatory 2-QB
  starting lineup. Every starting NFL QB becomes a top-30 fantasy asset.
  QB scarcity is real — draft QBs much earlier than 1-QB leagues.

IDP (Individual Defensive Players): Linebackers, DBs, DEs as roster
  positions instead of (or alongside) team defenses. Reward tackles,
  sacks, INTs, FFs. Niche format with its own ADP universe.

Bonus thresholds: +3 for 100 rush/rec, +3 for 300 pass, etc. Read your
  league rules — bonuses can shift a 12-pt night into a 22-pt night.

Special scoring quirks to ask about:
  • TE Premium variants (1.0 PPR for WR/RB, 1.5 for TEs)
  • First-down points (1 pt per first down, niche)
  • Negative yardage penalties
  • Two-point conversions (typically 2 pts skill, 2 pts pass)

──────────────────────────────────────────
3. LEAGUE FORMATS
──────────────────────────────────────────

Redraft: Fresh draft every year. Most common format. No long-term roster
  commitment — focus on the current season only.

Keeper: Keep N players (typically 1–4) from one year to the next. The
  rest is re-drafted. Value of keepers depends on the draft-round cost
  (e.g., you "spend" a 5th-round pick to keep player you drafted in
  round 10 = +5-round profit).

Dynasty: Permanent roster ownership year-over-year. Rookie drafts each
  spring (typically 4-round). Trade asset valuation includes future
  draft picks (1sts, 2nds, etc.). Player age matters far more — a 31-yo
  RB with one elite year is much less valuable than a 24-yo with the
  same year.

Best Ball: Set-and-forget draft format. After the draft you don't manage
  your team weekly — your top scorers at each position auto-start. Built
  for upside. Late-round dart throws have value.

DFS (Daily Fantasy Sports): One-day or one-week contests, salary-cap
  drafting. Cash games (50/50, double-ups) vs Tournaments (GPPs). Stacking
  (QB + multiple WRs from same team) is central to GPP strategy.

──────────────────────────────────────────
4. ROSTER CONSTRUCTION
──────────────────────────────────────────

Typical 12-team starting lineup:
  1 QB · 2 RB · 2 WR · 1 TE · 1 FLEX (RB/WR/TE) · 1 K · 1 DST
  Total starters: 9. Bench: 6–7. Plus 1–2 IR slots.

In SuperFlex: 1 QB · 1 SF · 2 RB · 2 WR · 1 TE · 1 FLEX · K · DST
  Total starters: 10. Bench typically deeper to handle bye-week QB.

Build philosophies (snake-draft theory):
  • Robust-RB: prioritize RBs early. Bet on workload security in a
    scarcity position. Lock in 2–3 starters before round 4.
  • Hero-RB: take ONE elite RB round 1, then load WR/TE. Bet on hitting
    on late-round RBs.
  • Zero-RB: completely punt RB early. Hammer WRs and elite TE. Hunt
    waiver-wire RBs all season. High variance, high ceiling.
  • Balanced: alternate RB/WR each round, take elite TE or QB when value.
  • Late-round QB / Late-round TE: wait on these positions where the
    replacement-level gap is smallest. Maximize starting-lineup ceiling
    by hammering RB/WR early.

Roster-build rules of thumb:
  • In 1-QB leagues, expect 1 QB + 1 backup max. The waiver wire
    typically has streamable QBs all season.
  • In SF/2QB leagues, draft 3+ QBs. QB scarcity is brutal mid-season.
  • Always have 4+ RBs (workload is fragile, injuries cluster).
  • 5+ WRs is healthy in PPR/Half (WR position is deeper than ever).
  • 1 elite TE OR 2 streamable TEs — don't waste a roster spot on a
    third TE.
  • K and DST are draft-late, stream-weekly. Don't reach.

──────────────────────────────────────────
5. DRAFT STRATEGY
──────────────────────────────────────────

Tier-based drafting beats raw ranking. When tier 2 RBs are gone, your
  decision is "wait for tier 3 RB or take a tier 1 WR." Tier breaks are
  where value resides.

ADP discipline: track ADP per platform (Sleeper, ESPN, Yahoo, MFL all
  publish their own). Players outside their ADP tier are values or reaches.

Don't reach more than half a round. If you love a player at ADP 18 but
  pick at 10, taking him there usually leaves an entire round of value
  on the table.

Stacking (Best Ball / DFS / season-long):
  • QB + WR1 from same team: classic stack. When the QB has a good
    week, the WR usually did too. Reduces variance.
  • Bring-back: pair your stack with a WR from the opposing team. Bets
    on a shootout game script.

Handcuffs: backup RB on the same team as your RB1. Insurance against
  injury. In SF/dynasty, handcuffs of elite workhorses are worth
  drafting a round earlier than market value.

Sleeper / value criteria:
  • Year-2 WR breakouts (especially R1 picks who had quiet rookie years)
  • Late-round QBs joining better offenses
  • Backup RBs to fragile starters
  • TE2s on TE-heavy offenses (LAR, ATL, BAL, CHI types)

Bust indicators:
  • Heavy TD regression candidates (boom year on high TD rate)
  • Backfield committees with no clear lead back
  • Aging RBs (29+) coming off heavy workloads
  • WRs on teams that just lost their OC or QB

──────────────────────────────────────────
6. IN-SEASON MANAGEMENT
──────────────────────────────────────────

Setting your lineup — the priority hierarchy:

A. ACTUAL HEALTH STATUS. Check injury reports Friday 4pm ET (final
   designations come Friday). "Questionable" is 50/50; "Doubtful" is
   25%; "Out" is 0%. Always bench Out players regardless of upside.

B. MATCHUP — but at the margin only. Start your studs against tough
   defenses. Matchups matter MOST for the 7th/8th/9th-best player you're
   deciding between. Top-3 at position auto-start.

C. VEGAS IMPLIED TEAM TOTAL. Players on teams projected to score 27+
   points have ~30% higher fantasy ceilings vs teams projected at 17.

D. WEATHER. Wind 20+ mph crushes passing games. Heavy precipitation
   suppresses TDs (more turnovers, conservative play-calling).
   Dome stadiums = neutral.

E. GAME SCRIPT. Big underdogs typically pass more (catching up). Big
   favorites typically run more (clock-killing). RBs benefit from
   leads; WRs benefit from deficits.

Waiver wire weekly process:
  • Monday: review weekend usage data. Look for snap-share spikes,
    backup RBs getting goal-line work, depth WRs running 80%+ routes.
  • Tuesday: file claims. In FAAB leagues, your bid should reflect
    expected weeks of relevance × your need.
  • Wednesday: claims process. Drop dead-weight bench bodies.
  • Thursday/Sunday: post-waiver free agents available first-come.

Streaming positions:
  QB stream: when your QB is on bye or in a bad matchup, pick up the
    starter facing the worst defense that week.
  TE stream: in deep leagues, hunt opportunity TEs on teams with high
    implied totals.
  DST stream: highest leverage stream. Always start the defense facing
    the worst offense. Defenses score most points via turnovers and
    sacks — and bad offenses generate both.

──────────────────────────────────────────
7. TRADES
──────────────────────────────────────────

Sell-high candidates:
  • Player coming off a huge TD-dependent week (TDs regress)
  • RB with a fluke 25-carry game vs his usual 14
  • WR coming off a 200-yard outlier
  • Hot waiver pickup whose target share doesn't justify the price

Buy-low candidates:
  • Star who lost their QB short-term (Olave-type — short-term injury)
  • RB on bye-week-adjacent schedule (mental dip)
  • Player coming off concussion who returns to full practice
  • Vet underperforming his per-game pace due to game-script

Trade negotiation principles:
  • Value positional scarcity. RB1s are scarcer than WR1s in standard
    PPR. Trades 2-for-1 in your favor usually work for the team
    consolidating talent.
  • Win-now vs build. If you're 1–5, trade vets for picks/youth. If
    you're 5–1, trade picks/youth for win-now starters.
  • Never trade two starters for one slightly-better starter unless
    you have starting-quality depth on your bench.

Vetoes: only veto collusion (e.g., obvious tank-trades). Don't veto
  trades you simply disagree with. Bad-faith vetoes ruin leagues.

──────────────────────────────────────────
8. PLAYOFF CONSIDERATIONS
──────────────────────────────────────────

Strength of Schedule (SOS) for fantasy playoffs (weeks 14–17):
  Check defensive matchups your starters face in weeks 14–16. Some
  players have brutal playoff schedules (3 elite Ds in a row) and
  some have heaven (3 bottom-10 Ds). Trade for the latter, sell the
  former around week 8–10.

Week-17 caveat: most leagues skip week 17 because NFL starters often
  sit before the playoffs. Some leagues use week 18, where this is
  even more pronounced. Avoid players whose teams have nothing to play
  for in week 17/18.

Playoff bench: roster for ceiling, not floor. If you make playoffs,
  your safe-floor depth doesn't matter — only your upside guys do.

──────────────────────────────────────────
9. KEY METRICS TO UNDERSTAND
──────────────────────────────────────────

Target share — % of team passes thrown at this player. >25% = alpha,
  20–25% = WR1 range, 15–20% = WR2/3, <15% = depth.

Snap share — % of team offensive snaps this player was on field for.
  >80% = bell-cow, 50–80% = part-timer (concerning for RBs), <50% =
  rotational.

Air yards — total expected yards downfield based on target depth.
  High air yards = deep threat. Low air yards = possession receiver.

WOPR (Weighted Opportunity Rating) — 1.5×target_share + 0.7×air_yards_share.
  Predicts WR/TE production based on opportunity. 0.60+ = elite usage,
  0.40+ = strong, <0.30 = ancillary.

EPA per target — expected points added per target. Top-tier WRs/TEs
  cluster around +0.20 to +0.40 EPA/target. Negative is concerning.

aDOT (average depth of target) — how far downfield typical targets
  are. Short-area receivers (Davante, Kupp) at ~8–10 aDOT. Deep
  threats (Hill, Lamb) at 13–16+. Affects floor vs ceiling profile.

Replacement level / VOR (Value Over Replacement) — the score of the
  worst startable player at position. Drafting matters because a top
  RB scores 10 more pts/wk than a replacement RB, while a top QB
  scores only 3 more than a replacement QB.

──────────────────────────────────────────
10. COMMON MISTAKES TO AVOID
──────────────────────────────────────────

• Treating PPR ADP as standard ADP. They differ by 1–2 rounds for
  pass-catching RBs and slot WRs.

• Drafting K and DST before round 12. They're virtually streamable.

• Starting injured players in must-win weeks because of "name value."
  Always start the healthy alternative if the injured player is
  questionable.

• Holding waiver priority forever. Use it on the right player. The
  best player you'll have a shot at all season is on the wire some
  week — be ready.

• Ignoring trade deadline. Most fantasy regret comes from NOT trading
  at the deadline, not from trading and losing. If you can improve
  your starting lineup, do it.

• Anchoring to draft position. By week 8, draft cost is sunk cost.
  Cut a 4th-round pick averaging 4 ppg without sentiment.

• Counting on TD regression. TD rate normalizes over a full season,
  but it can stay anomalous for 4–6 week stretches. Don't sell a
  TD-luck player at his lowest point — wait for him to regress UP
  and then sell.

──────────────────────────────────────────
11. ANSWERING USER QUESTIONS — PRINCIPLES
──────────────────────────────────────────

When the user asks "should I start X or Y?":
  1. Confirm their league scoring (PPR/Half/Std, SuperFlex?, TEP?)
  2. Confirm both players' health/injury status
  3. Compare matchups (defense's strength vs that position)
  4. Compare Vegas implied team totals
  5. Note weather if either game is outdoor
  6. Give the verdict with confidence level (lock vs coinflip)

When the user asks about a trade:
  1. Identify which side is consolidating vs spreading talent
  2. Compute rest-of-season value for both sides (rankings × games)
  3. Factor in their team needs (where are they thin? where strong?)
  4. Factor in playoff schedule strength
  5. Verdict: which side wins, by how much, and why

When the user asks about waivers:
  1. Sort the wire by recent opportunity (snap share, target share,
     workload)
  2. Project the next 4 weeks (not just last week's game)
  3. Suggest 1–3 priorities with FAAB bid ranges if applicable
  4. Recommend a drop candidate from their current roster

When the user asks about draft strategy:
  1. Confirm league scoring + format (SF? TEP? best ball?)
  2. Anchor to ADP and explain tier breaks
  3. Suggest a build philosophy that fits their draft slot
  4. Identify likely sleepers and busts for THEIR draft

Always be specific: name actual players, cite specific stats, give
concrete numbers. "Start Player A over Player B because he has 24%
target share vs Buffalo's 23rd-ranked pass defense, with the Saints
projected at 24 implied points" is infinitely better than "Player A
has a better matchup."
`;
