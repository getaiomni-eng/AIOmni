// supabase/functions/expert-rankings-harvest/index.ts
//
// Harvests weekly EXPERT rankings from every public provider we can reach, into
// public.expert_weekly_rankings, plus a consensus row per provider into
// ranking_snapshots so the existing scorer grades them beside our board.
//
// PROVIDERS
//   espn         ~8 individual analysts per week, via kona_player_info
//                player.rankings[scoringPeriodId]. Stored one row per analyst,
//                so the disagreement survives. Week 1 Josh Allen came back QB1
//                from one source and QB6 from another; averaging that away
//                before storage would discard the most useful part.
//   fantasypros  ECR, 11 experts, with best/worst/mean/stddev. One consensus
//                row carrying the spread.
//
// CAPTURE OR LOSE IT. Neither provider retains past weeks. On 2026-09-22 ESPN
// week 3 was fully published and week 2 was already gone. There is no backfill.
//
// WRITE ONCE PER WEEK unless forced. The first capture is the prediction of
// record; a re-run must never move a graded snapshot forward in time, which is
// exactly how week 2's aiomni_weekly number became unusable.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ESPN = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const FP   = 'https://partners.fantasypros.com/api/v1/consensus-rankings.php';
const POS: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE' };

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const isSynth = (id: string) => /^\d{4}_pick_\d+$/.test(id);

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(init.headers ?? {}),
    },
  });
}

/** name+POSITION -> gsis_id, preferring a real id over a seeded draft-pick one.
 *  Position is in the key because same-name collisions across positions are
 *  real: a 2026 defensive back shares a name with DeVonta Smith, and a
 *  name-only map is what put the wrong one on our own board. */
async function playerMap(): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (let off = 0; off < 6000; off += 1000) {
    const r = await sb(`nfl_players?select=gsis_id,full_name,position&limit=1000&offset=${off}`);
    if (!r.ok) break;
    const page = await r.json();
    if (!Array.isArray(page) || page.length === 0) break;
    for (const p of page) {
      if (!p?.full_name || !p?.gsis_id || !p?.position) continue;
      const k = `${norm(p.full_name)}|${p.position}`;
      const prev = m.get(k);
      if (!prev || (isSynth(prev) && !isSynth(p.gsis_id))) m.set(k, p.gsis_id);
    }
    if (page.length < 1000) break;
  }
  return m;
}

type Row = Record<string, unknown>;

async function fromEspn(season: number, week: number, ids: Map<string, string>) {
  const res = await fetch(`${ESPN}/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'x-fantasy-filter': JSON.stringify({
        players: { filterSlotIds: { value: [0, 2, 4, 6] }, limit: 400,
                   sortPercOwned: { sortPriority: 1, sortAsc: false } },
      }),
    },
  });
  if (!res.ok) return { rows: [] as Row[], consensus: [] as Row[], error: `espn ${res.status}` };
  const data = await res.json();

  const rows: Row[] = [];
  const meanByPlayer: { gsis: string; name: string; position: string; mean: number }[] = [];
  let unmapped = 0;

  for (const pl of (data.players ?? [])) {
    const p = pl.player;
    const position = POS[p?.defaultPositionId];
    if (!position) continue;
    // rankSourceId 0 is present for every player and always 0 -- a placeholder,
    // not an opinion.
    const entries = (p?.rankings?.[String(week)] ?? []).filter((x: any) =>
      x?.published && x?.rankType === 'PPR' && Number(x?.rankSourceId) !== 0 && Number(x?.rank) > 0);
    if (entries.length === 0) continue;
    const gsis = ids.get(`${norm(p.fullName)}|${position}`);
    if (!gsis) { unmapped++; continue; }

    for (const e of entries) {
      rows.push({
        season, week, format: 'ppr', provider: 'espn', expert_id: String(e.rankSourceId),
        gsis_id: gsis, player_name: p.fullName, position, team: null,
        rank: null, pos_rank: Number(e.rank), n_experts: 1,
      });
    }
    meanByPlayer.push({
      gsis, name: p.fullName, position,
      mean: entries.reduce((s: number, x: any) => s + Number(x.rank), 0) / entries.length,
    });
  }

  meanByPlayer.sort((a, b) => a.mean - b.mean);
  const seen: Record<string, number> = {};
  const consensus = meanByPlayer.map((r, i) => {
    seen[r.position] = (seen[r.position] ?? 0) + 1;
    return { season, week, source: 'espn_expert', kind: 'weekly', format: 'ppr',
             gsis_id: r.gsis, player_name: r.name, position: r.position, team: null,
             rank: i + 1, pos_rank: seen[r.position] };
  });
  return { rows, consensus, unmapped };
}

async function fromFantasyPros(season: number, week: number, ids: Map<string, string>) {
  const url = `${FP}?sport=NFL&year=${season}&week=${week}&position=ALL&type=weekly&scoring=PPR`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return { rows: [] as Row[], consensus: [] as Row[], error: `fantasypros ${res.status}` };
  const data = await res.json();
  const experts = Number(data?.total_experts) || null;

  const rows: Row[] = [];
  const ordered: { gsis: string; name: string; position: string; ecr: number }[] = [];
  let unmapped = 0;

  for (const p of (data.players ?? [])) {
    const position = String(p?.player_position_id ?? '');
    if (!['QB', 'RB', 'WR', 'TE'].includes(position)) continue;
    const gsis = ids.get(`${norm(p.player_name)}|${position}`);
    if (!gsis) { unmapped++; continue; }
    rows.push({
      season, week, format: 'ppr', provider: 'fantasypros', expert_id: 'ecr',
      gsis_id: gsis, player_name: p.player_name, position,
      team: p.player_team_id ?? null,
      rank: Number(p.rank_ecr) || null, pos_rank: parseInt(String(p.pos_rank ?? '').replace(/\D/g, ''), 10) || null,
      rank_best: Number(p.rank_min) || null, rank_worst: Number(p.rank_max) || null,
      rank_std: p.rank_std != null ? Number(p.rank_std) : null,
      n_experts: experts,
    });
    ordered.push({ gsis, name: p.player_name, position, ecr: Number(p.rank_ecr) || 9999 });
  }

  ordered.sort((a, b) => a.ecr - b.ecr);
  const seen: Record<string, number> = {};
  const consensus = ordered.map((r, i) => {
    seen[r.position] = (seen[r.position] ?? 0) + 1;
    return { season, week, source: 'fantasypros_ecr', kind: 'weekly', format: 'ppr',
             gsis_id: r.gsis, player_name: r.name, position: r.position, team: null,
             rank: i + 1, pos_rank: seen[r.position] };
  });
  return { rows, consensus, unmapped };
}

async function upsert(table: string, conflict: string, rows: Row[]) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const r = await sb(`${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk),
    });
    if (!r.ok) console.log(`[expert] ${table} upsert failed:`, r.status, (await r.text()).slice(0, 200));
    else written += chunk.length;
  }
  return written;
}

Deno.serve(async (req) => {
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const season: number = Number(body?.season) || 2026;
    const week: number   = Number(body?.week)   || 0;
    const force = body?.force === true;
    if (!week) throw new Error('week is required');

    const ids = await playerMap();
    const [espn, fp] = await Promise.all([fromEspn(season, week, ids), fromFantasyPros(season, week, ids)]);

    const out: Record<string, unknown> = { season, week, providers: {} as Record<string, unknown> };

    for (const [name, res] of [['espn', espn], ['fantasypros', fp]] as const) {
      if ((res as any).error) { (out.providers as any)[name] = { error: (res as any).error }; continue; }
      // Write once per week: the first capture is the prediction of record.
      const existing = await sb(`expert_weekly_rankings?season=eq.${season}&week=eq.${week}&provider=eq.${name}&select=gsis_id&limit=1`)
        .then(r => r.ok ? r.json() : []).catch(() => []);
      if (Array.isArray(existing) && existing.length > 0 && !force) {
        (out.providers as any)[name] = { skipped: 'already captured' };
        continue;
      }
      const detail = await upsert('expert_weekly_rankings',
        'season,week,format,provider,expert_id,gsis_id', res.rows);
      const snap = await upsert('ranking_snapshots',
        'season,week,source,format,player_name', res.consensus);
      (out.providers as any)[name] = {
        expert_rows: detail, consensus_rows: snap,
        distinct_experts: new Set(res.rows.map((r: any) => r.expert_id)).size,
        unmapped: (res as any).unmapped ?? 0,
      };
    }

    out.ok = true;
    out.duration_seconds = Math.round((Date.now() - started) / 1000);
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
