// Everything a network client needs, injected so every client runs against a
// mock fetch in scripts/social/publisher_test.ts. Nothing in this folder
// reads Deno.* directly except index.ts.

import type { Media, Network, SocialPost } from '../_shared/social/types.ts';

export interface Db {
  select<T = any>(query: string): Promise<T[]>;
  // PATCH rows matching `filter`; returns the updated rows (Prefer: return=representation).
  patch<T = any>(filter: string, body: Record<string, unknown>): Promise<T[]>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export interface Ctx {
  fetch: typeof fetch;
  env: (k: string) => string | undefined;
  db: Db;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (...a: unknown[]) => void;
}

export interface PublishResult {
  url: string | null;
  extra?: Record<string, unknown>;   // merged into the row's extra
}

export type Client = (post: SocialPost, ctx: Ctx) => Promise<PublishResult>;

// Throws with the status and a slice of the body, so the row's `error`
// column says what the platform actually objected to.
export async function ok(res: Response, label: string): Promise<Response> {
  if (res.ok) return res;
  const text = await res.text().catch(() => '');
  throw new Error(`${label} ${res.status}: ${text.slice(0, 300)}`);
}

export async function json<T = any>(res: Response, label: string): Promise<T> {
  await ok(res, label);
  return await res.json() as T;
}

// Downloads ONE media file into memory. Called one file at a time so a
// carousel never holds more than a single image in memory at once.
// Plain ArrayBuffer: a valid fetch body and Blob part in every TS/Deno version
// (Uint8Array<ArrayBufferLike> is not, from TypeScript 5.7).
export async function download(ctx: Ctx, m: Media): Promise<{ bytes: ArrayBuffer; type: string }> {
  const res = await ok(await ctx.fetch(m.url), `download ${m.url}`);
  const bytes = await res.arrayBuffer();
  const type = res.headers.get('content-type')?.split(';')[0]?.trim() || guessType(m.url, m.kind);
  return { bytes, type };
}

export function guessType(url: string, kind: Media['kind']): string {
  const u = url.toLowerCase().split('?')[0];
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg';
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.mp4')) return 'video/mp4';
  return kind === 'video' ? 'video/mp4' : 'image/png';
}

export const images = (p: SocialPost) => p.media.filter(m => m.kind === 'image');
export const video = (p: SocialPost) => p.media.find(m => m.kind === 'video') ?? null;

// Secrets each network needs. Each inner array is "any one of these".
// Threads' token may also live in app_settings (it is refreshed in place),
// which missingSecrets() checks separately.
export const SECRETS: Record<Network, string[][]> = {
  bluesky: [['BLUESKY_HANDLE'], ['BLUESKY_APP_PASSWORD']],
  x: [['X_API_KEY'], ['X_API_SECRET'], ['X_ACCESS_TOKEN'], ['X_ACCESS_SECRET']],
  facebook: [['META_PAGE_ID'], ['META_PAGE_TOKEN']],
  instagram: [['IG_USER_ID'], ['IG_TOKEN', 'META_PAGE_TOKEN']],
  threads: [['THREADS_USER_ID'], ['THREADS_TOKEN']],
  youtube: [['YT_CLIENT_ID'], ['YT_CLIENT_SECRET'], ['YT_REFRESH_TOKEN']],
  tiktok: [],
  reddit: [],
};

export async function missingSecrets(network: Network, ctx: Ctx): Promise<string[]> {
  const missing: string[] = [];
  for (const alts of SECRETS[network]) {
    if (alts.some(k => ctx.env(k))) continue;
    if (network === 'threads' && alts.includes('THREADS_TOKEN') && await ctx.db.getSetting('threads_token')) continue;
    missing.push(alts.join(' or '));
  }
  return missing;
}

// Graph API version for Facebook and Instagram. v25.0 (released 2026-02-18)
// is supported until 2028; override with META_GRAPH_VERSION.
// https://developers.facebook.com/docs/graph-api/changelog/version25.0/
export const graphVersion = (ctx: Ctx) => ctx.env('META_GRAPH_VERSION') || 'v25.0';

export const form = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) p.set(k, String(v));
  return p;
};
