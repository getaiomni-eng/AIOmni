// services/memory.ts
// Season-long AI memory system
// Pro: 1 season (52 weeks), Premium: 2 seasons (104 weeks)

import { supabase } from './supabase';

const RETENTION_WEEKS: Record<string, number> = {
  free:          0,
  rankings:      0,
  pro:           52,
};

export interface MemoryEntry {
  id?:             string;
  leagueId:        string;
  platform:        string;
  week:            number;
  season:          number;
  decisionType:    'waiver' | 'trade' | 'start_sit' | 'draft';
  decisionSummary: string;
  outcome?:        string;
  tags?:           string[];
}

export async function saveMemory(entry: MemoryEntry): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const userRecord = await supabase.from('users').select('id, tier').eq('auth_id', user.id).single();
    if (!userRecord.data) return false;

    const retentionWeeks = RETENTION_WEEKS[userRecord.data.tier] ?? 0;
    if (retentionWeeks === 0) return false; // Free tier — no memory

    const { error } = await supabase.from('memories').insert({
      user_id:          userRecord.data.id,
      league_id:        entry.leagueId,
      platform:         entry.platform,
      week:             entry.week,
      season:           entry.season,
      decision_type:    entry.decisionType,
      decision_summary: entry.decisionSummary,
      outcome:          entry.outcome ?? null,
      tags:             entry.tags ?? [],
    });

    return !error;
  } catch { return false; }
}

export async function loadMemories(leagueId: string, tier: string): Promise<MemoryEntry[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const retentionWeeks = RETENTION_WEEKS[tier] ?? 0;
    if (retentionWeeks === 0) return [];

    const userRecord = await supabase.from('users').select('id').eq('auth_id', user.id).single();
    if (!userRecord.data) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionWeeks * 7);

    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('user_id', userRecord.data.id)
      .eq('league_id', leagueId)
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    if (error || !data) return [];

    return data.map(m => ({
      id:              m.id,
      leagueId:        m.league_id,
      platform:        m.platform,
      week:            m.week,
      season:          m.season,
      decisionType:    m.decision_type,
      decisionSummary: m.decision_summary,
      outcome:         m.outcome,
      tags:            m.tags,
    }));
  } catch { return []; }
}

export async function loadAllMemories(tier: string): Promise<MemoryEntry[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const retentionWeeks = RETENTION_WEEKS[tier] ?? 0;
    if (retentionWeeks === 0) return [];

    const userRecord = await supabase.from('users').select('id').eq('auth_id', user.id).single();
    if (!userRecord.data) return [];

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionWeeks * 7);

    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('user_id', userRecord.data.id)
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !data) return [];

    return data.map(m => ({
      id:              m.id,
      leagueId:        m.league_id,
      platform:        m.platform,
      week:            m.week,
      season:          m.season,
      decisionType:    m.decision_type,
      decisionSummary: m.decision_summary,
      outcome:         m.outcome,
      tags:            m.tags,
    }));
  } catch { return []; }
}

export async function deleteAllMemories(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const userRecord = await supabase.from('users').select('id').eq('auth_id', user.id).single();
    if (!userRecord.data) return false;

    const { error } = await supabase.from('memories').delete().eq('user_id', userRecord.data.id);
    return !error;
  } catch { return false; }
}

export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';

  const lines = ['\n--- YOUR SEASON HISTORY (learn from this) ---'];
  const byType: Record<string, MemoryEntry[]> = {};

  for (const m of memories) {
    (byType[m.decisionType] = byType[m.decisionType] || []).push(m);
  }

  for (const [type, entries] of Object.entries(byType)) {
    lines.push(`\n${type.toUpperCase().replace('_', ' ')} DECISIONS:`);
    entries.slice(0, 10).forEach(e => {
      const outcome = e.outcome ? ` → ${e.outcome}` : '';
      lines.push(`  Wk${e.week}: ${e.decisionSummary}${outcome}`);
    });
  }

  lines.push('\nUse this history to personalize advice — reference past decisions when relevant.');
  return lines.join('\n');
}

export async function pruneOldMemories(tier: string): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const retentionWeeks = RETENTION_WEEKS[tier] ?? 0;
    const userRecord = await supabase.from('users').select('id').eq('auth_id', user.id).single();
    if (!userRecord.data) return;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionWeeks * 7);

    await supabase
      .from('memories')
      .delete()
      .eq('user_id', userRecord.data.id)
      .lt('created_at', cutoff.toISOString());
  } catch {}
}