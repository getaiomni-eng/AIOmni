export interface RotoWireNewsItem {
  title: string;
  description: string;
  pubDate: string;
  link: string;
}

let cache: RotoWireNewsItem[] = [];
let cacheTime = 0;

export async function fetchRotoWireNFL(): Promise<RotoWireNewsItem[]> {
  if (cache.length && Date.now() - cacheTime < 300000) return cache;
  try {
    const res = await fetch('https://www.rotowire.com/rss/news.php?sport=NFL');
    const text = await res.text();
    const items = text.match(/<item>([\s\S]*?)<\/item>/g) || [];
    cache = items.map(item => ({
      title: (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || [])[1] || '',
      description: (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || [])[1] || '',
      pubDate: (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '',
      link: (item.match(/<link>(.*?)<\/link>/) || [])[1] || '',
    }));
    cacheTime = Date.now();
    return cache;
  } catch { return []; }
}

export function findNewsForPlayer(news: RotoWireNewsItem[], name: string, max = 2): RotoWireNewsItem[] {
  const parts = name.toLowerCase().split(' ');
  const last = parts[parts.length - 1];
  return news.filter(n => n.title.toLowerCase().includes(last)).slice(0, max);
}

export function formatNewsAge(pubDate: string): string {
  const diff = Date.now() - new Date(pubDate).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
