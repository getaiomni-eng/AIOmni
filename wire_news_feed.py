#!/usr/bin/env python3
"""
Upgrade home screen Live Feed:
 1. Replace inline RSS fetch with `fetchNewsFeed` from services/newsFeed.ts
 2. Add 4 tabs: SLEEPER / NEWS / INJURIES / TRADES
 3. Render tab-filtered list with source badge + age
 4. Keep the tab selection in state
"""
path = 'app/(tabs)/index.tsx'
with open(path) as f: c = f.read()

# ── 1. Add import ──
if "from '../../services/newsFeed'" not in c:
    anchor = "import AsyncStorage from '@react-native-async-storage/async-storage';"
    add = "\nimport { fetchNewsFeed, FeedByTab, NewsTab, NewsItem as FeedNewsItem } from '../../services/newsFeed';"
    if anchor in c:
        c = c.replace(anchor, anchor + add)
        print("OK  Added newsFeed import")

# ── 2. Replace the `news` state declaration and add tab state ──
# Find the current news state
old_state = "const [news, setNews] = useState<NewsItem[]>(["
if old_state in c:
    # Find the end of the default seeds — look for the closing `]);` following it
    start = c.find(old_state)
    close = c.find('\n  ]);\n', start)
    if close < 0:
        close = c.find(']);', start)
    if close > 0:
        # Replace entire hardcoded seed with empty arrays + tab state
        new_block = """const [feed, setFeed] = useState<FeedByTab>({ SLEEPER: [], NEWS: [], INJURIES: [], TRADES: [], all: [] });
  const [newsTab, setNewsTab] = useState<NewsTab>('NEWS');"""
        c = c[:start] + new_block + c[close + len(']);'):]
        print("OK  Replaced news state with tabbed feed state")

# ── 3. Replace the inline RSS fetch with newsFeed ──
# Find the function that does the Promise.allSettled RSS fetches.
# We'll nuke everything from "const parseRSS" (or similar) down to `if (interleaved.length > 0) setNews(interleaved);`
import re
# The block starts with the outer try { and the parseRSS helper. Find and replace.
old_fetch_pattern = re.compile(
    r"(\s*const parseRSS = .*?interleaved\.push\(cbs\[i\]\);\s*\}\s*if \(interleaved\.length > 0\) setNews\(interleaved\);\s*\} catch \{\}\s*\};)",
    re.DOTALL
)
# Actually simpler: replace the fetch block plus handling with a call to fetchNewsFeed
matches = old_fetch_pattern.findall(c)
if matches:
    new_fetch = """
  const loadNewsFeed = async (forceRefresh = false) => {
    try {
      const feed = await fetchNewsFeed(forceRefresh);
      setFeed(feed);
    } catch (e) {
      console.log('feed load error', e);
    }
  };"""
    c = old_fetch_pattern.sub(new_fetch, c)
    print("OK  Replaced RSS fetch with newsFeed call")
else:
    # Fallback: try simpler regex
    idx_start = c.find("const parseRSS = ")
    if idx_start < 0:
        idx_start = c.find("const [rotoRes, pfrRes, cbsRes]")
        # Walk backward to find the enclosing function open brace
        if idx_start > 0:
            idx_start = c.rfind('const ', 0, idx_start)
            if idx_start < 0:
                idx_start = c.rfind('async () => {', 0, idx_start)
    idx_end = c.find("} catch {}\n  };", idx_start) if idx_start > 0 else -1
    if idx_start > 0 and idx_end > idx_start:
        replacement = """const loadNewsFeed = async (forceRefresh = false) => {
    try {
      const feed = await fetchNewsFeed(forceRefresh);
      setFeed(feed);
    } catch (e) {
      console.log('feed load error', e);
    }
  };"""
        c = c[:idx_start] + replacement + c[idx_end + len("} catch {}\n  };"):]
        print("OK  Replaced RSS fetch (fallback match)")
    else:
        print("WARN: RSS fetch block not found — manual intervention needed")

# ── 4. Find where the old fetch was called and replace with loadNewsFeed() ──
# The fetch was likely called from a useEffect or a function with name like loadNews, fetchNews
for caller_pattern in [
    "fetchNews()",
    "loadNews()",
    "parseRSS(",
]:
    if caller_pattern in c:
        pass  # We'll handle this later if needed

# Ensure loadNewsFeed() is called on mount — find a useEffect that previously fetched news
if "loadNewsFeed()" not in c:
    # Look for the useEffect that used to call fetchNews or similar
    # Best effort: find any early useEffect and add loadNewsFeed call to it
    pass  # Will handle after the feed function is wired

# ── 5. Replace the render — swap the ScrollView of news for tabbed version ──
old_render_start = """        {/* ── Live Feed ── */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>LIVE FEED</Text>
          <Text style={styles.sectionHint}>← swipe →</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {news.map((n, i) => (
            <TouchableOpacity key={i} activeOpacity={0.7} onPress={() => n.url ? Linking.openURL(n.url) : undefined}
              style={[styles.newsChip, { borderColor: n.color + '25' }]}>
              <View style={[styles.newsDot, { backgroundColor: n.color }]} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.newsSource, { color: n.color }]}>{n.source}</Text>
                <Text style={styles.newsText} numberOfLines={2}>{n.headline}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>"""

new_render = """        {/* ── Live Feed ── */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>LIVE FEED</Text>
          <TouchableOpacity onPress={() => loadNewsFeed(true)}>
            <Text style={styles.sectionHint}>↻ refresh</Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
          {(['SLEEPER','NEWS','INJURIES','TRADES'] as NewsTab[]).map(t => {
            const count = feed[t].length;
            const isActive = newsTab === t;
            const tabColor = t === 'SLEEPER' ? '#52c0e0' : t === 'INJURIES' ? '#ff4d6a' : t === 'TRADES' ? '#ffb800' : '#6eeb83';
            return (
              <TouchableOpacity key={t} onPress={() => setNewsTab(t)}
                style={[styles.feedTab, isActive && { backgroundColor: tabColor + '22', borderColor: tabColor }]}>
                <Text style={[styles.feedTabText, isActive && { color: tabColor }]}>{t}</Text>
                {count > 0 && <Text style={[styles.feedTabCount, isActive && { color: tabColor }]}>{count}</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {feed[newsTab].length === 0 ? (
            <View style={styles.feedEmpty}>
              <Text style={styles.feedEmptyText}>No {newsTab.toLowerCase()} to show.</Text>
            </View>
          ) : feed[newsTab].map((n: FeedNewsItem) => (
            <TouchableOpacity key={n.id} activeOpacity={0.7} onPress={() => n.url ? Linking.openURL(n.url) : undefined}
              style={[styles.newsChip, { borderColor: n.color + '35' }]}>
              <View style={[styles.newsDot, { backgroundColor: n.color }]} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                  <Text style={[styles.newsSource, { color: n.color }]}>{n.sourceTag}</Text>
                  <Text style={styles.newsAge}>{n.age}</Text>
                </View>
                <Text style={styles.newsText} numberOfLines={3}>{n.headline}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>"""

if old_render_start in c:
    c = c.replace(old_render_start, new_render)
    print("OK  Replaced render with tabbed feed")
else:
    print("WARN: render block not matched — the UI may need manual tweaks")

# ── 6. Add styles for the new UI ──
if "feedTab:" not in c:
    # Inject before the closing `});` of StyleSheet.create
    style_add = """
  feedTab: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 10,
    borderWidth: 1, borderColor: '#1a3542', backgroundColor: '#0f1c22',
  },
  feedTabText: {
    fontFamily: F.mono, fontSize: 9, letterSpacing: 1.2, color: '#7a9eaa', fontWeight: '700',
  },
  feedTabCount: {
    fontFamily: F.mono, fontSize: 9, color: '#7a9eaa', opacity: 0.7,
  },
  feedEmpty: {
    width: 220, padding: 16, backgroundColor: '#0f1c22', borderRadius: 10,
    borderWidth: 1, borderColor: '#1a3542', alignItems: 'center',
  },
  feedEmptyText: {
    fontFamily: F.body, fontSize: 12, color: '#7a9eaa',
  },
  newsAge: {
    fontFamily: F.mono, fontSize: 9, color: '#7a9eaa',
  },"""
    last_close = c.rfind('});')
    if last_close > 0:
        c = c[:last_close] + style_add + '\n' + c[last_close:]
        print("OK  Added feed tab styles")

# ── 7. Ensure loadNewsFeed is called somewhere — find a useEffect early in the component ──
# Best effort: add to existing useEffect that loads leagues, OR add its own.
# Look for "loadLeagues()" or "fetchLeagues()" as a sibling call pattern.
if "loadNewsFeed()" not in c:
    # Find the first useEffect inside the component
    effect_match = re.search(r'useEffect\(\(\) => \{\s*([^}]+)', c)
    if effect_match:
        # Inject loadNewsFeed() right after the opening brace
        idx = effect_match.end(0)
        # Find the end of the first statement (semicolon or newline)
        injection_point = c.find('\n', idx) + 1
        c = c[:injection_point] + '    loadNewsFeed();\n' + c[injection_point:]
        print("OK  Added loadNewsFeed() call in useEffect")

with open(path, 'w') as f: f.write(c)
print("\nDone. Run npx tsc --noEmit to verify.")
