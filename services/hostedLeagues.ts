// Hosted leagues (P1: best ball) — client service. Schema + RPCs shipped
// 2026-09-04; scoring engine verified against real 2025 week 1 data
// (optimal-lineup selection audited by hand, exact sums). Clients never
// write league tables: create/join are SECURITY DEFINER RPCs, scores are
// cron-computed server-side, reads are membership-scoped RLS.
import { supabase } from './supabase';

export interface HostedLeague {
  id: string; name: string; invite_code: string; season: number;
  format: string; team_count: number; rounds: number;
  starts: Record<string, number>; draft_status: 'open' | 'drafting' | 'complete';
}

export async function createHostedLeague(name: string, teamCount = 12):
  Promise<{ leagueId: string; inviteCode: string } | { error: string }> {
  const { data, error } = await supabase.rpc('create_hosted_league', {
    p_name: name, p_team_count: teamCount,
  });
  if (error) return { error: error.message };
  const row = Array.isArray(data) ? data[0] : data;
  return { leagueId: row.league_id, inviteCode: row.invite_code };
}

export async function joinHostedLeague(code: string, teamName: string):
  Promise<{ leagueId: string } | { error: string }> {
  const { data, error } = await supabase.rpc('join_hosted_league', {
    p_code: code, p_team_name: teamName,
  });
  if (error) return { error: error.message };
  return { leagueId: data as string };
}

export async function myHostedLeagues(): Promise<HostedLeague[]> {
  const { data } = await supabase.from('hosted_leagues')
    .select('*').order('created_at', { ascending: false });
  return (data as HostedLeague[]) ?? [];
}

export async function hostedStandings(leagueId: string): Promise<
  { user_id: string; team_name: string; total: number; weeks: number }[]
> {
  const [{ data: members }, { data: scores }] = await Promise.all([
    supabase.from('hosted_members').select('user_id, team_name').eq('league_id', leagueId),
    supabase.from('hosted_weekly_scores').select('user_id, points').eq('league_id', leagueId),
  ]);
  const agg = new Map<string, { total: number; weeks: number }>();
  for (const s of scores ?? []) {
    const a = agg.get(s.user_id) ?? { total: 0, weeks: 0 };
    a.total += Number(s.points); a.weeks += 1; agg.set(s.user_id, a);
  }
  return (members ?? [])
    .map(m => ({ user_id: m.user_id, team_name: m.team_name, ...(agg.get(m.user_id) ?? { total: 0, weeks: 0 }) }))
    .sort((a, b) => b.total - a.total);
}
