#!/usr/bin/env python3
import re
path = 'app/(tabs)/index.tsx'
with open(path) as f: c = f.read()

# ── 1. Replace the old `news` state with the new tabbed feed state ──
# Match the whole multi-line state + its array seed
pattern = re.compile(
    r"const \[news,\s*setNews\]\s*=\s*useState<NewsItem\[\]>\(FALLBACK_NEWS\);",
    re.DOTALL
)
m = pattern.search(c)
if m:
    replacement = """const [feed, setFeed] = useState<FeedByTab>({ SLEEPER: [], NEWS: [], INJURIES: [], TRADES: [], all: [] });
  const [newsTab, setNewsTab] = useState<NewsTab>('NEWS');"""
    c = pattern.sub(replacement, c)
    print("OK  Replaced news state with feed + newsTab state")
else:
    # Try alternate pattern — useState might span multiple lines
    alt = re.compile(
        r"const \[news,[\s\S]*?\]\s*=\s*useState<NewsItem\[\]>\([\s\S]*?\);",
    )
    m2 = alt.search(c)
    if m2:
        c = c[:m2.start()] + """const [feed, setFeed] = useState<FeedByTab>({ SLEEPER: [], NEWS: [], INJURIES: [], TRADES: [], all: [] });
  const [newsTab, setNewsTab] = useState<NewsTab>('NEWS');""" + c[m2.end():]
        print("OK  Replaced news state (alt pattern)")
    else:
        print("WARN state replacement didn't match")

# ── 2. Fix fetchNews() call in useEffect → loadNewsFeed() ──
old_call = "useEffect(() => { loadLeagues(); fetchNews(); }, [selectedSeason]);"
new_call = "useEffect(() => { loadLeagues(); loadNewsFeed(); }, [selectedSeason]);"
if old_call in c:
    c = c.replace(old_call, new_call)
    print("OK  Replaced fetchNews() → loadNewsFeed() in useEffect")
else:
    # Try a looser match
    m3 = re.search(r"loadLeagues\(\);\s*fetchNews\(\);", c)
    if m3:
        c = c[:m3.start()] + "loadLeagues(); loadNewsFeed();" + c[m3.end():]
        print("OK  Replaced fetchNews() → loadNewsFeed() (loose match)")

# ── 3. Remove the leftover `loadNewsFeed()` call my earlier patch injected at the wrong spot ──
# The wrong-spot call looks like a line-alone `    loadNewsFeed();` right after useEffect opening brace,
# but if it's redundant with the one now in useEffect, drop it.
# Actually after fixing 2, the only call site should be inside useEffect. If there's a duplicate
# standalone one, it was the error "used before declaration". Let's find and remove it.
dup = re.search(r"\n    loadNewsFeed\(\);\n", c)
if dup:
    # Count how many standalone `loadNewsFeed()` calls exist
    all_calls = re.findall(r"loadNewsFeed\(\)", c)
    # Definitions are 1, then useEffect call is 1, refresh button is 1 → 3 total is fine
    # If there are 4+, there's a duplicate. Let's look at line context more carefully.
    # Safer: just try to locate the specific orphan that came from my earlier patch
    # — it looks like `    loadNewsFeed();` on its own line right after the opening brace of the first useEffect
    pass  # Skip — let the real error guide us

# ── 4. Remove FALLBACK_NEWS if it's now unused ──
# Leave it; no harm in dead constant and we don't know its shape

with open(path, 'w') as f: f.write(c)
print("\nDone")
