// services/deleteAccount.ts
//
// Calls the delete-account edge function which hard-deletes the user's
// public.users row + all dependent rows + the auth.users record.
// Required by Apple App Store guideline 5.1.1(v) for any app with sign-up.

import { supabase } from './supabase';

const PROXY_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/delete-account';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw';

export async function deleteAccount(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userJwt = session?.access_token;
    if (!userJwt) return { ok: false, error: 'Not signed in' };

    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        apikey:        SUPABASE_ANON_KEY,
        Authorization: `Bearer ${userJwt}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: data?.error?.message ?? `HTTP ${res.status}` };
    }
    // Forcibly sign out client-side too — the server-side auth user is
    // gone, but the client still has cached session state.
    try { await supabase.auth.signOut(); } catch {}
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Unknown error' };
  }
}
