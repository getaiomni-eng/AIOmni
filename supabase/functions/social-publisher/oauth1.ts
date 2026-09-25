// OAuth 1.0a HMAC-SHA1 request signing (RFC 5849), for X's user-context auth.
//
// X accepts OAuth 1.0a user tokens on POST /2/tweets and the media upload
// endpoints. Only query-string and application/x-www-form-urlencoded body
// parameters are signed; JSON and multipart bodies are NOT part of the
// signature base string, which is why the callers below pass no body params.
// https://docs.x.com/resources/fundamentals/authentication/oauth-1-0a/creating-a-signature
//
// Verified against X's published example (signature "hCtSmYh+iHYCEqBWrE7C7hYmtUk=")
// in scripts/social/publisher_test.ts.

// RFC 3986 percent-encoding: encodeURIComponent leaves !'()* unescaped.
export const pct = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export interface OAuth1Creds {
  consumerKey: string; consumerSecret: string;
  token: string; tokenSecret: string;
}

export function baseString(method: string, url: string, params: Record<string, string>): string {
  const u = new URL(url);
  const all: [string, string][] = [];
  u.searchParams.forEach((v, k) => all.push([k, v]));
  for (const [k, v] of Object.entries(params)) all.push([k, v]);
  const enc = all.map(([k, v]) => [pct(k), pct(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const norm = enc.map(([k, v]) => `${k}=${v}`).join('&');
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  return `${method.toUpperCase()}&${pct(baseUrl)}&${pct(norm)}`;
}

export async function hmacSha1Base64(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Returns the value for the Authorization header.
export async function oauth1Header(
  method: string, url: string, creds: OAuth1Creds,
  opts: { formParams?: Record<string, string>; nonce?: string; timestamp?: string } = {},
): Promise<string> {
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: opts.nonce ?? crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: opts.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.token,
    oauth_version: '1.0',
  };
  const base = baseString(method, url, { ...oauth, ...(opts.formParams ?? {}) });
  const key = `${pct(creds.consumerSecret)}&${pct(creds.tokenSecret)}`;
  oauth.oauth_signature = await hmacSha1Base64(key, base);
  return 'OAuth ' + Object.keys(oauth).sort().map(k => `${pct(k)}="${pct(oauth[k])}"`).join(', ');
}
