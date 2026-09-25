// Post copy for every network, from one ThemeData.
//
// House rules (owner's, and site/DEPLOY.md's):
//   * no em dashes: they read as machine-written
//   * no methodology: never "model", "ensemble", "blend", weights or inputs.
//     We publish ranks and results, not how they are made.
//   * "expert consensus", never a provider's name
//   * claims only from the data in hand; "free to start", never "free"
// Every text here is final: the publisher posts it verbatim.

import type { Network, PlayerLine, ThemeData } from '../../supabase/functions/_shared/social/types.ts';

export interface Copy {
  body: string;
  title?: string;
  thread?: string[];
  steps?: string[];
  subreddit?: string;
  subreddit_note?: string;
}

const LIMIT: Partial<Record<Network, number>> = { x: 280, bluesky: 300, threads: 500 };
const X_LINK_LEN = 23;   // X counts every URL as 23 characters

const link = (network: Network, d: ThemeData) =>
  `https://getaiomni.com/rankings?utm_source=${network}&utm_medium=social&utm_campaign=wk${d.week}_${d.theme}`;

const who = (p: PlayerLine) => `${p.name} (${p.pos}${p.rank ?? ''}, ${p.team})`;
const tags = (d: ThemeData) => ['#FantasyFootball', '#NFL', '#FantasyFootballAdvice',
  ...({ rankings: ['#StartSit'], final_calls: ['#StartSit'], injuries: ['#InjuryReport'], tnf: ['#TNF'],
    disagree: ['#StartSit'], hits: [], report_card: [], weather: ['#StartSit'], waivers: ['#WaiverWire'],
    next_man_up: ['#WaiverWire'], shootout: ['#DFS', '#StartSit'], usage: ['#WaiverWire'] } as Record<string, string[]>)[d.theme] ?? []];

// Headline + fact lines, shared by every network; trimmed per network below.
function lines(d: ThemeData): { head: string; facts: string[]; long: string[] } {
  switch (d.theme) {
    case 'rankings': {
      const ones = (['QB', 'RB', 'WR', 'TE'] as const).map(p => `${p}1 ${d.lists[p][0]?.name}`).join(', ');
      const long = (['QB', 'RB', 'WR', 'TE'] as const).map(p =>
        `${p}: ${d.lists[p].slice(0, 12).map(x => `${x.rank}. ${x.name} (${x.team})`).join(', ')}`);
      return { head: `Week ${d.week} rankings are live.`, facts: [ones + '.', 'Top 12 at every position in the images.'], long };
    }
    case 'injuries': {
      const f = d.players.map(p => `${p.name} (${p.pos}${p.rank}): ${p.status}, ${p.practice}`);
      return { head: `Week ${d.week} injury watch: the starters we're tracking.`, facts: [...f.slice(0, 4), 'Rankings update after inactives on Sunday.'], long: f };
    }
    case 'disagree': {
      const h = d.higher.map(p => `${p.name}: our ${p.pos}${p.ours}, consensus ${p.pos}${p.consensus}`);
      const l = d.lower.map(p => `${p.name}: our ${p.pos}${p.ours}, consensus ${p.pos}${p.consensus}`);
      return { head: `Where we break from the expert consensus in Week ${d.week}.`,
        facts: [h[0] && `Higher on ${h[0]}`, h[1] && `Higher on ${h[1]}`, l[0] && `Lower on ${l[0]}`].filter(Boolean) as string[],
        long: [...h.map(x => `Higher: ${x}`), ...l.map(x => `Lower: ${x}`)] };
    }
    case 'tnf': {
      const f = d.players.map(p => `${p.name} ${p.pos}${p.rank}`);
      return { head: `Thursday night: ${d.game.away} at ${d.game.home}, ${d.game.kickoff_et}.`,
        facts: [`Our ranks: ${f.slice(0, 5).join(', ')}.`], long: f };
    }
    case 'final_calls': {
      const top = (['QB', 'RB', 'WR', 'TE'] as const).map(p => `${p}: ${d.top5[p].slice(0, 3).map(x => x.name.split(' ').slice(-1)[0]).join(', ')}`);
      const out = d.calls.filter(c => c.call === 'Out').map(c => c.name);
      const play = d.calls.filter(c => c.call === 'Playing').map(c => c.name);
      const calls = [out.length ? `Out: ${out.join(', ')}.` : '', play.length ? `Playing: ${play.join(', ')}.` : ''].filter(Boolean);
      return { head: `Final Week ${d.week} calls after this morning's injury news.`, facts: [...calls, ...top.slice(0, 2)],
        long: [...calls, ...(['QB', 'RB', 'WR', 'TE'] as const).map(p => `${p}: ${d.top5[p].map(x => `${x.rank}. ${x.name}`).join(', ')}`)] };
    }
    case 'hits': {
      const h = d.hits.map(p => `${p.name}: our ${p.pos}${p.rank}, finished ${p.pos}${p.finish} (${p.pts.toFixed(1)} pts)`);
      const s = d.sleepers.map(p => `${p.name}: we had ${p.pos}${p.rank}, finished ${p.pos}${p.finish}`);
      return { head: `Week ${d.week}: the calls that hit.`, facts: [...h.slice(0, 3), ...(s[0] ? [`Ahead of the consensus: ${s[0]}`] : [])],
        long: [...h, ...s.map(x => `Ahead of the consensus: ${x}`)] };
    }
    case 'weather': {
      const f = d.games.map(g => `${g.away} at ${g.home}: ${g.wind} mph${/rain|snow|storm/i.test(g.cond) ? ` and ${g.cond.toLowerCase()}` : ''}, passing about ${g.pass_hit_pct}% lower. ${g.players.slice(0, 2).map(p => `${p.name} (${p.pos}${p.rank})`).join(', ')}`);
      return { head: `Week ${d.week} weather watch: the games where the forecast matters.`, facts: f.slice(0, 2), long: f };
    }
    case 'waivers': {
      const f = d.players.map(p => `${p.name} (${p.pos}${p.rank}, ${p.team}): rostered in ${p.owned}% of leagues`);
      return { head: `Week ${d.week} waiver wire: players we rank as starters who are still out there.`, facts: f.slice(0, 3), long: f };
    }
    case 'next_man_up': {
      const f = d.pairs.map(x => `${x.out.name} (${x.out.team}) ${x.out.status.toLowerCase()}: ${x.up.name} steps in, ${x.up.note}`);
      return { head: `Week ${d.week} next man up: starters ruled out, and who inherits the work.`, facts: f.slice(0, 2), long: f };
    }
    case 'shootout': {
      const f = d.games.map(g => `${g.away} at ${g.home}: total ${g.total}, ${g.favorite} by ${g.spread}. ${g.players.slice(0, 2).map(p => p.name).join(', ')}`);
      return { head: `Week ${d.week} shootout alert: the highest Vegas totals on the slate.`, facts: f.slice(0, 2), long: f };
    }
    case 'usage': {
      const r = d.risers.map(p => `${p.name} (${p.pos}, ${p.team}): ${p.stat} ${p.before}% to ${p.after}%`);
      const l = d.fallers.map(p => `${p.name} (${p.pos}, ${p.team}): ${p.stat} ${p.before}% to ${p.after}%`);
      return { head: `Usage risers and fallers after Week ${d.week}.`,
        facts: [...r.slice(0, 2).map(x => `Up: ${x}`), ...l.slice(0, 1).map(x => `Down: ${x}`)],
        long: [...r.map(x => `Up: ${x}`), ...l.map(x => `Down: ${x}`)] };
    }
    case 'report_card': {
      const b = d.best_call;
      const f = [`${d.ours.top12_hits} of our ${d.ours.top12_total} top-12 picks finished top 12.`,
        `Expert consensus: ${d.consensus.top12_hits} of ${d.consensus.top12_total}.`,
        ...(b ? [`Best call: ${b.name}, our ${b.pos}${b.ours} vs consensus ${b.pos}${b.consensus}, finished ${b.pos}${b.finish}.`] : [])];
      return { head: `Week ${d.week} report card, graded against what actually happened.`, facts: f, long: f };
    }
  }
}

// Fit head + as many fact lines as the network allows, then the link.
function fit(network: Network, d: ThemeData, withLink: boolean) {
  const { head, facts } = lines(d);
  const max = LIMIT[network] ?? 2000;
  const url = withLink ? link(network, d) : '';
  const urlLen = network === 'x' ? X_LINK_LEN : url.length;
  let text = head;
  for (const f of facts) {
    const next = `${text}\n${f}`;
    if (next.length + (withLink ? urlLen + 1 : 0) > max) break;
    text = next;
  }
  return withLink ? `${text}\n${url}` : text;
}

export function copyFor(network: Network, d: ThemeData): Copy {
  const { head, long } = lines(d);
  const hashtags = tags(d).join(' ');
  switch (network) {
    case 'x': case 'bluesky': case 'threads':
      return { body: fit(network, d, true) };
    case 'facebook':
      return { body: `${head}\n\n${long.join('\n')}\n\nFull board: ${link(network, d)}` };
    case 'instagram':
      return { body: `${head}\n\n${long.join('\n')}\n\nFull weekly rankings: link in bio.\n\n${hashtags}` };
    case 'youtube':
      return {
        title: `${head.replace(/\.$/, '')} #Shorts`.slice(0, 100),
        body: `${head}\n\n${long.join('\n')}\n\nFull rankings: ${link(network, d)}\n\n${hashtags}`,
        steps: [
          'Already uploaded to YouTube as a private Short.',
          'Open the YouTube Studio app and tap Content.',
          'Tap the newest video (title matches the "Copy title" text).',
          'Tap Visibility, choose Public, then Save.',
          'Come back here and tap "Mark as posted".',
        ],
      };
    case 'tiktok':
      return {
        body: `${head} ${hashtags}`,
        steps: [
          'Tap "Download video". On iPhone it opens: tap Share, then Save Video.',
          'Tap "Copy caption".',
          'Open TikTok, tap +, then Upload, and pick the saved video.',
          'Tap Next, long-press the caption box and Paste.',
          'Tap Post, then come back here and tap "Mark as posted".',
        ],
      };
    case 'reddit':
      return {
        title: head.replace(/\.$/, ''),
        body: `${long.map(l => `- ${l}`).join('\n')}\n\nHappy to answer questions on any of these.`,
        subreddit: 'your profile (u/ account), or a sub whose rules allow it',
        subreddit_note: 'Most fantasy subs remove self-promotion. Post the data, leave app links out, and read the sub\'s Rules tab first.',
        steps: [
          'Tap "Copy title".',
          'Open Reddit, tap Create (+), and pick where to post (your profile is always safe).',
          'Paste the title, then come back and tap "Copy body".',
          'Paste the body. Optional: tap "Download image" first and attach it.',
          'Tap Post, then come back here and tap "Mark as posted".',
        ],
      };
  }
}
