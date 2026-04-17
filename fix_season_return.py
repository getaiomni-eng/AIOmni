#!/usr/bin/env python3
path = 'services/season.ts'
with open(path) as f: content = f.read()

old = """    if (cachedSeason) {
      await AsyncStorage.setItem('nfl_season', cachedSeason);
      return cachedSeason;
    }
  } catch {
    const saved = await AsyncStorage.getItem('nfl_season');
    cachedSeason = saved || String(new Date().getFullYear());
    return cachedSeason;
  }
}"""

new = """    if (cachedSeason) {
      await AsyncStorage.setItem('nfl_season', cachedSeason);
      return cachedSeason;
    }
  } catch {
    const saved = await AsyncStorage.getItem('nfl_season');
    cachedSeason = saved || String(new Date().getFullYear());
    return cachedSeason;
  }
  // Fallback if API returned but season was falsy
  cachedSeason = String(new Date().getFullYear());
  return cachedSeason;
}"""

if old in content:
    content = content.replace(old, new)
    with open(path,'w') as f: f.write(content)
    print("✓ season.ts: added final fallback return")
else:
    print("✗ pattern not found")
