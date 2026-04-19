#!/usr/bin/env python3
path = 'app/(tabs)/index.tsx'
with open(path) as f: lines = f.readlines()

# Line 80 (0-indexed line 79) is a stray `    loadNewsFeed();`
# Check that it's actually a standalone line calling loadNewsFeed, then remove it.
target_idx = 79  # line 80 is index 79

if target_idx < len(lines) and lines[target_idx].strip() == 'loadNewsFeed();':
    # Confirm the line above is NOT useEffect(() => { loadLeagues(); loadNewsFeed(); }
    # That one is on a single line now, so line 80 should be its own orphan
    removed = lines.pop(target_idx)
    with open(path, 'w') as f: f.writelines(lines)
    print(f"Removed stray line 80: {removed.rstrip()}")
else:
    print(f"Line 80 doesn't look like a stray: {lines[target_idx].rstrip() if target_idx < len(lines) else '(past EOF)'}")
    # Print context
    for i in range(max(0, target_idx - 3), min(len(lines), target_idx + 3)):
        print(f"  {i+1}: {lines[i].rstrip()}")
