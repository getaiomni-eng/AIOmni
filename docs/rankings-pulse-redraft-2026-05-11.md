# AIOmni Pulse — Redraft Rankings

*Generated 2026-05-11 12:11 UTC by running the AIOmni Pulse blend live against the same sources the app uses.*

## What this is

**AIOmni Pulse** = the AI-blended community-consensus rankings from the *AIOmni Pulse* tab. Implementation: `services/rankingsData.ts:fetchBlendedConsensus()`. This doc reproduces the blend offline by hitting the same source endpoints with the same weights.

**Sources & weights** (from `SOURCE_WEIGHTS.redraft`):

| Source | Weight | How fetched |
|---|---:|---|
| Sleeper | 24 | `api.sleeper.app/v1/players/nfl` (position-weighted by `search_rank`) |
| ESPN | 24 | `lm-api-reads.fantasy.espn.com` PPR default-league ADP |
| Yahoo | 24 | Supabase proxy `yahoo-rankings-proxy` (service-account) |
| MFL | 8 | Supabase proxy `mfl-adp-proxy?scoringRules={format}` |
| NFL.com | (12) | Stub — returns [] in the live code |
| Fleaflicker | (8) | Stub — returns [] in the live code |

Each player's final rank is a weighted average across the sources they appear in; missing-source weight is redistributed pro-rata. Per-format variation comes mainly via MFL (the only source that exposes a format-aware feed).

**Columns:** Pos# = rank within position · # = overall rank · S = number of sources containing this player (max 4) · Blended = weighted-average rank.

---

## Redraft — Full PPR (1.0 PPR) (`ppr`)

### Quarterbacks (QB)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Josh Allen | BUF | 15 | 4/4 | 16.90 |
| 2 | Drake Maye | NE | 23 | 4/4 | 24.50 |
| 3 | Lamar Jackson | BAL | 27 | 4/4 | 27.50 |
| 4 | Jayden Daniels | WAS | 33 | 4/4 | 33.00 |
| 5 | Joe Burrow | CIN | 38 | 4/4 | 40.30 |
| 6 | Jalen Hurts | PHI | 39 | 4/4 | 42.10 |
| 7 | Jaxson Dart | NYG | 52 | 4/4 | 54.50 |
| 8 | Caleb Williams | CHI | 60 | 4/4 | 64.20 |
| 9 | Trevor Lawrence | JAX | 65 | 4/4 | 71.10 |
| 10 | Justin Herbert | LAC | 66 | 4/4 | 71.50 |
| 11 | Brock Purdy | SF | 75 | 4/4 | 78.50 |
| 12 | Patrick Mahomes | KC | 76 | 4/4 | 79.20 |
| 13 | Dak Prescott | DAL | 77 | 4/4 | 79.20 |
| 14 | Bo Nix | DEN | 79 | 4/4 | 81.20 |
| 15 | Ty Simpson | LAR | 103 | 1/4 | 104.00 |
| 16 | Kyler Murray | MIN | 109 | 4/4 | 116.40 |
| 17 | Fernando Mendoza | LV | 115 | 3/4 | 120.57 |
| 18 | Jared Goff | DET | 116 | 4/4 | 120.60 |
| 19 | Jordan Love | GB | 118 | 4/4 | 122.00 |
| 20 | Baker Mayfield | TB | 120 | 4/4 | 122.60 |
| 21 | Matthew Stafford | LAR | 121 | 4/4 | 122.60 |
| 22 | Michael Penix Jr. | ATL | 124 | 1/4 | 123.00 |
| 23 | Tyler Shough | NO | 127 | 4/4 | 124.10 |
| 24 | Malik Willis | MIA | 144 | 4/4 | 140.10 |
| 25 | Aaron Rodgers | PIT | 146 | 1/4 | 141.00 |

### Running Backs (RB)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Bijan Robinson | ATL | 1 | 4/4 | 1.40 |
| 2 | Jahmyr Gibbs | DET | 3 | 4/4 | 3.00 |
| 3 | Jonathan Taylor | IND | 6 | 4/4 | 8.60 |
| 4 | Christian McCaffrey | SF | 7 | 4/4 | 9.10 |
| 5 | De'Von Achane | MIA | 10 | 4/4 | 12.50 |
| 6 | James Cook | BUF | 11 | 4/4 | 12.90 |
| 7 | Ashton Jeanty | LV | 13 | 4/4 | 14.90 |
| 8 | Jeremiyah Love | ARI | 16 | 4/4 | 20.40 |
| 9 | Saquon Barkley | PHI | 17 | 4/4 | 20.60 |
| 10 | Omarion Hampton | LAC | 20 | 4/4 | 22.30 |
| 11 | Chase Brown | CIN | 22 | 4/4 | 24.30 |
| 12 | Kenneth Walker | KC | 24 | 4/4 | 24.70 |
| 13 | Josh Jacobs | GB | 30 | 4/4 | 30.30 |
| 14 | Derrick Henry | BAL | 31 | 4/4 | 32.50 |
| 15 | Breece Hall | NYJ | 36 | 4/4 | 37.20 |
| 16 | Kyren Williams | LAR | 37 | 4/4 | 38.50 |
| 17 | Travis Etienne | NO | 40 | 4/4 | 42.70 |
| 18 | Javonte Williams | DAL | 42 | 4/4 | 43.20 |
| 19 | Bucky Irving | TB | 43 | 4/4 | 44.90 |
| 20 | Cam Skattebo | NYG | 47 | 4/4 | 50.00 |
| 21 | TreVeyon Henderson | NE | 53 | 4/4 | 55.60 |
| 22 | Quinshon Judkins | CLE | 55 | 4/4 | 56.70 |
| 23 | D'Andre Swift | CHI | 59 | 4/4 | 63.70 |
| 24 | Bhayshul Tuten | JAX | 63 | 4/4 | 65.20 |
| 25 | David Montgomery | HOU | 67 | 4/4 | 72.40 |

### Wide Receivers (WR)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Ja'Marr Chase | CIN | 2 | 4/4 | 2.80 |
| 2 | Puka Nacua | LAR | 4 | 4/4 | 5.50 |
| 3 | Jaxon Smith-Njigba | SEA | 5 | 4/4 | 6.30 |
| 4 | Amon-Ra St. Brown | DET | 8 | 4/4 | 10.10 |
| 5 | CeeDee Lamb | DAL | 9 | 4/4 | 10.60 |
| 6 | Justin Jefferson | MIN | 12 | 4/4 | 13.80 |
| 7 | Drake London | ATL | 14 | 4/4 | 16.60 |
| 8 | Malik Nabers | NYG | 18 | 4/4 | 20.70 |
| 9 | Nico Collins | HOU | 21 | 4/4 | 22.90 |
| 10 | Rashee Rice | KC | 25 | 4/4 | 24.70 |
| 11 | George Pickens | DAL | 28 | 4/4 | 27.60 |
| 12 | Chris Olave | NO | 29 | 4/4 | 30.10 |
| 13 | A.J. Brown | PHI | 32 | 4/4 | 32.90 |
| 14 | Tetairoa McMillan | CAR | 34 | 4/4 | 36.50 |
| 15 | Garrett Wilson | NYJ | 35 | 4/4 | 36.80 |
| 16 | Tee Higgins | CIN | 41 | 4/4 | 43.10 |
| 17 | DeVonta Smith | PHI | 44 | 4/4 | 45.10 |
| 18 | Zay Flowers | BAL | 45 | 4/4 | 46.60 |
| 19 | Jaylen Waddle | DEN | 48 | 4/4 | 50.90 |
| 20 | Ladd McConkey | LAC | 49 | 4/4 | 51.40 |
| 21 | Davante Adams | LAR | 50 | 4/4 | 52.10 |
| 22 | Luther Burden | CHI | 51 | 4/4 | 53.40 |
| 23 | Emeka Egbuka | TB | 54 | 4/4 | 55.80 |
| 24 | Terry McLaurin | WAS | 56 | 4/4 | 57.20 |
| 25 | Jameson Williams | DET | 57 | 4/4 | 58.10 |

### Tight Ends (TE)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Trey McBride | ARI | 19 | 4/4 | 22.00 |
| 2 | Brock Bowers | LV | 26 | 4/4 | 24.80 |
| 3 | Colston Loveland | CHI | 46 | 4/4 | 49.60 |
| 4 | Tyler Warren | IND | 62 | 4/4 | 64.70 |
| 5 | Harold Fannin | CLE | 82 | 4/4 | 82.30 |
| 6 | Kyle Pitts | ATL | 83 | 4/4 | 83.30 |
| 7 | Sam LaPorta | DET | 92 | 4/4 | 90.30 |
| 8 | Tucker Kraft | GB | 94 | 4/4 | 92.70 |
| 9 | Dallas Goedert | PHI | 106 | 4/4 | 108.70 |
| 10 | Travis Kelce | KC | 107 | 4/4 | 112.20 |
| 11 | Oronde Gadsden | LAC | 112 | 4/4 | 116.90 |
| 12 | Jake Ferguson | DAL | 113 | 4/4 | 118.40 |
| 13 | Dalton Kincaid | BUF | 125 | 4/4 | 123.30 |
| 14 | George Kittle | SF | 128 | 4/4 | 124.30 |
| 15 | Mark Andrews | BAL | 133 | 4/4 | 128.70 |
| 16 | Isaiah Likely | NYG | 136 | 4/4 | 133.10 |
| 17 | Juwan Johnson | NO | 151 | 4/4 | 144.90 |
| 18 | Hunter Henry | NE | 153 | 4/4 | 145.60 |
| 19 | Brenton Strange | JAX | 157 | 4/4 | 149.20 |
| 20 | Dalton Schultz | HOU | 165 | 3/4 | 153.86 |
| 21 | T.J. Hockenson | MIN | 168 | 4/4 | 155.60 |
| 22 | Kenyon Sadiq | NYJ | 169 | 4/4 | 156.00 |
| 23 | Jake Tonges | SFO | 184 | 1/4 | 163.00 |
| 24 | Eli Stowers | PHI | 185 | 2/4 | 164.00 |
| 25 | Colby Parkinson | LAR | 192 | 1/4 | 170.00 |

---

## Redraft — Half PPR (0.5 PPR) (`half`)

### Quarterbacks (QB)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Josh Allen | BUF | 15 | 4/4 | 16.90 |
| 2 | Drake Maye | NE | 23 | 4/4 | 24.50 |
| 3 | Lamar Jackson | BAL | 27 | 4/4 | 27.50 |
| 4 | Jayden Daniels | WAS | 33 | 4/4 | 33.00 |
| 5 | Joe Burrow | CIN | 38 | 4/4 | 40.30 |
| 6 | Jalen Hurts | PHI | 39 | 4/4 | 42.10 |
| 7 | Jaxson Dart | NYG | 52 | 4/4 | 54.50 |
| 8 | Caleb Williams | CHI | 60 | 4/4 | 64.20 |
| 9 | Trevor Lawrence | JAX | 65 | 4/4 | 71.10 |
| 10 | Justin Herbert | LAC | 66 | 4/4 | 71.50 |
| 11 | Brock Purdy | SF | 75 | 4/4 | 78.50 |
| 12 | Patrick Mahomes | KC | 76 | 4/4 | 79.20 |
| 13 | Dak Prescott | DAL | 77 | 4/4 | 79.20 |
| 14 | Bo Nix | DEN | 79 | 4/4 | 81.20 |
| 15 | Ty Simpson | LAR | 103 | 1/4 | 104.00 |
| 16 | Kyler Murray | MIN | 109 | 4/4 | 116.40 |
| 17 | Fernando Mendoza | LV | 115 | 3/4 | 120.57 |
| 18 | Jared Goff | DET | 116 | 4/4 | 120.60 |
| 19 | Jordan Love | GB | 118 | 4/4 | 122.00 |
| 20 | Baker Mayfield | TB | 120 | 4/4 | 122.60 |
| 21 | Matthew Stafford | LAR | 121 | 4/4 | 122.60 |
| 22 | Michael Penix Jr. | ATL | 124 | 1/4 | 123.00 |
| 23 | Tyler Shough | NO | 127 | 4/4 | 124.10 |
| 24 | Malik Willis | MIA | 144 | 4/4 | 140.10 |
| 25 | Aaron Rodgers | PIT | 146 | 1/4 | 141.00 |

### Running Backs (RB)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Bijan Robinson | ATL | 1 | 4/4 | 1.40 |
| 2 | Jahmyr Gibbs | DET | 3 | 4/4 | 3.00 |
| 3 | Jonathan Taylor | IND | 6 | 4/4 | 8.60 |
| 4 | Christian McCaffrey | SF | 7 | 4/4 | 9.10 |
| 5 | De'Von Achane | MIA | 10 | 4/4 | 12.50 |
| 6 | James Cook | BUF | 11 | 4/4 | 12.90 |
| 7 | Ashton Jeanty | LV | 13 | 4/4 | 14.90 |
| 8 | Jeremiyah Love | ARI | 16 | 4/4 | 20.40 |
| 9 | Saquon Barkley | PHI | 17 | 4/4 | 20.60 |
| 10 | Omarion Hampton | LAC | 20 | 4/4 | 22.30 |
| 11 | Chase Brown | CIN | 22 | 4/4 | 24.30 |
| 12 | Kenneth Walker | KC | 24 | 4/4 | 24.70 |
| 13 | Josh Jacobs | GB | 30 | 4/4 | 30.30 |
| 14 | Derrick Henry | BAL | 31 | 4/4 | 32.50 |
| 15 | Breece Hall | NYJ | 36 | 4/4 | 37.20 |
| 16 | Kyren Williams | LAR | 37 | 4/4 | 38.50 |
| 17 | Travis Etienne | NO | 40 | 4/4 | 42.70 |
| 18 | Javonte Williams | DAL | 42 | 4/4 | 43.20 |
| 19 | Bucky Irving | TB | 43 | 4/4 | 44.90 |
| 20 | Cam Skattebo | NYG | 47 | 4/4 | 50.00 |
| 21 | TreVeyon Henderson | NE | 53 | 4/4 | 55.60 |
| 22 | Quinshon Judkins | CLE | 55 | 4/4 | 56.70 |
| 23 | D'Andre Swift | CHI | 59 | 4/4 | 63.80 |
| 24 | Bhayshul Tuten | JAX | 63 | 4/4 | 65.20 |
| 25 | David Montgomery | HOU | 67 | 4/4 | 72.40 |

### Wide Receivers (WR)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Ja'Marr Chase | CIN | 2 | 4/4 | 2.80 |
| 2 | Puka Nacua | LAR | 4 | 4/4 | 5.50 |
| 3 | Jaxon Smith-Njigba | SEA | 5 | 4/4 | 6.30 |
| 4 | Amon-Ra St. Brown | DET | 8 | 4/4 | 10.10 |
| 5 | CeeDee Lamb | DAL | 9 | 4/4 | 10.60 |
| 6 | Justin Jefferson | MIN | 12 | 4/4 | 13.80 |
| 7 | Drake London | ATL | 14 | 4/4 | 16.60 |
| 8 | Malik Nabers | NYG | 18 | 4/4 | 20.70 |
| 9 | Nico Collins | HOU | 21 | 4/4 | 22.90 |
| 10 | Rashee Rice | KC | 25 | 4/4 | 24.70 |
| 11 | George Pickens | DAL | 28 | 4/4 | 27.60 |
| 12 | Chris Olave | NO | 29 | 4/4 | 30.10 |
| 13 | A.J. Brown | PHI | 32 | 4/4 | 32.90 |
| 14 | Tetairoa McMillan | CAR | 34 | 4/4 | 36.50 |
| 15 | Garrett Wilson | NYJ | 35 | 4/4 | 36.80 |
| 16 | Tee Higgins | CIN | 41 | 4/4 | 43.10 |
| 17 | DeVonta Smith | PHI | 44 | 4/4 | 45.10 |
| 18 | Zay Flowers | BAL | 45 | 4/4 | 46.60 |
| 19 | Jaylen Waddle | DEN | 48 | 4/4 | 50.90 |
| 20 | Ladd McConkey | LAC | 49 | 4/4 | 51.40 |
| 21 | Davante Adams | LAR | 50 | 4/4 | 52.00 |
| 22 | Luther Burden | CHI | 51 | 4/4 | 53.40 |
| 23 | Emeka Egbuka | TB | 54 | 4/4 | 55.80 |
| 24 | Terry McLaurin | WAS | 56 | 4/4 | 57.20 |
| 25 | Jameson Williams | DET | 57 | 4/4 | 58.10 |

### Tight Ends (TE)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Trey McBride | ARI | 19 | 4/4 | 22.00 |
| 2 | Brock Bowers | LV | 26 | 4/4 | 24.80 |
| 3 | Colston Loveland | CHI | 46 | 4/4 | 49.60 |
| 4 | Tyler Warren | IND | 62 | 4/4 | 64.70 |
| 5 | Harold Fannin | CLE | 82 | 4/4 | 82.30 |
| 6 | Kyle Pitts | ATL | 83 | 4/4 | 83.30 |
| 7 | Sam LaPorta | DET | 92 | 4/4 | 90.30 |
| 8 | Tucker Kraft | GB | 94 | 4/4 | 92.70 |
| 9 | Dallas Goedert | PHI | 106 | 4/4 | 108.70 |
| 10 | Travis Kelce | KC | 107 | 4/4 | 112.20 |
| 11 | Oronde Gadsden | LAC | 112 | 4/4 | 116.90 |
| 12 | Jake Ferguson | DAL | 113 | 4/4 | 118.40 |
| 13 | Dalton Kincaid | BUF | 125 | 4/4 | 123.30 |
| 14 | George Kittle | SF | 128 | 4/4 | 124.30 |
| 15 | Mark Andrews | BAL | 133 | 4/4 | 128.70 |
| 16 | Isaiah Likely | NYG | 136 | 4/4 | 133.10 |
| 17 | Juwan Johnson | NO | 151 | 4/4 | 144.90 |
| 18 | Hunter Henry | NE | 153 | 4/4 | 145.60 |
| 19 | Brenton Strange | JAX | 157 | 4/4 | 149.20 |
| 20 | Dalton Schultz | HOU | 165 | 3/4 | 153.86 |
| 21 | T.J. Hockenson | MIN | 168 | 4/4 | 155.60 |
| 22 | Kenyon Sadiq | NYJ | 169 | 4/4 | 156.00 |
| 23 | Jake Tonges | SFO | 184 | 1/4 | 163.00 |
| 24 | Eli Stowers | PHI | 185 | 2/4 | 164.00 |
| 25 | Colby Parkinson | LAR | 192 | 1/4 | 170.00 |

---

## Redraft — Standard (0 PPR) (`std`)

### Quarterbacks (QB)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Josh Allen | BUF | 16 | 3/4 | 18.67 |
| 2 | Drake Maye | NE | 27 | 3/4 | 26.67 |
| 3 | Lamar Jackson | BAL | 31 | 3/4 | 29.67 |
| 4 | Jayden Daniels | WAS | 33 | 3/4 | 35.67 |
| 5 | Joe Burrow | CIN | 43 | 3/4 | 43.67 |
| 6 | Jalen Hurts | PHI | 44 | 3/4 | 45.33 |
| 7 | Jaxson Dart | NYG | 57 | 3/4 | 57.67 |
| 8 | Caleb Williams | CHI | 65 | 3/4 | 70.00 |
| 9 | Trevor Lawrence | JAX | 73 | 3/4 | 76.00 |
| 10 | Justin Herbert | LAC | 74 | 3/4 | 77.00 |
| 11 | Brock Purdy | SF | 82 | 3/4 | 83.33 |
| 12 | Dak Prescott | DAL | 83 | 3/4 | 84.33 |
| 13 | Patrick Mahomes | KC | 85 | 3/4 | 85.33 |
| 14 | Bo Nix | DEN | 88 | 3/4 | 87.00 |
| 15 | Kyler Murray | MIN | 117 | 3/4 | 122.33 |
| 16 | Jared Goff | DET | 126 | 3/4 | 128.67 |
| 17 | Baker Mayfield | TB | 127 | 3/4 | 130.00 |
| 18 | Tyler Shough | NO | 128 | 3/4 | 130.00 |
| 19 | Matthew Stafford | LAR | 130 | 3/4 | 130.33 |
| 20 | Jordan Love | GB | 132 | 3/4 | 131.33 |
| 21 | Fernando Mendoza | LV | 133 | 2/4 | 131.50 |
| 22 | Malik Willis | MIA | 147 | 3/4 | 146.00 |
| 23 | C.J. Stroud | HOU | 153 | 3/4 | 151.33 |
| 24 | Daniel Jones | IND | 154 | 3/4 | 151.33 |
| 25 | Cam Ward | TEN | 155 | 3/4 | 151.67 |

### Running Backs (RB)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Bijan Robinson | ATL | 1 | 3/4 | 1.33 |
| 2 | Jahmyr Gibbs | DET | 3 | 3/4 | 3.00 |
| 3 | Jonathan Taylor | IND | 6 | 3/4 | 7.00 |
| 4 | Christian McCaffrey | SF | 7 | 3/4 | 7.00 |
| 5 | James Cook | BUF | 10 | 3/4 | 11.00 |
| 6 | De'Von Achane | MIA | 11 | 3/4 | 11.67 |
| 7 | Ashton Jeanty | LV | 13 | 3/4 | 15.00 |
| 8 | Saquon Barkley | PHI | 15 | 3/4 | 18.00 |
| 9 | Jeremiyah Love | ARI | 17 | 3/4 | 20.33 |
| 10 | Omarion Hampton | LAC | 19 | 3/4 | 21.33 |
| 11 | Kenneth Walker | KC | 21 | 3/4 | 22.33 |
| 12 | Chase Brown | CIN | 22 | 3/4 | 22.67 |
| 13 | Josh Jacobs | GB | 26 | 3/4 | 26.33 |
| 14 | Derrick Henry | BAL | 29 | 3/4 | 27.00 |
| 15 | Breece Hall | NYJ | 34 | 3/4 | 36.33 |
| 16 | Kyren Williams | LAR | 37 | 3/4 | 37.33 |
| 17 | Travis Etienne | NO | 38 | 3/4 | 39.33 |
| 18 | Javonte Williams | DAL | 39 | 3/4 | 40.00 |
| 19 | Bucky Irving | TB | 42 | 3/4 | 43.33 |
| 20 | Cam Skattebo | NYG | 48 | 3/4 | 48.33 |
| 21 | TreVeyon Henderson | NE | 54 | 3/4 | 56.00 |
| 22 | Quinshon Judkins | CLE | 55 | 3/4 | 56.33 |
| 23 | D'Andre Swift | CHI | 58 | 3/4 | 61.00 |
| 24 | Bhayshul Tuten | JAX | 60 | 3/4 | 62.00 |
| 25 | David Montgomery | HOU | 64 | 3/4 | 69.00 |

### Wide Receivers (WR)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Ja'Marr Chase | CIN | 2 | 3/4 | 2.67 |
| 2 | Puka Nacua | LAR | 4 | 3/4 | 5.33 |
| 3 | Jaxon Smith-Njigba | SEA | 5 | 3/4 | 6.33 |
| 4 | CeeDee Lamb | DAL | 8 | 3/4 | 9.67 |
| 5 | Amon-Ra St. Brown | DET | 9 | 3/4 | 10.00 |
| 6 | Justin Jefferson | MIN | 12 | 3/4 | 13.67 |
| 7 | Drake London | ATL | 14 | 3/4 | 15.67 |
| 8 | Malik Nabers | NYG | 18 | 3/4 | 21.00 |
| 9 | Nico Collins | HOU | 20 | 3/4 | 21.67 |
| 10 | Rashee Rice | KC | 24 | 3/4 | 23.33 |
| 11 | George Pickens | DAL | 28 | 3/4 | 26.67 |
| 12 | Chris Olave | NO | 30 | 3/4 | 28.67 |
| 13 | A.J. Brown | PHI | 32 | 3/4 | 31.33 |
| 14 | Garrett Wilson | NYJ | 35 | 3/4 | 36.33 |
| 15 | Tetairoa McMillan | CAR | 36 | 3/4 | 37.00 |
| 16 | Tee Higgins | CIN | 40 | 3/4 | 41.00 |
| 17 | DeVonta Smith | PHI | 41 | 3/4 | 43.00 |
| 18 | Zay Flowers | BAL | 45 | 3/4 | 45.33 |
| 19 | Jaylen Waddle | DEN | 46 | 3/4 | 48.00 |
| 20 | Davante Adams | LAR | 47 | 3/4 | 48.00 |
| 21 | Ladd McConkey | LAC | 49 | 3/4 | 50.33 |
| 22 | Luther Burden | CHI | 51 | 3/4 | 51.67 |
| 23 | Terry McLaurin | WAS | 52 | 3/4 | 54.00 |
| 24 | Jameson Williams | DET | 53 | 3/4 | 55.67 |
| 25 | Emeka Egbuka | TB | 56 | 3/4 | 57.33 |

### Tight Ends (TE)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Trey McBride | ARI | 23 | 3/4 | 22.67 |
| 2 | Brock Bowers | LV | 25 | 3/4 | 25.67 |
| 3 | Colston Loveland | CHI | 50 | 3/4 | 50.67 |
| 4 | Tyler Warren | IND | 63 | 3/4 | 66.33 |
| 5 | Harold Fannin | CLE | 81 | 3/4 | 83.00 |
| 6 | Kyle Pitts | ATL | 84 | 3/4 | 84.33 |
| 7 | Sam LaPorta | DET | 93 | 3/4 | 91.00 |
| 8 | Tucker Kraft | GB | 98 | 3/4 | 94.67 |
| 9 | Dallas Goedert | PHI | 105 | 3/4 | 103.67 |
| 10 | Travis Kelce | KC | 106 | 3/4 | 111.67 |
| 11 | Oronde Gadsden | LAC | 111 | 3/4 | 118.00 |
| 12 | Jake Ferguson | DAL | 112 | 3/4 | 118.00 |
| 13 | Dalton Kincaid | BUF | 121 | 3/4 | 124.33 |
| 14 | George Kittle | SF | 123 | 3/4 | 126.00 |
| 15 | Mark Andrews | BAL | 131 | 3/4 | 130.67 |
| 16 | Isaiah Likely | NYG | 134 | 3/4 | 132.67 |
| 17 | Hunter Henry | NE | 145 | 3/4 | 145.00 |
| 18 | Juwan Johnson | NO | 146 | 3/4 | 145.67 |
| 19 | Brenton Strange | JAX | 150 | 3/4 | 149.33 |
| 20 | Dalton Schultz | HOU | 158 | 2/4 | 154.50 |
| 21 | T.J. Hockenson | MIN | 161 | 3/4 | 155.33 |
| 22 | Kenyon Sadiq | NYJ | 174 | 3/4 | 162.00 |
| 23 | Colby Parkinson | LAR | 182 | 1/4 | 170.00 |
| 24 | Mason Taylor | NYJ | 188 | 1/4 | 175.00 |
| 25 | AJ Barner | SEA | 190 | 2/4 | 176.00 |

---

## Redraft — SuperFlex / 2QB (Full PPR) (`superflex`)

### Quarterbacks (QB)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Josh Allen | BUF | 15 | 4/4 | 16.90 |
| 2 | Drake Maye | NE | 23 | 4/4 | 24.50 |
| 3 | Lamar Jackson | BAL | 27 | 4/4 | 27.50 |
| 4 | Jayden Daniels | WAS | 33 | 4/4 | 33.00 |
| 5 | Joe Burrow | CIN | 38 | 4/4 | 40.30 |
| 6 | Jalen Hurts | PHI | 39 | 4/4 | 42.10 |
| 7 | Jaxson Dart | NYG | 52 | 4/4 | 54.50 |
| 8 | Caleb Williams | CHI | 60 | 4/4 | 64.20 |
| 9 | Trevor Lawrence | JAX | 65 | 4/4 | 71.10 |
| 10 | Justin Herbert | LAC | 66 | 4/4 | 71.50 |
| 11 | Brock Purdy | SF | 75 | 4/4 | 78.50 |
| 12 | Patrick Mahomes | KC | 76 | 4/4 | 79.20 |
| 13 | Dak Prescott | DAL | 77 | 4/4 | 79.20 |
| 14 | Bo Nix | DEN | 79 | 4/4 | 81.20 |
| 15 | Ty Simpson | LAR | 103 | 1/4 | 104.00 |
| 16 | Kyler Murray | MIN | 109 | 4/4 | 116.40 |
| 17 | Fernando Mendoza | LV | 115 | 3/4 | 120.57 |
| 18 | Jared Goff | DET | 116 | 4/4 | 120.60 |
| 19 | Jordan Love | GB | 118 | 4/4 | 122.00 |
| 20 | Baker Mayfield | TB | 120 | 4/4 | 122.60 |
| 21 | Matthew Stafford | LAR | 121 | 4/4 | 122.60 |
| 22 | Michael Penix Jr. | ATL | 124 | 1/4 | 123.00 |
| 23 | Tyler Shough | NO | 127 | 4/4 | 124.10 |
| 24 | Malik Willis | MIA | 144 | 4/4 | 140.10 |
| 25 | Aaron Rodgers | PIT | 146 | 1/4 | 141.00 |

### Running Backs (RB)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Bijan Robinson | ATL | 1 | 4/4 | 1.40 |
| 2 | Jahmyr Gibbs | DET | 3 | 4/4 | 3.00 |
| 3 | Jonathan Taylor | IND | 6 | 4/4 | 8.60 |
| 4 | Christian McCaffrey | SF | 7 | 4/4 | 9.10 |
| 5 | De'Von Achane | MIA | 10 | 4/4 | 12.50 |
| 6 | James Cook | BUF | 11 | 4/4 | 12.90 |
| 7 | Ashton Jeanty | LV | 13 | 4/4 | 14.90 |
| 8 | Jeremiyah Love | ARI | 16 | 4/4 | 20.40 |
| 9 | Saquon Barkley | PHI | 17 | 4/4 | 20.60 |
| 10 | Omarion Hampton | LAC | 20 | 4/4 | 22.30 |
| 11 | Chase Brown | CIN | 22 | 4/4 | 24.30 |
| 12 | Kenneth Walker | KC | 24 | 4/4 | 24.70 |
| 13 | Josh Jacobs | GB | 30 | 4/4 | 30.30 |
| 14 | Derrick Henry | BAL | 31 | 4/4 | 32.50 |
| 15 | Breece Hall | NYJ | 36 | 4/4 | 37.20 |
| 16 | Kyren Williams | LAR | 37 | 4/4 | 38.50 |
| 17 | Travis Etienne | NO | 40 | 4/4 | 42.70 |
| 18 | Javonte Williams | DAL | 42 | 4/4 | 43.20 |
| 19 | Bucky Irving | TB | 43 | 4/4 | 44.90 |
| 20 | Cam Skattebo | NYG | 47 | 4/4 | 50.00 |
| 21 | TreVeyon Henderson | NE | 53 | 4/4 | 55.60 |
| 22 | Quinshon Judkins | CLE | 55 | 4/4 | 56.70 |
| 23 | D'Andre Swift | CHI | 59 | 4/4 | 63.70 |
| 24 | Bhayshul Tuten | JAX | 63 | 4/4 | 65.20 |
| 25 | David Montgomery | HOU | 67 | 4/4 | 72.40 |

### Wide Receivers (WR)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Ja'Marr Chase | CIN | 2 | 4/4 | 2.80 |
| 2 | Puka Nacua | LAR | 4 | 4/4 | 5.50 |
| 3 | Jaxon Smith-Njigba | SEA | 5 | 4/4 | 6.30 |
| 4 | Amon-Ra St. Brown | DET | 8 | 4/4 | 10.10 |
| 5 | CeeDee Lamb | DAL | 9 | 4/4 | 10.60 |
| 6 | Justin Jefferson | MIN | 12 | 4/4 | 13.80 |
| 7 | Drake London | ATL | 14 | 4/4 | 16.60 |
| 8 | Malik Nabers | NYG | 18 | 4/4 | 20.70 |
| 9 | Nico Collins | HOU | 21 | 4/4 | 22.90 |
| 10 | Rashee Rice | KC | 25 | 4/4 | 24.70 |
| 11 | George Pickens | DAL | 28 | 4/4 | 27.60 |
| 12 | Chris Olave | NO | 29 | 4/4 | 30.10 |
| 13 | A.J. Brown | PHI | 32 | 4/4 | 32.90 |
| 14 | Tetairoa McMillan | CAR | 34 | 4/4 | 36.50 |
| 15 | Garrett Wilson | NYJ | 35 | 4/4 | 36.80 |
| 16 | Tee Higgins | CIN | 41 | 4/4 | 43.10 |
| 17 | DeVonta Smith | PHI | 44 | 4/4 | 45.10 |
| 18 | Zay Flowers | BAL | 45 | 4/4 | 46.60 |
| 19 | Jaylen Waddle | DEN | 48 | 4/4 | 50.90 |
| 20 | Ladd McConkey | LAC | 49 | 4/4 | 51.40 |
| 21 | Davante Adams | LAR | 50 | 4/4 | 52.10 |
| 22 | Luther Burden | CHI | 51 | 4/4 | 53.40 |
| 23 | Emeka Egbuka | TB | 54 | 4/4 | 55.80 |
| 24 | Terry McLaurin | WAS | 56 | 4/4 | 57.20 |
| 25 | Jameson Williams | DET | 57 | 4/4 | 58.10 |

### Tight Ends (TE)

| Pos# | Player | Team | # | S | Blended |
|---:|---|:-:|---:|:-:|---:|
| 1 | Trey McBride | ARI | 19 | 4/4 | 22.00 |
| 2 | Brock Bowers | LV | 26 | 4/4 | 24.80 |
| 3 | Colston Loveland | CHI | 46 | 4/4 | 49.60 |
| 4 | Tyler Warren | IND | 62 | 4/4 | 64.70 |
| 5 | Harold Fannin | CLE | 82 | 4/4 | 82.30 |
| 6 | Kyle Pitts | ATL | 83 | 4/4 | 83.30 |
| 7 | Sam LaPorta | DET | 92 | 4/4 | 90.30 |
| 8 | Tucker Kraft | GB | 94 | 4/4 | 92.70 |
| 9 | Dallas Goedert | PHI | 106 | 4/4 | 108.70 |
| 10 | Travis Kelce | KC | 107 | 4/4 | 112.20 |
| 11 | Oronde Gadsden | LAC | 112 | 4/4 | 116.90 |
| 12 | Jake Ferguson | DAL | 113 | 4/4 | 118.40 |
| 13 | Dalton Kincaid | BUF | 125 | 4/4 | 123.30 |
| 14 | George Kittle | SF | 128 | 4/4 | 124.30 |
| 15 | Mark Andrews | BAL | 133 | 4/4 | 128.70 |
| 16 | Isaiah Likely | NYG | 136 | 4/4 | 133.10 |
| 17 | Juwan Johnson | NO | 151 | 4/4 | 144.90 |
| 18 | Hunter Henry | NE | 153 | 4/4 | 145.60 |
| 19 | Brenton Strange | JAX | 157 | 4/4 | 149.20 |
| 20 | Dalton Schultz | HOU | 165 | 3/4 | 153.86 |
| 21 | T.J. Hockenson | MIN | 168 | 4/4 | 155.60 |
| 22 | Kenyon Sadiq | NYJ | 169 | 4/4 | 156.00 |
| 23 | Jake Tonges | SFO | 184 | 1/4 | 163.00 |
| 24 | Eli Stowers | PHI | 185 | 2/4 | 164.00 |
| 25 | Colby Parkinson | LAR | 192 | 1/4 | 170.00 |

---
