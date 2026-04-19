#!/usr/bin/env python3
path = 'app/(tabs)/index.tsx'
with open(path) as f: c = f.read()

# Remove the orphan "const fetchNews = async () => {\n    try {" 
# before loadNewsFeed definition
old = """  const fetchNews = async () => {
    try {
  const loadNewsFeed = async (forceRefresh = false) => {
    try {
      const feed = await fetchNewsFeed(forceRefresh);
      setFeed(feed);
    } catch (e) {
      console.log('feed load error', e);
    }
  };"""

new = """  const loadNewsFeed = async (forceRefresh = false) => {
    try {
      const feed = await fetchNewsFeed(forceRefresh);
      setFeed(feed);
    } catch (e) {
      console.log('feed load error', e);
    }
  };"""

if old in c:
    c = c.replace(old, new)
    with open(path, 'w') as f: f.write(c)
    print("Dangling fetchNews wrapper removed")
else:
    print("Pattern not found — showing current state around line 279")
    lines = c.split('\n')
    for i in range(275, 295):
        if i < len(lines): print(f"{i+1}: {lines[i]}")
