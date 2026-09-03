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

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Consumable: $0.99 AI credit ─────────────────────────────────────
  // Handled BEFORE tier resolution: NON_RENEWING_PURCHASE is in ACTIVATING,
  // and a consumable carries no entitlement, so falling through would
  // resolve no tier and no-op — or worse, misclassify. product_id is the
  // whole signal here.
  const productId: string = event.product_id ?? '';
  if (type === 'NON_RENEWING_PURCHASE' && productId === 'com.getaiomni.ai.credit.v1') {
    // RC retries webhooks: dedupe on event id or one purchase credits twice.
    const evtId = String(event.id ?? `${appUserId}:${event.purchased_at_ms ?? Date.now()}`);
    const { error: dupErr, data: dupRow } = await sb
      .from('processed_rc_events')
      .insert({ event_id: evtId })
      .select('event_id')
      .maybeSingle();
    if (dupErr) return new Response('ok (duplicate credit event)', { status: 200 });

    const { data: u } = await sb.from('users').select('id, ai_credits').eq('auth_id', appUserId).maybeSingle();
    if (!u) return new Response('ok (no user row yet)', { status: 200 });
    const { error: incErr } = await sb
      .from('users')
      .update({ ai_credits: (u.ai_credits ?? 0) + 1, updated_at: new Date().toISOString() })
      .eq('auth_id', appUserId);
    if (incErr) {
      // Roll back the dedupe marker so RC's retry can succeed.
      await sb.from('processed_rc_events').delete().eq('event_id', evtId);
      return new Response('credit grant failed', { status: 500 });
    }
    return new Response('ok (+1 ai credit)', { status: 200 });
  }

  let newTier: 'free' | 'rankings' | 'pro' | null = null;
  if (ACTIVATING.has(type)) newTier = tierFromEntitlements(entitlements);
  else if (DEACTIVATING.has(type)) newTier = 'free';

  if (!newTier) return new Response(`ok (no-op for ${type})`, { status: 200 });

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
    .update({
      tier: newTier,
      // A real RevenueCat entitlement supersedes any comped grant. Without
      // this, a user who was comped and then actually subscribed would be
      // downgraded by the tier-expiry sweep while paying.
      tier_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('auth_id', appUserId);

  if (error) {
    console.error('revenuecat-webhook update failed:', error.message);
    return new Response('db error', { status: 500 });
  }
  console.log(`revenuecat-webhook: ${appUserId} → ${newTier} (${type})`);
  return new Response('ok', { status: 200 });
});
