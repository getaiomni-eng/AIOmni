// services/ai.ts
// Calls Claude via Supabase Edge Function proxy.
//
// Auth: sends the SIGNED-IN USER'S JWT in Authorization (not the anon key)
// so the proxy can rate-limit per user AND so anonymous callers with just
// the bundled anon key can't drain Anthropic quota. The proxy rejects
// any request whose Bearer token is just the anon key.

import { NFL_DATA_DICTIONARY } from './nflDataDictionary';
import { supabase } from './supabase';
import { hasAIConsent } from './aiConsent';

const PROXY_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/claude-proxy';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw';

// ─── Model tiers ────────────────────────────────────────────────────────
// Centralized so swaps are one-line. Update prompt cost expectations and
// the trade-off matrix here, not in callers.
//   fast  → Haiku 4.5 ($1/$5 per Mtok). Player-card buttons, quick lookups.
//   smart → Opus 4.8 ($5/$25 per Mtok). AI Coach + Trade Analyzer + draft.
//   mid   → Sonnet 4.6 ($3/$15 per Mtok). Reserved for future use.
export const MODELS = {
  fast:  'claude-haiku-4-5',
  mid:   'claude-sonnet-4-6',
  smart: 'claude-opus-4-8',
} as const;

export type ModelTier = keyof typeof MODELS;

export interface AskAIOptions {
  tier?: ModelTier;
  maxTokens?: number;
  // If true, skip the NFL data dictionary append. Use for chat-format
  // questions where the dictionary just inflates token count.
  skipDictionary?: boolean;
  // Stable instructions (persona, rubric, reference knowledge) sent as the
  // Anthropic `system` field with cache_control. When set, the NFL data
  // dictionary is folded into the system block (so it's cached too) and
  // `prompt` becomes the dynamic user turn. Identical static blocks across
  // calls hit the prompt cache — big cost win for Coach/Trade/draft.
  system?: string;
}

export async function askAI(
  prompt: string,
  opts: AskAIOptions | number = {},
): Promise<string> {
  // Back-compat: old callers passed `maxTokens` as second arg (a number).
  // Detect and translate so existing code keeps working.
  const o: AskAIOptions = typeof opts === 'number' ? { maxTokens: opts } : opts;
  const tier = o.tier ?? 'smart';
  const maxTokens = o.maxTokens ?? 512;
  const model = MODELS[tier];

  try {
    // Defence in depth for guideline 5.1.1(i): even if a new call site forgets
    // the consent gate, nothing leaves the device without permission.
    if (!(await hasAIConsent())) throw new Error('ai_consent_required');

    // Pull the current user's session JWT — required by the hardened
    // proxy (rejects requests whose Bearer is just the anon key).
    // apikey header stays as the anon key per Supabase convention.
    const { data: { session } } = await supabase.auth.getSession();
    const userJwt = session?.access_token;
    if (!userJwt) throw new Error('not_authenticated');

    const headers: Record<string, string> = {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${userJwt}`,
    };

    // When a `system` block is provided, the dictionary lives there (static →
    // cacheable) and the prompt is the dynamic user turn. Otherwise (legacy
    // callers) the dictionary is appended to the user content as before.
    const payload: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: [{
        role: 'user',
        content: o.system || o.skipDictionary ? prompt : prompt + '\n\n' + NFL_DATA_DICTIONARY,
      }],
    };
    if (o.system) {
      const systemText = o.skipDictionary ? o.system : `${o.system}\n\n${NFL_DATA_DICTIONARY}`;
      payload.system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
    }

    // Explicit deadline. Without one, iOS's ~60s URLSession default was the
    // real timeout, and a slow Claude call surfaced as a bare TypeError that
    // the UI rendered as "Connection error" with no cause.
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 50_000);
    let res: Response;
    try {
      res = await fetch(PROXY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (fe: any) {
      if (fe?.name === 'AbortError') throw new Error('ai_timeout');
      throw fe;
    } finally {
      clearTimeout(deadline);
    }

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`askAI HTTP ${res.status} (${tier}/${model}):`, errBody);
      // Taxonomy, not a bucket: each status maps to a distinct, actionable
      // error the UI can name. Collapsing them all into "Connection error"
      // is how a prompt-size failure masqueraded as bad wifi in production.
      // The proxy emits 429 for THREE causes: weekly quota, per-IP burst
      // throttle, and Anthropic's own rate limit passed through. Only the
      // first is the user's quota — labeling the others "weekly limit"
      // (with an upsell!) is confidently wrong. Branch on the body.
      if (res.status === 429) {
        throw new Error(/weekly prompt limit/i.test(errBody) ? 'prompt_limit_reached' : 'ai_rate_limited');
      }
      if (res.status === 401) throw new Error('session_expired');
      // 400 is Anthropic's whole invalid_request class; only map to
      // prompt-too-large when the body says so. 413 is unambiguous.
      if (res.status === 413 || (res.status === 400 && /prompt is too long|too many tokens|max_tokens/i.test(errBody))) {
        throw new Error('ai_prompt_too_large');
      }
      if (res.status === 529 || res.status >= 500) throw new Error('ai_overloaded');
      throw new Error(`AI request failed (${res.status})`);
    }

    const data = await res.json();
    if (data?.content?.[0]?.text) return data.content[0].text;
    if (data?.text) return data.text;
    if (data?.error) {
      console.error('askAI error in response:', data.error);
      const msg = String(data.error.message || data.error);
      if (/overloaded/i.test(msg)) throw new Error('ai_overloaded');
      if (/prompt is too long|max_tokens|too many tokens/i.test(msg)) throw new Error('ai_prompt_too_large');
      throw new Error(msg);
    }
    console.error('askAI unexpected response shape:', JSON.stringify(data).slice(0, 200));
    // An unrecognized 200 used to return '' — a silently blank AI bubble
    // that still charged the prompt. Fail loudly instead.
    throw new Error('ai_bad_response');
  } catch (e: any) {
    console.error('askAI error:', e.message);
    throw e;
  }
}

// Shared human-readable messages for the error taxonomy above. Call sites
// pass their own generic fallback so surface-appropriate wording survives.
export function describeAIError(e: any, fallback: string): string {
  const m = String(e?.message ?? '');
  if (m.includes('ai_consent_required')) return 'AI features are turned off. Enable “Share data with AI service” in Settings.';
  if (m.includes('not_authenticated'))   return 'Sign in to use AI features — create a free account from Settings.';
  if (m.includes('session_expired'))     return 'Your session expired — sign in again in Settings to keep using AI features.';
  if (m.includes('ai_prompt_too_large')) return 'This conversation has grown too large for one request. Start a fresh chat (your leagues reload automatically).';
  if (m.includes('ai_image_too_large'))  return 'That image was too large to process. Try a screenshot instead of a full-resolution photo.';
  if (m.includes('ai_overloaded'))       return 'The AI service is briefly overloaded. Give it a minute and try again.';
  if (m.includes('ai_rate_limited'))     return 'Too many requests right now — wait a minute and try again. (Your prompt was not charged.)';
  if (m.includes('ai_timeout'))          return 'That request took too long and was cancelled. Try again — shorter questions come back faster.';
  if (m.includes('ai_bad_response'))     return 'The AI returned an unreadable response. Try again.';
  return fallback;
}

// v2026-06-10: vision call for reading screenshots (trade proposals, etc.).
// True when a signed-in Supabase session exists. AI surfaces pre-check this
// before charging a prompt — a guest's call can never succeed (the proxy
// requires a user JWT), so charging first would burn quota on guaranteed
// failures.
export async function hasAISession(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return Boolean(session?.access_token);
  } catch {
    return false;
  }
}

// Sends a base64 image + a text instruction as Anthropic content blocks through
// the same authenticated proxy (it forwards the body verbatim). Defaults to the
// `fast` (Haiku) tier — cheap and reads on-screen text fine.
// Accepts a single base64 image or several (a draft board rarely fits in
// one screenshot). Images are sent in the order given, each labelled, so
// the model can stitch a multi-part board together correctly.
export async function askAIVision(
  imageBase64: string | string[],
  mediaType: string,
  prompt: string,
  opts: AskAIOptions = {},
): Promise<string> {
  const tier = opts.tier ?? 'fast';
  const maxTokens = opts.maxTokens ?? 512;
  const model = MODELS[tier];
  const images = Array.isArray(imageBase64) ? imageBase64 : [imageBase64];
  // Declared outside the try so the catch can always clear it.
  const controller = new AbortController();
  // Multi-image uploads are proportionally bigger; give them more runway.
  const deadline = setTimeout(() => controller.abort(), 60_000 + (images.length - 1) * 20_000);
  try {
    // 5.1.1(i): images are the most sensitive thing we transmit — the same
    // consent gate as askAI, no exceptions. (Build 197 shipped without this.)
    if (!(await hasAIConsent())) throw new Error('ai_consent_required');

    const { data: { session } } = await supabase.auth.getSession();
    const userJwt = session?.access_token;
    if (!userJwt) throw new Error('not_authenticated');
    // Vision uploads are the biggest payload the app sends and were the
    // ONLY AI path with no deadline — a stalled upload left the Coach
    // stuck in its "reading" state with no way out.
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type':  'application/json',
        'apikey':        SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${userJwt}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{
          role: 'user',
          content: [
            ...images.flatMap((data, i) => ([
              ...(images.length > 1
                ? [{ type: 'text', text: `Image ${i + 1} of ${images.length}:` }]
                : []),
              { type: 'image', source: { type: 'base64', media_type: mediaType, data } },
            ])),
            { type: 'text', text: prompt },
          ],
        }],
      }),
    }).finally(() => clearTimeout(deadline));
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`askAIVision HTTP ${res.status} (${tier}/${model}):`, errBody);
      // Same taxonomy as askAI so call sites can explain themselves.
      if (res.status === 429) {
        throw new Error(/weekly prompt limit/i.test(errBody) ? 'prompt_limit_reached' : 'ai_rate_limited');
      }
      if (res.status === 401) throw new Error('session_expired');
      if (res.status === 413 || (res.status === 400 && /too large|prompt is too long|image/i.test(errBody))) {
        throw new Error('ai_image_too_large');
      }
      if (res.status === 529 || res.status >= 500) throw new Error('ai_overloaded');
      throw new Error(`AI vision request failed (${res.status})`);
    }
    const data = await res.json();
    if (data?.content?.[0]?.text) return data.content[0].text;
    if (data?.error) throw new Error(data.error.message || data.error);
    throw new Error('ai_bad_response');
  } catch (e: any) {
    clearTimeout(deadline);
    if (e?.name === 'AbortError') {
      console.error('askAIVision timed out');
      throw new Error('ai_timeout');
    }
    console.error('askAIVision error:', e.message);
    throw e;
  }
}