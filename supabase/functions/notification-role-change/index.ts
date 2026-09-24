// supabase/functions/notification-role-change/index.ts
// ───────────────────────────────────────────────────────────
// Alerts a user when a player on their roster has genuinely TAKEN OVER a
// role -- and, critically, verifies the jump is not just a teammate's injury.
//
// WHY THIS IS AN ALERT AND NOT A RANKING INPUT. The same detector was
// backtested as a ranking multiplier on 2024+2025 and landed at parity:
// WR 0.5825 vs 0.5826 unmodified, RB 0.6628 vs 0.6628, TE 0.5684 vs 0.5688.
// The reason is structural -- by the time the trigger has 3 games to fire on,
// the engine's trailing-5 opportunity window already contains those 3 games,
// so the detector is re-describing information the ranking already holds.
// Adding it there would be machinery and a 50/50 failure mode for no gain.
//
// As an alert the economics invert. A false positive costs a glance; being
// first to tell someone their WR3 is now a WR1 is worth opening the app for.
//
// THE TEAMMATE CHECK IS THE WHOLE PRODUCT. Every app can say "this guy got
// more targets". Almost none can say whether it will last. Backtested on
// 2024+2025 the check blocked roughly half of all fires (WR 53 of 116, RB 30
// of 87, TE 34 of 49) and recovered the accuracy the unfiltered trigger lost.
// Live through week 2 of 2026 it separates:
//
//   Parker Washington  opp 0.34 -> 0.84   REAL     (JAX leader played all 3)
//   Chris Brooks       opp 1.00 -> 9.00   BLOCKED  (Josh Jacobs missed 3/3)
//
// Both look identical on a usage chart. Only one is worth a notification.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Both conditions must hold. Usage alone is game script: a back trailing by
// three scores catches 8 checkdowns and looks like a breakout.
const WINDOW = 3;        // consecutive games that must show the step
const OPP_MULT = 1.5;    // opportunity vs the player's own prior median
const PTS_MULT = 1.3;    // production must follow the usage

const norm = (s: unknown) =>
  String(s ?? '').toLowerCase().replace(/[.'’]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').replace(/\s+/g, ' ').trim();

const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };
const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);

async function pushAll(messages: any[]) {
  for (let i = 0; i < messages.length; i += 100) {
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages.slice(i, i + 100)),
      });
    } catch (e) {
      console.log('[role-change] expo push failed:', (e as any)?.message);
    }
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  try {
    const season = Number(new URL(req.url).searchParams.get('season')) || 2026;

    // ── 1. Two seasons of weekly lines, so a role change that straddles the
    // offseason is still visible. Washington's began in week 16 of the prior
    // season; a current-season-only view cannot see it at all.
    const rows: any[] = [];
    for (let off = 0; off < 40000; off += 1000) {
      const { data, error } = await sb
        .from('nfl_weekly_stats')
        .select('season, week, gsis_id, team, targets, carries, wopr, fantasy_pts_ppr')
        .in('season', [season - 1, season])
        .eq('season_type', 'REG')
        .range(off, off + 999);
      if (error || !data?.length) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    if (!rows.length) throw new Error('no weekly stats');

    const { data: players } = await sb
      .from('nfl_players').select('gsis_id, full_name, position, team')
      .in('position', ['WR', 'RB', 'TE']);
    const meta = new Map((players ?? []).map((p: any) => [p.gsis_id, p]));

    // ── 2. Per-player chronology, and who actually played each week.
    const hist = new Map<string, any[]>();
    const played = new Map<number, Set<string>>();
    const byOrd = new Map<number, any[]>();
    for (const r of rows) {
      const p = meta.get(r.gsis_id);
      if (!p) continue;
      const ord = Number(r.season) * 100 + Number(r.week);
      const opp = p.position === 'RB'
        ? Number(r.carries ?? 0) + Number(r.targets ?? 0)
        : Number(r.wopr ?? 0);
      const rec = { ord, opp, pts: Number(r.fantasy_pts_ppr ?? 0), team: r.team, gsis_id: r.gsis_id };
      if (!hist.has(r.gsis_id)) hist.set(r.gsis_id, []);
      hist.get(r.gsis_id)!.push(rec);
      if (!played.has(ord)) played.set(ord, new Set());
      played.get(ord)!.add(r.gsis_id);
      if (!byOrd.has(ord)) byOrd.set(ord, []);
      byOrd.get(ord)!.push(rec);
    }
    for (const arr of hist.values()) arr.sort((a, b) => a.ord - b.ord);
    const latest = Math.max(...byOrd.keys());

    // ── 3. Detect, then verify against the teammate's availability.
    type Hit = { gsis_id: string; name: string; position: string; team: string;
                 oppWas: number; oppNow: number; ptsWas: number; ptsNow: number };
    const hits: Hit[] = [];
    let blocked = 0;

    for (const [gsis, h] of hist) {
      if (h.length < WINDOW + 3) continue;
      // Only current news. A step that ended weeks ago is not an alert.
      if (h[h.length - 1].ord < latest - 1) continue;

      const last = h.slice(-WINDOW), prior = h.slice(0, -WINDOW);
      const bOpp = med(prior.map(x => x.opp)), bPts = med(prior.map(x => x.pts));
      if (!(bOpp > 0 && last.every(x => x.opp >= OPP_MULT * bOpp) && avg(last.map(x => x.pts)) >= PTS_MULT * bPts)) continue;

      // Who led this team in opportunity BEFORE the step? If he sat through
      // any of the step games, this is a fill-in and it reverts on his return.
      const team = last[last.length - 1].team;
      const mates = new Map<string, number>();
      for (const x of prior) for (const r of (byOrd.get(x.ord) ?? []))
        if (r.team === team && r.gsis_id !== gsis) mates.set(r.gsis_id, (mates.get(r.gsis_id) ?? 0) + r.opp);
      const alpha = [...mates.entries()].sort((a, b) => b[1] - a[1])[0];
      if (alpha && last.some(x => !(played.get(x.ord)?.has(alpha[0])))) { blocked++; continue; }

      const p = meta.get(gsis)!;
      hits.push({ gsis_id: gsis, name: p.full_name, position: p.position, team,
                  oppWas: bOpp, oppNow: avg(last.map(x => x.opp)),
                  ptsWas: bPts, ptsNow: avg(last.map(x => x.pts)) });
    }
    if (!hits.length) {
      return new Response(JSON.stringify({ ok: true, hits: 0, blocked, sent: 0 }),
        { headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── 4. Match to rosters. normalized_name is what the client writes, and
    // it is the same join the other notification jobs use.
    const byName = new Map(hits.map(h => [norm(h.name), h]));
    const { data: rostered } = await sb
      .from('user_rostered_players')
      .select('user_id, normalized_name, users:user_id(push_token, notification_prefs)')
      .in('normalized_name', [...byName.keys()]);

    // One alert per player per week. A role change is news once; repeating it
    // daily is what made the old heat alerts feel like spam.
    const bucket = Math.floor(Date.now() / (7 * 86400000));
    const { data: already } = await sb
      .from('notification_log').select('user_id, dedupe_key')
      .in('dedupe_key', hits.map(h => `role:${h.gsis_id}:${bucket}`));
    const seen = new Set((already ?? []).map((r: any) => `${r.user_id}|${r.dedupe_key}`));

    const messages: any[] = [];
    const logs: any[] = [];
    for (const r of (rostered ?? [])) {
      const hit = byName.get(r.normalized_name);
      const u: any = (r as any).users;
      if (!hit || !u?.push_token) continue;
      if ((u.notification_prefs ?? {}).role_alerts === false) continue;
      const key = `role:${hit.gsis_id}:${bucket}`;
      if (seen.has(`${r.user_id}|${key}`)) continue;
      seen.add(`${r.user_id}|${key}`);

      const share = hit.position === 'RB'
        ? `${hit.oppWas.toFixed(1)} → ${hit.oppNow.toFixed(1)} touches`
        : `${(hit.oppWas * 100).toFixed(0)}% → ${(hit.oppNow * 100).toFixed(0)}% of the passing game`;
      messages.push({
        to: u.push_token,
        title: `${hit.name} has taken over`,
        // The last clause is the differentiator. Anyone can report a usage
        // spike; saying it is NOT injury-driven is the part users cannot get
        // elsewhere, and the reason to trust the alert.
        body: `${share}, ${hit.ptsWas.toFixed(1)} → ${hit.ptsNow.toFixed(1)} pts over ${WINDOW} games. `
            + `Not an injury fill — ${hit.team}'s previous leader played every one.`,
        sound: 'default',
        data: { type: 'role_change', gsis_id: hit.gsis_id },
      });
      logs.push({ user_id: r.user_id, dedupe_key: key });
    }

    if (messages.length) {
      await pushAll(messages);
      await sb.from('notification_log').insert(logs);
    }
    return new Response(JSON.stringify({
      ok: true, hits: hits.length, blocked, sent: messages.length,
      detected: hits.map(h => h.name),
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
});
