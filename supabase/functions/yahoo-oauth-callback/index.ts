// supabase/functions/yahoo-oauth-callback/index.ts
// Receives Yahoo OAuth callback, exchanges code for tokens, stores them.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('YAHOO_SERVICE_CLIENT_ID')!;
const CLIENT_SECRET = Deno.env.get('YAHOO_SERVICE_CLIENT_SECRET')!;
const REDIRECT_URI = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/yahoo-oauth-callback';

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      return new Response(`<h1>Yahoo OAuth error</h1><p>${error}</p>`, {
        status: 400, headers: { 'Content-Type': 'text/html' },
      });
    }
    if (!code) {
      return new Response('<h1>Missing code parameter</h1>', {
        status: 400, headers: { 'Content-Type': 'text/html' },
      });
    }

    const basicAuth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    });

    const tokenRes = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return new Response(`<h1>Yahoo token exchange failed</h1><p>HTTP ${tokenRes.status}</p><pre>${text}</pre>`, {
        status: 500, headers: { 'Content-Type': 'text/html' },
      });
    }

    const tokens = await tokenRes.json();
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { error: dbError } = await supabase
      .from('yahoo_service_tokens')
      .upsert({
        id: 'aiomni_service',
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scope: tokens.scope ?? null,
        last_refreshed: new Date().toISOString(),
      });

    if (dbError) {
      return new Response(`<h1>DB error</h1><pre>${dbError.message}</pre>`, {
        status: 500, headers: { 'Content-Type': 'text/html' },
      });
    }

    return new Response(`
      <html><body style="font-family: system-ui; padding: 40px; max-width: 600px;">
        <h1 style="color: green;">&#10003; AIOmni Yahoo service account authenticated</h1>
        <p>Tokens stored. yahoo-rankings-proxy can now fetch global Yahoo ADP server-side.</p>
        <p>Token expires: ${expiresAt}</p>
        <p>Refresh token saved for auto-renewal.</p>
        <p style="color: #666; font-size: 0.9em; margin-top: 30px;">You can close this window.</p>
      </body></html>
    `, { headers: { 'Content-Type': 'text/html' } });

  } catch (err: any) {
    return new Response(`<h1>Unexpected error</h1><pre>${err.message ?? String(err)}</pre>`, {
      status: 500, headers: { 'Content-Type': 'text/html' },
    });
  }
});
