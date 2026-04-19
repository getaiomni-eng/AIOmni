#!/usr/bin/env python3
"""
Update PlayerCardModal to use new consolidated news feed:
  - findNewsForPlayer now pulls from all 6 RSS sources, not just Rotowire
  - Player card gets better news coverage (ESPN + PFT + others)
"""
path = 'app/components/PlayerCardModal.tsx'
with open(path) as f: c = f.read()

# Swap the rotowire import for newsFeed
old = "import { fetchRotoWireNFL, findNewsForPlayer, RotoWireItem } from '../../services/rotowire';"
new = "import { findNewsForPlayer, NewsItem as FeedNewsItem } from '../../services/newsFeed';"
if old in c:
    c = c.replace(old, new)
    print("OK  Swapped rotowire import for newsFeed")
else:
    print("--  Import pattern not found")

# Change news state type from RotoWireItem[] to FeedNewsItem[]
c = c.replace("useState<RotoWireItem[]>", "useState<FeedNewsItem[]>")

# Replace the news fetch call — old version called fetchRotoWireNFL + manual filter
# New version uses findNewsForPlayer directly
old_news_fetch = """    // News — Rotowire RSS, filtered to this player
    setNewsLoading(true);
    fetchRotoWireNFL()
      .then(items => {
        if (cancelled) return;
        // Find up to 3 items mentioning this player
        const matches: RotoWireItem[] = [];
        const lowerName = player.name.toLowerCase();
        const lastName = player.name.split(' ').pop()?.toLowerCase() ?? '';
        for (const item of items) {
          const itemPlayer = item.player.toLowerCase();
          if (
            itemPlayer === lowerName ||
            (lastName && itemPlayer.endsWith(lastName)) ||
            (item.headline.toLowerCase().includes(lowerName))
          ) {
            matches.push(item);
            if (matches.length >= 3) break;
          }
        }
        setNews(matches);
      })
      .catch(() => { if (!cancelled) setNews([]); })
      .finally(() => { if (!cancelled) setNewsLoading(false); });"""

new_news_fetch = """    // News — pulls from all 6 RSS sources via consolidated news feed
    setNewsLoading(true);
    findNewsForPlayer(player.name, 3)
      .then(items => { if (!cancelled) setNews(items); })
      .catch(() => { if (!cancelled) setNews([]); })
      .finally(() => { if (!cancelled) setNewsLoading(false); });"""

if old_news_fetch in c:
    c = c.replace(old_news_fetch, new_news_fetch)
    print("OK  Replaced news fetch with findNewsForPlayer")
else:
    print("--  News fetch block not matched")

# Update news card render — field names changed slightly (sourceTag instead of source,
# and the existing render uses item.headline/body/age which all exist in both)
# Also: source badge now uses sourceTag
c = c.replace(
    "<Text style={s.newsSource}>ROTOWIRE</Text>",
    "<Text style={s.newsSource}>{item.sourceTag}</Text>"
)

with open(path, 'w') as f: f.write(c)
print("\nDone")
