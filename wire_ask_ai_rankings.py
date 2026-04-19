#!/usr/bin/env python3
"""
Wire rankings Ask AI → AI Coach tab with pre-filled question.
Two file edits:
 1. coach.tsx — read URL param 'q', auto-send on mount
 2. rankings.tsx — onAskAI routes to /(tabs)/coach with question param
"""

# ══════════════════════════════════════════════════════════════
# 1. AI Coach: accept URL param and auto-send
# ══════════════════════════════════════════════════════════════
coach_path = 'app/(tabs)/coach.tsx'
with open(coach_path) as f: coach = f.read()

# Add useLocalSearchParams import
if "useLocalSearchParams" not in coach:
    old = "import { useRouter } from 'expo-router';"
    new = "import { useRouter, useLocalSearchParams } from 'expo-router';"
    coach = coach.replace(old, new)
    print("OK  coach.tsx — added useLocalSearchParams import")

# Add hook inside the component — right after useRouter
if "useLocalSearchParams<" not in coach:
    old = "  const router = useRouter();\n  const insets = useSafeAreaInsets();"
    new = """  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();"""
    if old in coach:
        coach = coach.replace(old, new)
        print("OK  coach.tsx — added params hook")

# Add effect that fires send() when params.q is present and context is ready
if "// Auto-send from URL param" not in coach:
    # Insert right after the existing big useEffect block.
    # Anchor: look for the second useEffect (`if (allLeagues.length > 0)`)
    anchor = "  }, [selectedLeague, allLeagues]);"
    addition = """  }, [selectedLeague, allLeagues]);

  // Auto-send from URL param (when rankings/other screens route here with a question)
  useEffect(() => {
    if (!contextReady) return;
    if (!params.q) return;
    const q = String(params.q);
    // Clear the param so it doesn't re-fire on re-render
    router.setParams({ q: undefined });
    setTimeout(() => { send(q); }, 400);
  }, [contextReady, params.q]);"""
    if anchor in coach:
        coach = coach.replace(anchor, addition)
        print("OK  coach.tsx — added auto-send effect")

with open(coach_path, 'w') as f: f.write(coach)


# ══════════════════════════════════════════════════════════════
# 2. Rankings: Ask AI button routes to Coach with question
# ══════════════════════════════════════════════════════════════
rank_path = 'app/(tabs)/rankings.tsx'
with open(rank_path) as f: rank = f.read()

old_ask = """            onAskAI={() => setCardVisible(false)}"""

new_ask = """            onAskAI={() => {
              const q = `What should I know about ${cardPlayer.name} (${cardPlayer.position} - ${cardPlayer.team}) for my ${format} league? Current rank is #${cardPlayer.rank}.`;
              setCardVisible(false);
              setTimeout(() => {
                router.push({ pathname: '/(tabs)/coach', params: { q } } as any);
              }, 150);
            }}"""

if old_ask in rank:
    rank = rank.replace(old_ask, new_ask)
    print("OK  rankings.tsx — Ask AI routes to Coach with pre-filled question")
else:
    print("--  rankings.tsx — onAskAI pattern not found")

with open(rank_path, 'w') as f: f.write(rank)
print("\nDone")
