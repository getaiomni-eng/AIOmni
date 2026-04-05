// services/playerIntelligence.ts
// Fetches player data from Supabase and injects into AI Coach prompt

const PLAYER_LOOKUP_URL = 'https://khoruzvsprxyocisuhet.supabase.co/functions/v1/player-lookup';
const SUPABASE_ANON     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtob3J1enZzcHJ4eW9jaXN1aGV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMDc5MTEsImV4cCI6MjA5MDU4MzkxMX0.YUIDZOJJhUc0ubkQxB_pSyXeE_xjcrqY7jGmbttlfRw';

// Extract player names mentioned in a prompt
export function extractPlayerNames(text: string): string[] {
  // Common NFL player name patterns — capitalized words
  const words  = text.split(/\s+/);
  const names: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i].replace(/[^a-zA-Z]/g, '');
    const n = words[i+1]?.replace(/[^a-zA-Z]/g, '');
    // Two consecutive capitalized words = likely a player name
    if (w.length > 1 && n?.length > 1 &&
        w[0] === w[0].toUpperCase() && n[0] === n[0].toUpperCase() &&
        w[0] !== w[0].toLowerCase() && n[0] !== n[0].toLowerCase()) {
      names.push(`${w} ${n}`);
    }
  }
  return [...new Set(names)].slice(0, 10); // max 10 players per query
}

// Fetch player intelligence for a prompt
export async function getPlayerContext(prompt: string): Promise<string> {
  try {
    const players = extractPlayerNames(prompt);
    if (players.length === 0) return '';

    const res = await fetch(PLAYER_LOOKUP_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ players }),
    });

    if (!res.ok) return '';
    const data = await res.json();
    return data.formatted ?? '';
  } catch {
    return '';
  }
}

// Fetch top players at a position for draft context
export async function getPositionContext(position: string, limit = 20): Promise<string> {
  try {
    const res = await fetch(PLAYER_LOOKUP_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ position, limit }),
    });

    if (!res.ok) return '';
    const data = await res.json();
    return data.formatted ?? '';
  } catch {
    return '';
  }
}

// College top prospects — fetched from Supabase college_prospects table
export async function getCollegeProspects(position?: string): Promise<string> {
  try {
    const res = await fetch(PLAYER_LOOKUP_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ college: true, position }),
    });

    if (!res.ok) return '';
    const data = await res.json();
    return data.formatted ?? '';
  } catch {
    return '';
  }
}
