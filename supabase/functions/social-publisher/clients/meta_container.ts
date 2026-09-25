// Instagram and Threads both publish in two steps: create a media container,
// wait until Meta has fetched and processed it, then publish it. Publishing a
// container that is still IN_PROGRESS fails, so poll its status first.
//   Instagram: GET /{container}?fields=status_code  -> FINISHED | IN_PROGRESS | ERROR | EXPIRED | PUBLISHED
//   Threads:   GET /{container}?fields=status,error_message (same values)
// Threads' docs suggest waiting ~30s on average before publishing.

import { type Ctx, json } from '../ctx.ts';

export async function waitForContainer(
  ctx: Ctx, base: string, id: string, token: string, field: 'status_code' | 'status',
  opts: { intervalMs?: number; timeoutMs?: number; label: string },
): Promise<void> {
  const interval = opts.intervalMs ?? 3000;
  const deadline = ctx.now() + (opts.timeoutMs ?? 60_000);
  for (;;) {
    const fields = field === 'status' ? 'status,error_message' : 'status_code';
    const r = await json<Record<string, string>>(await ctx.fetch(
      `${base}/${id}?fields=${fields}&access_token=${encodeURIComponent(token)}`), `${opts.label} status`);
    const s = r[field];
    if (s === 'FINISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(`${opts.label} container ${id} ${s}${r.error_message ? `: ${r.error_message}` : ''}`);
    if (ctx.now() > deadline) throw new Error(`${opts.label} container ${id} still ${s} after ${Math.round((opts.timeoutMs ?? 60_000) / 1000)}s`);
    await ctx.sleep(interval);
  }
}
