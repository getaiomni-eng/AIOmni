// supabase/functions/espn-expert-snapshot/index.ts
//
// Captures ESPN's WEEKLY EXPERT consensus rankings into ranking_snapshots so
// our weekly board is judged against the right opponent.
//
// WHY: we had been scoring aiomni_weekly against espn_adp. ADP is a DRAFT
// signal -- where players go in August -- and using it to grade a
// matchup-adjusted weekly board is unfair to both sides. ESPN publishes actual
// weekly rankings from named analysts, and that is the like-for-like
// comparison.
//
// CAPTURE OR LOSE IT. ESPN does not retain past weeks. Pulled on 2026-09-22,
// week 3 ranks are fully published and week 2's are already gone -- only a
// handful of unpublished rows with nonsense values remain. There is no
// backfill. A week we do not capture before kickoff can never be compared.
//
// THE SOURCE: player.rankings[scoringPeriodId] is an array of
// {rank, rankSourceId, rankType, published}. Each rankSourceId is a different
// ESPN analyst, and they genuinely disagree -- week 1 Josh Allen came back QB1
// from one and QB6 from another. We average the published PPR ranks across
// analysts, which is the consensus their own product shows.
//
// rankSourceId 0 is excluded: it is present for every player and always 0, a
// placeholder rather than an opinion.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ESPN = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl';
const POS: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE' };

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');
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

Deno.serve(async (req) => {
  const started = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const season: number = Number(body?.season) || 2026;
    const week: number   = Number(body?.week)   || 0;
    if (!week) throw new Error('week is required');

    // Skill positions only, ordered by ownership so the pool is the players
    // anyone is actually deciding about.
    const res = await fetch(`${ESPN}/seasons/${season}/segments/0/leaguedefaults/3?view=kona_player_info`, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'x-fantasy-filter': JSON.stringify({
          players: {
            filterSlotIds: { value: [0, 2, 4, 6] },
            limit: 400,
            sortPercOwned: { sortPriority: 1, sortAsc: false },
          },
        }),
      },
    });
    if (!res.ok) throw new Error(`ESPN kona ${res.status}`);
    const data = await res.json();

    // name+position -> gsis_id. Position is part of the key because same-name
    // collisions across positions are real here: a 2026 DB shares a name with
    // DeVonta Smith, and a name-only map put the wrong one on our own board.
    const idByKey = new Map<string, string>();
    for (let off = 0; off < 6000; off += 1000) {
      const r = await sb(`nfl_players?select=gsis_id,full_name,position&limit=1000&offset=${off}`);
      if (!r.ok) break;
      const page = await r.json();
      if (!Array.isArray(page) || page.length === 0) break;
      for (const p of page) {
        if (!p?.full_name || !p?.gsis_id || !p?.position) continue;
        const k = `${norm(p.full_name)}|${p.position}`;
        const prev = idByKey.get(k);
        if (!prev || (isSynth(prev) && !isSynth(p.gsis_id))) idByKey.set(k, p.gsis_id);
      }
      if (page.length < 1000) break;
    }

    // Consensus rank per player = mean of the published PPR analyst ranks.
    type Row = { gsis_id: string; name: string; position: string; team: string | null; consensus: number };
    const rows: Row[] = [];
    let noRanks = 0, unmapped = 0;
    for (const pl of (data.players ?? [])) {
      const p = pl.player;
      const position = POS[p?.defaultPositionId];
      if (!position) continue;
      const entries = (p?.rankings?.[String(week)] ?? [])
        .filter((x: any) => x?.published && x?.rankType === 'PPR' && Number(x?.rankSourceId) !== 0 && Number(x?.rank) > 0);
      if (entries.length === 0) { noRanks++; continue; }
      const consensus = entries.reduce((s: number, x: any) => s + Number(x.rank), 0) / entries.length;
      const gsis = idByKey.get(`${norm(p.fullName)}|${position}`);
      if (!gsis) { unmapped++; continue; }
      rows.push({ gsis_id: gsis, name: p.fullName, position, team: null, consensus });
    }
    if (rows.length === 0) throw new Error(`no published expert ranks for week ${week}`);

    // Overall and per-position ranks from the consensus.
    rows.sort((a, b) => a.consensus - b.consensus);
    const posSeen: Record<string, number> = {};
    const out = rows.map((r, i) => {
      posSeen[r.position] = (posSeen[r.position] ?? 0) + 1;
      return {
        season, week, source: 'espn_expert', kind: 'weekly', format: 'ppr',
        gsis_id: r.gsis_id, player_name: r.name, position: r.position, team: r.team,
        rank: i + 1, pos_rank: posSeen[r.position],
      };
    });

    // Write once per week, same rule as the weekly board: the first capture is
    // the prediction of record. Re-running later must not quietly move a
    // graded snapshot forward in time.
    const existing = await sb(`ranking_snapshots?season=eq.${season}&week=eq.${week}&source=eq.espn_expert&format=eq.ppr&select=player_name&limit=1`)
      .then(r => r.ok ? r.json() : []).catch(() => []);
    if (Array.isArray(existing) && existing.length > 0 && body?.force !== true) {
      return new Response(JSON.stringify({ ok: true, skipped: 'already captured', week, existing: true }),
        { headers: { 'Content-Type': 'application/json' } });
    }

    let written = 0;
    for (let i = 0; i < out.length; i += 200) {
      const chunk = out.slice(i, i + 200);
      const r = await sb('ranking_snapshots?on_conflict=season,week,source,format,player_name', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      });
      if (!r.ok) console.log('[espn-expert] upsert failed:', r.status, (await r.text()).slice(0, 200));
      else written += chunk.length;
    }

    return new Response(JSON.stringify({
      ok: true, season, week, ranked: out.length, written,
      skipped_no_ranks: noRanks, skipped_unmapped: unmapped,
      duration_seconds: Math.round((Date.now() - started) / 1000),
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
