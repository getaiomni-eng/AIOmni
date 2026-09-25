// YouTube Shorts, mode 'semi': upload PRIVATE, the owner flips it public.
//
// Why private: videos uploaded through an API project that has not passed
// Google's audit are locked to private, so the honest automation is "upload
// and hand over" -- the owner taps Visibility -> Public in YouTube Studio.
//
//   token:  POST https://oauth2.googleapis.com/token  grant_type=refresh_token
//   upload: POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
//           headers X-Upload-Content-Type, X-Upload-Content-Length; JSON snippet/status
//           -> 200, Location: <session url>
//           PUT <session url>  (the bytes)  -> 200/201 { id }
//   https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
// A vertical video of 3 minutes or less is treated as a Short automatically.
//
// NOTE for setup: an OAuth consent screen left in "Testing" issues refresh
// tokens that expire after 7 days. Publish the consent screen (unverified is
// fine for the owner's own account) or this breaks every week.

import type { SocialPost } from '../../_shared/social/types.ts';
import { type Client, type Ctx, download, form, json, ok, video } from '../ctx.ts';

const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

export async function youtubeAccessToken(ctx: Ctx): Promise<string> {
  const r = await json<{ access_token: string }>(await ctx.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: form({
      client_id: ctx.env('YT_CLIENT_ID'), client_secret: ctx.env('YT_CLIENT_SECRET'),
      refresh_token: ctx.env('YT_REFRESH_TOKEN'), grant_type: 'refresh_token',
    }),
  }), 'youtube token');
  return r.access_token;
}

export const youtube: Client = async (post: SocialPost, ctx: Ctx) => {
  const v = video(post);
  if (!v) throw new Error('youtube: row has no video media');
  const access = await youtubeAccessToken(ctx);
  const { bytes, type } = await download(ctx, v);

  const title = (post.title || post.body.split('\n')[0]).slice(0, 100);
  const init = await ok(await ctx.fetch(UPLOAD, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': type,
      'X-Upload-Content-Length': String(bytes.byteLength),
    },
    body: JSON.stringify({
      snippet: { title, description: post.body.slice(0, 5000), categoryId: '17' },   // 17 = Sports
      status: { privacyStatus: 'private', selfDeclaredMadeForKids: false },
    }),
  }), 'youtube upload init');
  const session = init.headers.get('location');
  if (!session) throw new Error('youtube upload init: no Location header');

  const up = await json<{ id: string }>(await ctx.fetch(session, {
    method: 'PUT', headers: { Authorization: `Bearer ${access}`, 'Content-Type': type }, body: bytes,
  }), 'youtube upload');
  return {
    url: `https://studio.youtube.com/video/${up.id}/edit`,
    extra: { youtube_video_id: up.id, youtube_watch_url: `https://youtube.com/shorts/${up.id}`, needs_owner: 'set visibility to Public' },
  };
};
