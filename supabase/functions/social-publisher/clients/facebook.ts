// Facebook Page posts via the Pages API (Page access token, pages_manage_posts).
// https://developers.facebook.com/docs/pages-api/posts
//
//   one image:   POST /{page-id}/photos  url, message         -> {id, post_id}
//   several:     POST /{page-id}/photos  url, published=false -> {id}  (each)
//                POST /{page-id}/feed    message, attached_media=[{media_fbid}]
//   text only:   POST /{page-id}/feed    message, link
//
// Facebook fetches the image from the public 'social' bucket URL itself, so
// nothing is downloaded here.

import type { SocialPost } from '../../_shared/social/types.ts';
import { type Client, type Ctx, form, graphVersion, images, json } from '../ctx.ts';

export const facebook: Client = async (post: SocialPost, ctx: Ctx) => {
  const base = `https://graph.facebook.com/${graphVersion(ctx)}`;
  const page = ctx.env('META_PAGE_ID')!;
  const token = ctx.env('META_PAGE_TOKEN')!;
  const imgs = images(post).slice(0, 10);
  // Facebook has no reply threads for Page posts; fold the thread into the post.
  const message = [post.body, ...(post.thread ?? [])].join('\n\n');

  if (imgs.length === 1) {
    const r = await json<{ id: string; post_id?: string }>(await ctx.fetch(`${base}/${page}/photos`, {
      method: 'POST', body: form({ url: imgs[0].url, message, access_token: token }),
    }), 'facebook photo');
    return { url: `https://www.facebook.com/${r.post_id ?? r.id}` };
  }

  const attached: { media_fbid: string }[] = [];
  for (const m of imgs) {
    const r = await json<{ id: string }>(await ctx.fetch(`${base}/${page}/photos`, {
      method: 'POST', body: form({ url: m.url, published: false, access_token: token }),
    }), 'facebook photo (unpublished)');
    attached.push({ media_fbid: r.id });
  }
  const r = await json<{ id: string }>(await ctx.fetch(`${base}/${page}/feed`, {
    method: 'POST',
    body: form({
      message,
      attached_media: attached.length ? JSON.stringify(attached) : undefined,
      link: attached.length ? undefined : post.link ?? undefined,
      access_token: token,
    }),
  }), 'facebook feed');
  return { url: `https://www.facebook.com/${r.id}` };
};
