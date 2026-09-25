// Tests for supabase/functions/social-publisher with a mock fetch and an
// in-memory PostgREST. No network, no real credentials.
//
//   node scripts/social/publisher_test.ts

import { baseString, oauth1Header, hmacSha1Base64, pct } from '../../supabase/functions/social-publisher/oauth1.ts';
import { linkFacets, bluesky } from '../../supabase/functions/social-publisher/clients/bluesky.ts';
import { x } from '../../supabase/functions/social-publisher/clients/x.ts';
import { facebook } from '../../supabase/functions/social-publisher/clients/facebook.ts';
import { instagram } from '../../supabase/functions/social-publisher/clients/instagram.ts';
import { threads } from '../../supabase/functions/social-publisher/clients/threads.ts';
import { youtube } from '../../supabase/functions/social-publisher/clients/youtube.ts';
import { runPublisher } from '../../supabase/functions/social-publisher/core.ts';
import type { Ctx, Db } from '../../supabase/functions/social-publisher/ctx.ts';
import type { SocialPost } from '../../supabase/functions/_shared/social/types.ts';

let passed = 0, failed = 0;
const check = (cond: unknown, msg: string) => {
  if (cond) passed++;
  else { failed++; console.log('  FAIL:', msg); }
};
const section = (s: string) => console.log(`\n== ${s}`);

// ── mocks ───────────────────────────────────────────────────────────────────
interface Call { url: string; method: string; headers: Record<string, string>; body: any; bodyText: string }
type Route = [RegExp | string, (c: Call, n: number) => Response | Promise<Response>];

function mockFetch(routes: Route[]) {
  const calls: Call[] = [];
  const hits = new Map<number, number>();
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    let body: any = init.body, bodyText = '';
    if (body instanceof URLSearchParams) { bodyText = body.toString(); body = Object.fromEntries(body); }
    else if (typeof body === 'string') { bodyText = body; try { body = JSON.parse(body); } catch { /* raw */ } }
    else if (body instanceof FormData) { const o: Record<string, unknown> = {}; body.forEach((v, k) => { o[k] = v; }); body = o; }
    else if (body instanceof Uint8Array || body instanceof ArrayBuffer) { bodyText = `<${body.byteLength} bytes>`; }
    const call: Call = { url, method: (init.method ?? 'GET').toUpperCase(), headers, body, bodyText };
    calls.push(call);
    for (let i = 0; i < routes.length; i++) {
      const [pat, fn] = routes[i];
      if (typeof pat === 'string' ? url.includes(pat) : pat.test(url)) {
        const n = (hits.get(i) ?? 0) + 1; hits.set(i, n);
        return await fn(call, n);
      }
    }
    return new Response(`no route for ${call.method} ${url}`, { status: 599 });
  }) as typeof fetch;
  return { f, calls };
}
const J = (o: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', ...headers } });
const IMG = (type = 'image/png') => new Response(new Uint8Array(1234), { status: 200, headers: { 'content-type': type } });

function memDb(rows: any[] = [], settings: Record<string, string> = {}): Db & { rows: any[]; settings: Record<string, string> } {
  const matches = (r: any, filter: string) => {
    const q = new URLSearchParams(filter.split('?')[1] ?? '');
    for (const [k, v] of q) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      const [op, val] = [v.slice(0, v.indexOf('.')), v.slice(v.indexOf('.') + 1)];
      if (op === 'eq' && String(r[k]) !== val) return false;
      if (op === 'in' && !val.replace(/[()]/g, '').split(',').includes(String(r[k]))) return false;
      if (op === 'lte' && !(Date.parse(r[k]) <= Date.parse(decodeURIComponent(val)))) return false;
    }
    return true;
  };
  return {
    rows, settings,
    async select(q) { return rows.filter(r => matches(r, q)).map(r => ({ ...r })); },
    async patch(f, body) { const hit = rows.filter(r => matches(r, f)); hit.forEach(r => Object.assign(r, body)); return hit.map(r => ({ ...r })); },
    async getSetting(k) { return settings[k] ?? null; },
    async setSetting(k, v) { settings[k] = v; },
  };
}

const ENV: Record<string, string> = {
  BLUESKY_HANDLE: 'aiomni.bsky.social', BLUESKY_APP_PASSWORD: 'xxxx-xxxx',
  X_API_KEY: 'ck', X_API_SECRET: 'cs', X_ACCESS_TOKEN: 'at', X_ACCESS_SECRET: 'as',
  META_PAGE_ID: 'PAGE1', META_PAGE_TOKEN: 'PTOKEN', IG_USER_ID: 'IG1',
  THREADS_USER_ID: 'TU1', THREADS_TOKEN: 'TTOKEN',
  YT_CLIENT_ID: 'yc', YT_CLIENT_SECRET: 'ys', YT_REFRESH_TOKEN: 'yr',
};
let clock = Date.parse('2026-09-27T15:00:00Z');
const mkCtx = (f: typeof fetch, db: Db = memDb(), env: Record<string, string> = ENV): Ctx => ({
  fetch: f, env: k => env[k], db, sleep: async (ms) => { clock += ms; }, now: () => clock, log: () => {},
});

const img = (name: string, ext = 'png') => ({ kind: 'image' as const, url: `https://sb.test/storage/v1/object/public/social/2026-09-27/final_calls/${name}.${ext}`, width: 1080, height: 1350, alt: `alt ${name}` });
const post = (over: Partial<SocialPost> = {}): SocialPost => ({
  post_date: '2026-09-27', theme: 'final_calls', network: 'bluesky', mode: 'auto', status: 'queued',
  publish_at: '2026-09-27T14:00:00Z', title: null,
  body: '🏈 Week 3 final calls are in: getaiomni.com/rankings', thread: ['Reply one', 'Reply two'],
  media: [img('a'), img('b')], link: 'https://getaiomni.com/rankings', extra: {}, ...over,
});

// ── OAuth 1.0a: X's published example ──────────────────────────────────────
// https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
section('OAuth 1.0a signature (X docs example)');
{
  const url = 'https://api.twitter.com/1.1/statuses/update.json?include_entities=true';
  const params = {
    status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
    oauth_consumer_key: 'xvz1evFS4wEEPTGEFPHBog',
    oauth_nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: '1318622958',
    oauth_token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', oauth_version: '1.0',
  };
  const base = baseString('POST', url, params);
  const expectedBase = 'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&include_entities%3Dtrue%26oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26oauth_signature_method%3DHMAC-SHA1%26oauth_timestamp%3D1318622958%26oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26oauth_version%3D1.0%26status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521';
  check(base === expectedBase, 'signature base string matches the docs');
  const sig = await hmacSha1Base64(`${pct('kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw')}&${pct('LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE')}`, base);
  check(sig === 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=', `signature matches docs (got ${sig})`);
  const header = await oauth1Header('POST', url, {
    consumerKey: 'xvz1evFS4wEEPTGEFPHBog', consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
    token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb', tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
  }, { formParams: { status: params.status }, nonce: params.oauth_nonce, timestamp: params.oauth_timestamp });
  check(header.includes('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"'), 'Authorization header carries the encoded signature');
  check(header.startsWith('OAuth ') && !header.includes('status='), 'header has oauth_* only (body params signed, not sent in header)');
}

// ── Bluesky ────────────────────────────────────────────────────────────────
section('bluesky');
{
  const facets = linkFacets('🏈 Week 3: getaiomni.com/rankings.');
  const f0 = facets[0] as any;
  const enc = new TextEncoder();
  const text = '🏈 Week 3: getaiomni.com/rankings.';
  const slice = new TextDecoder().decode(enc.encode(text).slice(f0.index.byteStart, f0.index.byteEnd));
  check(slice === 'getaiomni.com/rankings', `facet byte range covers the link, not the emoji or trailing dot (got "${slice}")`);
  check(f0.features[0].uri === 'https://getaiomni.com/rankings', 'bare domain gets https:// in the facet uri');

  const m = mockFetch([
    ['createSession', () => J({ accessJwt: 'JWT', did: 'did:plc:abc', handle: 'aiomni.bsky.social' })],
    ['/social/', () => IMG()],
    ['uploadBlob', (_c, n) => J({ blob: { $type: 'blob', ref: { $link: `cid${n}` }, mimeType: 'image/png', size: 1234 } })],
    ['createRecord', (_c, n) => J({ uri: `at://did:plc:abc/app.bsky.feed.post/rkey${n}`, cid: `cid-post-${n}` })],
  ]);
  const res = await bluesky(post(), mkCtx(m.f));
  const creates = m.calls.filter(c => c.url.includes('createRecord'));
  check(m.calls[0].body.identifier === 'aiomni.bsky.social' && m.calls[0].body.password === 'xxxx-xxxx', 'createSession uses handle + app password');
  check(m.calls.filter(c => c.url.includes('uploadBlob')).every(c => c.headers.authorization === 'Bearer JWT' && c.headers['content-type'] === 'image/png'), 'uploadBlob: bearer + image content-type');
  const rec0 = creates[0].body.record;
  check(creates[0].body.repo === 'did:plc:abc' && creates[0].body.collection === 'app.bsky.feed.post', 'createRecord repo/collection');
  check(rec0.embed?.$type === 'app.bsky.embed.images' && rec0.embed.images.length === 2 && rec0.embed.images[0].alt === 'alt a', 'root post embeds 2 images with alt');
  check(rec0.embed.images[0].aspectRatio.width === 1080, 'aspectRatio set');
  check(Array.isArray(rec0.facets) && rec0.facets.length === 1, 'root post has a link facet');
  check(creates.length === 3, '1 root + 2 replies');
  check(creates[1].body.record.reply.root.uri.endsWith('rkey1') && creates[2].body.record.reply.parent.uri.endsWith('rkey2'), 'replies chain root/parent');
  check(res.url === 'https://bsky.app/profile/aiomni.bsky.social/post/rkey1', `post url (${res.url})`);

  const big = mockFetch([
    ['createSession', () => J({ accessJwt: 'JWT', did: 'did:plc:abc', handle: 'h' })],
    ['/social/', () => new Response(new Uint8Array(2_100_000), { headers: { 'content-type': 'image/png' } })],
  ]);
  let err = '';
  try { await bluesky(post(), mkCtx(big.f)); } catch (e) { err = String(e); }
  check(err.includes('2 MB'), 'oversize image is refused before upload');
}

// ── X ──────────────────────────────────────────────────────────────────────
section('x');
{
  const m = mockFetch([
    ['/social/', () => IMG()],
    ['api.x.com/2/media/upload', (_c, n) => J({ data: { id: `m${n}` } })],
    ['api.x.com/2/tweets', (_c, n) => J({ data: { id: `t${n}`, text: '' } }, 201)],
  ]);
  const res = await x(post({ network: 'x' }), mkCtx(m.f));
  const ups = m.calls.filter(c => c.url.includes('/2/media/upload'));
  const tws = m.calls.filter(c => c.url.includes('/2/tweets'));
  check(ups.length === 2 && ups.every(c => c.method === 'POST' && /^OAuth .*oauth_signature="/.test(c.headers.authorization)), 'media upload: 2 signed POSTs');
  check(ups[0].body.media_category === 'tweet_image' && ups[0].body.media instanceof Blob, 'multipart media + media_category=tweet_image');
  check(tws[0].body.media?.media_ids?.join(',') === 'm1,m2' && tws[0].body.text.startsWith('🏈'), 'post has text + both media ids');
  check(tws[0].headers['content-type'] === 'application/json' && tws[0].headers.authorization.includes('oauth_consumer_key="ck"'), 'post is JSON, OAuth 1.0a signed with the consumer key');
  check(tws[1].body.reply?.in_reply_to_tweet_id === 't1' && tws[2].body.reply?.in_reply_to_tweet_id === 't2', 'thread replies chain');
  check(res.url === 'https://x.com/i/web/status/t1', 'post url');

  const fb = mockFetch([
    ['/social/', () => IMG()],
    ['api.x.com/2/media/upload', () => J({ errors: [{ message: 'Unsupported Authentication' }] }, 403)],
    ['upload.x.com/1.1/media/upload.json', () => J({ media_id_string: 'legacy1' })],
    ['api.x.com/2/tweets', () => J({ data: { id: 't9' } }, 201)],
  ]);
  await x(post({ network: 'x', media: [img('a')], thread: null }), mkCtx(fb.f));
  check(fb.calls.some(c => c.url.includes('upload.x.com/1.1')) && fb.calls.find(c => c.url.includes('/2/tweets'))?.body.media.media_ids[0] === 'legacy1', 'falls back to v1.1 upload when v2 refuses OAuth 1.0a');

  const rf = mockFetch([
    ['/social/', () => IMG()],
    ['api.x.com/2/media/upload', () => J({ data: { id: 'm1' } })],
    ['api.x.com/2/tweets', (_c, n) => n === 1 ? J({ data: { id: 't1' } }, 201) : J({ title: 'Too Many Requests' }, 429)],
  ]);
  const r2 = await x(post({ network: 'x' }), mkCtx(rf.f));
  check(r2.url === 'https://x.com/i/web/status/t1' && String(r2.extra?.thread_error).includes('429'), 'a failed reply does not fail the row (no double-post on retry)');
}

// ── Facebook ───────────────────────────────────────────────────────────────
section('facebook');
{
  const one = mockFetch([['/PAGE1/photos', () => J({ id: 'ph1', post_id: 'PAGE1_99' })]]);
  const r1 = await facebook(post({ network: 'facebook', media: [img('a')], thread: ['more'] }), mkCtx(one.f));
  check(one.calls[0].url === 'https://graph.facebook.com/v25.0/PAGE1/photos' && one.calls[0].body.url.endsWith('a.png'), 'single photo -> /{page}/photos with url');
  check(one.calls[0].body.message.includes('more') && one.calls[0].body.access_token === 'PTOKEN', 'thread folded into message; page token');
  check(r1.url === 'https://www.facebook.com/PAGE1_99', 'post url from post_id');

  const multi = mockFetch([
    ['/PAGE1/photos', (_c, n) => J({ id: `ph${n}` })],
    ['/PAGE1/feed', () => J({ id: 'PAGE1_100' })],
  ]);
  await facebook(post({ network: 'facebook' }), mkCtx(multi.f));
  const photos = multi.calls.filter(c => c.url.endsWith('/photos'));
  const feed = multi.calls.find(c => c.url.endsWith('/feed'))!;
  check(photos.length === 2 && photos.every(c => c.body.published === 'false'), 'multi: unpublished photos first');
  check(JSON.parse(feed.body.attached_media).map((a: any) => a.media_fbid).join(',') === 'ph1,ph2', 'feed post attaches both media_fbid');
}

// ── Instagram ──────────────────────────────────────────────────────────────
section('instagram');
{
  let err = '';
  try { await instagram(post({ network: 'instagram' }), mkCtx(mockFetch([]).f)); } catch (e) { err = String(e); }
  check(err.includes('JPEG only'), 'PNG refused with a clear message (Instagram is JPEG-only)');

  const m = mockFetch([
    [/\/IG1\/media$/, (c, n) => J({ id: c.body.media_type === 'CAROUSEL' ? 'car1' : `item${n}` })],
    [/fields=status_code/, (c) => J({ status_code: c.url.includes('/car1?') && !(globalThis as any).__igPolled ? ((globalThis as any).__igPolled = true, 'IN_PROGRESS') : 'FINISHED' })],
    ['/IG1/media_publish', () => J({ id: 'igmedia1' })],
    [/igmedia1\?fields=permalink/, () => J({ permalink: 'https://www.instagram.com/p/ABC/' })],
  ]);
  const res = await instagram(post({ network: 'instagram', media: [img('a', 'jpg'), img('b', 'jpg')] }), mkCtx(m.f));
  const items = m.calls.filter(c => /\/IG1\/media$/.test(c.url) && c.body.is_carousel_item === 'true');
  const car = m.calls.find(c => c.body?.media_type === 'CAROUSEL')!;
  check(m.calls[0].url.startsWith('https://graph.facebook.com/v25.0/IG1/media'), 'META_PAGE_TOKEN -> graph.facebook.com');
  check(items.length === 2 && car.body.children === 'item1,item2' && car.body.caption.startsWith('🏈'), 'carousel: 2 items then CAROUSEL container with caption');
  check(m.calls.filter(c => c.url.includes('/car1?fields=status_code')).length === 2, 'waits for IN_PROGRESS -> FINISHED before publishing');
  check(m.calls.find(c => c.url.endsWith('/media_publish'))!.body.creation_id === 'car1', 'media_publish with creation_id');
  check(res.url === 'https://www.instagram.com/p/ABC/', 'permalink returned');

  const ig = mockFetch([
    [/\/IG1\/media$/, () => J({ id: 'c1' })],
    [/fields=status_code/, () => J({ status_code: 'FINISHED' })],
    ['/IG1/media_publish', () => J({ id: 'p1' })],
    [/fields=permalink/, () => J({})],
  ]);
  await instagram(post({ network: 'instagram', media: [img('a', 'jpg')] }), mkCtx(ig.f, memDb(), { ...ENV, IG_TOKEN: 'IGT' }));
  check(ig.calls[0].url.startsWith('https://graph.instagram.com/') && ig.calls[0].body.alt_text === 'alt a' && ig.calls[0].body.access_token === 'IGT', 'IG_TOKEN -> graph.instagram.com; single image carries alt_text');
}

// ── Threads ────────────────────────────────────────────────────────────────
section('threads');
{
  const db = memDb();
  const m = mockFetch([
    ['refresh_access_token', () => J({ access_token: 'TTOKEN2', token_type: 'bearer', expires_in: 5184000 })],
    [/\/TU1\/threads$/, (c, n) => J({ id: `ct${n}` })],
    [/fields=status/, () => J({ status: 'FINISHED' })],
    ['/TU1/threads_publish', (_c, n) => J({ id: `tp${n}` })],
    [/fields=permalink/, () => J({ permalink: 'https://www.threads.net/@aiomni/post/X' })],
  ]);
  const res = await threads(post({ network: 'threads' }), mkCtx(m.f, db));
  check(m.calls[0].url.includes('grant_type=th_refresh_token') && m.calls[0].url.includes('access_token=TTOKEN'), 'token of unknown age is refreshed first');
  check(db.settings.threads_token === 'TTOKEN2' && !!db.settings.threads_token_refreshed_at, 'refreshed token stored in app_settings');
  const conts = m.calls.filter(c => /\/TU1\/threads$/.test(c.url));
  check(conts[0].body.is_carousel_item === 'true' && conts[1].body.is_carousel_item === 'true' && conts[2].body.media_type === 'CAROUSEL' && conts[2].body.children === 'ct1,ct2', 'carousel items then CAROUSEL container');
  check(conts.every(c => c.body.access_token === 'TTOKEN2'), 'uses the refreshed token');
  check(conts[3].body.media_type === 'TEXT' && conts[3].body.reply_to_id === 'tp1' && conts[4].body.reply_to_id === 'tp2', 'replies as TEXT with reply_to_id chain');
  check(res.url === 'https://www.threads.net/@aiomni/post/X', 'permalink');

  const db2 = memDb([], { threads_token: 'FRESH', threads_token_refreshed_at: new Date(clock - 86400_000).toISOString() });
  const m2 = mockFetch([
    [/\/TU1\/threads$/, () => J({ id: 'c1' })], [/fields=status/, () => J({ status: 'FINISHED' })],
    ['/TU1/threads_publish', () => J({ id: 'p1' })], [/fields=permalink/, () => J({})],
  ]);
  await threads(post({ network: 'threads', media: [], thread: null }), mkCtx(m2.f, db2));
  check(!m2.calls.some(c => c.url.includes('refresh_access_token')) && m2.calls[0].body.media_type === 'TEXT', 'recent token not refreshed; no media -> TEXT post');
}

// ── YouTube ────────────────────────────────────────────────────────────────
section('youtube');
{
  const m = mockFetch([
    ['oauth2.googleapis.com/token', () => J({ access_token: 'YA', expires_in: 3599 })],
    ['/social/', () => new Response(new Uint8Array(5000), { headers: { 'content-type': 'video/mp4' } })],
    ['upload/youtube/v3/videos', () => new Response('', { status: 200, headers: { location: 'https://upload.test/session/1' } })],
    ['upload.test/session/1', () => J({ id: 'vid123' })],
  ]);
  const res = await youtube(post({ network: 'youtube', mode: 'semi', title: 'Week 3 final calls', media: [{ kind: 'video', url: 'https://sb.test/social/v.mp4', width: 1080, height: 1920, alt: '' }] }), mkCtx(m.f));
  const tok = m.calls[0], init = m.calls.find(c => c.url.includes('uploadType=resumable'))!, put = m.calls.find(c => c.method === 'PUT')!;
  check(tok.body.grant_type === 'refresh_token' && tok.body.refresh_token === 'yr', 'refresh-token grant');
  check(init.headers['x-upload-content-length'] === '5000' && init.headers['x-upload-content-type'] === 'video/mp4', 'resumable init headers');
  check(init.body.status.privacyStatus === 'private' && init.body.snippet.title === 'Week 3 final calls' && init.body.snippet.categoryId === '17', 'uploads PRIVATE, title, Sports category');
  check(put.headers.authorization === 'Bearer YA' && put.bodyText === '<5000 bytes>', 'PUT bytes to the session URL');
  check(res.url === 'https://studio.youtube.com/video/vid123/edit' && res.extra?.youtube_video_id === 'vid123', 'studio link + video id');
}

// ── core loop ──────────────────────────────────────────────────────────────
section('core');
{
  const row = (id: number, network: string, over: any = {}) => ({ id, ...post({ network: network as any }), attempts: 0, extra: { steps: ['x'] }, ...over });

  const paused = await runPublisher(mkCtx(mockFetch([]).f, memDb([row(1, 'bluesky')], { social_autopost: 'off' })));
  check(paused.paused === true && paused.processed.length === 0, 'kill switch off -> nothing happens');

  // Bluesky connected, X not, one row not due yet, one manual row.
  const db = memDb([
    row(1, 'bluesky'),
    row(2, 'x'),
    row(3, 'bluesky', { publish_at: '2026-09-27T18:00:00Z' }),
    row(4, 'tiktok', { mode: 'manual', status: 'ready' }),
  ], { social_autopost: 'on' });
  const env = { ...ENV }; delete env.X_ACCESS_SECRET;
  const bsky = mockFetch([
    ['createSession', () => J({ accessJwt: 'JWT', did: 'did:plc:abc', handle: 'h' })],
    ['/social/', () => IMG()],
    ['uploadBlob', () => J({ blob: {} })],
    ['createRecord', (_c, n) => J({ uri: `at://d/app.bsky.feed.post/r${n}`, cid: 'c' })],
  ]);
  const dry = await runPublisher(mkCtx(bsky.f, db, env), { dryRun: true });
  check(dry.processed.length === 2 && bsky.calls.length === 0 && db.rows[0].status === 'queued', 'dry run: lists 2 due rows, touches nothing');
  check(dry.processed.find(p => p.network === 'x')?.missing?.[0] === 'X_ACCESS_SECRET', 'dry run names the missing secret');

  const run = await runPublisher(mkCtx(bsky.f, db, env));
  const byId = (id: number) => db.rows.find(r => r.id === id);
  check(byId(1).status === 'posted' && byId(1).posted_url.includes('/post/r1') && byId(1).extra.steps?.[0] === 'x', 'due bluesky row posted; extra preserved');
  check(byId(2).status === 'skipped' && byId(2).error === 'not connected: set X_ACCESS_SECRET', 'unconnected network -> skipped with secret name');
  check(byId(3).status === 'queued' && byId(4).status === 'ready', 'not-yet-due and manual rows untouched');
  check(run.processed.length === 2, 'processed exactly the 2 due rows');

  // Claim race: another run already took the row.
  const raceDb = memDb([row(5, 'bluesky')], { social_autopost: 'on' });
  const origPatch = raceDb.patch.bind(raceDb);
  raceDb.patch = async (f, b) => (f.includes('status=eq.queued') ? (raceDb.rows[0].status = 'publishing', []) : origPatch(f, b));
  const race = await runPublisher(mkCtx(bsky.f, raceDb));
  check(race.processed.length === 0, 'row claimed elsewhere is skipped (no double-post)');

  // Failure -> retry queued, then failed on the 3rd attempt.
  const failDb = memDb([row(6, 'bluesky', { attempts: 0 })], { social_autopost: 'on' });
  const boom = mockFetch([['createSession', () => J({ error: 'AuthenticationRequired' }, 401)]]);
  await runPublisher(mkCtx(boom.f, failDb));
  const r6 = failDb.rows[0];
  check(r6.status === 'queued' && r6.attempts === 1 && Date.parse(r6.publish_at) === clock + 15 * 60_000 && r6.error.includes('401'), 'first failure -> requeued +15 min with error');
  r6.attempts = 2; r6.publish_at = new Date(clock - 1).toISOString();
  await runPublisher(mkCtx(boom.f, failDb));
  check(r6.status === 'failed' && r6.attempts === 3, 'third failure -> failed');

  // Publish-now by id ignores publish_at but still needs status queued.
  const nowDb = memDb([row(7, 'bluesky', { publish_at: '2026-09-28T00:00:00Z' }), row(8, 'bluesky', { status: 'held' })], { social_autopost: 'on' });
  await runPublisher(mkCtx(bsky.f, nowDb), { id: 7 });
  await runPublisher(mkCtx(bsky.f, nowDb), { id: 8 });
  check(nowDb.rows[0].status === 'posted' && nowDb.rows[1].status === 'held', 'publish-now works on a queued row, never on a held one');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
