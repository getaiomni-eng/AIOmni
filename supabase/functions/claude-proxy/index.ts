import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
