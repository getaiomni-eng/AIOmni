// supabase/functions/notification-news-scanner/index.ts
// ───────────────────────────────────────────────────────────
// A1 — Player news for rostered players. Runs every 15 min.
// Pulls latest NFL news from RotoWire's RSS feed (same source the home
// tab's Live Feed uses), parses out player names from headlines, then
// for each item that mentions a player a user has rostered, sends an
// Expo push. Dedupes via notification_log so the same news item won't
// fire twice for the same user.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const ROTO_NFL = 'https://www.rotowire.com/rss/current.xml';

// Same normalization rule the rankings blend + client roster sync use,
// so news headlines and rostered names key into the same bucket.
function normalize(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\s+(jr|sr|ii|iii|iv|v)\.?$/, '')
    .replace(/[^a-z]/g, '');
}

type NewsItem = {
  guid:       string;
  title:      string;
  link:       string;
  playerName: string | null;
  normalized: string | null;
};

async function fetchRotoNews(): Promise<NewsItem[]> {
  const res = await fetch(ROTO_NFL);
  if (!res.ok) return [];
  const xml = await res.text();
  const items: NewsItem[] = [];
  // Capture title, link, guid in order — RotoWire's items follow the
  // standard RSS structure.
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const titleMatch = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s.exec(block);
    const linkMatch  = /<link>(.*?)<\/link>/.exec(block);
    const guidMatch  = /<guid[^>]*>(.*?)<\/guid>/.exec(block);
    const title = titleMatch?.[1]?.trim() ?? '';
    if (!title) continue;
    const link = linkMatch?.[1]?.trim() ?? '';
    const guid = guidMatch?.[1]?.trim() ?? link ?? title;
    // RotoWire's convention: "Player Name: short blurb..." — the player
    // name is what's before the first colon. Fallback to null.
    const colon = title.indexOf(':');
    const playerName = colon > 0 ? title.substring(0, colon).trim() : null;
    items.push({
      guid,
      title,
      link,
      playerName,
      normalized: playerName ? normalize(playerName) : null,
    });
  }
  return items;
}

type ExpoMessage = {
  to:    string;
  title: string;
  body:  string;
  data?: Record<string, unknown>;
  sound?: 'default';
};

async function sendExpoPush(messages: ExpoMessage[]): Promise<void> {
  if (messages.length === 0) return;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(chunk),
      });
    } catch (e) {
      console.log('[news-scanner] expo push send failed:', (e as any)?.message);
    }
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // 1. Fetch fresh news (only keep items with an identifiable player).
  const allItems = await fetchRotoNews();
  const items = allItems.filter(i => i.normalized);
  if (items.length === 0) {
    return new Response(JSON.stringify({ ok: true, items_seen: 0 }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  // 2. Pull all (user, normalized_name) pairs for users opted in.
  // This is bounded — each user has ~200 rostered names max, so even
  // a few thousand users is well under the 1k-row limit per query.
  const playerKeys = items.map(i => i.normalized!).filter((v, i, a) => a.indexOf(v) === i);
  const { data: matches, error } = await sb
    .from('user_rostered_players')
    .select('user_id, normalized_name, display_name, league_id, platform, users:user_id(push_token, notification_prefs)')
    .in('normalized_name', playerKeys);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });
  }

  // 3. Build push messages, deduped against notification_log.
  const messages: ExpoMessage[] = [];
  const logRows: any[] = [];

  // Index news items by normalized name for O(1) lookup.
  const newsByName = new Map<string, NewsItem[]>();
  for (const it of items) {
    if (!it.normalized) continue;
    if (!newsByName.has(it.normalized)) newsByName.set(it.normalized, []);
    newsByName.get(it.normalized)!.push(it);
  }

  // Pre-fetch existing dedupe keys per user to avoid one round-trip per push.
  const userIds = Array.from(new Set((matches ?? []).map(m => m.user_id)));
  const guids   = items.map(i => i.guid);
  const dedupeSet = new Set<string>();
  if (userIds.length > 0) {
    const { data: existing } = await sb
      .from('notification_log')
      .select('user_id, dedupe_key')
      .in('user_id', userIds)
      .eq('kind', 'player_news')
      .in('dedupe_key', guids);
    for (const e of (existing ?? [])) dedupeSet.add(`${e.user_id}|${e.dedupe_key}`);
  }

  // De-dupe within this run too: same user shouldn't get notified for
  // the same player twice if multiple matching items in the same fetch.
  const sentThisRun = new Set<string>();

  for (const match of (matches ?? [])) {
    const userRow = (match as any).users;
    const pushToken = userRow?.push_token;
    if (!pushToken) continue;
    const prefs = userRow?.notification_prefs ?? {};
    if (prefs.player_news === false) continue;

    const news = newsByName.get(match.normalized_name) ?? [];
    for (const item of news) {
      const dedupe = item.guid;
      const seenKey = `${match.user_id}|${dedupe}`;
      if (dedupeSet.has(seenKey) || sentThisRun.has(seenKey)) continue;
      sentThisRun.add(seenKey);

      messages.push({
        to:        pushToken,
        title:     match.display_name,
        body:      item.title.length > 140 ? item.title.slice(0, 137) + '…' : item.title,
        sound:     'default',
        data:      {
          kind:       'player_news',
          player:     match.display_name,
          league_id:  match.league_id,
          platform:   match.platform,
          link:       item.link,
        },
      });
      logRows.push({
        user_id:    match.user_id,
        kind:       'player_news',
        dedupe_key: dedupe,
        title:      match.display_name,
        body:       item.title,
      });
    }
  }

  // 4. Insert log rows BEFORE sending the pushes — if the push API call
  // hiccups halfway through, we'd rather miss a notification than send
  // a duplicate on the next 15-min run.
  if (logRows.length > 0) {
    await sb.from('notification_log').insert(logRows);
  }

  await sendExpoPush(messages);

  return new Response(
    JSON.stringify({
      ok: true,
      items_seen:   items.length,
      matched_rows: matches?.length ?? 0,
      pushes_sent:  messages.length,
    }),
    { headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
