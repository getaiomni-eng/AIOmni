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
  league_kind?: 'season' | 'weekly'; start_week?: number; end_week?: number; pick_deadline?: string | null;
  creator_id: string; dues_url: string | null;
}

// Pick-clock presets. The 8h default is deliberate: these drafts are mostly
// asynchronous, and silently dropping everyone to 90s would autopick for people
// who expected to draft over an evening. The commissioner picks explicitly.
export const PICK_CLOCKS = [
  { label: '90 seconds', seconds: 90,    hint: 'Live draft, everyone in the room' },
  { label: '10 minutes', seconds: 600,   hint: 'Live-ish, phones in hand' },
  { label: '2 hours',    seconds: 7200,  hint: 'Same evening' },
  { label: '8 hours',    seconds: 28800, hint: 'Take your time (default)' },
] as const;

export async function createHostedLeague(
  name: string, teamCount = 12, kind: 'season' | 'weekly' = 'season', pickSeconds = 28800):
  Promise<{ leagueId: string; inviteCode: string } | { error: string }> {
  const { data, error } = await supabase.rpc('create_hosted_league', {
    p_name: name, p_team_count: teamCount, p_kind: kind, p_pick_seconds: pickSeconds,
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

export async function setLeagueDuesUrl(leagueId: string, url: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('set_league_dues_url', { p_league: leagueId, p_url: url });
  return error ? { error: error.message } : {};
}

export async function myAppId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
  return data?.id ?? null;
}

// ── Draft room ──────────────────────────────────────────────────────────────
export interface DraftPickRow { overall: number; round: number; user_id: string; gsis_id: string }
export interface DraftMember { user_id: string; team_name: string; draft_slot: number | null }

export async function startHostedDraft(leagueId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('start_hosted_draft', { p_league: leagueId });
  return error ? { error: error.message } : {};
}

export async function makeHostedPick(leagueId: string, sleeperId: string):
  Promise<{ overall: number; playerName: string; nextSlot: number; complete: boolean } | { error: string }> {
  const { data, error } = await supabase.rpc('make_hosted_pick', { p_league: leagueId, p_sleeper_id: sleeperId });
  if (error) return { error: error.message };
  const r = Array.isArray(data) ? data[0] : data;
  return { overall: r.overall, playerName: r.player_name, nextSlot: r.next_slot, complete: r.complete };
}

export async function draftRoomState(leagueId: string): Promise<{
  league: HostedLeague | null; members: DraftMember[]; picks: DraftPickRow[];
}> {
  const [{ data: lgs }, { data: members }, { data: picks }] = await Promise.all([
    supabase.from('hosted_leagues').select('*').eq('id', leagueId),
    supabase.from('hosted_members').select('user_id, team_name, draft_slot').eq('league_id', leagueId),
    supabase.from('hosted_picks').select('overall, round, user_id, gsis_id').eq('league_id', leagueId).order('overall'),
  ]);
  return {
    league: (lgs?.[0] as HostedLeague) ?? null,
    members: (members as DraftMember[]) ?? [],
    picks: (picks as DraftPickRow[]) ?? [],
  };
}

// Realtime: fire onChange on every new pick or league status flip.
// postgres_changes is RLS-scoped — only members receive a league's events.
export function subscribeDraft(leagueId: string, onChange: () => void): () => void {
  const ch = supabase
    .channel(`draft:${leagueId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hosted_picks', filter: `league_id=eq.${leagueId}` }, onChange)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'hosted_leagues', filter: `id=eq.${leagueId}` }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}

// Snake math mirrored client-side for the on-the-clock banner.
export function snakeSlot(overall: number, teams: number): number {
  const r = Math.floor((overall - 1) / teams);
  const i = (overall - 1) % teams;
  return r % 2 === 0 ? i + 1 : teams - i;
}

export async function forceHostedPick(leagueId: string, sleeperId: string):
  Promise<{ complete: boolean } | { error: string }> {
  const { data, error } = await supabase.rpc('force_hosted_pick', { p_league: leagueId, p_sleeper_id: sleeperId });
  if (error) return { error: error.message };
  const r = Array.isArray(data) ? data[0] : data;
  return { complete: r.complete };
}
export async function leaveHostedLeague(leagueId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('leave_hosted_league', { p_league: leagueId });
  return error ? { error: error.message } : {};
}
export async function deleteHostedLeague(leagueId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('delete_hosted_league', { p_league: leagueId });
  return error ? { error: error.message } : {};
}
// Server errors are precise but raw; users get the human version.
export function friendlyDraftError(msg: string): string {
  if (/duplicate key|hosted_picks_league_id_gsis/i.test(msg)) return 'Already drafted — someone beat you to him.';
  if (/not your turn/i.test(msg)) return "Not your turn yet — hold tight.";
  if (/draft is not live/i.test(msg)) return 'The draft is not live.';
  if (/draft is complete/i.test(msg)) return 'The draft is over.';
  // Raised by make_hosted_pick when the player has no gsis mapping — mostly
  // unmapped rookies, which the board now filters out. Kept as a backstop so
  // nobody on the clock ever sees a raw Postgres string.
  if (/unknown or undraftable/i.test(msg)) return "That player isn't draftable yet — pick someone else.";
  if (/pick clock must be/i.test(msg)) return 'Pick clock must be between 30 seconds and 24 hours.';
  if (/regular season is over/i.test(msg)) return 'The regular season is over — weekly runs return next year.';
  return msg;
}
