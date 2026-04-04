import { supabase } from './supabase';

const PROXY_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/claude-proxy';

export async function askAI(prompt: string, maxTokens = 200): Promise<string> {
  try {
    // Get auth token if user is signed in
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token ?? ''}`,
    };

    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (res.status === 429) {
      const data = await res.json();
      throw new Error(`prompt_limit_reached:${data.tier}`);
    }

    const data = await res.json();
    return data?.content?.[0]?.text ?? '';
  } catch (e: any) {
    console.error('askAI error:', e);
    throw e;
  }
}
