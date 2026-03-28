// services/liveData.ts
// Live data layer — NFL injuries, weather, Vegas lines, advanced stats, college prospects
// Injected into every AI Coach prompt before Claude responds

// ─── API KEYS ─────────────────────────────────────────────────────────────────
const ODDS_API_KEY    = '1dc3181b24294523fb9a75fda64bd6b6';
const WEATHER_API_KEY = '33088c749184a0c3277f533351c3b649';
const CFBD_API_KEY    = 'FXYJqCTsSGNxj67UAcWxd6pDdgYZ15hvXE/WscfGOnUW09lvRDEvZe/xngs/bMuo';

// ─── NFL Stadium Locations ────────────────────────────────────────────────────
const NFL_STADIUMS: Record<string, { city: string; lat: number; lon: number; dome: boolean }> = {
  ARI: { city: 'Glendale, AZ',       lat: 33.5277, lon: -112.2626, dome: true  },
  ATL: { city: 'Atlanta, GA',         lat: 33.7553, lon: -84.4006,  dome: true  },
  BAL: { city: 'Baltimore, MD',       lat: 39.2780, lon: -76.6227,  dome: false },
  BUF: { city: 'Orchard Park, NY',    lat: 42.7738, lon: -78.7870,  dome: false },
  CAR: { city: 'Charlotte, NC',       lat: 35.2258, lon: -80.8528,  dome: false },
  CHI: { city: 'Chicago, IL',         lat: 41.8623, lon: -87.6167,  dome: false },
  CIN: { city: 'Cincinnati, OH',      lat: 39.0955, lon: -84.5160,  dome: false },
  CLE: { city: 'Cleveland, OH',       lat: 41.5061, lon: -81.6995,  dome: false },
  DAL: { city: 'Arlington, TX',       lat: 32.7473, lon: -97.0945,  dome: true  },
  DEN: { city: 'Denver, CO',          lat: 39.7439, lon: -105.0201, dome: false },
  DET: { city: 'Detroit, MI',         lat: 42.3400, lon: -83.0456,  dome: true  },
  GB:  { city: 'Green Bay, WI',       lat: 44.5013, lon: -88.0622,  dome: false },
  HOU: { city: 'Houston, TX',         lat: 29.6847, lon: -95.4107,  dome: true  },
  IND: { city: 'Indianapolis, IN',    lat: 39.7601, lon: -86.1639,  dome: true  },
  JAX: { city: 'Jacksonville, FL',    lat: 30.3240, lon: -81.6373,  dome: false },
  KC:  { city: 'Kansas City, MO',     lat: 39.0490, lon: -94.4839,  dome: false },
  LAC: { city: 'Inglewood, CA',       lat: 33.9535, lon: -118.3392, dome: true  },
  LAR: { city: 'Inglewood, CA',       lat: 33.9535, lon: -118.3392, dome: true  },
  LV:  { city: 'Las Vegas, NV',       lat: 36.0909, lon: -115.1833, dome: true  },
  MIA: { city: 'Miami Gardens, FL',   lat: 25.9580, lon: -80.2389,  dome: false },
  MIN: { city: 'Minneapolis, MN',     lat: 44.9736, lon: -93.2575,  dome: true  },
  NE:  { city: 'Foxborough, MA',      lat: 42.0909, lon: -71.2643,  dome: false },
  NO:  { city: 'New Orleans, LA',     lat: 29.9511, lon: -90.0812,  dome: true  },
  NYG: { city: 'East Rutherford, NJ', lat: 40.8128, lon: -74.0742,  dome: false },
  NYJ: { city: 'East Rutherford, NJ', lat: 40.8128, lon: -74.0742,  dome: false },
  PHI: { city: 'Philadelphia, PA',    lat: 39.9008, lon: -75.1675,  dome: false },
  PIT: { city: 'Pittsburgh, PA',      lat: 40.4468, lon: -80.0158,  dome: false },
  SEA: { city: 'Seattle, WA',         lat: 47.5952, lon: -122.3316, dome: false },
  SF:  { city: 'Santa Clara, CA',     lat: 37.4032, lon: -121.9698, dome: false },
  TB:  { city: 'Tampa, FL',           lat: 27.9759, lon: -82.5033,  dome: false },
  TEN: { city: 'Nashville, TN',       lat: 36.1665, lon: -86.7713,  dome: false },
  WAS: { city: 'Landover, MD',        lat: 38.9076, lon: -76.8645,  dome: false },
};

// ─── Types ────────────────────────────────────────────────────────────────────
export interface InjuryReport {
  playerId:   string;
  playerName: string;
  team:       string;
  position:   string;
  status:     string;
  injury:     string;
  updatedAt:  string;
}

export interface WeatherReport {
  team:          string;
  city:          string;
  tempF:         number;
  windMph:       number;
  condition:     string;
  isDome:        boolean;
  fantasyImpact: string;
}

export interface VegasLine {
  homeTeam:         string;
  awayTeam:         string;
  homeImpliedScore: number;
  awayImpliedScore: number;
  total:            number;
  spread:           number;
  gameTime:         string;
}

export interface LiveGameContext {
  injuries:      InjuryReport[];
  weather:       WeatherReport[];
  vegasLines:    VegasLine[];
  advancedStats: string;
  snapCounts:    string;
  prospects:     string;
  fetchedAt:     string;
  sources:       string[];
}

// ─── NFL Injuries via ESPN (free, no key) ─────────────────────────────────────
export async function fetchNFLInjuries(): Promise<InjuryReport[]> {
  try {
    const res  = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries');
    const data = await res.json();
    const injuries: InjuryReport[] = [];
    for (const team of (data?.injuries ?? [])) {
      const teamAbbr = team?.team?.abbreviation ?? '';
      for (const entry of (team?.injuries ?? [])) {
        const athlete = entry?.athlete;
        const details = entry?.injuries?.[0];
        if (!athlete || !details) continue;
        const status = details?.status ?? '';
        if (!['Out', 'Doubtful', 'Questionable', 'Injured Reserve', 'Day-To-Day'].includes(status)) continue;
        injuries.push({
          playerId:   athlete.id ?? '',
          playerName: athlete.displayName ?? '',
          team:       teamAbbr,
          position:   athlete.position?.abbreviation ?? '',
          status,
          injury:     details?.type?.abbreviation ?? details?.type?.description ?? 'Unknown',
          updatedAt:  details?.returnFromInjury ?? new Date().toLocaleDateString(),
        });
      }
    }
    return injuries;
  } catch (e) {
    console.log('fetchNFLInjuries error:', e);
    return [];
  }
}

// ─── Weather at outdoor NFL stadiums ─────────────────────────────────────────
export async function fetchGameWeather(teams: string[]): Promise<WeatherReport[]> {
  if (!WEATHER_API_KEY) return [];
  const reports: WeatherReport[] = [];
  const outdoorTeams = teams.filter(t => NFL_STADIUMS[t] && !NFL_STADIUMS[t].dome);
  await Promise.all(outdoorTeams.map(async (team) => {
    const stadium = NFL_STADIUMS[team];
    if (!stadium) return;
    try {
      const res  = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?lat=${stadium.lat}&lon=${stadium.lon}&appid=${WEATHER_API_KEY}&units=imperial`
      );
      const data = await res.json();
      const tempF     = Math.round(data.main?.temp ?? 65);
      const windMph   = Math.round((data.wind?.speed ?? 0) * 1.15);
      const condition = data.weather?.[0]?.main ?? 'Clear';
      let fantasyImpact = '';
      if (windMph >= 20)        fantasyImpact  = `⚠️ HIGH WIND (${windMph}mph) — avoid kickers, deep threats`;
      else if (windMph >= 15)   fantasyImpact  = `🌬️ Moderate wind (${windMph}mph) — slight passing concern`;
      if (condition === 'Snow') fantasyImpact += ' | ❄️ SNOW — run-heavy script likely';
      if (condition === 'Rain') fantasyImpact += ' | 🌧️ Rain — ball security concern, RBs up';
      if (tempF <= 20)          fantasyImpact += ` | 🥶 Extreme cold (${tempF}°F)`;
      reports.push({
        team, city: stadium.city, tempF, windMph, condition, isDome: false,
        fantasyImpact: fantasyImpact || `✅ Good conditions (${tempF}°F, ${windMph}mph)`,
      });
    } catch (e) { console.log(`Weather error ${team}:`, e); }
  }));
  return reports;
}

// ─── Vegas Lines via The Odds API ─────────────────────────────────────────────
export async function fetchVegasLines(): Promise<VegasLine[]> {
  if (!ODDS_API_KEY) return [];
  try {
    const res  = await fetch(
      `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,totals&oddsFormat=american`
    );
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((game: any) => {
      const bookmaker = game.bookmakers?.[0];
      const spreadMkt = bookmaker?.markets?.find((m: any) => m.key === 'spreads');
      const totalMkt  = bookmaker?.markets?.find((m: any) => m.key === 'totals');
      const total  = totalMkt?.outcomes?.[0]?.point  ?? 44;
      const spread = spreadMkt?.outcomes?.[0]?.point ?? 0;
      return {
        homeTeam:         game.home_team ?? '',
        awayTeam:         game.away_team ?? '',
        homeImpliedScore: Math.round(((total / 2) - (spread / 2)) * 10) / 10,
        awayImpliedScore: Math.round(((total / 2) + (spread / 2)) * 10) / 10,
        total, spread,
        gameTime: game.commence_time ?? '',
      };
    });
  } catch (e) {
    console.log('fetchVegasLines error:', e);
    return [];
  }
}

// ─── Advanced Stats via ESPN (target share, snap counts, receiving) ───────────
export async function fetchAdvancedStats(): Promise<string> {
  try {
    // ESPN player stats — season leaders
    const [receivingRes, rushingRes] = await Promise.all([
      fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/leaders?limit=20&stat=receiving'),
      fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/leaders?limit=20&stat=rushing'),
    ]);

    const receivingData = await receivingRes.json();
    const rushingData   = await rushingRes.json();

    const lines: string[] = ['--- NFL SEASON LEADERS ---'];

    // Receiving leaders
    const recLeaders = receivingData?.leaders?.find((l: any) => l.name === 'receivingYards')?.leaders ?? [];
    if (recLeaders.length > 0) {
      lines.push('TOP RECEIVERS (yards):');
      recLeaders.slice(0, 10).forEach((l: any) => {
        const name  = l.athlete?.displayName ?? 'Unknown';
        const team  = l.team?.abbreviation ?? '';
        const value = l.value ?? 0;
        lines.push(`  ${name} (${team}): ${value} yds`);
      });
    }

    // Rushing leaders
    const rushLeaders = rushingData?.leaders?.find((l: any) => l.name === 'rushingYards')?.leaders ?? [];
    if (rushLeaders.length > 0) {
      lines.push('TOP RUSHERS (yards):');
      rushLeaders.slice(0, 10).forEach((l: any) => {
        const name  = l.athlete?.displayName ?? 'Unknown';
        const team  = l.team?.abbreviation ?? '';
        const value = l.value ?? 0;
        lines.push(`  ${name} (${team}): ${value} yds`);
      });
    }

    return lines.join('\n') + '\n';
  } catch (e) {
    console.log('fetchAdvancedStats error:', e);
    return '';
  }
}

// ─── Snap Counts + Target Share via nflverse (open source) ───────────────────
export async function fetchSnapCounts(week: number, season = 2024): Promise<string> {
  try {
    // nflverse publishes weekly snap counts as CSV on GitHub
    const url = `https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_${season}.csv`;
    const res  = await fetch(url);
    if (!res.ok) return '';

    const text = await res.text();
    const lines = text.split('\n');
    if (lines.length < 2) return '';

    const headers = lines[0].split(',');
    const weekIdx    = headers.indexOf('week');
    const playerIdx  = headers.indexOf('player');
    const teamIdx    = headers.indexOf('team');
    const posIdx     = headers.indexOf('position');
    const offSnapIdx = headers.indexOf('offense_snaps');
    const offPctIdx  = headers.indexOf('offense_pct');

    if (weekIdx === -1 || playerIdx === -1) return '';

    // Filter to current week, relevant positions, >50% snap share
    const weekData = lines.slice(1)
      .map(l => l.split(','))
      .filter(row => row[weekIdx] === String(week) && ['WR', 'RB', 'TE'].includes(row[posIdx]))
      .filter(row => parseFloat(row[offPctIdx]) >= 0.5)
      .sort((a, b) => parseFloat(b[offPctIdx]) - parseFloat(a[offPctIdx]))
      .slice(0, 30);

    if (weekData.length === 0) return '';

    const snapLines = weekData.map(row =>
      `${row[playerIdx]} (${row[teamIdx]} ${row[posIdx]}): ${Math.round(parseFloat(row[offPctIdx]) * 100)}% snap share, ${row[offSnapIdx]} snaps`
    );

    return `\n--- SNAP COUNTS WK ${week} (${season}) — players >50% snap share ---\n${snapLines.join('\n')}\n`;
  } catch (e) {
    console.log('fetchSnapCounts error:', e);
    return '';
  }
}

// ─── Next Gen Stats via ESPN hidden API ───────────────────────────────────────
export async function fetchNextGenStats(): Promise<string> {
  try {
    // ESPN scoreboard gives us current week matchups + team stats
    const res  = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
    const data = await res.json();
    const events = data?.events ?? [];
    if (events.length === 0) return '';

    const lines: string[] = [`--- THIS WEEK'S MATCHUPS & GAME NOTES ---`];
    for (const event of events.slice(0, 16)) {
      const comp = event.competitions?.[0];
      const home = comp?.competitors?.find((c: any) => c.homeAway === 'home');
      const away = comp?.competitors?.find((c: any) => c.homeAway === 'away');
      if (!home || !away) continue;

      const homeName = home.team?.abbreviation ?? '';
      const awayName = away.team?.abbreviation ?? '';
      const gameTime = new Date(event.date ?? '').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const odds     = comp?.odds?.[0];
      const line     = odds ? ` | Line: ${odds.details ?? 'N/A'} | O/U: ${odds.overUnder ?? 'N/A'}` : '';
      const status   = event.status?.type?.description ?? '';

      lines.push(`${awayName} @ ${homeName} (${gameTime}${status ? ', ' + status : ''})${line}`);
    }

    return lines.join('\n') + '\n';
  } catch (e) {
    console.log('fetchNextGenStats error:', e);
    return '';
  }
}

// ─── College Football Prospects (Dynasty Elite) ───────────────────────────────
export async function fetchCollegeProspects(year = 2025): Promise<string> {
  if (!CFBD_API_KEY) return '';
  try {
    const res  = await fetch(
      `https://api.collegefootballdata.com/draft/prospects?year=${year}`,
      { headers: { Authorization: `Bearer ${CFBD_API_KEY}` } }
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return '';
    const top = data.slice(0, 30).map((p: any) =>
      `${p.name} (${p.position}, ${p.school}) — Grade: ${p.grade ?? 'N/A'}, Round: ${p.projectedRound ?? 'N/A'}`
    ).join('\n');
    return `\n--- ${year} NFL DRAFT PROSPECTS ---\n${top}\n`;
  } catch (e) {
    console.log('fetchCollegeProspects error:', e);
    return '';
  }
}

// ─── Top College Receivers ────────────────────────────────────────────────────
export async function fetchTopCollegeReceivers(year = 2024): Promise<string> {
  if (!CFBD_API_KEY) return '';
  try {
    const res  = await fetch(
      `https://api.collegefootballdata.com/stats/player/season?year=${year}&category=receiving`,
      { headers: { Authorization: `Bearer ${CFBD_API_KEY}` } }
    );
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return '';
    const top = data
      .sort((a: any, b: any) => (b.stat ?? 0) - (a.stat ?? 0))
      .slice(0, 20)
      .map((p: any) => `${p.player} (${p.team}) — ${p.statType}: ${p.stat}`)
      .join('\n');
    return `\n--- TOP ${year} COLLEGE RECEIVERS ---\n${top}\n`;
  } catch (e) {
    console.log('fetchTopCollegeReceivers error:', e);
    return '';
  }
}

// ─── Master fetch ─────────────────────────────────────────────────────────────
export async function fetchAllLiveData(
  rosterTeams: string[] = [],
  includeDynasty = false,
  currentWeek = 1
): Promise<LiveGameContext> {
  const teamList = rosterTeams.length > 0 ? rosterTeams : Object.keys(NFL_STADIUMS);

  const [injuries, weather, vegasLines, advancedStats, nextGenMatchups, snapCounts, prospects] = await Promise.all([
    fetchNFLInjuries(),
    fetchGameWeather(teamList),
    fetchVegasLines(),
    fetchAdvancedStats(),
    fetchNextGenStats(),
    fetchSnapCounts(currentWeek),
    includeDynasty ? fetchCollegeProspects() : Promise.resolve(''),
  ]);

  const sources: string[] = ['ESPN Injury API', 'ESPN Stats API', 'ESPN Scoreboard'];
  if (weather.length    > 0) sources.push('OpenWeatherMap');
  if (vegasLines.length > 0) sources.push('The Odds API');
  if (snapCounts)            sources.push('nflverse Snap Counts');
  if (prospects)             sources.push('College Football Data API');

  return {
    injuries,
    weather,
    vegasLines,
    advancedStats: advancedStats + '\n' + nextGenMatchups,
    snapCounts,
    prospects,
    fetchedAt: new Date().toISOString(),
    sources,
  };
}

// ─── Format for AI prompt injection ──────────────────────────────────────────
export function formatLiveDataForPrompt(data: LiveGameContext): string {
  const lines: string[] = [
    `\n=== LIVE DATA (${new Date(data.fetchedAt).toLocaleTimeString()}) ===`,
    `Sources: ${data.sources.join(', ')}\n`,
  ];

  if (data.injuries.length > 0) {
    lines.push('--- NFL INJURY REPORT ---');
    const grouped = data.injuries.reduce((acc, inj) => {
      (acc[inj.status] = acc[inj.status] || []).push(
        `${inj.playerName} (${inj.team} ${inj.position}) — ${inj.injury}`
      );
      return acc;
    }, {} as Record<string, string[]>);
    for (const [status, players] of Object.entries(grouped)) {
      lines.push(`${status}: ${players.join(', ')}`);
    }
    lines.push('');
  }

  if (data.weather.length > 0) {
    lines.push('--- GAME WEATHER (outdoor stadiums) ---');
    for (const w of data.weather) {
      lines.push(`${w.team} @ ${w.city}: ${w.tempF}°F, ${w.windMph}mph, ${w.condition}`);
      if (!w.fantasyImpact.startsWith('✅')) lines.push(`  ${w.fantasyImpact}`);
    }
    lines.push('');
  }

  if (data.vegasLines.length > 0) {
    lines.push('--- VEGAS IMPLIED SCORES ---');
    for (const v of data.vegasLines) {
      lines.push(
        `${v.awayTeam} @ ${v.homeTeam}: Total ${v.total} | ` +
        `${v.awayTeam} implied ${v.awayImpliedScore} | ${v.homeTeam} implied ${v.homeImpliedScore}`
      );
    }
    lines.push('');
  }

  if (data.advancedStats) lines.push(data.advancedStats);
  if (data.snapCounts)    lines.push(data.snapCounts);
  if (data.prospects)     lines.push(data.prospects);

  lines.push('=== END LIVE DATA ===\n');
  return lines.join('\n');
}

// ─── Quick injury lookup ──────────────────────────────────────────────────────
export function findPlayerInjury(injuries: InjuryReport[], playerName: string): InjuryReport | null {
  const name = playerName.toLowerCase();
  return injuries.find(inj =>
    inj.playerName.toLowerCase().includes(name) ||
    name.includes(inj.playerName.toLowerCase().split(' ').pop() || '')
  ) || null;
}