// supabase/functions/sleeper-depth-sync/index.ts
// Pulls depth_chart_position + depth_chart_order from Sleeper's
// /players/nfl endpoint and syncs into nfl_players.
// Sleeper exposes the canonical depth chart most fantasy apps trust.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const startedAt = Date.now();

    // Fetch Sleeper's full player dump (~5-10MB JSON, all NFL players).
    const res = await fetch('https://api.sleeper.app/v1/players/nfl', {
      headers: { 'User-Agent': 'AIOmni/1.0' },
    });
    if (!res.ok) throw new Error(`sleeper API HTTP ${res.status}`);
    const players: Record<string, any> = await res.json();

    // Build sleeper_id → { depth_chart_position, depth_chart_order } map
    const depthBySleeperId = new Map<string, { pos: string | null; order: number | null }>();
    for (const [sleeperId, p] of Object.entries(players)) {
      const pos = p?.depth_chart_position ?? null;
      const order = p?.depth_chart_order ?? null;
      if (pos !== null || order !== null) {
        depthBySleeperId.set(sleeperId, { pos, order });
      }
    }

    // Pull our players that have a sleeper_id. Update in batches.
    const ourPlayers: any[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from('nfl_players')
        .select('gsis_id, sleeper_id')
        .not('sleeper_id', 'is', null)
        .range(offset, offset + 999);
      if (error) throw error;
      if (!data || data.length === 0) break;
      ourPlayers.push(...data);
      if (data.length < 1000) break;
      offset += 1000;
    }

    let updated = 0;
    let skipped = 0;
    const failures: string[] = [];
    // Update in bulk via upsert pattern. PostgREST single-row updates would
    // be too slow, so we issue UPDATE per-player but only when there's
    // actually a depth chart change to apply.
    for (const p of ourPlayers) {
      const dc = depthBySleeperId.get(p.sleeper_id);
      if (!dc) { skipped++; continue; }
      const { error } = await supabase
        .from('nfl_players')
        .update({
          depth_chart_position: dc.pos,
          depth_chart_order: dc.order,
        })
        .eq('gsis_id', p.gsis_id);
      if (error) {
        failures.push(`${p.gsis_id}: ${error.message}`);
        if (failures.length > 5) break;
      } else {
        updated++;
      }
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    return new Response(JSON.stringify({
      ok: failures.length === 0,
      sleeper_total: Object.keys(players).length,
      our_players_with_sleeper_id: ourPlayers.length,
      sleeper_with_depth_chart: depthBySleeperId.size,
      updated,
      skipped,
      failures: failures.slice(0, 5),
      duration_seconds: duration,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch (err: any) {
    console.error('sleeper-depth-sync error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message ?? String(err) }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
