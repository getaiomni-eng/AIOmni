// supabase/functions/regenerate-rankings-json/index.ts
// ───────────────────────────────────────────────────────────
// Pulls top-25 per (format × position) from nfl_proprietary_rankings_v2,
// builds the compact JSON expected by site/rankings.html, and uploads to
// the public-rankings storage bucket. Scheduled daily after the engine
// rerun so the marketing site always reflects the latest data without
// requiring a redeploy.
//
// Output URL:
//   https://khoruzvsprxyocisuhet.supabase.co/storage/v1/object/public/public-rankings/rankings.json

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FORMATS = ['PPR','HALF','STD','SF','DYN','DYN_HALF','DYN_STD','DYN_SF'] as const;
const POSITIONS = ['QB','RB','WR','TE'] as const;
const TOP_N = 25;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const started = Date.now();

    // Build {formula: {fmt: {pos: [...] }}}
    const formula: Record<string, Record<string, Array<any>>> = {};
    let totalRows = 0;

    for (const fmt of FORMATS) {
      formula[fmt] = {};
      for (const pos of POSITIONS) {
        const { data, error } = await supabase
          .from('nfl_proprietary_rankings_v2')
          .select('rank, pos_rank, name, team, tier, score')
          .eq('format', fmt)
          .eq('position', pos)
          .order('score', { ascending: false })
          .limit(TOP_N);
        if (error) throw error;
        const compact = (data ?? []).map(r => ({
          pr: r.pos_rank,
          or: r.rank,
          n: r.name,
          t: r.team,
          tier: r.tier,
          sc: Math.round((r.score as number) * 10) / 10,
        }));
        formula[fmt][pos] = compact;
        totalRows += compact.length;
      }
    }

    // PULSE = live market consensus, sourced from KeepTradeCut trade values
    // (the ktc-values function, self-refreshing 12h cache). KTC has no scoring
    // variants, so PPR/HALF/STD all map to its redraft 1QB column; SF/dynasty
    // map accordingly. Builds top-25 per position by value, with positional +
    // overall ranks. Previously the site's Pulse tab was empty — regen only
    // ever PRESERVED a pulse block it never created.
    let pulse: any = undefined;
    try {
      const ktcRes = await fetch(`${SUPABASE_URL}/functions/v1/ktc-values`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const ktc = await ktcRes.json();
      if (ktc?.dynasty && ktc?.redraft) {
        const PULSE_MAP: Record<string, ['dynasty' | 'redraft', 'oneQB' | 'sf']> = {
          PPR: ['redraft', 'oneQB'], HALF: ['redraft', 'oneQB'], STD: ['redraft', 'oneQB'],
          SF: ['redraft', 'sf'], DYN_1QB: ['dynasty', 'oneQB'], DYN_SF: ['dynasty', 'sf'],
        };
        pulse = {};
        for (const [fmt, [season, valKey]] of Object.entries(PULSE_MAP)) {
          const table = ktc[season] as Record<string, { oneQB: number; sf: number; pos: string; team: string }>;
          const all = Object.entries(table)
            .map(([n, v]) => ({ n, t: v.team, pos: v.pos, val: v[valKey] }))
            .filter(p => p.val > 0 && POSITIONS.includes(p.pos as any))
            .sort((a, b) => b.val - a.val);
          all.forEach((p, i) => ((p as any).overall = i + 1));
          const byPos: Record<string, any[]> = { QB: [], RB: [], WR: [], TE: [] };
          for (const p of all) byPos[p.pos].push(p);
          pulse[fmt] = {};
          for (const pos of POSITIONS) {
            pulse[fmt][pos] = byPos[pos].slice(0, TOP_N).map((p, i) => ({
              pr: i + 1, or: (p as any).overall, n: p.n, t: p.t || '—',
              tier: Math.min(5, Math.ceil((i + 1) / 5)), sc: p.val,
            }));
          }
        }
      }
    } catch (e) {
      console.error('pulse build (KTC) failed, leaving pulse empty:', e);
    }

    const payload: Record<string, any> = {
      generated: new Date().toISOString().slice(0, 10),
      formula,
    };
    if (pulse) payload.pulse = pulse;

    const body = JSON.stringify(payload);
    const { error: upErr } = await supabase.storage
      .from('public-rankings')
      .upload('rankings.json', new Blob([body], { type: 'application/json' }), {
        upsert: true,
        contentType: 'application/json',
        cacheControl: '300', // 5 min CDN cache
      });
    if (upErr) throw upErr;

    return new Response(JSON.stringify({
      ok: true,
      duration_seconds: Math.round((Date.now() - started) / 1000),
      total_rows: totalRows,
      payload_bytes: body.length,
      pulse_preserved: !!pulse,
      public_url: `${SUPABASE_URL}/storage/v1/object/public/public-rankings/rankings.json`,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch (err: any) {
    console.error('regenerate-rankings-json error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
