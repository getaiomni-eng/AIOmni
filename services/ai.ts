const API_KEY = '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';
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-sonnet-4-20250514';
const VERSION = '2023-06-01';

export async function askAI(prompt: string, maxTokens = 200): Promise<string> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': VERSION,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  return data?.content?.[0]?.text ?? '';
}
