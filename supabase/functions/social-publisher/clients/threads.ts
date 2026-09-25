// Threads API. https://developers.facebook.com/docs/threads/posts
// Base https://graph.threads.net/v1.0
//
//   IMAGE:    POST /{threads-user-id}/threads  media_type=IMAGE, image_url, text
//   CAROUSEL: POST /{threads-user-id}/threads  media_type=IMAGE, image_url, is_carousel_item=true  (each, 2-20)
//             POST /{threads-user-id}/threads  media_type=CAROUSEL, children, text
//   TEXT:     POST /{threads-user-id}/threads  media_type=TEXT, text (500 chars)
//   replies:  the same TEXT container with reply_to_id
//   then:     GET /{container}?fields=status,error_message until FINISHED
//             POST /{threads-user-id}/threads_publish  creation_id -> {id}
//
// TOKEN ROTATION. Long-lived Threads tokens last 60 days and can be refreshed
// once they are at least 24 hours old:
//   GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=...
//   https://developers.facebook.com/docs/threads/get-started/long-lived-tokens
// The current token lives in app_settings 'threads_token' (seeded from the
// THREADS_TOKEN secret on first use) and is refreshed in place when it is
// older than 50 days, recorded in 'threads_token_refreshed_at'. A refresh
// that fails (e.g. token under 24h old) is logged and the old token is used.

import type { SocialPost } from '../../_shared/social/types.ts';
import { type Client, type Ctx, form, images, json } from '../ctx.ts';
import { waitForContainer } from './meta_container.ts';

const BASE = 'https://graph.threads.net/v1.0';
const REFRESH_AFTER_MS = 50 * 24 * 3600_000;

export async function threadsToken(ctx: Ctx): Promise<string> {
  let token = await ctx.db.getSetting('threads_token');
  let refreshedAt = Date.parse((await ctx.db.getSetting('threads_token_refreshed_at')) ?? '');
  if (!token) {
    token = ctx.env('THREADS_TOKEN') ?? null;
    if (!token) throw new Error('threads: no token (set THREADS_TOKEN)');
    await ctx.db.setSetting('threads_token', token);
    refreshedAt = NaN;   // unknown age: try a refresh now
  }
  if (!(refreshedAt > 0) || ctx.now() - refreshedAt > REFRESH_AFTER_MS) {
    try {
      const r = await json<{ access_token: string; expires_in: number }>(await ctx.fetch(
        `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`),
        'threads token refresh');
      token = r.access_token;
      await ctx.db.setSetting('threads_token', token);
      await ctx.db.setSetting('threads_token_refreshed_at', new Date(ctx.now()).toISOString());
      ctx.log('[threads] token refreshed, valid', Math.round(r.expires_in / 86400), 'days');
    } catch (e) {
      ctx.log('[threads] token refresh skipped:', String((e as Error)?.message ?? e).slice(0, 160));
    }
  }
  return token;
}

async function container(ctx: Ctx, user: string, token: string, params: Record<string, string | boolean | undefined>): Promise<string> {
  return (await json<{ id: string }>(await ctx.fetch(`${BASE}/${user}/threads`, {
    method: 'POST', body: form({ ...params, access_token: token }),
  }), `threads container (${params.media_type})`)).id;
}

async function publish(ctx: Ctx, user: string, token: string, id: string): Promise<string> {
  await waitForContainer(ctx, BASE, id, token, 'status', { label: 'threads', intervalMs: 5000, timeoutMs: 60_000 });
  return (await json<{ id: string }>(await ctx.fetch(`${BASE}/${user}/threads_publish`, {
    method: 'POST', body: form({ creation_id: id, access_token: token }),
  }), 'threads publish')).id;
}

export const threads: Client = async (post: SocialPost, ctx: Ctx) => {
  const user = ctx.env('THREADS_USER_ID')!;
  const token = await threadsToken(ctx);
  const imgs = images(post).slice(0, 20);

  let root: string;
  if (imgs.length === 0) {
    root = await container(ctx, user, token, { media_type: 'TEXT', text: post.body });
  } else if (imgs.length === 1) {
    root = await container(ctx, user, token, { media_type: 'IMAGE', image_url: imgs[0].url, text: post.body });
  } else {
    const children: string[] = [];
    for (const m of imgs) children.push(await container(ctx, user, token, { media_type: 'IMAGE', image_url: m.url, is_carousel_item: true }));
    root = await container(ctx, user, token, { media_type: 'CAROUSEL', children: children.join(','), text: post.body });
  }
  const rootId = await publish(ctx, user, token, root);

  // The main post is live now: a failed reply must not throw, or the row
  // would be retried and the main post published twice.
  let parent = rootId, threadError: string | undefined;
  try {
    for (const t of post.thread ?? []) {
      const c = await container(ctx, user, token, { media_type: 'TEXT', text: t, reply_to_id: parent });
      parent = await publish(ctx, user, token, c);
    }
  } catch (e) { threadError = String((e as Error)?.message ?? e).slice(0, 300); }
  const link = await json<{ permalink?: string }>(await ctx.fetch(
    `${BASE}/${rootId}?fields=permalink&access_token=${encodeURIComponent(token)}`), 'threads permalink')
    .catch(() => ({} as { permalink?: string }));
  return { url: link.permalink ?? null, extra: { threads_media_id: rootId, ...(threadError ? { thread_error: threadError } : {}) } };
};
