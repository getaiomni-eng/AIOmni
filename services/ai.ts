// services/ai.ts
// Calls Claude via Supabase Edge Function proxy

import { NFL_DATA_DICTIONARY } from './nflDataDictionary';
import { supabase } from './supabase';

const PROXY_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/claude-proxy';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw';

export async function askAI(prompt: string, maxTokens = 512): Promise<string> {
  try {
    // Always include apikey + Authorization for Supabase edge functions
    let authToken = SUPABASE_ANON_KEY;

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        authToken = session.access_token;
      }
    } catch {
      // No auth — use anon key as fallback
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${authToken}`,
    };

    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt + '\n\n' + NFL_DATA_DICTIONARY }],
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`askAI HTTP ${res.status}:`, errBody);
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