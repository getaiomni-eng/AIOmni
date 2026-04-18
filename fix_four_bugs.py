#!/usr/bin/env python3
import os, re

# FIX 1: Trade prompt actually includes the trade
path = 'app/(tabs)/trade.tsx'
with open(path) as f: content = f.read()

old_trade_fn = """  const analyzeTrade = async () => {
    try {
      const prompt = `Respond ONLY with a JSON object, no markdown. Format: { youReceiveGrade: 'A', youGiveGrade: 'B+', verdict: '...', analysis: '...' }`;
      const response = await askAI(prompt, 550);
      console.log('Raw AI response:', response);
      const clean = response.replace(/```json|```/g, '').trim();
      try {
        const parsed = JSON.parse(clean);
        setYouReceiveGrade(parsed.youReceiveGrade);
        setYouGiveGrade(parsed.youGiveGrade);
        setVerdict(parsed.verdict);
        setAnalysis(parsed.analysis);
      } catch(e) {
        console.log('Parse error:', e);
        setVerdict(clean.slice(0, 200));
      }
    } catch (error) {
      setVerdict('Analysis timed out. Try again.');
      setAnalysis('Unable to complete analysis. Tap Analyze Again to retry.');
    }
  };"""

new_trade_fn = """  const analyzeTrade = async () => {
    try {
      const prompt = `You are AIOmni, expert fantasy football trade analyst.
Format: ${format.toUpperCase()}

YOU ARE GIVING UP:
${giving}

YOU ARE RECEIVING:
${getting}

Grade EACH side of the trade on an A+ to F scale based on ${format === 'dynasty' ? 'dynasty value (age, contract, future production)' : 'rest-of-season value for redraft'}.
Consider: positional value, injury status, depth chart, schedule, ${format === 'dynasty' ? 'age curves and rookie contracts' : 'weekly upside and floor'}.

Respond with ONLY a valid JSON object, no markdown, no code fences. Use this exact shape:
{"youReceiveGrade": "<letter grade>", "youGiveGrade": "<letter grade>", "verdict": "<accept/decline/consider in one short sentence>", "analysis": "<2-3 sentences explaining the grades, who wins, and why>"}`;
      const response = await askAI(prompt, 550);
      console.log('Raw AI response:', response);
      let clean = response.replace(/```json|```/g, '').trim();
      const jsonStart = clean.indexOf('{');
      const jsonEnd = clean.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        clean = clean.slice(jsonStart, jsonEnd + 1);
      }
      try {
        const parsed = JSON.parse(clean);
        setYouReceiveGrade(parsed.youReceiveGrade);
        setYouGiveGrade(parsed.youGiveGrade);
        setVerdict(parsed.verdict);
        setAnalysis(parsed.analysis);
      } catch(e) {
        console.log('Parse error:', e);
        setVerdict('Could not parse response. Try again.');
        setAnalysis(response.slice(0, 300));
      }
    } catch (error) {
      setVerdict('Analysis timed out. Try again.');
      setAnalysis('Unable to complete analysis. Tap Analyze Again to retry.');
    }
  };"""

if old_trade_fn in content:
    content = content.replace(old_trade_fn, new_trade_fn)
    with open(path, 'w') as f: f.write(content)
    print("trade.tsx: OK")
else:
    print("trade.tsx: pattern not found")


# FIX 2: Waiver filter
path = 'services/waivers.ts'
with open(path) as f: content = f.read()

old_filter = """    // Pass 1: trending, unrostered, active skill positions
    for (const t of trendingRes || []) {
      const p = allPlayers[t.player_id];
      if (!p || rostered.has(t.player_id) || added.has(t.player_id)) continue;
      if (!['QB','RB','WR','TE','K','DEF'].includes(p.position)) continue;
      if (!p.team && p.position !== 'DEF') continue;
      results.push(normalizeSleeperPlayer(t.player_id, p, t.count));
      added.add(t.player_id);
      if (results.length >= 150) break;
    }

    // Pass 2: fill from search_rank sorted pool
    if (results.length < 150) {
      const ranked = Object.entries(allPlayers)
        .filter(([pid, p]: any) =>
          !rostered.has(pid) &&
          !added.has(pid) &&
          ['QB','RB','WR','TE','K','DEF'].includes(p.position) &&
          (p.team || p.position === 'DEF') &&
          p.search_rank && p.search_rank < 500 &&
          p.active !== false
        )
        .sort(([, a]: any, [, b]: any) => (a.search_rank ?? 9999) - (b.search_rank ?? 9999))
        .slice(0, 150 - results.length);

      for (const [pid, p] of ranked) {
        results.push(normalizeSleeperPlayer(pid, p as any, trendMap.get(pid) ?? 0));
      }
    }"""

new_filter = """    const isLive = (p: any): boolean => {
      if (!p) return false;
      if (p.active === false) return false;
      if (p.status === 'Retired' || p.status === 'Inactive' || p.status === 'NFL') return false;
      if (p.position !== 'DEF' && !p.team) return false;
      return true;
    };

    for (const t of trendingRes || []) {
      const p = allPlayers[t.player_id];
      if (!p || rostered.has(t.player_id) || added.has(t.player_id)) continue;
      if (!['QB','RB','WR','TE','K','DEF'].includes(p.position)) continue;
      if (!isLive(p)) continue;
      results.push(normalizeSleeperPlayer(t.player_id, p, t.count));
      added.add(t.player_id);
      if (results.length >= 150) break;
    }

    if (results.length < 150) {
      const ranked = Object.entries(allPlayers)
        .filter(([pid, p]: any) =>
          !rostered.has(pid) &&
          !added.has(pid) &&
          ['QB','RB','WR','TE','K','DEF'].includes(p.position) &&
          isLive(p) &&
          p.search_rank && p.search_rank < 500
        )
        .sort(([, a]: any, [, b]: any) => (a.search_rank ?? 9999) - (b.search_rank ?? 9999))
        .slice(0, 150 - results.length);

      for (const [pid, p] of ranked) {
        results.push(normalizeSleeperPlayer(pid, p as any, trendMap.get(pid) ?? 0));
      }
    }"""

if old_filter in content:
    content = content.replace(old_filter, new_filter)
    with open(path, 'w') as f: f.write(content)
    print("waivers.ts: OK")
else:
    print("waivers.ts: pattern not found")


# FIX 3: Draft mode
path = 'services/draft.ts'
with open(path) as f: content = f.read()

old_mode = """  try {
    if (mode === 'rookie') {
      const prospects = await fetchProspectDB();
      return prospects.length > 0 ? prospects : [...DEFAULT_PLAYER_DB];
    }

    const ranked = await fetchBlendedConsensus();"""

new_mode = """  try {
    if (mode === 'rookie') {
      const [prospects, ranked] = await Promise.all([
        fetchProspectDB(),
        fetchBlendedConsensus(),
      ]);

      const nflAsPlayerInfo: PlayerInfo[] = ranked.map((p, i) => ({
        id: p.id,
        name: p.name,
        position: p.position,
        team: p.team,
        adp: parseFloat(p.adp) || (i + 1),
        byeWeek: BYE_WEEKS_2026[p.team] ?? 0,
        tier: p.tier,
        rank: p.rank,
        isDrafted: false,
      }));

      if (prospects.length === 0 && nflAsPlayerInfo.length === 0) return [...DEFAULT_PLAYER_DB];
      if (prospects.length === 0) return nflAsPlayerInfo;

      const pLen = prospects.length;
      return [
        ...prospects,
        ...nflAsPlayerInfo.map((p, i) => ({ ...p, adp: pLen + i + 1, rank: pLen + i + 1 })),
      ];
    }

    const ranked = await fetchBlendedConsensus();"""

if old_mode in content:
    content = content.replace(old_mode, new_mode)
    with open(path, 'w') as f: f.write(content)
    print("draft.ts: OK")
else:
    print("draft.ts: pattern not found")


# FIX 4: Rankings scoring
path = 'services/rankingsData.ts'
with open(path) as f: content = f.read()

old_score = """    // Base score: lower median = better (invert for sorting)
    let score = 600 - Math.min(median, 500);

    // Confidence bonus: more sources = more reliable
    score += (p.sourceCount - 1) * 3;

    // Trending momentum
    const adds  = trendAddMap.get(p.id) ?? 0;
    const drops = trendDropMap.get(p.id) ?? 0;
    if (adds > 0)  score += Math.log10(adds + 1) * 15;
    if (drops > 0) score -= Math.log10(drops + 1) * 10;

    // ESPN leader bonus
    const leaderData = leaderMap.get(p.name.toLowerCase());
    if (leaderData && leaderData.value > 0) {
      score += Math.min(leaderData.value * 0.1, 50);
    }

    // Snap share bonus
    const snap = snapMap.get(p.name.toLowerCase());
    if (snap && snap > 50) score += (snap - 50) * 0.3;"""

new_score = """    let score = 1000 - (Math.log(Math.max(median, 1)) * 80);
    score += (p.sourceCount - 1) * 2;
    const adds  = trendAddMap.get(p.id) ?? 0;
    const drops = trendDropMap.get(p.id) ?? 0;
    if (adds > 0)  score += Math.min(Math.log10(adds + 1) * 4, 15);
    if (drops > 0) score -= Math.min(Math.log10(drops + 1) * 3, 12);
    const leaderData = leaderMap.get(p.name.toLowerCase());
    if (leaderData && leaderData.value > 0) {
      score += Math.min(leaderData.value * 0.02, 8);
    }
    const snap = snapMap.get(p.name.toLowerCase());
    if (snap && snap > 50) score += Math.min((snap - 50) * 0.1, 8);"""

if old_score in content:
    content = content.replace(old_score, new_score)
    with open(path, 'w') as f: f.write(content)
    print("rankingsData.ts: OK")
else:
    print("rankingsData.ts: pattern not found")

print("Done")
