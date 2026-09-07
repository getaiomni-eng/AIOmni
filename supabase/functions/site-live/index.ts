// Public live feed for getaiomni.com.
//
// The marketing site should show the machine running, not screenshots of it.
// This returns the same signals the app works from -- this week's games with
// real conditions, and the headlines the news pipeline is reading -- as one
// cached payload the static site can fetch with no key of its own.
//
// Deliberately public and deliberately narrow:
//   * No API keys ever reach the browser. Weather is fetched here with the
//     server-side key and only the rendered result goes out.
//   * The RSS sources block cross-origin reads, so fetching them here is also
//     the only way a static page could show them at all.
//   * Nothing proprietary is exposed: no rankings, no scores, no method,
//     no analyst takes. Public weather and public headlines only.
//
// Cached in-memory per isolate. A cold isolate costs one upstream round; every
// visitor after that is free until TTL expires.

const WEATHER_KEY = Deno.env.get("WEATHER_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TTL_MS = 15 * 60 * 1000;
let cache: { at: number; body: string } | null = null;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
  // Let the CDN and the browser share the cache too.
  "Cache-Control": "public, max-age=300, s-maxage=900",
};

// Outdoor stadiums only. A dome has no weather worth reporting, and listing
// "72F indoors" as a condition is noise.
const STADIUMS: Record<string, { city: string; lat: number; lon: number }> = {
  BUF:{city:"Orchard Park",lat:42.774,lon:-78.787}, MIA:{city:"Miami Gardens",lat:25.958,lon:-80.239},
  NE:{city:"Foxborough",lat:42.091,lon:-71.264},    NYJ:{city:"East Rutherford",lat:40.814,lon:-74.074},
  BAL:{city:"Baltimore",lat:39.278,lon:-76.623},    CIN:{city:"Cincinnati",lat:39.095,lon:-84.516},
  CLE:{city:"Cleveland",lat:41.506,lon:-81.699},    PIT:{city:"Pittsburgh",lat:40.447,lon:-80.016},
  DEN:{city:"Denver",lat:39.744,lon:-105.020},      KC:{city:"Kansas City",lat:39.049,lon:-94.484},
  CHI:{city:"Chicago",lat:41.862,lon:-87.617},      GB:{city:"Green Bay",lat:44.501,lon:-88.062},
  PHI:{city:"Philadelphia",lat:39.901,lon:-75.168}, WAS:{city:"Landover",lat:38.908,lon:-76.864},
  NYG:{city:"East Rutherford",lat:40.814,lon:-74.074}, TB:{city:"Tampa",lat:27.976,lon:-82.503},
  CAR:{city:"Charlotte",lat:35.226,lon:-80.853},    SEA:{city:"Seattle",lat:47.595,lon:-122.332},
  SF:{city:"Santa Clara",lat:37.403,lon:-121.970},  TEN:{city:"Nashville",lat:36.166,lon:-86.771},
  JAX:{city:"Jacksonville",lat:30.324,lon:-81.637}, DEN2:{city:"",lat:0,lon:0},
};

function nflSeason(d = new Date()) { return d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; }
function nflWeek(season: number, now = new Date()): number | null {
  const sep1 = new Date(Date.UTC(season, 8, 1));
  const dow = sep1.getUTCDay();
  const toMon = (8 - (dow === 0 ? 7 : dow)) % 7;
  const opener = new Date(Date.UTC(season, 8, 1 + toMon + 3));
  const days = Math.floor((now.getTime() - opener.getTime()) / 86400000);
  if (days < -7) return null;
  return Math.min(18, Math.max(1, Math.floor(days / 7) + 1));
}

async function games(season: number, week: number) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/nfl_schedule?season=eq.${season}&week=eq.${week}&select=home_team,away_team`,
    { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
  return r.ok ? await r.json() : [];
}

async function weatherFor(team: string) {
  const s = STADIUMS[team];
  if (!s || !WEATHER_KEY) return null;
  try {
    const r = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${s.lat}&lon=${s.lon}&units=imperial&appid=${WEATHER_KEY}`);
    if (!r.ok) return null;
    const d = await r.json();
    const tempF = Math.round(d.main?.temp ?? 0);
    const windMph = Math.round((d.wind?.speed ?? 0));
    const cond = d.weather?.[0]?.main ?? "Clear";
    // Same thresholds the app uses, so the site never says something the
    // product would disagree with.
    let flag = "";
    if (windMph >= 20) flag = "high wind";
    else if (windMph >= 15) flag = "breezy";
    if (cond === "Snow") flag = "snow";
    else if (cond === "Rain") flag = flag ? flag + " · rain" : "rain";
    if (tempF <= 20) flag = flag ? flag + " · freezing" : "freezing";
    return { team, city: s.city, tempF, windMph, cond, flag };
  } catch { return null; }
}

async function headlines() {
  const FEEDS = [
    { url: "https://www.rotowire.com/rss/news.php?sport=NFL", src: "Rotowire" },
    { url: "https://www.cbssports.com/rss/headlines/nfl/",    src: "CBS Sports" },
    { url: "https://www.profootballrumors.com/feed",          src: "Pro Football Rumors" },
  ];
  // Feeds carry sponsored/betting-promo items that read as editorial. They
  // are not news and must not sit on a marketing page as though they were.
  const JUNK = /promo code|bonus bet|sportsbook|betting promo|odds boost|sign[- ]up offer|use code/i;
  const ENT: Record<string, string> = {
    "&amp;":"&", "&#039;":"'", "&#39;":"'", "&quot;":'"', "&apos;":"'",
    "&nbsp;":" ", "&#8217;":"\u2019", "&#8216;":"\u2018", "&#8220;":"\u201c",
    "&#8221;":"\u201d", "&#8212;":"\u2014", "&#8211;":"\u2013", "&lt;":"<", "&gt;":">",
  };
  const clean = (t: string) =>
    t.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
     .replace(/&[a-z]+;|&#\d+;/gi, (m) => ENT[m] ?? m)
     .replace(/\s+/g, " ").trim();

  const perFeed: Record<string, { title: string; src: string; link: string }[]> = {};
  await Promise.all(FEEDS.map(async (f) => {
    try {
      const r = await fetch(f.url, { headers: { "User-Agent": "AIOmni/1.0 (+https://getaiomni.com)" } });
      if (!r.ok) return;
      const xml = await r.text();
      const items = xml.split(/<item[\s>]/).slice(1, 10);
      const got: { title: string; src: string; link: string }[] = [];
      for (const it of items) {
        const t = it.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1];
        const l = it.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/s)?.[1]?.trim();
        if (!t || !l) continue;
        const title = clean(t);
        if (!title || JUNK.test(title)) continue;
        got.push({ title: title.slice(0, 140), src: f.src, link: l });
      }
      perFeed[f.src] = got;
    } catch { /* one dead feed must not empty the whole panel */ }
  }));

  // Interleave so one prolific feed cannot crowd the others out. A panel of
  // twelve CBS headlines misrepresents a pipeline that reads three sources.
  const out: { title: string; src: string; link: string }[] = [];
  for (let i = 0; i < 6; i++)
    for (const f of FEEDS)
      if (perFeed[f.src]?.[i]) out.push(perFeed[f.src][i]);
  return out.slice(0, 12);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  if (cache && Date.now() - cache.at < TTL_MS) {
    return new Response(cache.body, { headers: { ...CORS, "x-cache": "hit" } });
  }

  const season = nflSeason();
  const week = nflWeek(season);
  const sched = week ? await games(season, week) : [];

  const teams = [...new Set(sched.flatMap((g: any) => [g.home_team, g.away_team]))]
    .filter((t) => STADIUMS[t]);
  const [wx, news] = await Promise.all([
    Promise.all(teams.slice(0, 14).map(weatherFor)),
    headlines(),
  ]);

  const body = JSON.stringify({
    season, week,
    games: sched.length,
    weather: wx.filter(Boolean),
    headlines: news,
    generated_at: new Date().toISOString(),
  });
  cache = { at: Date.now(), body };
  return new Response(body, { headers: { ...CORS, "x-cache": "miss" } });
});
