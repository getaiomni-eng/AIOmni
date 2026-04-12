#!/usr/bin/env python3
"""
Adds:
1. PROSPECTS tab to rankings.tsx (Dynasty Elite paywall)
2. Server-side prompt counting to the Edge Function
"""

# ── 1. Add PROSPECTS tab to rankings.tsx ──

with open('app/(tabs)/rankings.tsx', 'r') as f:
    c = f.read()

# Add supabase import
c = c.replace(
    "from '../../services/rankingsData';",
    "from '../../services/rankingsData';\nimport { supabase } from '../../services/supabase';\nimport { getCurrentTier } from '../../services/purchases';"
)

# Extend Mode type
c = c.replace(
    "type Mode     = 'community' | 'mine';",
    "type Mode     = 'community' | 'mine' | 'prospects';"
)

# Add prospects state
c = c.replace(
    "const [loading, setLoading] = useState(false);",
    """const [loading, setLoading] = useState(false);
  const [prospects, setProspects] = useState<any[]>([]);
  const [prospectsLoading, setProspectsLoading] = useState(false);
  const [prospectsGated, setProspectsGated] = useState(false);"""
)

# Add prospects loader
c = c.replace(
    "const loadSavedState = async () => {",
    """const handleProspectsTab = async () => {
    const tier = await getCurrentTier();
    if (tier !== 'dynasty_elite' && tier !== 'premium') {
      setProspectsGated(true);
      setMode('prospects');
      return;
    }
    setProspectsGated(false);
    setMode('prospects');
    if (prospects.length === 0) {
      setProspectsLoading(true);
      try {
        const { data } = await supabase
          .from('college_prospects')
          .select('*')
          .order('consensus_rank', { ascending: true })
          .limit(200);
        if (data) setProspects(data);
      } catch {}
      setProspectsLoading(false);
    }
  };

  const loadSavedState = async () => {"""
)

# Add PROSPECTS button to toggle
c = c.replace(
    """<TouchableOpacity onPress={handleMyRankingsTab} style={[s.toggleBtn, mode === 'mine' && s.toggleBtnOn]}>
          <Text style={[s.toggleText, mode === 'mine' && s.toggleTextOn]}>MY RANKINGS</Text>
        </TouchableOpacity>
      </View>""",
    """<TouchableOpacity onPress={handleMyRankingsTab} style={[s.toggleBtn, mode === 'mine' && s.toggleBtnOn]}>
          <Text style={[s.toggleText, mode === 'mine' && s.toggleTextOn]}>MY RANKINGS</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleProspectsTab} style={[s.toggleBtn, mode === 'prospects' && { backgroundColor: palette.flame }]}>
          <Text style={[s.toggleText, mode === 'prospects' && s.toggleTextOn]}>PROSPECTS</Text>
        </TouchableOpacity>
      </View>"""
)

# Add prospects rendering before the closing tags
# Find the spot after the community/mine rendering
prospects_ui = """
        {mode === 'prospects' && (
          prospectsGated ? (
            <View style={{ alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 }}>
              <Text style={{ fontFamily: F.bold, fontSize: 22, color: dark.text, textAlign: 'center', letterSpacing: 1, marginBottom: 12 }}>DYNASTY ELITE</Text>
              <Text style={{ fontFamily: F.body, fontSize: 14, color: dark.textMuted, textAlign: 'center', lineHeight: 22, marginBottom: 24 }}>
                College prospect rankings filtered through your dynasty scoring format. Requires Dynasty Elite subscription.
              </Text>
              <TouchableOpacity 
                style={{ backgroundColor: palette.flame, borderRadius: 14, paddingHorizontal: 32, paddingVertical: 16 }}
                onPress={() => router.push('/paywall' as any)}
              >
                <Text style={{ fontFamily: F.bold, fontSize: 14, color: dark.bg, letterSpacing: 2 }}>UPGRADE TO DYNASTY ELITE</Text>
              </TouchableOpacity>
            </View>
          ) : prospectsLoading ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <ActivityIndicator color={palette.flame} size="large" />
              <Text style={{ color: dark.textMuted, fontFamily: F.body, marginTop: 12 }}>Loading prospects...</Text>
            </View>
          ) : (
            prospects.filter(p =>
              (position === 'ALL' || p.position === position) &&
              (!search || p.name.toLowerCase().includes(search.toLowerCase()) || (p.school || '').toLowerCase().includes(search.toLowerCase()))
            ).map((p: any, i: number) => {
              const posStyle = POS_COLORS[p.position] || POS_COLORS.K;
              return (
                <View key={p.id} style={s.card}>
                  <Text style={[s.rank, i < 3 && { color: palette.flame }]}>{p.consensus_rank || i + 1}</Text>
                  <View style={s.info}>
                    <Text style={s.name}>{(p.name || '').toUpperCase()}</Text>
                    <View style={s.metaRow}>
                      <Text style={s.team}>{p.school || '—'}</Text>
                      <View style={[s.posBadge, { backgroundColor: posStyle.bg }]}>
                        <Text style={[s.posText, { color: posStyle.color }]}>{p.position}</Text>
                      </View>
                      {p.class_year && <Text style={{ fontFamily: F.body, fontSize: 9, color: dark.textMuted, marginLeft: 4 }}>{p.class_year}</Text>}
                    </View>
                    {(p.height || p.weight || p.forty_time) && (
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                        {p.height ? <Text style={{ fontFamily: F.body, fontSize: 9, color: dark.textMuted }}>{p.height}</Text> : null}
                        {p.weight ? <Text style={{ fontFamily: F.body, fontSize: 9, color: dark.textMuted }}>{p.weight} lbs</Text> : null}
                        {p.forty_time ? <Text style={{ fontFamily: F.body, fontSize: 9, color: palette.amber }}>{p.forty_time}s 40</Text> : null}
                      </View>
                    )}
                  </View>
                  <View style={s.rightCol}>
                    {p.positional_rank && <Text style={{ fontFamily: F.body, fontSize: 9, color: dark.textMuted }}>{p.position}{p.positional_rank}</Text>}
                    {p.prospect_grade > 0 && <Text style={{ fontFamily: F.bold, fontSize: 11, color: palette.flame }}>Grade {p.prospect_grade}</Text>}
                  </View>
                </View>
              );
            })
          )
        )}"""

# Insert prospects UI before the closing BaseSelectionModal
c = c.replace(
    "        <BaseSelectionModal",
    prospects_ui + "\n\n        <BaseSelectionModal"
)

# Add router import if not there
if "useRouter" not in c:
    c = c.replace(
        "import { useSafeAreaInsets }",
        "import { useRouter } from 'expo-router';\nimport { useSafeAreaInsets }"
    )
    c = c.replace(
        "const insets = useSafeAreaInsets();",
        "const router = useRouter();\n  const insets = useSafeAreaInsets();"
    )

with open('app/(tabs)/rankings.tsx', 'w') as f:
    f.write(c)
print('✓ Prospects tab added to rankings')

# ── 2. Create server-side prompt enforcement Edge Function ──
# This is a Deno function for Supabase Edge Functions

import os
os.makedirs('supabase/functions/claude-proxy', exist_ok=True)

edge_fn = '''import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const TIER_LIMITS: Record<string, number> = {
  free: 25,
  rankings: 0,
  pro: 75,
  premium: 125,
  dynasty_elite: 999,
};

function getNextSundayNoon(): string {
  const now = new Date();
  const day = now.getDay();
  const daysUntil = day === 0 ? 7 : 7 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(12, 0, 0, 0);
  return next.toISOString();
}

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");

    const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);

    // Try to get authenticated user
    let userId: string | null = null;
    let tier = "free";

    if (token && token !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const { data: { user } } = await sb.auth.getUser(token);
      if (user) {
        userId = user.id;
        // Get tier from users table
        const { data: userData } = await sb
          .from("users")
          .select("tier")
          .eq("auth_id", user.id)
          .single();
        if (userData?.tier) tier = userData.tier;
      }
    }

    // Check prompt limit
    const limit = TIER_LIMITS[tier] ?? 25;

    if (limit < 999 && userId) {
      // Get or create prompt_usage record
      const { data: usage } = await sb
        .from("prompt_usage")
        .select("*")
        .eq("user_id", userId)
        .single();

      const now = new Date();

      if (usage) {
        const resetAt = new Date(usage.reset_at);
        let currentCount = usage.prompts_used;

        // Check if we need to reset
        if (now >= resetAt) {
          currentCount = 0;
          await sb
            .from("prompt_usage")
            .update({ prompts_used: 0, reset_at: getNextSundayNoon() })
            .eq("user_id", userId);
        }

        if (currentCount >= limit) {
          return new Response(
            JSON.stringify({ error: { message: "Weekly prompt limit reached" } }),
            { status: 429, headers: { "Content-Type": "application/json" } }
          );
        }

        // Increment
        await sb
          .from("prompt_usage")
          .update({ prompts_used: currentCount + 1 })
          .eq("user_id", userId);
      } else {
        // First time — create record
        await sb.from("prompt_usage").insert({
          user_id: userId,
          prompts_used: 1,
          reset_at: getNextSundayNoon(),
        });
      }
    }

    // Forward to Anthropic
    const body = await req.json();

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await anthropicRes.json();

    return new Response(JSON.stringify(data), {
      status: anthropicRes.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: { message: e.message || "Proxy error" } }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
'''

with open('supabase/functions/claude-proxy/index.ts', 'w') as f:
    f.write(edge_fn)
print('✓ Edge Function with prompt enforcement written')

print('''
✓ Both done.

NEXT STEPS:

1. Rankings prospects tab — verify with: npx expo export

2. Deploy Edge Function:
   npx supabase functions deploy claude-proxy --project-ref khoruzvsprxyocisuhet

3. Set secrets in Supabase dashboard → Edge Functions → claude-proxy → Secrets:
   ANTHROPIC_API_KEY = your Claude API key
   SUPABASE_URL = https://khoruzvsprxyocisuhet.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = (from Supabase Settings → API → service_role key)

4. Add RLS policy for prompt_usage table:
   CREATE POLICY "Users can read own usage" ON prompt_usage FOR SELECT USING (user_id = auth.uid()::text);
   CREATE POLICY "Service can manage" ON prompt_usage FOR ALL USING (true);
''')
