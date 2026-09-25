// Shared contract for daily social posting. Mirrors public.social_posts
// (migration 20260926000000). Used by the generator (scripts/social, Node),
// the publisher (social-publisher, Deno) and the /rank Posts tab endpoints.

export type Network = 'bluesky' | 'threads' | 'facebook' | 'instagram' | 'x' | 'youtube' | 'tiktok' | 'reddit';
export type Mode = 'auto' | 'semi' | 'manual';
export type Status = 'queued' | 'held' | 'publishing' | 'posted' | 'failed' | 'ready' | 'done' | 'skipped';
export type Theme = 'hits' | 'report_card' | 'rankings' | 'tnf' | 'injuries' | 'disagree' | 'final_calls'
  | 'weather' | 'waivers' | 'next_man_up' | 'shootout' | 'usage';

export const MODE: Record<Network, Mode> = {
  bluesky: 'auto', threads: 'auto', facebook: 'auto', instagram: 'auto', x: 'auto',
  youtube: 'semi', tiktok: 'manual', reddit: 'manual',
};

export interface Media {
  kind: 'image' | 'video';
  url: string;              // public URL in the 'social' storage bucket
  width: number; height: number;
  alt: string;              // accessibility text; Bluesky/X/Threads use it
}

export interface SocialPost {
  id?: number;
  post_date: string;        // YYYY-MM-DD, US/Eastern
  theme: Theme;
  network: Network;
  mode: Mode;
  status: Status;
  publish_at: string | null;
  title: string | null;
  body: string;
  thread: string[] | null;
  media: Media[];
  link: string | null;
  extra: {
    steps?: string[];        // numbered copy-paste instructions (manual/semi)
    subreddit?: string;
    subreddit_note?: string; // the sub's self-promo rule in one line
    [k: string]: unknown;
  };
  posted_url?: string | null;
  posted_at?: string | null;
  error?: string | null;
  attempts?: number;
}

// Media sizes the generator renders. One set per theme per day.
export const SIZES = {
  portrait: { width: 1080, height: 1350 },   // Instagram, Threads, Facebook
  landscape: { width: 1600, height: 900 },   // X, Bluesky
  vertical: { width: 1080, height: 1920 },   // TikTok, YouTube Shorts (video)
} as const;

// ── Theme data: what the generator hands the renderer ─────────────────────
// All player lists are already ordered and trimmed. `consensus` means expert
// consensus (never name the provider in media). Ranks are position ranks.
export interface PlayerLine { name: string; pos: 'QB' | 'RB' | 'WR' | 'TE'; team: string; opp?: string; rank?: number }

export type ThemeData =
  | { theme: 'rankings'; season: number; week: number;
      lists: Record<'QB' | 'RB' | 'WR' | 'TE', PlayerLine[]> }                 // top 12 each
  | { theme: 'injuries'; season: number; week: number;
      players: (PlayerLine & { status: string; practice: string })[] }        // <= 10, most important first
  | { theme: 'disagree'; season: number; week: number;
      higher: (PlayerLine & { ours: number; consensus: number })[];           // we're higher, <= 5
      lower: (PlayerLine & { ours: number; consensus: number })[] }           // we're lower, <= 5
  | { theme: 'tnf'; season: number; week: number;
      game: { away: string; home: string; kickoff_et: string };
      players: PlayerLine[] }                                                  // ranked players in the game, <= 10
  | { theme: 'final_calls'; season: number; week: number;
      top5: Record<'QB' | 'RB' | 'WR' | 'TE', PlayerLine[]>;
      calls: (PlayerLine & { call: 'Out' | 'Playing' })[] }                   // owner's desk calls, may be empty
  | { theme: 'hits'; season: number; week: number;
      hits: (PlayerLine & { finish: number; pts: number })[];                 // we ranked him high, he delivered, <= 5
      sleepers: (PlayerLine & { finish: number; pts: number })[] }            // we were above consensus and right, <= 5
  | { theme: 'report_card'; season: number; week: number;
      ours: { top12_hits: number; top12_total: number };                       // across QB/RB/WR/TE
      consensus: { top12_hits: number; top12_total: number };
      best_call: PlayerLine & { ours: number; consensus: number; finish: number } | null }
  | { theme: 'weather'; season: number; week: number;
      games: { away: string; home: string; kickoff_et: string;
               wind: number; cond: string;                          // mph, e.g. 'Rain'
               impact: 'high' | 'moderate';                         // high = wind >= 15
               pass_hit_pct: number;                                // e.g. 13 = passing ~13% lower
               players: PlayerLine[] }[] }                          // <= 4 games, <= 4 players each
  | { theme: 'waivers'; season: number; week: number;
      players: (PlayerLine & { owned: number })[] }                // rostered % in ESPN leagues, <= 8
  | { theme: 'next_man_up'; season: number; week: number;
      pairs: { out: PlayerLine & { status: string }; up: PlayerLine & { note: string } }[] }  // <= 5
  | { theme: 'shootout'; season: number; week: number;
      games: { away: string; home: string; kickoff_et: string; total: number;
               favorite: string; spread: number; players: PlayerLine[] }[] }   // top 3 totals
  | { theme: 'usage'; season: number; week: number;                // week = last week played
      risers: (PlayerLine & { stat: string; before: number; after: number })[];   // <= 5
      fallers: (PlayerLine & { stat: string; before: number; after: number })[] };

// What the renderer returns for one ThemeData: local file paths.
export interface RenderedSet {
  portrait: string[];       // 1080x1350 PNGs (carousel order; rankings = one per position)
  landscape: string[];      // 1600x900 PNGs (max 4, X/Bluesky)
  video: string | null;     // 1080x1920 MP4, 10-20s
  cover: string | null;     // 1080x1920 PNG, first frame / thumbnail
  alt: string[];            // alt text per portrait image, same order
}
