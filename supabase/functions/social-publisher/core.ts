// The publish loop, separate from index.ts so it runs under a mock PostgREST
// and mock fetch in scripts/social/publisher_test.ts.

import type { Network, SocialPost } from '../_shared/social/types.ts';
import { type Client, type Ctx, missingSecrets } from './ctx.ts';
import { bluesky } from './clients/bluesky.ts';
import { facebook } from './clients/facebook.ts';
import { instagram } from './clients/instagram.ts';
import { threads } from './clients/threads.ts';
import { x } from './clients/x.ts';
import { youtube } from './clients/youtube.ts';

export const CLIENTS: Partial<Record<Network, Client>> = { bluesky, x, facebook, instagram, threads, youtube };

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15 * 60_000;

export interface RunResult {
  ok: boolean;
  paused?: boolean;
  dry_run?: boolean;
  processed: { id: number; network: Network; status: string; url?: string | null; error?: string; missing?: string[] }[];
  deferred?: number;   // due rows left for the next run (time budget)
}

export async function runPublisher(
  ctx: Ctx, opts: { id?: number; dryRun?: boolean; budgetMs?: number } = {},
): Promise<RunResult> {
  const started = ctx.now();
  const budget = opts.budgetMs ?? 100_000;   // edge functions are cut off at 150s; stop starting new rows well before

  // Kill switch from the /rank Posts tab. Honoured for "publish now" too.
  if ((await ctx.db.getSetting('social_autopost')) !== 'on') return { ok: true, paused: true, processed: [] };

  const nowIso = new Date(ctx.now()).toISOString();
  const rows = await ctx.db.select<SocialPost & { id: number }>(opts.id
    ? `social_posts?select=*&id=eq.${opts.id}&status=eq.queued&mode=in.(auto,semi)`
    : `social_posts?select=*&status=eq.queued&mode=in.(auto,semi)&publish_at=lte.${encodeURIComponent(nowIso)}&order=publish_at.asc&limit=10`);

  const out: RunResult = { ok: true, processed: [], dry_run: opts.dryRun || undefined };

  if (opts.dryRun) {
    for (const r of rows) {
      out.processed.push({ id: r.id, network: r.network, status: 'would_publish', missing: await missingSecrets(r.network, ctx) });
    }
    return out;
  }

  for (let i = 0; i < rows.length; i++) {
    if (ctx.now() - started > budget) { out.deferred = rows.length - i; break; }
    const row = rows[i];
    const stamp = () => new Date(ctx.now()).toISOString();

    // Claim: only one run can move a row from queued to publishing, so an
    // overlapping cron tick (or a "publish now" tap) can never double-post.
    const claimed = await ctx.db.patch(`social_posts?id=eq.${row.id}&status=eq.queued`, { status: 'publishing', updated_at: stamp() });
    if (claimed.length === 0) continue;

    const client = CLIENTS[row.network];
    const missing = await missingSecrets(row.network, ctx);
    if (!client || missing.length) {
      const error = client ? `not connected: set ${missing.join(', ')}` : `no automated client for ${row.network}`;
      await ctx.db.patch(`social_posts?id=eq.${row.id}`, { status: 'skipped', error, updated_at: stamp() });
      out.processed.push({ id: row.id, network: row.network, status: 'skipped', error, missing });
      continue;
    }

    try {
      const res = await client(row, ctx);
      await ctx.db.patch(`social_posts?id=eq.${row.id}`, {
        status: 'posted', posted_url: res.url, posted_at: stamp(), error: null,
        extra: { ...(row.extra ?? {}), ...(res.extra ?? {}) }, updated_at: stamp(),
      });
      out.processed.push({ id: row.id, network: row.network, status: 'posted', url: res.url });
    } catch (e) {
      const error = String((e as Error)?.message ?? e).slice(0, 500);
      const attempts = (row.attempts ?? 0) + 1;
      const retry = attempts < MAX_ATTEMPTS;
      await ctx.db.patch(`social_posts?id=eq.${row.id}`, retry
        ? { status: 'queued', attempts, error, publish_at: new Date(ctx.now() + RETRY_DELAY_MS).toISOString(), updated_at: stamp() }
        : { status: 'failed', attempts, error, updated_at: stamp() });
      ctx.log(`[social-publisher] ${row.network} #${row.id} attempt ${attempts} failed:`, error);
      out.processed.push({ id: row.id, network: row.network, status: retry ? 'retry_queued' : 'failed', error });
    }
  }
  return out;
}
