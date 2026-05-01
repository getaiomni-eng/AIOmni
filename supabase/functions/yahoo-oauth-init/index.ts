// supabase/functions/yahoo-oauth-init/index.ts
// Generates the Yahoo authorization URL for the AIOmni service account.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const CLIENT_ID = Deno.env.get('YAHOO_SERVICE_CLIENT_ID')!;
const REDIRECT_URI = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/yahoo-oauth-callback';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!CLIENT_ID) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'YAHOO_SERVICE_CLIENT_ID not set in supabase secrets',
    }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: 'fspt-r',
    state: 'aiomni_service_init',
    language: 'en-us',
  });

  const authUrl = `https://api.login.yahoo.com/oauth2/request_auth?${params.toString()}`;

  return new Response(JSON.stringify({
    ok: true,
    auth_url: authUrl,
    instructions: 'Open auth_url in a browser. Log in as the AIOmni service Yahoo account. Approve. Yahoo will redirect to the callback function which stores the tokens.',
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
});
