/**
 * NFL Fantasy Data Dictionary
 * ───────────────────────────
 * Universal reference injected into AI Coach system prompt.
 * Platform-agnostic — covers Sleeper, ESPN, Yahoo, and any data source.
 */

export const NFL_DATA_DICTIONARY = `
[NFL Fantasy Data Dictionary]

PLAYER INFO:
- position: QB, RB, WR, TE, K, DEF/DST
- depth: depth chart order (1=starter)
- active: on a roster or eligible to be
- star: high fantasy-relevance designation
- rookie: drafted in the current season
- injury: description of current injury
- injury_risk: low/medium/high probability of season impact
- game_status: active, questionable, doubtful, out, IR, PUP, suspended

SCORING & PROJECTIONS:
- proj_pts: projected fantasy points (standard scoring)
- proj_pts_ppr: projected points with point-per-reception
- proj_pts_high / proj_pts_low: ceiling and floor projections
- rank: overall fantasy ranking
- rank_position: ranking among same position (e.g. QB5, RB12)

AUCTION & DRAFT:
- auction_value: consensus fair bid price
- min_value: steal threshold (below = great value)
- max_value: overpay threshold (above = too expensive)
- ADP: average draft position across platforms
- ownership: projected roster ownership percentage

PASSING:
- passing_attempts: total pass attempts
- passing_completions: completed passes
- passing_yards: total passing yards
- passing_touchdowns: passing TDs
- passing_interceptions: INTs thrown
- completion_rate: completions / attempts

RUSHING:
- rushing_attempts (carries): total rush attempts
- rushing_yards: total rushing yards
- rushing_touchdowns: rushing TDs

RECEIVING:
- targets: times targeted by QB
- receptions (catches): completed receptions
- receiving_yards: total receiving yards
- receiving_touchdowns: receiving TDs

TOUCHDOWNS & TURNOVERS:
- fumbles: total fumbles
- fumbles_lost: fumbles lost to opponent
- defensive_touchdowns: TDs scored by defense/special teams
- return_td: kick/punt return touchdowns
- 2pt_conversion: successful 2-point conversions

KICKING:
- field_goals_made / field_goals_attempted: FGs by distance tier
- extra_points_made / extra_points_attempted: PATs
- missed_fg_penalty: points lost for missed FGs

DST (DEFENSE/SPECIAL TEAMS):
- sacks: total sacks
- interceptions: INTs caught by defense
- interception_touchdowns: pick-sixes
- fumbles_recovered: fumbles recovered by defense
- fumble_return_touchdowns: fumbles returned for TDs
- safeties: total safeties
- points_allowed: total points given up (scoring tiers)
- yards_allowed: total yards given up (scoring tiers)

IDP (INDIVIDUAL DEFENSIVE PLAYER):
- tackles: total tackles
- assists: assisted tackles
- tackles_loss: tackles for a loss
- sacks: individual sacks
- passes_defended: passes broken up
- interceptions: individual INTs
- fumbles_forced: forced fumbles

GAME & SCHEDULE:
- week: NFL week number
- season: NFL season year
- game_date: game date and time (Eastern)
- home_team / away_team: team codes
- home_score / away_score: final scores
- tv_station: broadcast channel
- playoff_week: 1=Wild Card, 2=Divisional, 3=Conference Championship, 4=Super Bowl

WEATHER (OUTDOOR GAMES):
- forecast: weather description
- high_temp / low_temp: temperature range
- wind_speed: wind in mph
- wind_chill: wind chill in °F

STANDINGS:
- wins / losses / ties: team record
- conference: AFC or NFC
- division: team division
- division_rank / conference_rank: standings position

SCORING FORMAT MODIFIERS:
- PPR: point per reception (0 / 0.5 / 1.0)
- TE Premium: bonus points per TE reception
- SuperFlex: allows QB in flex spot
- 4pt vs 6pt passing TD: drastically changes QB value
- bonus thresholds: 100yd rush/rec, 200yd rush/rec, 300yd pass, 400yd pass
`.trim();