// Daily social generator: theme -> data -> graphics -> copy -> queued posts.
//
//   node scripts/social/generate.ts                  today's theme, live
//   node scripts/social/generate.ts --theme rankings --dry-run --out /tmp/x
//
// Runs in GitHub Actions each morning (.github/workflows/social-daily.yml),
// which has Chrome and ffmpeg for the graphics. Needs SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY. Writes public.social_posts; social-publisher
// posts the 'auto' rows after the veto window, and the /rank Posts tab shows
// the copy-paste ones.
//
// VETO WINDOW. Automated posts publish 3 hours after they are queued (90
// minutes on Sunday, so final calls land before the 1pm ET kickoff) unless the
// owner taps Hold. Rows he has held, or that are already publishing, posted
// or done, are never overwritten by a re-run.

import { basename, extname, join } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { buildTheme, restDb } from './data.ts';
import { copyFor } from './copy.ts';
import { MODE, type Media, type Network, type RenderedSet, type SocialPost, type Theme } from '../../supabase/functions/_shared/social/types.ts';

// US/Eastern weekday -> themes, in posting order. The second theme of a day
// publishes 4 hours after the first. Sunday runs after the 13:45 UTC rankings
// build; Tuesday after the 14:15 UTC harvest (waivers needs fresh roster %).
// "disagree" sits on Wednesday because the expert consensus is harvested on
// Tuesday: by Saturday it predates the injury news and the gaps go stale.
const DAY_THEMES: Theme[][] = [
  ['final_calls'],             // Sun
  ['hits', 'usage'],           // Mon
  ['waivers', 'report_card'],  // Tue
  ['rankings', 'disagree'],    // Wed
  ['tnf', 'shootout'],         // Thu
  ['injuries', 'next_man_up'], // Fri
  ['weather'],                 // Sat
];
const STAGGER_MS = 4 * 3600_000;
const NETWORKS: Network[] = ['x', 'threads', 'bluesky', 'instagram', 'facebook', 'youtube', 'tiktok', 'reddit'];
// Reddit only where a data post is welcome; daily brand posts get accounts banned.
const REDDIT_THEMES: Theme[] = ['rankings', 'report_card'];
const KEEP: SocialPost['status'][] = ['held', 'publishing', 'posted', 'done'];

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (k: string) => process.argv.includes(`--${k}`);

function etNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, dow, year: Number(parts.year), month: Number(parts.month) };
}

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4' };

async function upload(url: string, key: string, path: string, file: string) {
  const r = await fetch(`${url}/storage/v1/object/social/${path}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'x-upsert': 'true', 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' },
    body: readFileSync(file),
  });
  if (!r.ok) throw new Error(`upload ${path} ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return `${url}/storage/v1/object/public/social/${path}`;
}

function mediaFor(network: Network, r: { portrait: Media[]; landscape: Media[]; video: Media[]; cover: Media[] }): Media[] {
  switch (network) {
    case 'x': case 'bluesky': return r.landscape.slice(0, 4);
    case 'instagram': return r.portrait.slice(0, 10);
    case 'threads': case 'facebook': return r.portrait.slice(0, 10);
    // The cover rides along as an image: the Posts tab uses it as the video's
    // poster, and the publisher only ever uploads the video item.
    case 'youtube': case 'tiktok': return r.video.length ? [...r.video, ...r.cover] : [];
    case 'reddit': return r.portrait.slice(0, 4);
  }
}

async function main() {
  const now = etNow();
  const themes: Theme[] = arg('theme') ? [arg('theme') as Theme] : DAY_THEMES[now.dow];
  for (const [i, theme] of themes.entries()) {
    try { await runTheme(theme, i, now); }
    catch (e) { console.error(`[social] ${theme} failed:`, (e as Error)?.message ?? e); process.exitCode = 1; }
  }
}

async function runTheme(theme: Theme, slot: number, now: ReturnType<typeof etNow>) {
  const date = arg('date') ?? now.date;
  const season = Number(arg('season')) || (now.month >= 3 ? now.year : now.year - 1);
  const dry = flag('dry-run');
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const db = restDb(url, key);

  const data = await buildTheme(db, theme, season);
  if (!data) { console.log(`[social] ${date} ${theme}: nothing to post (no data yet)`); return; }

  const out = arg('out') ? join(arg('out')!, theme) : mkdtempSync(join(tmpdir(), 'social-'));
  mkdirSync(out, { recursive: true });
  const { render } = await import('./render/render.ts') as { render: (d: typeof data, o: string) => Promise<RenderedSet> };
  const set = await render(data, out);
  // Instagram's publishing API takes JPEG only (it rejects PNG), so the
  // portrait set -- Instagram, Threads, Facebook, Reddit -- ships as JPEG.
  set.portrait = set.portrait.map(f => {
    const jpg = f.replace(/\.png$/i, '.jpg');
    if (jpg !== f) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', f, '-q:v', '2', jpg]);
    return jpg;
  });

  // Upload media once; every network references the same public URLs.
  const put = async (file: string) => dry ? `file://${file}` : upload(url, key, `${date}/${theme}/${basename(file)}`, file);
  const alt = (i: number) => set.alt[i] ?? set.alt[0] ?? `AIOmni week ${data.week} ${theme}`;
  const media = {
    portrait: await Promise.all(set.portrait.map(async (f, i) => ({ kind: 'image' as const, url: await put(f), width: 1080, height: 1350, alt: alt(i) }))),
    landscape: await Promise.all(set.landscape.map(async (f, i) => ({ kind: 'image' as const, url: await put(f), width: 1600, height: 900, alt: alt(i) }))),
    video: set.video ? [{ kind: 'video' as const, url: await put(set.video), width: 1080, height: 1920, alt: alt(0) }] : [],
  };
  const cover = set.cover ? await put(set.cover) : null;
  const coverMedia: Media[] = cover ? [{ kind: 'image', url: cover, width: 1080, height: 1920, alt: `Cover: ${alt(0)}` }] : [];

  const windowMs = (now.dow === 0 ? 90 : 180) * 60_000;
  const publishAt = new Date(Date.now() + windowMs + slot * STAGGER_MS).toISOString();

  const rows: SocialPost[] = [];
  for (const network of NETWORKS) {
    if (network === 'reddit' && !REDDIT_THEMES.includes(theme)) continue;
    const m = mediaFor(network, { ...media, cover: coverMedia });
    if ((network === 'youtube' || network === 'tiktok') && !m.some(x => x.kind === 'video')) continue;   // video networks need a video
    const c = copyFor(network, data);
    const mode = MODE[network];
    rows.push({
      post_date: date, theme, network, mode,
      status: mode === 'manual' ? 'ready' : 'queued',
      publish_at: mode === 'manual' ? null : publishAt,
      title: c.title ?? null, body: c.body, thread: c.thread ?? null, media: m,
      link: `https://getaiomni.com/rankings`,
      extra: { ...(c.steps ? { steps: c.steps } : {}), ...(c.subreddit ? { subreddit: c.subreddit, subreddit_note: c.subreddit_note } : {}),
        ...(cover ? { cover } : {}) },
    });
  }

  if (dry) {
    console.log(JSON.stringify({ date, theme, week: data.week, out, rows }, null, 1));
    return;
  }

  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const existing = await db.get<SocialPost>(`social_posts?select=id,network,status&post_date=eq.${date}&theme=eq.${theme}`);
  let written = 0, kept = 0;
  for (const row of rows) {
    const ex = existing.find(e => e.network === row.network);
    if (ex && KEEP.includes(ex.status)) { kept++; continue; }
    const r = ex
      ? await fetch(`${url}/rest/v1/social_posts?id=eq.${ex.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ ...row, attempts: 0, error: null, updated_at: new Date().toISOString() }) })
      : await fetch(`${url}/rest/v1/social_posts`, { method: 'POST', headers: h, body: JSON.stringify(row) });
    if (!r.ok) throw new Error(`write ${row.network} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    written++;
  }
  console.log(`[social] ${date} ${theme} week ${data.week}: ${written} queued, ${kept} left alone (held/posted/done), publishes ${publishAt}`);
}

main().catch(e => { console.error('[social] failed:', e?.message ?? e); process.exit(1); });
