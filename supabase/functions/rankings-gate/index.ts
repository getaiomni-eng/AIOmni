// supabase/functions/rankings-gate/index.ts
// ───────────────────────────────────────────────────────────
// Gated, encrypted delivery of the marketing rankings. Replaces the wide-open
// public-rankings/rankings.json CDN object. A request only succeeds if it:
//   1. comes from an allowed Origin (the marketing site),
//   2. carries a fresh time-windowed HMAC token the page mints client-side,
//   3. is under the per-IP rate limit.
// Even on success the body is AES-256-GCM ciphertext — the page decrypts it
// with an obfuscated key. This stops curl/view-source/bot scraping cold; it is
// honestly obfuscation against a determined headless browser (the keys live in
// client JS), not a cryptographic guarantee.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HMAC_SECRET = Deno.env.get('RANKINGS_GATE_HMAC')!;
const AES_KEY_B64 = Deno.env.get('RANKINGS_GATE_AESKEY')!;

const ALLOWED = new Set([
  'https://getaiomni.com',
  'https://www.getaiomni.com',
]);

// Best-effort per-IP rate limit (per-instance; edge may run several).
const RL = new Map<string, { n: number; t: number }>();
const RL_MAX = 40, RL_WIN = 60_000;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = RL.get(ip);
  if (!e || now - e.t > RL_WIN) { RL.set(ip, { n: 1, t: now }); return false; }
  e.n++;
  return e.n > RL_MAX;
}

const enc = new TextEncoder();
function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(HMAC_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}
async function validToken(token: string | null): Promise<boolean> {
  if (!token || !token.includes('.')) return false;
  const [winStr, sig] = token.split('.');
  const win = parseInt(winStr, 10);
  if (!Number.isFinite(win)) return false;
  const now = Math.floor(Date.now() / 30_000);
  if (Math.abs(now - win) > 1) return false;          // 30s window, ±1 skew
  const expect = await hmacHex(winStr);
  // constant-time-ish compare
  if (sig.length !== expect.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expect.charCodeAt(i);
  return diff === 0;
}
async function encryptPayload(plain: string): Promise<string> {
  const raw = Uint8Array.from(atob(AES_KEY_B64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0); out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

function corsFor(origin: string | null) {
  const ok = origin && ALLOWED.has(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin! : 'null',
    'Access-Control-Allow-Headers': 'content-type, x-rk-token',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

serve(async (req) => {
  const origin = req.headers.get('origin');
  const cors = corsFor(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // 1. Origin allow-list (Referer fallback for browsers that omit Origin on GET)
  const referer = req.headers.get('referer') ?? '';
  const originOk = (origin && ALLOWED.has(origin)) ||
    [...ALLOWED].some(a => referer.startsWith(a));
  if (!originOk) return new Response('forbidden', { status: 403, headers: cors });

  // 2. Rate limit
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return new Response('rate limited', { status: 429, headers: cors });

  // 3. Token
  const token = req.headers.get('x-rk-token');
  if (!(await validToken(token))) return new Response('bad token', { status: 401, headers: cors });

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data, error } = await supabase.storage.from('public-rankings').download('rankings.json');
    if (error || !data) throw error ?? new Error('no rankings');
    const cipher = await encryptPayload(await data.text());
    return new Response(JSON.stringify({ v: 1, d: cipher }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
