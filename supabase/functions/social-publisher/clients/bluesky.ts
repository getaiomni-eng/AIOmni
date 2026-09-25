// Bluesky (AT Protocol). Free, no app review; an app password is enough.
//
//   POST {service}/xrpc/com.atproto.server.createSession   {identifier, password}
//   POST {service}/xrpc/com.atproto.repo.uploadBlob        raw bytes -> {blob}
//   POST {service}/xrpc/com.atproto.repo.createRecord      app.bsky.feed.post
//
// Limits from the lexicons (github.com/bluesky-social/atproto/lexicons):
//   app.bsky.embed.images: at most 4 images, each blob maxSize 2,000,000 bytes
//   app.bsky.feed.post.text: 300 graphemes
// Links are NOT auto-detected server-side: a URL is only clickable if the post
// carries an app.bsky.richtext.facet#link whose byteStart/byteEnd are UTF-8
// BYTE offsets (not string indexes -- an emoji before the link shifts them).
// https://docs.bsky.app/docs/advanced-guides/post-richtext

import type { SocialPost } from '../../_shared/social/types.ts';
import { type Client, type Ctx, download, images, json } from '../ctx.ts';

const MAX_BLOB = 2_000_000;

interface Ref { uri: string; cid: string }

// URLs with a scheme, plus bare domains like getaiomni.com/rank.
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|app|io|co|gg|tv)(?:\/[^\s<>"')\]]*)?/gi;

export function linkFacets(text: string) {
  const enc = new TextEncoder();
  const facets: unknown[] = [];
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0].replace(/[.,;:!?]+$/, '');          // trailing sentence punctuation is not part of the link
    const start = enc.encode(text.slice(0, m.index!)).length;
    const end = start + enc.encode(raw).length;
    const uri = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    facets.push({
      index: { byteStart: start, byteEnd: end },
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
    });
  }
  return facets;
}

export const bluesky: Client = async (post: SocialPost, ctx: Ctx) => {
  const service = (ctx.env('BLUESKY_SERVICE') || 'https://bsky.social').replace(/\/$/, '');
  const session = await json<{ accessJwt: string; did: string; handle: string }>(await ctx.fetch(
    `${service}/xrpc/com.atproto.server.createSession`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: ctx.env('BLUESKY_HANDLE'), password: ctx.env('BLUESKY_APP_PASSWORD') }),
    }), 'bluesky createSession');
  const auth = { Authorization: `Bearer ${session.accessJwt}` };

  const embedImages: unknown[] = [];
  for (const m of images(post).slice(0, 4)) {
    const { bytes, type } = await download(ctx, m);
    if (bytes.byteLength > MAX_BLOB) throw new Error(`bluesky: ${m.url} is ${bytes.byteLength} bytes, over the 2 MB blob limit`);
    const up = await json<{ blob: unknown }>(await ctx.fetch(`${service}/xrpc/com.atproto.repo.uploadBlob`, {
      method: 'POST', headers: { ...auth, 'Content-Type': type }, body: bytes,
    }), 'bluesky uploadBlob');
    embedImages.push({ alt: m.alt ?? '', image: up.blob, aspectRatio: { width: m.width, height: m.height } });
  }

  const create = async (text: string, reply?: { root: Ref; parent: Ref }, withImages = false): Promise<Ref> => {
    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post', text, createdAt: new Date(ctx.now()).toISOString(),
    };
    const facets = linkFacets(text);
    if (facets.length) record.facets = facets;
    if (withImages && embedImages.length) record.embed = { $type: 'app.bsky.embed.images', images: embedImages };
    if (reply) record.reply = reply;
    return await json<Ref>(await ctx.fetch(`${service}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
    }), 'bluesky createRecord');
  };

  const root = await create(post.body, undefined, true);
  // The main post is live now: a failed reply must not throw, or the row
  // would be retried and the main post published twice.
  let parent = root, threadError: string | undefined;
  try { for (const t of post.thread ?? []) parent = await create(t, { root, parent }); }
  catch (e) { threadError = String((e as Error)?.message ?? e).slice(0, 300); }

  const rkey = root.uri.split('/').pop();
  return { url: `https://bsky.app/profile/${session.handle || session.did}/post/${rkey}`, extra: threadError ? { thread_error: threadError } : undefined };
};
