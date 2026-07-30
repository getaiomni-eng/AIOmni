// RevenueCat → users.tier sync (service role).
//
// The ONLY legitimate writer of users.tier besides manual postgres grants.
// Clients can no longer write tier at all (trg_protect_tier silently
// preserves it), so purchases flow: StoreKit → RevenueCat → this webhook
// → users.tier → claude-proxy / rankings-gate read it server-side.
//
// Setup (one-time):
//   1. supabase secrets set REVENUECAT_WEBHOOK_SECRET=<random string>
//   2. supabase functions deploy revenuecat-webhook --no-verify-jwt
//   3. RevenueCat dashboard → Integrations → Webhooks:
//        URL: https://<project>.supabase.co/functions/v1/revenuecat-webhook
//        Authorization header value: Bearer <same secret>
//
// RevenueCat app_user_id == Supabase auth uid (Purchases.configure is
// called with the auth user id), so mapping is direct.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '';

// Entitlement ids → tier, highest wins. Mirrors ENTITLEMENTS in
// services/purchases.ts.
function tierFromEntitlements(ids: string[]): 'pro' | 'rankings' | null {
  if (ids.includes('pro')) return 'pro';
  if (ids.includes('rankings')) return 'rankings';
  return null;
}

// Event types that mean "entitlement active" vs "entitlement ended".
const ACTIVATING = new Set(['INITIAL_PURCHASE', 'RENEWAL', 'UNCANCELLATION', 'PRODUCT_CHANGE', 'NON_RENEWING_PURCHASE']);
const DEACTIVATING = new Set(['EXPIRATION']);
// CANCELLATION = auto-renew turned off but still paid through period end —
// tier stays until EXPIRATION fires. BILLING_ISSUE handled by EXPIRATION.

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const auth = req.headers.get('Authorization') ?? '';
  if (!WEBHOOK_SECRET || auth !== `Bearer ${WEBHOOK_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400 }); }
  const event = body?.event;
  if (!event) return new Response('no event', { status: 400 });

  const appUserId: string | undefined = event.app_user_id;
  const type: string = event.type ?? '';
  const entitlements: string[] = event.entitlement_ids ?? (event.entitlement_id ? [event.entitlement_id] : []);

  // RC uses $RCAnonymousID:… when the app never logged the user in —
  // nothing to map; ack so RC doesn't retry forever.
  if (!appUserId || appUserId.startsWith('$RCAnonymous')) {
    return new Response('ok (unmapped user)', { status: 200 });
  }

  let newTier: 'free' | 'rankings' | 'pro' | null = null;
  if (ACTIVATING.has(type)) newTier = tierFromEntitlements(entitlements);
  else if (DEACTIVATING.has(type)) newTier = 'free';

  if (!newTier) return new Response(`ok (no-op for ${type})`, { status: 200 });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // Never downgrade a manual grant on EXPIRATION of something else:
  // only write 'free' if the current tier matches what just expired.
  if (newTier === 'free') {
    const { data: row } = await sb.from('users').select('tier').eq('auth_id', appUserId).maybeSingle();
    const expiredTier = tierFromEntitlements(entitlements);
    if (row?.tier && expiredTier && row.tier !== expiredTier) {
      return new Response('ok (expiration does not match current tier — left unchanged)', { status: 200 });
    }
  }

  const { error } = await sb
    .from('users')
    .update({ tier: newTier, updated_at: new Date().toISOString() })
    .eq('auth_id', appUserId);

  if (error) {
    console.error('revenuecat-webhook update failed:', error.message);
    return new Response('db error', { status: 500 });
  }
  console.log(`revenuecat-webhook: ${appUserId} → ${newTier} (${type})`);
  return new Response('ok', { status: 200 });
});
