// services/ai.ts
// Calls Claude via Supabase Edge Function proxy.
//
// Auth: sends the SIGNED-IN USER'S JWT in Authorization (not the anon key)
// so the proxy can rate-limit per user AND so anonymous callers with just
// the bundled anon key can't drain Anthropic quota. The proxy rejects
// any request whose Bearer token is just the anon key.

import { NFL_DATA_DICTIONARY } from './nflDataDictionary';
import { supabase } from './supabase';

const PROXY_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/claude-proxy';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw';

// ─── Model tiers ────────────────────────────────────────────────────────
// Centralized so swaps are one-line. Update prompt cost expectations and
// the trade-off matrix here, not in callers.
//   fast  → Haiku 4.5 ($1/$5 per Mtok). Player-card buttons, quick lookups.
//   smart → Opus 4.7 ($5/$25 per Mtok). AI Coach + Trade Analyzer + draft.
//   mid   → Sonnet 4.6 ($3/$15 per Mtok). Reserved for future use.
export const MODELS = {
  fast:  'claude-haiku-4-5',
  mid:   'claude-sonnet-4-6',
  smart: 'claude-opus-4-7',
} as const;

export type ModelTier = keyof typeof MODELS;

export interface AskAIOptions {
  tier?: ModelTier;
  maxTokens?: number;
  // If true, skip the NFL data dictionary append. Use for chat-format
  // questions where the dictionary just inflates token count.
  skipDictionary?: boolean;
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

    const content = o.skipDictionary
      ? prompt
      : prompt + '\n\n' + NFL_DATA_DICTIONARY;

    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`askAI HTTP ${res.status} (${tier}/${model}):`, errBody);
      if (res.status === 429) throw new Error('prompt_limit_reached');
      throw new Error(`AI request failed (${res.status})`);
    }

    const data = await res.json();
    if (data?.content?.[0]?.text) return data.content[0].text;
    if (data?.text) return data.text;
    if (data?.error) {
      console.error('askAI error in response:', data.error);
      throw new Error(data.error.message || data.error);
    }
    console.error('askAI unexpected response shape:', JSON.stringify(data).slice(0, 200));
    return '';
  } catch (e: any) {
    console.error('askAI error:', e.message);
    throw e;
  }
}