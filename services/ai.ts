// services/ai.ts
// Calls Claude via Supabase Edge Function proxy
// NEVER hardcode API keys here — key lives in Supabase secrets

import { supabase } from './supabase';

const PROXY_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/claude-proxy';

export async function askAI(prompt: string, maxTokens = 512): Promise<string> {
  try {
    // Build headers — only include Authorization if we have a real session
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }
    } catch {
      // No auth — continue as anonymous/free tier
    }

    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`askAI HTTP ${res.status}:`, errBody);

      if (res.status === 429) {
        throw new Error('prompt_limit_reached');
      }
      throw new Error(`AI request failed (${res.status})`);
    }

    const data = await res.json();

    // Handle Claude API response format
    if (data?.content?.[0]?.text) {
      return data.content[0].text;
    }

    // Handle proxy wrapper format (if proxy wraps the response)
    if (data?.text) {
      return data.text;
    }

    // Handle error in response body
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