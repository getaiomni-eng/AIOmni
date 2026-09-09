// Weekly ranking snapshot — registers what every source believed BEFORE the
// week is played (2026-09-08).
//
// Runs Thursday morning, ahead of the first kickoff. A snapshot taken after
// games start is not a prediction, so this is deliberately scheduled early
// and is safe to re-run: rows are keyed on (season, week, source, format,
// player_name) and upsert.
//
// Sources are captured independently. One dead upstream must not cost the
// week's whole comparison, so each is wrapped and the response reports what
// landed and what did not.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

type Row = {
  season: number; week: number; source: string; format: string;
  gsis_id: string | null; player_name: string; position: string | null;
  team: string | null; rank: number; pos_rank: number | null;
};

function nflSeason(d = new Date()) { return d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; }
function nflWeek(season: number, now = new Date()): number {
  const sep1 = new Date(Date.UTC(season, 8, 1));
  const dow = sep1.getUTCDay();
  const opener = new Date(Date.UTC(season, 8, 1 + ((8 - (dow === 0 ? 7 : dow)) % 7) + 3));
  const days = Math.floor((now.getTime() - opener.getTime()) / 86400000);
  return Math.min(18, Math.max(1, Math.floor(days / 7) + 1));
}

const norm = (n: string) =>
  n.toLowerCase().replace(/[.'’]/g, "").replace(/\s+(jr|sr|ii|iii|iv|v)$/i, "").replace(/\s+/g, " ").trim();

async function sb(path: string, init?: RequestInit) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
               "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** name -> gsis_id, so every source can be compared on the same player key. */
async function nameToGsis(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (let off = 0; off < 6000; off += 1000) {
    const r = await sb(`nfl_players?select=gsis_id,full_name&limit=1000&offset=${off}`);
    if (!r.ok) break;
    const rows = await r.json();
    if (!rows.length) break;
    for (const p of rows) if (p.full_name && p.gsis_id) m.set(norm(p.full_name), p.gsis_id);
  }
  return m;
}

/**
 * Collapse duplicate player names, keeping the best (lowest) rank.
 *
 * The snapshot key is (season, week, source, format, player_name), so a
 * repeated name makes Postgres reject the whole batch with 21000: "ON
 * CONFLICT DO UPDATE cannot affect row a second time".
 *
 * This is not hypothetical -- the Formula's own PPR board ships 250 rows for
 * 246 distinct players, with four rookies (Jadarian Price, Jordyn Tyson,
 * Chris Brazzell II, Zachariah Branch) each occupying two ranks. That is an
 * engine bug worth fixing at source; deduping here keeps one bad board from
 * costing the entire week's comparison.
 */
function dedupe(rows: Row[]): Row[] {
  const best = new Map<string, Row>();
  for (const r of rows) {
    // Key on gsis_id when we have one. Two different people can share a name
    // -- Justin Jefferson is both a Vikings WR and a Browns linebacker -- and
    // keying on name would silently drop one of them.
    const k = r.gsis_id ?? `name:${norm(r.player_name)}`;
    const prev = best.get(k);
    if (!prev || r.rank < prev.rank) best.set(k, r);
  }
  return [...best.values()].sort((a, b) => a.rank - b.rank);
}

function posRanks(rows: Row[]): Row[] {
  const seen: Record<string, number> = {};
  for (const r of rows.sort((a, b) => a.rank - b.rank)) {
    const p = r.position ?? "NA";
    seen[p] = (seen[p] ?? 0) + 1;
    r.pos_rank = seen[p];
  }
  return rows;
}

// ── sources ─────────────────────────────────────────────────────────────

async function aiomniFormula(season: number, week: number, g: Map<string, string>): Promise<Row[]> {
  // Reads the base table with the service key -- the public view withholds
  // nothing we need here, but the base is the canonical source of the board.
  const r = await sb(`nfl_proprietary_rankings_v2?format=eq.PPR&select=rank,name,position,team,pos_rank&order=rank.asc&limit=300`);
  if (!r.ok) throw new Error(`formula ${r.status}`);
  return (await r.json()).map((p: any) => ({
    season, week, source: "aiomni_formula", format: "ppr",
    gsis_id: g.get(norm(p.name)) ?? null, player_name: p.name,
    position: p.position, team: p.team, rank: p.rank, pos_rank: p.pos_rank,
  }));
}

async function sleeperADP(season: number, week: number, g: Map<string, string>): Promise<Row[]> {
  const r = await fetch("https://api.sleeper.app/v1/players/nfl");
  if (!r.ok) throw new Error(`sleeper ${r.status}`);
  const db = await r.json();
  const out: Row[] = [];
  for (const p of Object.values<any>(db)) {
    if (!p?.search_rank || p.search_rank > 400) continue;
    if (!["QB", "RB", "WR", "TE"].includes(p.position)) continue;
    if (!p.team) continue;
    const name = `${p.first_name} ${p.last_name}`;
    out.push({ season, week, source: "sleeper_adp", format: "ppr",
      gsis_id: g.get(norm(name)) ?? null, player_name: name,
      position: p.position, team: p.team, rank: p.search_rank, pos_rank: null });
  }
  out.sort((a, b) => a.rank - b.rank);
  out.forEach((r, i) => { r.rank = i + 1; });
  return posRanks(out).slice(0, 300);
}

async function espnADP(season: number, week: number, g: Map<string, string>): Promise<Row[]> {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`;
  const r = await fetch(url, {
    headers: { "x-fantasy-filter": JSON.stringify({
      players: { limit: 300, sortDraftRanks: { sortPriority: 100, sortAsc: true, value: "PPR" } } }) },
  });
  if (!r.ok) throw new Error(`espn ${r.status}`);
  const j = await r.json();
  const POS: Record<number, string> = { 1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DST" };
  const out: Row[] = [];
  (j.players ?? []).forEach((entry: any, i: number) => {
    const p = entry.player; if (!p) return;
    const pos = POS[p.defaultPositionId]; if (!["QB","RB","WR","TE"].includes(pos)) return;
    out.push({ season, week, source: "espn_adp", format: "ppr",
      gsis_id: g.get(norm(p.fullName)) ?? null, player_name: p.fullName,
      position: pos, team: null, rank: i + 1, pos_rank: null });
  });
  return posRanks(out);
}

async function yahooADP(season: number, week: number, g: Map<string, string>): Promise<Row[]> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/yahoo-rankings-proxy`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  // Yahoo's Fantasy API has been gated behind manual approval since late
  // July 2026 and returns errors for every endpoint. Name it so a failure
  // here reads as the known outage rather than a new bug.
  if (!r.ok) throw new Error(`yahoo ${r.status} (Yahoo API gating — expected until their approval lands)`);
  const j = await r.json();
  const list = Array.isArray(j) ? j : (j.players ?? j.rankings ?? []);
  const out: Row[] = list.map((p: any, i: number) => ({
    season, week, source: "yahoo_adp", format: "ppr",
    gsis_id: g.get(norm(p.name ?? p.full_name ?? "")) ?? null,
    player_name: p.name ?? p.full_name ?? "",
    position: p.position ?? null, team: p.team ?? null,
    rank: p.rank ?? i + 1, pos_rank: null,
  })).filter((r: Row) => r.player_name && ["QB","RB","WR","TE"].includes(r.position ?? ""));
  return posRanks(out);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const season = Number(url.searchParams.get("season")) || nflSeason();
  const week   = Number(url.searchParams.get("week"))   || nflWeek(season);

  const g = await nameToGsis();
  const sources: Record<string, (s: number, w: number, g: Map<string, string>) => Promise<Row[]>> = {
    aiomni_formula: aiomniFormula,
    sleeper_adp:    sleeperADP,
    espn_adp:       espnADP,
    yahoo_adp:      yahooADP,
  };

  const report: Record<string, any> = {};
  for (const [name, fn] of Object.entries(sources)) {
    try {
      const raw = await fn(season, week, g);
      const rows = posRanks(dedupe(raw));
      const dropped = raw.length - rows.length;
      const mapped = rows.filter(r => r.gsis_id).length;
      if (rows.length) {
        const res = await sb("ranking_snapshots?on_conflict=season,week,source,format,player_name", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows),
        });
        if (!res.ok) throw new Error(`insert ${res.status}: ${(await res.text()).slice(0, 160)}`);
      }
      // Unmapped players cannot be scored later, so surface the rate now
      // rather than discovering a thin comparison on Tuesday.
      report[name] = { rows: rows.length, mapped, unmapped: rows.length - mapped,
                       ...(dropped ? { duplicates_dropped: dropped } : {}) };
    } catch (e) {
      report[name] = { error: String((e as any)?.message ?? e) };
    }
  }

  const ok = Object.values(report).some((r: any) => r.rows > 0);
  return new Response(JSON.stringify({ ok, season, week, captured_at: new Date().toISOString(), sources: report }, null, 2),
    { status: ok ? 200 : 500, headers: CORS });
});
