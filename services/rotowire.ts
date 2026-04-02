// services/rotowire.ts
// Rotowire RSS feed parser — NFL news and injury updates

export interface RotoWireItem {
  player:    string;
  team:      string;
  position:  string;
  headline:  string;
  body:      string;
  timestamp: string;
  age:       string;
}

const ROTOWIRE_RSS = 'https://www.rotowire.com/rss/news.php?sport=NFL';

export async function fetchRotoWireNFL(): Promise<RotoWireItem[]> {
  try {
    const res = await fetch(ROTOWIRE_RSS);
    if (!res.ok) return [];
    const xml   = await res.text();
    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];

    return items.slice(0, 30).flatMap(item => {
      const title = extractCDATA(item, 'title') || extractTag(item, 'title');
      const desc  = extractCDATA(item, 'description') || extractTag(item, 'description');
      const pubDate = extractTag(item, 'pubDate') ?? '';

      if (!title) return [];

      // Parse "Player Name (TEAM - POS): Headline" format
      const headerMatch = title.match(/^(.+?)\s*\(([A-Z]+)\s*-\s*([A-Z]+)\):\s*(.+)$/);
      if (!headerMatch) {
        return [{
          player:    '',
          team:      '',
          position:  '',
          headline:  title,
          body:      cleanText(desc ?? ''),
          timestamp: pubDate,
          age:       formatNewsAge(pubDate),
        }];
      }

      return [{
        player:    headerMatch[1].trim(),
        team:      headerMatch[2].trim(),
        position:  headerMatch[3].trim(),
        headline:  headerMatch[4].trim(),
        body:      cleanText(desc ?? ''),
        timestamp: pubDate,
        age:       formatNewsAge(pubDate),
      }];
    });
  } catch (e) {
    console.log('fetchRotoWireNFL error:', e);
    return [];
  }
}

export function findNewsForPlayer(items: RotoWireItem[], playerName: string): RotoWireItem | null {
  if (!playerName || items.length === 0) return null;
  const name = playerName.toLowerCase();
  return items.find(item =>
    item.player.toLowerCase().includes(name) ||
    name.includes(item.player.toLowerCase().split(' ').pop() ?? '')
  ) ?? null;
}

export function formatNewsAge(pubDate: string): string {
  if (!pubDate) return '';
  try {
    const then = new Date(pubDate).getTime();
    const now  = Date.now();
    const diff = now - then;
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins  < 60)  return `${mins}m ago`;
    if (hours < 24)  return `${hours}h ago`;
    return `${days}d ago`;
  } catch {
    return '';
  }
}

function extractCDATA(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}><\\!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`));
  return match ? cleanText(match[1]) : '';
}

function extractTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? cleanText(match[1]) : '';
}

function cleanText(text: string): string {
  return text
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#8217;/g, "'")
    .replace(/&#8216;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/<[^>]+>/g, '')
    .trim();
}