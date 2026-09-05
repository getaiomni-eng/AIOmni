// Hosted-league push notifications (2026-09-05). Fired by DB triggers on
// draft start / pick / completion; also callable by the recap cron.
// Fire-and-forget from the caller's perspective — this must never matter
// to a draft's correctness.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SECRET       = Deno.env.get('HOSTED_NOTIFY_SECRET') ?? '';
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

serve(async (req) => {
  if (SECRET && req.headers.get('x-hosted-secret') !== SECRET) {
    return new Response('forbidden', { status: 403 });
  }
  const { type, league_id, week } = await req.json().catch(() => ({}));
  if (!type || !league_id) return new Response('bad request', { status: 400 });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: league } = await sb.from('hosted_leagues')
    .select('name, team_count, rounds').eq('id', league_id).maybeSingle();
  if (!league) return new Response('ok', { status: 200 });

  const { data: members } = await sb.from('hosted_members')
    .select('user_id, team_name, draft_slot').eq('league_id', league_id);

  // Which members get which message
  let targets: { user_id: string; title: string; body: string }[] = [];
  if (type === 'draft_started') {
    targets = (members ?? []).map(m => ({
      user_id: m.user_id,
      title: `${league.name}: draft is live!`,
      body: 'Slots are set — get in the draft room.',
    }));
  } else if (type === 'draft_complete') {
    targets = (members ?? []).map(m => ({
      user_id: m.user_id,
      title: `${league.name}: draft complete`,
      body: 'Rosters are locked. Scoring runs automatically every week.',
    }));
  } else if (type === 'pick_made') {
    // Notify only whoever is now on the clock.
    const { count } = await sb.from('hosted_picks')
      .select('*', { count: 'exact', head: true }).eq('league_id', league_id);
    const total = (league.rounds ?? 18) * (league.team_count ?? 0);
    const overall = (count ?? 0) + 1;
    if (overall > total) return new Response('ok', { status: 200 });
    const teams = league.team_count ?? 0;
    const r = Math.floor((overall - 1) / teams);
    const i = (overall - 1) % teams;
    const slot = r % 2 === 0 ? i + 1 : teams - i;
    const onClock = (members ?? []).find(m => m.draft_slot === slot);
    if (onClock) targets = [{
      user_id: onClock.user_id,
      title: `${league.name}: you're on the clock`,
      body: `Pick ${overall} of ${total} is yours.`,
    }];
  } else if (type === 'week_scored') {
    targets = (members ?? []).map(m => ({
      user_id: m.user_id,
      title: `${league.name}: week ${week} is scored`,
      body: 'Standings updated — see how your best lineup did.',
    }));
  }
  if (!targets.length) return new Response('ok', { status: 200 });

  const ids = [...new Set(targets.map(t => t.user_id))];
  const { data: users } = await sb.from('users').select('id, push_token').in('id', ids);
  const tokenById = new Map((users ?? []).map(u => [u.id, u.push_token]));

  const messages = targets
    .map(t => ({ to: tokenById.get(t.user_id), title: t.title, body: t.body, sound: 'default' }))
    .filter(m => typeof m.to === 'string' && m.to.startsWith('Expo'));
  if (messages.length) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    }).catch(() => {});
  }
  return new Response(JSON.stringify({ sent: messages.length }), { status: 200 });
});
