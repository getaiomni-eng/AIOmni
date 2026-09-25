// Instagram content publishing (professional account).
// https://developers.facebook.com/docs/instagram-platform/content-publishing
//
//   single:   POST /{ig-user-id}/media  image_url, caption, alt_text        -> {id} (container)
//   carousel: POST /{ig-user-id}/media  image_url, is_carousel_item=true    (each, max 10)
//             POST /{ig-user-id}/media  media_type=CAROUSEL, children, caption
//   then:     GET  /{container}?fields=status_code  until FINISHED
//             POST /{ig-user-id}/media_publish  creation_id                 -> {id}
//
// Two hosts, depending on how the token was issued:
//   IG_TOKEN (Instagram Login)       -> graph.instagram.com
//   META_PAGE_TOKEN (Facebook Login) -> graph.facebook.com
// JPEG ONLY: "JPEG is the only image format supported." The generator must
// hand Instagram rows .jpg media; a PNG fails here with a clear error rather
// than as an opaque container ERROR. alt_text is single-image only.
// Limit: 100 API-published posts per 24h (a carousel counts as one).

import type { SocialPost } from '../../_shared/social/types.ts';
import { type Client, type Ctx, form, graphVersion, images, json } from '../ctx.ts';
import { waitForContainer } from './meta_container.ts';

const isJpeg = (url: string) => /\.jpe?g$/i.test(url.split('?')[0]);

export const instagram: Client = async (post: SocialPost, ctx: Ctx) => {
  const igToken = ctx.env('IG_TOKEN');
  const token = igToken || ctx.env('META_PAGE_TOKEN')!;
  const base = igToken ? `https://graph.instagram.com/${graphVersion(ctx)}` : `https://graph.facebook.com/${graphVersion(ctx)}`;
  const ig = ctx.env('IG_USER_ID')!;
  const imgs = images(post).slice(0, 10);
  if (imgs.length === 0) throw new Error('instagram: a post needs at least one image');
  const notJpeg = imgs.filter(m => !isJpeg(m.url));
  if (notJpeg.length) throw new Error(`instagram accepts JPEG only; got ${notJpeg.map(m => m.url.split('/').pop()).join(', ')}`);
  const caption = [post.body, ...(post.thread ?? [])].join('\n\n');

  let container: string;
  if (imgs.length === 1) {
    container = (await json<{ id: string }>(await ctx.fetch(`${base}/${ig}/media`, {
      method: 'POST', body: form({ image_url: imgs[0].url, caption, alt_text: imgs[0].alt || undefined, access_token: token }),
    }), 'instagram container')).id;
  } else {
    const children: string[] = [];
    for (const m of imgs) {
      children.push((await json<{ id: string }>(await ctx.fetch(`${base}/${ig}/media`, {
        method: 'POST', body: form({ image_url: m.url, is_carousel_item: true, access_token: token }),
      }), 'instagram carousel item')).id);
    }
    for (const c of children) await waitForContainer(ctx, base, c, token, 'status_code', { label: 'instagram item' });
    container = (await json<{ id: string }>(await ctx.fetch(`${base}/${ig}/media`, {
      method: 'POST', body: form({ media_type: 'CAROUSEL', children: children.join(','), caption, access_token: token }),
    }), 'instagram carousel')).id;
  }
  await waitForContainer(ctx, base, container, token, 'status_code', { label: 'instagram' });
  const pub = await json<{ id: string }>(await ctx.fetch(`${base}/${ig}/media_publish`, {
    method: 'POST', body: form({ creation_id: container, access_token: token }),
  }), 'instagram publish');
  const link = await json<{ permalink?: string }>(await ctx.fetch(
    `${base}/${pub.id}?fields=permalink&access_token=${encodeURIComponent(token)}`), 'instagram permalink')
    .catch(() => ({} as { permalink?: string }));
  return { url: link.permalink ?? null, extra: { instagram_media_id: pub.id } };
};
