import { supabase } from './supabase';

const PROXY_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/claude-proxy';

export async function askAI(prompt: string, maxTokens = 200): Promise<string> {
  try {
    console.log('askAI: Starting request with prompt:', prompt.substring(0, 100) + '...');
    // Get auth token if user is signed in
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token ?? ''}`,
    };
    console.log('askAI: Headers prepared, session:', !!session);

    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model:      'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    console.log('askAI: Fetch completed, status:', res.status);

    if (!res.ok) {
      const body = await res.text();
      console.error('askAI: Response not ok, status:', res.status, 'body:', body);
      throw new Error(`HTTP ${res.status}: ${body}`);
    }

    const data = await res.json();
    console.log('askAI: Parsed JSON data:', data);

    const content = data?.content?.[0]?.text;
    if (!content || content.trim() === '') {
      console.error('askAI: Content missing or empty, full response:', JSON.stringify(data));
      throw new Error(`Empty response from AI: ${JSON.stringify(data)}`);
    }

    console.log('askAI: Returning content:', content.substring(0, 100) + '...');
    return content;
  } catch (e: any) {
    console.error('askAI error:', e);
    throw e;
  }
}
