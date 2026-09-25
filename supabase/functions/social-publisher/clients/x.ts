// X (Twitter). OAuth 1.0a user context (the brand account's own tokens).
//
//   POST https://api.x.com/2/media/upload   multipart: media, media_category=tweet_image
//        https://docs.x.com/x-api/media/upload-media  -> { data: { id } }
//   POST https://api.x.com/2/tweets          JSON: text, media.media_ids (1-4), reply.in_reply_to_tweet_id
//        https://docs.x.com/x-api/posts/create-post   -> 201 { data: { id } }
//
// Posting is pay-per-use for new developers (2026). Media upload auth on the
// v2 endpoint has been reported flaky with OAuth 1.0a on X's dev forum
// (devcommunity.x.com/t/241900); if v2 refuses the token (401/403) we fall
// back to the legacy v1.1 upload endpoint, which has always taken OAuth 1.0a.
// JSON and multipart bodies are not part of the OAuth 1.0a signature.

import type { SocialPost } from '../../_shared/social/types.ts';
import { type Client, type Ctx, download, images, json } from '../ctx.ts';
import { oauth1Header, type OAuth1Creds } from '../oauth1.ts';

const API = 'https://api.x.com';
const V1_UPLOAD = 'https://upload.x.com/1.1/media/upload.json';

const creds = (ctx: Ctx): OAuth1Creds => ({
  consumerKey: ctx.env('X_API_KEY')!, consumerSecret: ctx.env('X_API_SECRET')!,
  token: ctx.env('X_ACCESS_TOKEN')!, tokenSecret: ctx.env('X_ACCESS_SECRET')!,
});

async function uploadImage(ctx: Ctx, bytes: ArrayBuffer, type: string): Promise<string> {
  const c = creds(ctx);
  const body = () => {
    const fd = new FormData();
    fd.append('media', new Blob([bytes], { type }), 'image');
    fd.append('media_category', 'tweet_image');
    return fd;
  };
  const url = `${API}/2/media/upload`;
  const res = await ctx.fetch(url, { method: 'POST', headers: { Authorization: await oauth1Header('POST', url, c) }, body: body() });
  if (res.status === 401 || res.status === 403) {
    ctx.log('[x] v2 media upload refused OAuth 1.0a (', res.status, '), falling back to v1.1');
    const r1 = await json<{ media_id_string: string }>(await ctx.fetch(V1_UPLOAD, {
      method: 'POST', headers: { Authorization: await oauth1Header('POST', V1_UPLOAD, c) }, body: body(),
    }), 'x media upload (v1.1)');
    return r1.media_id_string;
  }
  const r = await json<{ data: { id: string } }>(res, 'x media upload');
  return r.data.id;
}

async function tweet(ctx: Ctx, payload: Record<string, unknown>): Promise<string> {
  const url = `${API}/2/tweets`;
  const r = await json<{ data: { id: string } }>(await ctx.fetch(url, {
    method: 'POST',
    headers: { Authorization: await oauth1Header('POST', url, creds(ctx)), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }), 'x create post');
  return r.data.id;
}

export const x: Client = async (post: SocialPost, ctx: Ctx) => {
  const mediaIds: string[] = [];
  for (const m of images(post).slice(0, 4)) {
    const { bytes, type } = await download(ctx, m);
    mediaIds.push(await uploadImage(ctx, bytes, type));
  }
  const first = await tweet(ctx, { text: post.body, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) });
  // The main post is live now: a failed reply must not throw, or the row
  // would be retried and the main post published twice.
  let parent = first, threadError: string | undefined;
  try { for (const t of post.thread ?? []) parent = await tweet(ctx, { text: t, reply: { in_reply_to_tweet_id: parent } }); }
  catch (e) { threadError = String((e as Error)?.message ?? e).slice(0, 300); }
  return { url: `https://x.com/i/web/status/${first}`, extra: threadError ? { thread_error: threadError } : undefined };
};
