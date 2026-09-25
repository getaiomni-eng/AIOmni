// Social graphics + video for the daily posts.
//
//   render(data: ThemeData, outDir) -> RenderedSet
//   node scripts/social/render/render.ts <sample.json> <outDir>
//
// HTML templates (brand: marketing/reddit/banner.html) rendered by headless
// Chrome at 2x, downscaled with ffmpeg lanczos for crisp text; the vertical
// frames are stitched into a 1080x1920 H.264 MP4 with short crossfades and a
// silent audio track (TikTok and Shorts both accept it).
//
// No npm deps. Needs Chrome (CHROME_PATH, the macOS app, or `google-chrome`
// on GitHub's ubuntu runners), ffmpeg, and network: fonts load from Google
// Fonts at render time.
//
// Copy rules: no methodology words. It is "AIOmni weekly rankings" and
// "expert consensus", never a provider name, never how the ranks are built.

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SIZES } from '../../../supabase/functions/_shared/social/types.ts';
import type { PlayerLine, RenderedSet, ThemeData } from '../../../supabase/functions/_shared/social/types.ts';

type Kind = keyof typeof SIZES;
type Pos = 'QB' | 'RB' | 'WR' | 'TE';
const POSITIONS: Pos[] = ['QB', 'RB', 'WR', 'TE'];
const POS_NAME: Record<Pos, string> = { QB: 'Quarterback', RB: 'Running back', WR: 'Wide receiver', TE: 'Tight end' };

// ── process helpers ────────────────────────────────────────────────────────
function run(cmd: string, args: string[], timeoutMs = 90_000): Promise<string> {
  return new Promise((res, rej) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) rej(new Error(`${cmd} failed: ${err.message}\n${String(stderr).slice(-600)}`));
      else res(String(stdout));
    });
  });
}

function chromePath(): string {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  if (existsSync(mac)) return mac;
  return 'google-chrome';
}

// A few Chrome processes at a time; each launch is ~1s, so this keeps a
// 14-image rankings day around 10s without swamping a 2-core runner.
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => {
    while (q.length) await fn(q.shift()!);
  }));
}

// Chrome writes the screenshot quickly but, with a fresh --user-data-dir,
// often never exits afterwards (seen on macOS Chrome 153). So watch stderr
// for "bytes written to file" and kill it ourselves. --use-mock-keychain and
// --password-store=basic stop a fresh profile from touching the macOS
// keychain, which can otherwise block on a system prompt.
function chromeShot(args: string[], out: string, timeoutMs = 60_000): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(chromePath(), args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    let done = false;
    const finish = (e?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { p.kill('SIGKILL'); } catch { /* already gone */ }
      e ? rej(e) : res();
    };
    const timer = setTimeout(() => finish(new Error(`chrome timed out after ${timeoutMs}ms\n${err.slice(-400)}`)), timeoutMs);
    p.stderr.on('data', (b: Buffer) => {
      err += b.toString();
      if (/bytes written to file/.test(err)) setTimeout(() => finish(), 150); // let the write flush
    });
    p.on('error', (e) => finish(e));
    p.on('exit', () => {
      // Exited on its own: fine if the file is there, otherwise report stderr.
      setTimeout(() => existsSync(out) ? finish() : finish(new Error(`chrome exited without a screenshot\n${err.slice(-400)}`)), 50);
    });
  });
}

async function shoot(html: string, kind: Kind, outPng: string, work: string) {
  const { width, height } = SIZES[kind];
  const id = Math.random().toString(36).slice(2);
  const htmlPath = join(work, `${id}.html`);
  const big = join(work, `${id}@2x.png`);
  const profile = join(work, `profile-${id}`);
  await writeFile(htmlPath, html);
  await chromeShot([
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--use-mock-keychain', '--password-store=basic', '--disable-extensions', '--disable-background-networking',
    `--user-data-dir=${profile}`, '--force-device-scale-factor=2', '--virtual-time-budget=8000',
    `--window-size=${width},${height}`, `--screenshot=${big}`, pathToFileURL(htmlPath).href,
  ], big);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', big, '-vf', `scale=${width}:${height}:flags=lanczos`, outPng]);
  await rm(profile, { recursive: true, force: true });
}

// ── html building blocks ───────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

let gid = 0;
function ring(px: number) {
  const id = `g${++gid}`;
  return `<svg class="o" width="${px}" height="${px}" viewBox="0 0 21.85 21.85"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
<stop offset="0%" stop-color="#1be7ff"/><stop offset="25%" stop-color="#6eeb83"/><stop offset="50%" stop-color="#e4ff1a"/>
<stop offset="75%" stop-color="#ffb800"/><stop offset="100%" stop-color="#ff5714"/></linearGradient></defs>
<circle cx="10.925" cy="10.925" r="8.30" fill="none" stroke="url(#${id})" stroke-width="1.97" stroke-linecap="round" stroke-dasharray="44.34 7.83" stroke-dashoffset="32.61"/></svg>`;
}
const wordmark = (fontPx: number) =>
  `<span class="wm" style="font-size:${fontPx}px"><span>AI</span><span style="display:inline-block;margin:0 ${-fontPx * 0.04}px 0 ${fontPx * 0.16}px">${ring(Math.round(fontPx * 1.15))}</span><span class="dim">MNI</span></span>`;

// Per-size type scale. Everything is sized for a phone held at arm's length.
const SCALE: Record<Kind, { pad: number; wm: number; stamp: number; h1: number; sub: number; foot: number }> = {
  portrait: { pad: 60, wm: 34, stamp: 22, h1: 76, sub: 30, foot: 20 },
  landscape: { pad: 56, wm: 32, stamp: 20, h1: 64, sub: 28, foot: 19 },
  vertical: { pad: 72, wm: 42, stamp: 26, h1: 104, sub: 38, foot: 24 },
};

function page(kind: Kind, week: number, inner: string, opts: { title?: string; sub?: string; accent?: string } = {}) {
  const { width, height } = SIZES[kind];
  const s = SCALE[kind];
  const accent = opts.accent ?? '#D4FF00';
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Audiowide&family=Barlow:wght@500;600;700;800&family=Space+Mono:wght@400;700&display=block" rel="stylesheet">
<style>
:root{--bg:#070D0E;--panel:#0D1618;--raise:#122023;--line:#1C2B2E;--line2:#26383C;--ink:#E9F1F1;--dim:#95A9AC;--mute:#5E7276;
 --volt:#D4FF00;--QB:#CC77FF;--RB:#33DDFF;--WR:#00FFAA;--TE:#FFAA00;--red:#FF2255;--accent:${accent}}
*{box-sizing:border-box}
html,body{margin:0;width:${width}px;height:${height}px;background:var(--bg);overflow:hidden;font-family:Barlow,sans-serif;color:var(--ink)}
.grid{position:absolute;inset:0;background-image:linear-gradient(#0e191b 1px,transparent 1px),linear-gradient(90deg,#0e191b 1px,transparent 1px);
 background-size:48px 48px;-webkit-mask-image:radial-gradient(ellipse 75% 60% at 50% 30%,#000 15%,transparent 80%)}
.glow{position:absolute;left:50%;top:22%;width:130%;height:60%;transform:translate(-50%,-50%);
 background:radial-gradient(ellipse at 50% 50%,rgba(27,231,255,.09),rgba(228,255,26,.04) 42%,transparent 70%)}
.stripe{position:absolute;left:0;right:0;bottom:0;height:${Math.round(s.pad / 6)}px;background:linear-gradient(90deg,#1be7ff,#6eeb83,#e4ff1a,#ffb800,#ff5714)}
.pg{position:absolute;inset:0;padding:${s.pad}px ${s.pad}px ${s.pad * 0.55}px;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between}
.wm{display:inline-flex;align-items:center;font-family:Audiowide;line-height:1;letter-spacing:.02em}
.wm .dim{opacity:.45}.wm svg{display:block}
.stamp{font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.2em;font-size:${s.stamp}px;color:var(--volt);
 border:2px solid rgba(212,255,0,.55);padding:${s.stamp * 0.35}px ${s.stamp * 0.7}px;border-radius:10px}
h1{margin:${s.pad * 0.55}px 0 0;font-weight:800;font-size:${s.h1}px;line-height:1.02;letter-spacing:-.01em}
h1 .acc{color:var(--accent)}
.sub{margin-top:${s.sub * 0.45}px;font-weight:500;font-size:${s.sub}px;color:var(--dim)}
.body{flex:1;display:flex;flex-direction:column;margin-top:${s.pad * 0.55}px;min-height:0;overflow:hidden}
.foot{display:flex;justify-content:space-between;align-items:center;font-family:'Space Mono',monospace;font-weight:700;
 letter-spacing:.24em;color:var(--dim);font-size:${s.foot}px;padding-top:${s.foot}px}
.foot .ppr{color:var(--mute)}
.pos{font-family:'Space Mono',monospace;font-weight:700}
.QB{color:var(--QB)}.RB{color:var(--RB)}.WR{color:var(--WR)}.TE{color:var(--TE)}
.chip{display:inline-block;font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.06em;border-radius:8px;padding:.18em .55em;font-size:.72em}
.chip.q{background:rgba(255,184,0,.14);color:#FFB800;border:1px solid rgba(255,184,0,.45)}
.chip.out{background:rgba(255,34,85,.14);color:#FF4D77;border:1px solid rgba(255,34,85,.5)}
.chip.play{background:rgba(0,255,170,.12);color:#00FFAA;border:1px solid rgba(0,255,170,.45)}
.card{background:linear-gradient(180deg,rgba(18,32,35,.92),rgba(13,22,24,.92));border:1px solid var(--line2);border-radius:18px}
</style></head><body><div class="grid"></div><div class="glow"></div>
<div class="pg">
 <div class="top">${wordmark(s.wm)}<span class="stamp">WEEK ${week}</span></div>
 ${opts.title ? `<h1>${opts.title}</h1>` : ''}${opts.sub ? `<div class="sub">${opts.sub}</div>` : ''}
 <div class="body">${inner}</div>
 <div class="foot"><span>GETAIOMNI.COM</span><span class="ppr">PPR</span></div>
</div><div class="stripe"></div></body></html>`;
}

const tag = (p: { pos: Pos; rank?: number }) => `<span class="pos ${p.pos}">${p.pos}${p.rank ?? ''}</span>`;
const matchup = (p: PlayerLine) => esc(p.opp ? `${p.team} vs ${p.opp}` : p.team);

// A ranked list row: [WR1] Name .......... SEA vs WAS
function rows(list: PlayerLine[], size: { name: number; meta: number; rk: number; gap: number }, withPosInRank = true) {
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;flex:1;min-height:0">${list.map((p, i) => `
  <div style="display:flex;align-items:baseline;gap:${size.gap}px;border-bottom:1px solid ${i === list.length - 1 ? 'transparent' : 'var(--line)'};padding-bottom:${size.gap * 0.35}px">
    <span class="pos ${p.pos}" style="font-size:${size.rk}px;width:${size.rk * 3.1}px;flex:none">${withPosInRank ? `${p.pos}${p.rank ?? i + 1}` : p.rank ?? i + 1}</span>
    <span style="font-weight:700;font-size:${size.name}px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
    <span style="font-weight:500;font-size:${size.meta}px;color:var(--dim);white-space:nowrap">${matchup(p)}</span>
  </div>`).join('')}</div>`;
}

// ── theme templates ────────────────────────────────────────────────────────
interface Frame { kind: Kind; html: string; alt?: string }

function titleCard(week: number, big: string, sub: string, accent = '#D4FF00') {
  return page('vertical', week, `
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
    <div style="font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.3em;font-size:34px;color:var(--volt)">WEEK ${week}</div>
    <div style="font-weight:800;font-size:150px;line-height:.95;margin-top:28px;letter-spacing:-.02em">${big}</div>
    <div style="font-weight:500;font-size:46px;color:var(--dim);margin-top:36px;line-height:1.2">${sub}</div>
  </div>`, { accent });
}

function endCard(week: number) {
  return page('vertical', week, `
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
    ${wordmark(120)}
    <div style="font-weight:700;font-size:54px;margin-top:64px;line-height:1.15">Weekly rankings,<br><span style="color:var(--volt)">built for your league.</span></div>
    <div style="font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.28em;font-size:34px;color:var(--dim);margin-top:56px">GETAIOMNI.COM</div>
    <div style="font-weight:500;font-size:34px;color:var(--mute);margin-top:22px">Free to start on iPhone and web</div>
  </div>`);
}

// Big vertical card: a heading and up to 6 player lines. The stack is centred
// ABOVE the bottom ~400px, where TikTok and Shorts draw the caption and buttons.
function verticalList(week: number, heading: string, list: { left: string; name: string; right: string }[], accent?: string) {
  return page('vertical', week, `
  <div style="font-weight:800;font-size:84px;line-height:1;margin-top:10px">${heading}</div>
  <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:26px;margin-top:40px;padding-bottom:300px">
  ${list.map(l => `<div class="card" style="padding:30px 34px;display:flex;align-items:center;gap:28px">
      <span style="font-size:44px;flex:none;min-width:150px">${l.left}</span>
      <span style="flex:1;min-width:0"><span style="display:block;font-weight:700;font-size:54px;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(l.name)}</span>
      <span style="display:block;font-weight:500;font-size:34px;color:var(--dim);margin-top:8px">${l.right}</span></span></div>`).join('')}
  </div>`, { accent });
}

const posColor = (p: Pos) => `var(--${p})`;

function rankingsFrames(d: Extract<ThemeData, { theme: 'rankings' }>): { portrait: Frame[]; landscape: Frame[]; vertical: Frame[] } {
  const portrait: Frame[] = POSITIONS.map(pos => {
    const list = d.lists[pos].slice(0, 12).map((p, i) => ({ ...p, pos, rank: p.rank ?? i + 1 }));
    return {
      kind: 'portrait',
      html: page('portrait', d.week, rows(list, { name: 38, meta: 26, rk: 28, gap: 22 }), {
        title: `<span class="acc">${pos}</span> rankings`, sub: `Week ${d.week} · AIOmni weekly rankings`, accent: posColor(pos),
      }),
      alt: `AIOmni week ${d.week} ${POS_NAME[pos].toLowerCase()} rankings, top ${list.length}: ` +
        list.map(p => `${p.rank}. ${p.name} (${p.team}${p.opp ? ` vs ${p.opp}` : ''})`).join(', ') + '.',
    };
  });
  const landscape: Frame[] = POSITIONS.map(pos => {
    const list = d.lists[pos].slice(0, 12).map((p, i) => ({ ...p, pos, rank: p.rank ?? i + 1 }));
    const half = Math.ceil(list.length / 2);
    const col = (l: PlayerLine[]) => `<div style="flex:1;display:flex;flex-direction:column;min-width:0">${rows(l, { name: 34, meta: 24, rk: 26, gap: 18 })}</div>`;
    return {
      kind: 'landscape',
      html: page('landscape', d.week, `<div style="display:flex;gap:56px;flex:1;min-height:0">${col(list.slice(0, half))}${col(list.slice(half))}</div>`, {
        title: `<span class="acc">${pos}</span> rankings`, sub: `Week ${d.week} · AIOmni weekly rankings`, accent: posColor(pos),
      }),
    };
  });
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Week ${d.week}<br><span style="color:var(--volt)">rankings</span>`, 'Top 5 at every position.<br>Full lists in the app.') },
    ...POSITIONS.map(pos => ({
      kind: 'vertical' as Kind,
      html: verticalList(d.week, `<span style="color:${posColor(pos)}">${pos}</span> top 5`,
        d.lists[pos].slice(0, 5).map((p, i) => ({ left: `<span class="pos ${pos}">${pos}${p.rank ?? i + 1}</span>`, name: p.name, right: matchup(p) })),
        posColor(pos)),
    })),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

function statusChip(status: string) {
  const s = status.toLowerCase();
  const cls = /out|doubt|ir|reserve/.test(s) ? 'out' : /play|active/.test(s) ? 'play' : 'q';
  return `<span class="chip ${cls}">${esc(status.toUpperCase())}</span>`;
}
const shortPractice = (p: string) => esc(p
  .replace(/Did Not Participate( In Practice)?/i, 'Did not practice')
  .replace(/Limited Participation( in Practice)?/i, 'Limited practice')
  .replace(/Full Participation( in Practice)?/i, 'Full practice'));

function injuriesFrames(d: Extract<ThemeData, { theme: 'injuries' }>) {
  const list = d.players.slice(0, 10);
  const block = (l: typeof list, big: boolean) => `<div style="display:flex;flex-direction:column;justify-content:space-between;flex:1;gap:${big ? 14 : 10}px;min-height:0">${l.map(p => `
    <div class="card" style="padding:${big ? '12px 22px' : '10px 18px'};display:flex;align-items:center;gap:18px">
      <span style="flex:1;min-width:0">
        <span style="display:block;font-weight:700;font-size:${big ? 32 : 29}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
        <span style="display:block;font-weight:500;font-size:${big ? 23 : 21}px;color:var(--dim);margin-top:2px">${matchup(p)} · ${shortPractice(p.practice || 'No practice report')}</span></span>
      <span style="text-align:right;flex:none;font-size:${big ? 30 : 26}px">${statusChip(p.status)}<span style="display:block;margin-top:6px;font-size:${big ? 24 : 21}px;color:var(--dim)">Ours ${tag(p)}</span></span>
    </div>`).join('')}</div>`;
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, block(list.slice(0, 7), true), { title: 'Injury <span class="acc">watch</span>', sub: 'Questionable before Sunday, with our current rank', accent: '#FFB800' }),
    alt: `AIOmni week ${d.week} injury watch: ` + list.slice(0, 7).map(p => `${p.name} (${p.pos} ${p.team}), ${p.status}, ${p.practice || 'no practice report'}, our rank ${p.pos}${p.rank ?? ''}`).join('; ') + '.',
  }];
  const top = list.slice(0, 8);
  const half = Math.ceil(top.length / 2);
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, `<div style="display:flex;gap:28px;flex:1;min-height:0"><div style="flex:1;display:flex;min-width:0">${block(top.slice(0, half), false)}</div><div style="flex:1;display:flex;min-width:0">${block(top.slice(half), false)}</div></div>`,
      { title: 'Injury <span class="acc">watch</span>', sub: 'Questionable before Sunday, with our current rank', accent: '#FFB800' }),
  }];
  const chunks: typeof list[] = [];
  for (let i = 0; i < Math.min(list.length, 8); i += 4) chunks.push(list.slice(i, i + 4));
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Injury<br><span style="color:#FFB800">watch</span>`, 'Who is questionable,<br>and where we rank them now.', '#FFB800') },
    ...chunks.map((c, i) => ({ kind: 'vertical' as Kind, html: verticalList(d.week, i === 0 ? 'On the report' : 'Also watching',
      c.map(p => ({ left: `${statusChip(p.status)}`, name: p.name, right: `${matchup(p)} · ${shortPractice(p.practice || 'No report')}<br>Ours ${tag(p)}` }))) })),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

function disagreeFrames(d: Extract<ThemeData, { theme: 'disagree' }>) {
  const hi = d.higher.slice(0, 5), lo = d.lower.slice(0, 5);
  const item = (p: (typeof hi)[number], up: boolean, big: boolean) => `
    <div class="card" style="padding:${big ? '12px 20px' : '10px 18px'};display:flex;align-items:center;gap:16px">
      <span style="font-size:${big ? 40 : 34}px;color:${up ? '#00FFAA' : '#FF4D77'};flex:none;width:${big ? 40 : 34}px;text-align:center">${up ? '▲' : '▼'}</span>
      <span style="flex:1;min-width:0"><span style="display:block;font-weight:700;font-size:${big ? 34 : 30}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
        <span style="display:block;font-weight:500;font-size:${big ? 23 : 21}px;color:var(--dim);margin-top:2px">${matchup(p)}</span></span>
      <span style="text-align:right;flex:none;font-size:${big ? 26 : 23}px;line-height:1.35">Ours <span class="pos ${p.pos}">${p.pos}${p.ours}</span><br><span style="color:var(--dim)">Consensus ${p.pos}${p.consensus}</span></span>
    </div>`;
  const section = (label: string, list: typeof hi, up: boolean, big: boolean) => `
    <div style="font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.18em;font-size:${big ? 22 : 19}px;color:${up ? '#00FFAA' : '#FF4D77'};margin:${big ? 6 : 2}px 0 ${big ? 10 : 8}px">${label}</div>
    <div style="display:flex;flex-direction:column;gap:${big ? 10 : 8}px">${list.map(p => item(p, up, big)).join('')}</div>`;
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, `<div style="display:flex;flex-direction:column;justify-content:space-between;flex:1">${section('WE ARE HIGHER', hi.slice(0, 4), true, true)}${section('WE ARE LOWER', lo.slice(0, 4), false, true)}</div>`,
      { title: 'Where we <span class="acc">disagree</span>', sub: 'AIOmni weekly rankings vs expert consensus' }),
    alt: `AIOmni week ${d.week}, where we disagree with expert consensus. We are higher on: ` +
      hi.slice(0, 4).map(p => `${p.name} (ours ${p.pos}${p.ours}, consensus ${p.pos}${p.consensus})`).join(', ') + '. We are lower on: ' +
      lo.slice(0, 4).map(p => `${p.name} (ours ${p.pos}${p.ours}, consensus ${p.pos}${p.consensus})`).join(', ') + '.',
  }];
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, `<div style="display:flex;gap:28px;flex:1;min-height:0"><div style="flex:1;min-width:0">${section('WE ARE HIGHER', hi.slice(0, 4), true, false)}</div><div style="flex:1;min-width:0">${section('WE ARE LOWER', lo.slice(0, 4), false, false)}</div></div>`,
      { title: 'Where we <span class="acc">disagree</span>', sub: 'AIOmni weekly rankings vs expert consensus' }),
  }];
  const vcard = (p: (typeof hi)[number], up: boolean) => ({
    left: `<span style="color:${up ? '#00FFAA' : '#FF4D77'};font-size:56px">${up ? '▲' : '▼'}</span>`, name: p.name,
    right: `Ours <span class="pos ${p.pos}">${p.pos}${p.ours}</span> · Consensus ${p.pos}${p.consensus}`,
  });
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Where we<br><span style="color:var(--volt)">disagree</span>`, 'Our weekly rankings<br>vs the expert consensus.') },
    { kind: 'vertical', html: verticalList(d.week, '<span style="color:#00FFAA">Higher</span> than consensus', hi.map(p => vcard(p, true))) },
    { kind: 'vertical', html: verticalList(d.week, '<span style="color:#FF4D77">Lower</span> than consensus', lo.map(p => vcard(p, false))) },
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

function tnfFrames(d: Extract<ThemeData, { theme: 'tnf' }>) {
  const list = d.players.slice(0, 10);
  const g = `${esc(d.game.away)} @ ${esc(d.game.home)}`;
  const line = (p: PlayerLine, big: boolean) => `
    <div style="display:flex;align-items:baseline;gap:18px;border-bottom:1px solid var(--line);padding-bottom:${big ? 10 : 7}px">
      <span class="pos ${p.pos}" style="font-size:${big ? 30 : 26}px;width:${big ? 92 : 80}px;flex:none">${p.pos}${p.rank ?? ''}</span>
      <span style="font-weight:700;font-size:${big ? 40 : 32}px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
      <span style="font-weight:600;font-size:${big ? 28 : 24}px;color:var(--dim)">${esc(p.team)}</span></div>`;
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, `<div class="card" style="padding:20px 26px;margin-bottom:26px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-weight:800;font-size:48px">${g}</span><span style="font-family:'Space Mono',monospace;font-weight:700;font-size:24px;color:var(--volt)">${esc(d.game.kickoff_et)}</span></div>
      <div style="display:flex;flex-direction:column;justify-content:space-between;flex:1">${list.map(p => line(p, true)).join('')}</div>`,
      { title: 'Thursday night <span class="acc">spotlight</span>', sub: 'Where AIOmni ranks everyone in the game' }),
    alt: `AIOmni week ${d.week} Thursday night spotlight, ${d.game.away} at ${d.game.home}, ${d.game.kickoff_et}. Our position ranks: ` +
      list.map(p => `${p.name} ${p.pos}${p.rank ?? ''} (${p.team})`).join(', ') + '.',
  }];
  const half = Math.ceil(Math.min(list.length, 10) / 2);
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, `<div style="display:flex;gap:48px;flex:1;min-height:0">
      <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between">${list.slice(0, half).map(p => line(p, false)).join('')}</div>
      <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between">${list.slice(half).map(p => line(p, false)).join('')}</div></div>`,
      { title: `Thursday night: <span class="acc">${g}</span>`, sub: `${esc(d.game.kickoff_et)} · where AIOmni ranks everyone in the game` }),
  }];
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Thursday<br><span style="color:var(--volt)">night</span>`, `${g}<br>${esc(d.game.kickoff_et)}`) },
    { kind: 'vertical', html: verticalList(d.week, 'Start your stars', list.slice(0, 5).map(p => ({ left: tag(p), name: p.name, right: esc(p.team) }))) },
    ...(list.length > 5 ? [{ kind: 'vertical' as Kind, html: verticalList(d.week, 'Also in play', list.slice(5, 10).map(p => ({ left: tag(p), name: p.name, right: esc(p.team) }))) }] : []),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

function top5Grid(top5: Record<Pos, PlayerLine[]>, cols: number, big: boolean) {
  return `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:${big ? 20 : 18}px;flex:1;min-height:0">${POSITIONS.map(pos => `
    <div class="card" style="padding:${big ? '18px 22px' : '16px 18px'};display:flex;flex-direction:column;min-width:0">
      <div class="pos ${pos}" style="font-size:${big ? 30 : 26}px;letter-spacing:.12em;margin-bottom:${big ? 8 : 6}px">${pos}</div>
      <div style="display:flex;flex-direction:column;justify-content:space-around;flex:1">${top5[pos].slice(0, 5).map((p, i) => `
        <div style="display:flex;gap:12px;align-items:baseline;min-width:0"><span style="font-family:'Space Mono',monospace;font-weight:700;color:var(--dim);font-size:${big ? 24 : 21}px;width:22px">${p.rank ?? i + 1}</span>
        <span style="font-weight:700;font-size:${big ? 31 : 27}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span></div>`).join('')}</div>
    </div>`).join('')}</div>`;
}

function finalCallsFrames(d: Extract<ThemeData, { theme: 'final_calls' }>) {
  const calls = d.calls.slice(0, 8);
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, top5Grid(d.top5, 2, true), { title: 'Final <span class="acc">calls</span>', sub: 'Top 5 at every position after the morning update' }),
    alt: `AIOmni week ${d.week} final calls, top 5 at every position. ` +
      POSITIONS.map(pos => `${pos}: ${d.top5[pos].slice(0, 5).map(p => p.name).join(', ')}`).join('. ') + '.',
  }];
  if (calls.length) {
    portrait.push({
      kind: 'portrait',
      html: page('portrait', d.week, `<div style="display:flex;flex-direction:column;gap:16px;flex:1;justify-content:center">${calls.map(p => `
        <div class="card" style="padding:18px 24px;display:flex;align-items:center;gap:20px">
          <span style="flex:1;min-width:0"><span style="display:block;font-weight:700;font-size:38px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
          <span style="display:block;font-weight:500;font-size:25px;color:var(--dim);margin-top:4px"><span class="pos ${p.pos}">${p.pos}</span> · ${matchup(p)}</span></span>
          <span style="font-size:34px">${statusChip(p.call === 'Out' ? 'Out' : 'Playing')}</span></div>`).join('')}</div>`,
        { title: 'Injury <span class="acc">calls</span>', sub: 'Our calls on this week\'s questionable players' }),
      alt: `AIOmni week ${d.week} injury calls: ` + calls.map(p => `${p.name} (${p.pos} ${p.team}): ${p.call}`).join(', ') + '.',
    });
  }
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, top5Grid(d.top5, 4, false), { title: 'Final <span class="acc">calls</span>', sub: 'Top 5 at every position after the morning update' }),
  }];
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Final<br><span style="color:var(--volt)">calls</span>`, 'Top 5 at every position,<br>after the morning update.') },
    ...POSITIONS.map(pos => ({ kind: 'vertical' as Kind, html: verticalList(d.week, `<span style="color:${posColor(pos)}">${pos}</span> top 5`,
      d.top5[pos].slice(0, 5).map((p, i) => ({ left: `<span class="pos ${pos}">${pos}${p.rank ?? i + 1}</span>`, name: p.name, right: matchup(p) })), posColor(pos)) })),
    ...(calls.length ? [{ kind: 'vertical' as Kind, html: verticalList(d.week, 'Injury calls',
      calls.slice(0, 5).map(p => ({ left: statusChip(p.call === 'Out' ? 'Out' : 'Playing'), name: p.name, right: `<span class="pos ${p.pos}">${p.pos}</span> · ${matchup(p)}` }))) }] : []),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

function hitsFrames(d: Extract<ThemeData, { theme: 'hits' }>) {
  const hits = d.hits.slice(0, 5), sl = d.sleepers.slice(0, 5);
  const item = (p: (typeof hits)[number], big: boolean) => `
    <div class="card" style="padding:${big ? '12px 20px' : '10px 18px'};display:flex;align-items:center;gap:16px">
      <span style="flex:1;min-width:0"><span style="display:block;font-weight:700;font-size:${big ? 32 : 30}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
        <span style="display:block;font-weight:500;font-size:${big ? 23 : 21}px;color:var(--dim);margin-top:2px">Ranked <span class="pos ${p.pos}">${p.pos}${p.rank ?? ''}</span> · finished ${p.pos}${p.finish}</span></span>
      <span style="flex:none;font-weight:800;font-size:${big ? 40 : 34}px;color:var(--volt)">${p.pts.toFixed(1)}<span style="font-size:.55em;color:var(--dim);font-weight:600"> pts</span></span>
    </div>`;
  const section = (label: string, list: typeof hits, big: boolean) => list.length ? `
    <div style="font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.18em;font-size:${big ? 22 : 19}px;color:var(--volt);margin:${big ? 6 : 2}px 0 ${big ? 10 : 8}px">${label}</div>
    <div style="display:flex;flex-direction:column;gap:${big ? 10 : 8}px">${list.map(p => item(p, big)).join('')}</div>` : '';
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, `<div style="display:flex;flex-direction:column;justify-content:space-between;flex:1">${section('RANKED HIGH, DELIVERED', hits.slice(0, sl.length ? 4 : 5), true)}${section('CALLED IT: ABOVE CONSENSUS', sl.slice(0, 3), true)}</div>`,
      { title: 'Sunday\'s <span class="acc">hits</span>', sub: `Week ${d.week}: where our rankings paid off` }),
    alt: `AIOmni week ${d.week} hits. Ranked high and delivered: ` +
      hits.slice(0, sl.length ? 4 : 5).map(p => `${p.name}, ranked ${p.pos}${p.rank ?? ''}, finished ${p.pos}${p.finish} with ${p.pts.toFixed(1)} points`).join('; ') +
      (sl.length ? '. Above consensus and right: ' + sl.slice(0, 3).map(p => `${p.name}, ranked ${p.pos}${p.rank ?? ''}, finished ${p.pos}${p.finish}`).join('; ') : '') + '.',
  }];
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, `<div style="display:flex;gap:28px;flex:1;min-height:0"><div style="flex:1;min-width:0">${section('RANKED HIGH, DELIVERED', hits.slice(0, 4), false)}</div>${sl.length ? `<div style="flex:1;min-width:0">${section('CALLED IT', sl.slice(0, 4), false)}</div>` : ''}</div>`,
      { title: 'Sunday\'s <span class="acc">hits</span>', sub: `Week ${d.week}: where our rankings paid off` }),
  }];
  const vcard = (p: (typeof hits)[number]) => ({ left: tag(p), name: p.name, right: `Finished ${p.pos}${p.finish} · <span style="color:var(--volt)">${p.pts.toFixed(1)} pts</span>` });
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Sunday's<br><span style="color:var(--volt)">hits</span>`, 'Where our week ' + d.week + '<br>rankings paid off.') },
    { kind: 'vertical', html: verticalList(d.week, 'Ranked high, delivered', hits.map(vcard)) },
    ...(sl.length ? [{ kind: 'vertical' as Kind, html: verticalList(d.week, 'Called it', sl.map(vcard)) }] : []),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

function reportFrames(d: Extract<ThemeData, { theme: 'report_card' }>) {
  const pct = (x: { top12_hits: number; top12_total: number }) => x.top12_total ? x.top12_hits / x.top12_total : 0;
  const bar = (label: string, x: { top12_hits: number; top12_total: number }, color: string, big: boolean, m = 1) => `
    <div style="margin-bottom:${(big ? 26 : 18) * m}px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-weight:700;font-size:${(big ? 34 : 28) * m}px">
        <span>${label}</span><span style="font-family:'Space Mono',monospace;color:${color}">${x.top12_hits}/${x.top12_total}</span></div>
      <div style="height:${(big ? 26 : 20) * m}px;border-radius:${13 * m}px;background:var(--raise);margin-top:${10 * m}px;overflow:hidden">
        <div style="height:100%;width:${(pct(x) * 100).toFixed(1)}%;background:${color};border-radius:13px"></div></div></div>`;
  const b = d.best_call;
  const best = (big: boolean, m = 1) => b ? `
    <div class="card" style="padding:${big ? 22 * m : 16}px ${big ? 26 * m : 20}px;margin-top:${(big ? 12 : 6) * m}px">
      <div style="font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.18em;font-size:${(big ? 22 : 19) * m}px;color:var(--volt)">BEST CALL</div>
      <div style="font-weight:800;font-size:${(big ? 46 : 36) * m}px;margin-top:${8 * m}px">${esc(b.name)}</div>
      <div style="font-weight:500;font-size:${(big ? 27 : 23) * m}px;color:var(--dim);margin-top:6px">Ours <span class="pos ${b.pos}">${b.pos}${b.ours}</span> · consensus ${b.pos}${b.consensus} · finished <span style="color:var(--ink);font-weight:700">${b.pos}${b.finish}</span></div>
    </div>` : '';
  const explain = (big: boolean, m = 1) => `<div style="font-weight:500;font-size:${(big ? 25 : 21) * m}px;line-height:1.3;color:var(--dim);margin-bottom:${(big ? 28 : 18) * m}px">Top-12 hits: players ranked top 12 at their position who finished top 12. QB, RB, WR and TE combined.</div>`;
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, `<div style="display:flex;flex-direction:column;flex:1;justify-content:center">${explain(true, 1.2)}${bar('AIOmni', d.ours, '#D4FF00', true, 1.45)}${bar('Expert consensus', d.consensus, '#95A9AC', true, 1.45)}${best(true, 1.2)}</div>`,
      { title: `Week ${d.week} <span class="acc">report card</span>`, sub: 'How our weekly rankings graded out' }),
    alt: `AIOmni week ${d.week} report card. Top-12 hits: AIOmni ${d.ours.top12_hits} of ${d.ours.top12_total}, expert consensus ${d.consensus.top12_hits} of ${d.consensus.top12_total}.` +
      (b ? ` Best call: ${b.name}, ours ${b.pos}${b.ours}, consensus ${b.pos}${b.consensus}, finished ${b.pos}${b.finish}.` : ''),
  }];
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, `<div style="display:flex;gap:44px;flex:1;min-height:0;align-items:center"><div style="flex:1.2;min-width:0">${explain(false)}${bar('AIOmni', d.ours, '#D4FF00', false)}${bar('Expert consensus', d.consensus, '#95A9AC', false)}</div>${b ? `<div style="flex:1;min-width:0">${best(false)}</div>` : ''}</div>`,
      { title: `Week ${d.week} <span class="acc">report card</span>`, sub: 'How our weekly rankings graded out' }),
  }];
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Report<br><span style="color:var(--volt)">card</span>`, `How our week ${d.week}<br>rankings graded out.`) },
    { kind: 'vertical', html: page('vertical', d.week, `<div style="flex:1;display:flex;flex-direction:column;justify-content:center">
        <div style="font-weight:800;font-size:84px;line-height:1;margin-bottom:40px">Top-12 hits</div>
        <div style="font-size:1.6em">${bar('AIOmni', d.ours, '#D4FF00', true)}${bar('Expert consensus', d.consensus, '#95A9AC', true)}</div>
        <div style="font-weight:500;font-size:34px;color:var(--dim);margin-top:20px">Ranked top 12 at the position and finished top 12.</div></div>`) },
    ...(b ? [{ kind: 'vertical' as Kind, html: verticalList(d.week, 'Best call', [{ left: `<span class="pos ${b.pos}">${b.pos}${b.ours}</span>`, name: b.name, right: `Consensus ${b.pos}${b.consensus} · finished <b style="color:var(--ink)">${b.pos}${b.finish}</b>` }]) }] : []),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

// ── weather ────────────────────────────────────────────────────────────────
// Glyphs drawn in SVG so they render the same on every runner (no emoji font).
function wxIcon(cond: string, px: number) {
  const c = cond.toLowerCase();
  const cloud = `<path d="M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.2 4.5 4.5 0 0 0 7 18z" fill="none" stroke="#95A9AC" stroke-width="1.6" stroke-linejoin="round"/>`;
  const drops = `<path d="M9 20.5l-1 2M13 20.5l-1 2M17 20.5l-1 2" stroke="#33DDFF" stroke-width="1.6" stroke-linecap="round"/>`;
  const flakes = `<path d="M9 21.5h.01M13 22.5h.01M17 21.5h.01" stroke="#E9F1F1" stroke-width="2.4" stroke-linecap="round"/>`;
  const wind = `<path d="M3 9h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 17h7" fill="none" stroke="#D4FF00" stroke-width="1.7" stroke-linecap="round"/>`;
  const inner = /snow/.test(c) ? cloud + flakes : /rain|drizzle|storm|thunder/.test(c) ? cloud + drops : /cloud/.test(c) ? cloud : wind;
  return `<svg width="${px}" height="${px}" viewBox="0 0 24 26" style="flex:none;display:block">${inner}</svg>`;
}
const impactChip = (i: 'high' | 'moderate') =>
  i === 'high' ? `<span class="chip out">HIGH IMPACT</span>` : `<span class="chip q">MODERATE</span>`;

function weatherFrames(d: Extract<ThemeData, { theme: 'weather' }>) {
  const games = d.games.slice(0, 4);
  const n = Math.max(games.length, 1);
  // m scales a card up when there are few games, so 1-3 cards fill the page
  // instead of floating in empty space.
  const card = (g: (typeof games)[number], big: boolean, m = 1) => {
    const pl = g.players.slice(0, big && n <= 3 ? 4 : 3);
    const z = (v: number) => Math.round(v * m);
    return `
    <div class="card" style="padding:${z(big ? 16 : 12)}px ${z(big ? 22 : 18)}px;display:flex;flex-direction:column;gap:${z(big ? 10 : 6)}px;min-height:0">
      <div style="display:flex;align-items:center;gap:${z(big ? 18 : 14)}px">
        ${wxIcon(g.cond, z(big ? 58 : 46))}
        <span style="flex:1;min-width:0">
          <span style="display:block;font-weight:800;font-size:${z(big ? 36 : 30)}px;line-height:1.05">${esc(g.away)} @ ${esc(g.home)}</span>
          <span style="display:block;font-family:'Space Mono',monospace;font-weight:700;font-size:${z(big ? 19 : 16)}px;color:var(--dim);margin-top:4px">${esc(g.kickoff_et)}</span></span>
        <span style="text-align:right;flex:none">
          <span style="display:block;font-weight:800;font-size:${z(big ? 44 : 36)}px;line-height:1;color:var(--volt)">${g.wind}<span style="font-size:.5em;color:var(--dim);font-weight:600"> mph</span></span>
          <span style="display:block;font-weight:600;font-size:${z(big ? 21 : 18)}px;color:var(--dim);margin-top:2px">${esc(g.cond)}</span></span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;font-size:${z(big ? 24 : 21)}px">${impactChip(g.impact)}
        <span style="font-weight:600;color:var(--ink)">Passing ~${g.pass_hit_pct}% lower</span></div>
      ${pl.length ? `<div style="display:flex;flex-wrap:wrap;gap:${z(big ? 6 : 4)}px ${z(big ? 22 : 16)}px">${pl.map(p =>
        `<span style="font-size:${z(big ? 23 : 20)}px;white-space:nowrap"><span class="pos ${p.pos}">${p.pos}${p.rank ?? ''}</span> <span style="font-weight:600">${esc(p.name)}</span></span>`).join('')}</div>` : ''}
    </div>`;
  };
  const sub = 'Outdoor games with wind or rain in the forecast';
  const title = 'Weather <span class="acc">watch</span>';
  const empty = `<div style="flex:1;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:34px;color:var(--dim)">Clear skies: no weather concerns this week.</div>`;
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, games.length
      ? `<div style="display:flex;flex-direction:column;gap:${n >= 4 ? 12 : 24}px;flex:1;justify-content:${n >= 4 ? 'space-between' : 'center'}">${games.map(g => card(g, true, n === 1 ? 1.65 : n === 2 ? 1.35 : n === 3 ? 1.15 : 1)).join('')}</div>`
      : empty, { title, sub, accent: '#33DDFF' }),
    alt: `AIOmni week ${d.week} weather watch. ` + (games.length ? games.map(g =>
      `${g.away} at ${g.home}, ${g.kickoff_et}: ${g.wind} mph, ${g.cond}, ${g.impact} impact, passing about ${g.pass_hit_pct}% lower. Players affected: ${g.players.slice(0, 4).map(p => `${p.name} (${p.pos}${p.rank ?? ''})`).join(', ') || 'none listed'}.`).join(' ')
      : 'No weather concerns this week.'),
  }];
  const half = Math.ceil(games.length / 2);
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, games.length
      ? (games.length <= 3
        ? `<div style="display:flex;flex-direction:column;gap:14px;flex:1;justify-content:center;${games.length === 1 ? 'padding:0 15%;' : ''}">${games.map(g => card(g, false, games.length === 1 ? 1.25 : 1)).join('')}</div>`
        : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 24px;flex:1;align-content:space-between">${games.map(g => card(g, false)).join('')}</div>`)
      : empty, { title, sub, accent: '#33DDFF' }),
  }];
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Weather<br><span style="color:#33DDFF">watch</span>`, 'Wind and rain in the forecast,<br>and who it hits.', '#33DDFF') },
    ...games.map(g => ({ kind: 'vertical' as Kind, html: page('vertical', d.week, `
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding-bottom:300px">
        <div style="display:flex;align-items:center;gap:30px">${wxIcon(g.cond, 130)}
          <span><span style="display:block;font-weight:800;font-size:92px;line-height:1">${esc(g.away)} @ ${esc(g.home)}</span>
          <span style="display:block;font-family:'Space Mono',monospace;font-weight:700;font-size:32px;color:var(--dim);margin-top:12px">${esc(g.kickoff_et)}</span></span></div>
        <div style="display:flex;align-items:baseline;gap:24px;margin-top:48px">
          <span style="font-weight:800;font-size:150px;line-height:1;color:var(--volt)">${g.wind}</span>
          <span style="font-weight:700;font-size:56px;color:var(--dim)">mph · ${esc(g.cond)}</span></div>
        <div style="margin-top:34px;font-size:44px;display:flex;align-items:center;gap:22px">${impactChip(g.impact)}<span style="font-weight:700">Passing ~${g.pass_hit_pct}% lower</span></div>
        <div style="display:flex;flex-direction:column;gap:18px;margin-top:44px">${g.players.slice(0, 4).map(p =>
          `<div class="card" style="padding:22px 30px;display:flex;align-items:center;gap:26px"><span class="pos ${p.pos}" style="font-size:40px;min-width:130px">${p.pos}${p.rank ?? ''}</span><span style="font-weight:700;font-size:46px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span><span style="margin-left:auto;font-weight:600;font-size:32px;color:var(--dim)">${esc(p.team)}</span></div>`).join('')}</div>
      </div>`, { accent: '#33DDFF' }) })),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

// ── waivers ────────────────────────────────────────────────────────────────
function ownedPill(owned: number, px: number) {
  const pct = Math.round(owned);
  const col = pct < 25 ? '#00FFAA' : pct < 50 ? '#D4FF00' : '#FFB800';
  return `<span style="display:inline-flex;flex-direction:column;align-items:center;justify-content:center;border-radius:${px * 0.5}px;border:2px solid ${col};
    background:rgba(0,0,0,.25);padding:${px * 0.18}px ${px * 0.45}px;min-width:${px * 3.2}px;flex:none">
    <span style="font-family:'Space Mono',monospace;font-weight:700;font-size:${px * 0.42}px;letter-spacing:.12em;color:var(--dim)">ROSTERED</span>
    <span style="font-weight:800;font-size:${px}px;line-height:1;color:${col}">${pct}%</span></span>`;
}

function waiversFrames(d: Extract<ThemeData, { theme: 'waivers' }>) {
  const list = d.players.slice(0, 8);
  // zoom: few rows are drawn bigger so the page never looks half empty.
  const row = (p: (typeof list)[number], big: boolean, zoom = 1) => `
    <div class="card" style="zoom:${zoom};padding:${big ? '12px 20px' : '10px 16px'};display:flex;align-items:center;gap:${big ? 20 : 16}px">
      <span class="pos ${p.pos}" style="font-size:${big ? 30 : 26}px;flex:none;min-width:${big ? 90 : 78}px">${p.pos}${p.rank ?? ''}</span>
      <span style="flex:1;min-width:0"><span style="display:block;font-weight:700;font-size:${big ? 36 : 30}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
        <span style="display:block;font-weight:500;font-size:${big ? 23 : 20}px;color:var(--dim);margin-top:2px">${matchup(p)}</span></span>
      ${ownedPill(p.owned, big ? 38 : 32)}
    </div>`;
  const sub = 'Our weekly ranks, rostered in under half of ESPN leagues';
  const title = 'Waiver <span class="acc">wire</span>';
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, `<div style="display:flex;flex-direction:column;gap:${list.length > 6 ? 10 : 18}px;flex:1;justify-content:${list.length <= 5 ? 'center' : 'space-between'}">${list.map(p => row(p, true, list.length <= 3 ? 1.35 : list.length <= 5 ? 1.15 : 1)).join('')}</div>`,
      { title, sub, accent: '#00FFAA' }),
    alt: `AIOmni week ${d.week} waiver wire, players rostered in under half of ESPN leagues: ` +
      list.map(p => `${p.name} (our ${p.pos}${p.rank ?? ''}, ${p.team}${p.opp ? ` vs ${p.opp}` : ''}), rostered ${Math.round(p.owned)}%`).join('; ') + '.',
  }];
  const top = list.slice(0, 8);
  const half = Math.ceil(top.length / 2);
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, `<div style="display:flex;gap:24px;flex:1;min-height:0">${[top.slice(0, half), top.slice(half)].filter(c => c.length).map(col =>
      `<div style="flex:1;display:flex;flex-direction:column;gap:18px;min-width:0;justify-content:${col.length <= 2 ? 'center' : 'space-between'}">${col.map(p => row(p, false, col.length <= 2 ? 1.2 : 1)).join('')}</div>`).join('')}</div>`,
      { title, sub, accent: '#00FFAA' }),
  }];
  const chunks: typeof list[] = [];
  for (let i = 0; i < Math.min(list.length, 8); i += 4) chunks.push(list.slice(i, i + 4));
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Waiver<br><span style="color:#00FFAA">wire</span>`, 'Ranked by us.<br>Rostered in under half of leagues.', '#00FFAA') },
    ...chunks.map((c, i) => ({ kind: 'vertical' as Kind, html: verticalList(d.week, i === 0 ? 'Grab them now' : 'Also available',
      c.map(p => ({ left: tag(p), name: p.name, right: `${matchup(p)} · <span style="color:#00FFAA;font-weight:700">Rostered ${Math.round(p.owned)}%</span>` })), '#00FFAA') })),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

// ── next man up ────────────────────────────────────────────────────────────
function nextManFrames(d: Extract<ThemeData, { theme: 'next_man_up' }>) {
  const pairs = d.pairs.slice(0, 5);
  const pair = (x: (typeof pairs)[number], big: boolean, zoom = 1) => `
    <div class="card" style="zoom:${zoom};padding:${big ? '14px 20px' : '10px 16px'};display:flex;align-items:center;gap:${big ? 16 : 12}px">
      <span style="flex:1;min-width:0">
        <span style="display:block;font-weight:700;font-size:${big ? 30 : 25}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dim)">${esc(x.out.name)}</span>
        <span style="display:flex;align-items:center;gap:10px;margin-top:4px;font-size:${big ? 22 : 19}px"><span class="pos ${x.out.pos}">${x.out.pos}</span><span style="color:var(--mute)">${esc(x.out.team)}</span>${statusChip(x.out.status)}</span></span>
      <span style="font-size:${big ? 40 : 32}px;color:var(--volt);flex:none">→</span>
      <span style="flex:1.25;min-width:0">
        <span style="display:block;font-weight:800;font-size:${big ? 32 : 27}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.up.name)}</span>
        <span style="display:block;font-weight:500;font-size:${big ? 21 : 18}px;color:var(--dim);margin-top:4px"><span class="pos ${x.up.pos}">${x.up.pos}${x.up.rank ?? ''}</span> · ${esc(x.up.note)}</span></span>
    </div>`;
  const sub = 'Starters ruled out, and who inherits the work';
  const title = 'Next man <span class="acc">up</span>';
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, `<div style="display:flex;flex-direction:column;gap:${pairs.length >= 5 ? 16 : 22}px;flex:1;justify-content:center">${pairs.map(x => pair(x, true, pairs.length >= 5 ? 1.2 : pairs.length >= 3 ? 1.3 : 1.4)).join('')}</div>`,
      { title, sub }),
    alt: `AIOmni week ${d.week} next man up: ` +
      pairs.map(x => `${x.out.name} (${x.out.pos}, ${x.out.team}) is ${x.out.status}; ${x.up.name} (our ${x.up.pos}${x.up.rank ?? ''}) steps in, ${x.up.note}`).join('; ') + '.',
  }];
  const top = pairs.slice(0, 4);
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, `<div style="display:grid;grid-template-columns:1fr 1fr;gap:30px 24px;flex:1;align-content:center">${top.map(x => pair(x, false, 1.22)).join('')}</div>`,
      { title, sub }),
  }];
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Next man<br><span style="color:var(--volt)">up</span>`, 'Starters ruled out,<br>and who inherits the work.') },
    ...pairs.slice(0, 4).map(x => ({ kind: 'vertical' as Kind, html: page('vertical', d.week, `
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:34px;padding-bottom:300px">
        <div class="card" style="padding:30px 34px">
          <div style="font-size:40px">${statusChip(x.out.status)}</div>
          <div style="font-weight:700;font-size:64px;margin-top:18px;color:var(--dim)">${esc(x.out.name)}</div>
          <div style="font-size:36px;margin-top:8px;color:var(--mute)"><span class="pos ${x.out.pos}">${x.out.pos}</span> · ${esc(x.out.team)}</div></div>
        <div style="font-size:90px;color:var(--volt);text-align:center;line-height:1">↓</div>
        <div class="card" style="padding:30px 34px;border-color:rgba(212,255,0,.5)">
          <div style="font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.2em;font-size:28px;color:var(--volt)">NEXT MAN UP</div>
          <div style="font-weight:800;font-size:72px;margin-top:14px;line-height:1.05">${esc(x.up.name)}</div>
          <div style="font-size:36px;margin-top:12px;color:var(--dim)"><span class="pos ${x.up.pos}">${x.up.pos}${x.up.rank ?? ''}</span> · ${esc(x.up.note)}</div></div>
      </div>`) })),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

// ── shootout ───────────────────────────────────────────────────────────────
function shootoutFrames(d: Extract<ThemeData, { theme: 'shootout' }>) {
  const games = d.games.slice(0, 3);
  const spread = (g: (typeof games)[number]) => `${esc(g.favorite)} -${Math.abs(g.spread)}`;
  const card = (g: (typeof games)[number], big: boolean, zoom = 1) => `
    <div class="card" style="zoom:${zoom};padding:${big ? '18px 24px' : '14px 18px'};display:flex;gap:${big ? 24 : 18}px;align-items:center">
      <span style="flex:none;text-align:center;min-width:${big ? 150 : 120}px">
        <span style="display:block;font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.16em;font-size:${big ? 18 : 15}px;color:var(--dim)">TOTAL</span>
        <span style="display:block;font-weight:800;font-size:${big ? 68 : 54}px;line-height:1;color:#FF5714">${g.total}</span></span>
      <span style="flex:1;min-width:0">
        <span style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
          <span style="font-weight:800;font-size:${big ? 38 : 30}px">${esc(g.away)} @ ${esc(g.home)}</span>
          <span style="font-family:'Space Mono',monospace;font-weight:700;font-size:${big ? 19 : 16}px;color:var(--dim);white-space:nowrap">${esc(g.kickoff_et)}</span></span>
        <span style="display:block;font-weight:600;font-size:${big ? 22 : 19}px;color:var(--dim);margin-top:4px">Favorite: <span style="color:var(--ink)">${spread(g)}</span></span>
        <span style="display:flex;flex-wrap:wrap;gap:${big ? '6px 20px' : '4px 14px'};margin-top:${big ? 10 : 6}px">${g.players.slice(0, big ? 4 : 3).map(p =>
          `<span style="font-size:${big ? 22 : 19}px;white-space:nowrap"><span class="pos ${p.pos}">${p.pos}${p.rank ?? ''}</span> <span style="font-weight:600">${esc(p.name)}</span></span>`).join('')}</span>
      </span>
    </div>`;
  const sub = 'Highest Vegas totals this week';
  const title = 'Shootout <span class="acc">alert</span>';
  const portrait: Frame[] = [{
    kind: 'portrait',
    html: page('portrait', d.week, `<div style="display:flex;flex-direction:column;gap:26px;flex:1;justify-content:center">${games.map(g => card(g, true, games.length <= 2 ? 1.35 : 1.22)).join('')}</div>`,
      { title, sub, accent: '#FF5714' }),
    alt: `AIOmni week ${d.week} shootout alert, highest Vegas totals: ` +
      games.map(g => `${g.away} at ${g.home} (${g.kickoff_et}), total ${g.total}, ${g.favorite} favored by ${Math.abs(g.spread)}; players to start: ${g.players.slice(0, 4).map(p => `${p.name} (${p.pos}${p.rank ?? ''})`).join(', ')}`).join('. ') + '.',
  }];
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, `<div style="display:flex;flex-direction:column;gap:18px;flex:1;justify-content:center">${games.map(g => card(g, false, 1.08)).join('')}</div>`,
      { title, sub, accent: '#FF5714' }),
  }];
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Shootout<br><span style="color:#FF5714">alert</span>`, 'The highest Vegas totals<br>on the board this week.', '#FF5714') },
    ...games.map(g => ({ kind: 'vertical' as Kind, html: page('vertical', d.week, `
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center;padding-bottom:300px">
        <div style="font-weight:800;font-size:96px;line-height:1">${esc(g.away)} @ ${esc(g.home)}</div>
        <div style="font-family:'Space Mono',monospace;font-weight:700;font-size:32px;color:var(--dim);margin-top:14px">${esc(g.kickoff_et)}</div>
        <div style="display:flex;align-items:baseline;gap:26px;margin-top:44px">
          <span style="font-weight:800;font-size:170px;line-height:1;color:#FF5714">${g.total}</span>
          <span style="font-weight:700;font-size:44px;color:var(--dim)">point total<br><span style="color:var(--ink)">${spread(g)}</span></span></div>
        <div style="display:flex;flex-direction:column;gap:18px;margin-top:44px">${g.players.slice(0, 4).map(p =>
          `<div class="card" style="padding:22px 30px;display:flex;align-items:center;gap:26px"><span class="pos ${p.pos}" style="font-size:40px;min-width:130px">${p.pos}${p.rank ?? ''}</span><span style="font-weight:700;font-size:46px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span><span style="margin-left:auto;font-weight:600;font-size:32px;color:var(--dim)">${esc(p.team)}</span></div>`).join('')}</div>
      </div>`, { accent: '#FF5714' }) })),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

// ── usage risers & fallers ─────────────────────────────────────────────────
const usageNum = (stat: string, v: number) => /share/i.test(stat)
  ? `${Math.round(v <= 1 ? v * 100 : v)}%` : v.toFixed(1);
const usageLine = (p: { stat: string; before: number; after: number }) =>
  `${esc(p.stat)} ${usageNum(p.stat, p.before)} → ${usageNum(p.stat, p.after)}`;

function usageFrames(d: Extract<ThemeData, { theme: 'usage' }>) {
  const up = d.risers.slice(0, 5), dn = d.fallers.slice(0, 5);
  type U = (typeof up)[number];
  const item = (p: U, rise: boolean, big: boolean) => `
    <div class="card" style="padding:${big ? '12px 20px' : '10px 18px'};display:flex;align-items:center;gap:16px">
      <span style="font-size:${big ? 40 : 34}px;color:${rise ? '#00FFAA' : '#FF4D77'};flex:none;width:${big ? 40 : 34}px;text-align:center">${rise ? '▲' : '▼'}</span>
      <span style="flex:1;min-width:0"><span style="display:block;font-weight:700;font-size:${big ? 34 : 30}px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span>
        <span style="display:block;font-weight:500;font-size:${big ? 23 : 21}px;color:var(--dim);margin-top:2px"><span class="pos ${p.pos}">${p.pos}</span> · ${esc(p.team)}</span></span>
      <span style="text-align:right;flex:none;font-size:${big ? 25 : 22}px;font-weight:700;color:${rise ? '#00FFAA' : '#FF4D77'};white-space:nowrap">${usageLine(p)}</span>
    </div>`;
  const section = (label: string, list: U[], rise: boolean, big: boolean) => list.length ? `<div>
    <div style="font-family:'Space Mono',monospace;font-weight:700;letter-spacing:.18em;font-size:${big ? 22 : 19}px;color:${rise ? '#00FFAA' : '#FF4D77'};margin:${big ? 6 : 2}px 0 ${big ? 10 : 8}px">${label}</div>
    <div style="display:flex;flex-direction:column;gap:${big ? 10 : 8}px">${list.map(p => item(p, rise, big)).join('')}</div></div>` : '';
  const sub = `Biggest workload changes, last two games vs. before (through week ${d.week})`;
  const title = 'Usage <span class="acc">risers</span> & fallers';
  const portrait: Frame[] = [{
    kind: 'portrait',
    // 8 rows under a two-line title overflow at full size (the last card was
    // clipped), so a full board is drawn at 86%.
    html: page('portrait', d.week, `<div style="display:flex;flex-direction:column;justify-content:${up.length && dn.length ? 'space-between' : 'center'};flex:1;zoom:${Math.min(up.length, 4) + Math.min(dn.length, 4) > 6 ? 0.86 : 1}">${section('RISING', up.slice(0, 4), true, true)}${section('FALLING', dn.slice(0, 4), false, true)}</div>`,
      { title, sub }),
    alt: `AIOmni week ${d.week} usage risers and fallers. Rising: ` +
      up.slice(0, 4).map(p => `${p.name} (${p.pos}, ${p.team}), ${p.stat} ${usageNum(p.stat, p.before)} to ${usageNum(p.stat, p.after)}`).join('; ') +
      '. Falling: ' + dn.slice(0, 4).map(p => `${p.name} (${p.pos}, ${p.team}), ${p.stat} ${usageNum(p.stat, p.before)} to ${usageNum(p.stat, p.after)}`).join('; ') + '.',
  }];
  const landscape: Frame[] = [{
    kind: 'landscape',
    html: page('landscape', d.week, `<div style="display:flex;gap:28px;flex:1;min-height:0">${up.length ? `<div style="flex:1;min-width:0">${section('RISING', up.slice(0, 4), true, false)}</div>` : ''}${dn.length ? `<div style="flex:1;min-width:0">${section('FALLING', dn.slice(0, 4), false, false)}</div>` : ''}</div>`,
      { title, sub }),
  }];
  const vcard = (p: U, rise: boolean) => ({
    left: `<span style="color:${rise ? '#00FFAA' : '#FF4D77'};font-size:56px">${rise ? '▲' : '▼'}</span>`, name: p.name,
    right: `<span class="pos ${p.pos}">${p.pos}</span> · ${esc(p.team)} · <span style="color:${rise ? '#00FFAA' : '#FF4D77'};font-weight:700">${usageLine(p)}</span>`,
  });
  const vertical: Frame[] = [
    { kind: 'vertical', html: titleCard(d.week, `Usage<br><span style="color:var(--volt)">risers</span> &amp; fallers`, 'Who is getting more of the ball,<br>and who is losing it.') },
    ...(up.length ? [{ kind: 'vertical' as Kind, html: verticalList(d.week, '<span style="color:#00FFAA">Rising</span>', up.map(p => vcard(p, true))) }] : []),
    ...(dn.length ? [{ kind: 'vertical' as Kind, html: verticalList(d.week, '<span style="color:#FF4D77">Falling</span>', dn.map(p => vcard(p, false))) }] : []),
    { kind: 'vertical', html: endCard(d.week) },
  ];
  return { portrait, landscape, vertical };
}

function frames(d: ThemeData) {
  switch (d.theme) {
    case 'weather': return weatherFrames(d);
    case 'waivers': return waiversFrames(d);
    case 'next_man_up': return nextManFrames(d);
    case 'shootout': return shootoutFrames(d);
    case 'usage': return usageFrames(d);
    case 'rankings': return rankingsFrames(d);
    case 'injuries': return injuriesFrames(d);
    case 'disagree': return disagreeFrames(d);
    case 'tnf': return tnfFrames(d);
    case 'final_calls': return finalCallsFrames(d);
    case 'hits': return hitsFrames(d);
    case 'report_card': return reportFrames(d);
  }
}

// ── video ──────────────────────────────────────────────────────────────────
// Each card holds, then crossfades into the next. Duration lands in 12-18s:
// ~3.2s per card with a 0.5s fade, the title and end cards a little shorter.
async function video(framesPng: string[], out: string) {
  const fade = 0.5;
  const n = framesPng.length;
  const target = Math.min(18, Math.max(12, n * 3));
  const hold = (target + fade * (n - 1)) / n;              // per-clip length incl. overlap
  const args = ['-y', '-loglevel', 'error'];
  for (const f of framesPng) args.push('-loop', '1', '-t', hold.toFixed(3), '-framerate', '30', '-i', f);
  args.push('-f', 'lavfi', '-t', target.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo');
  const chain: string[] = [];
  for (let i = 0; i < n; i++) chain.push(`[${i}:v]scale=1080:1920,setsar=1,fps=30,format=yuv420p[v${i}]`);
  let prev = 'v0';
  for (let i = 1; i < n; i++) {
    const outLbl = i === n - 1 ? 'vout' : `x${i}`;
    chain.push(`[${prev}][v${i}]xfade=transition=fade:duration=${fade}:offset=${(i * (hold - fade)).toFixed(3)}[${outLbl}]`);
    prev = outLbl;
  }
  if (n === 1) chain.push('[v0]copy[vout]');
  args.push('-filter_complex', chain.join(';'), '-map', '[vout]', '-map', `${n}:a`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart', out);
  await run('ffmpeg', args, 180_000);
}

// ── public entry ───────────────────────────────────────────────────────────
export async function render(data: ThemeData, outDir: string): Promise<RenderedSet> {
  await mkdir(outDir, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'aiomni-social-'));
  const f = frames(data);
  const base = data.theme.replace(/_/g, '-');
  const jobs: { frame: Frame; out: string }[] = [
    ...f.portrait.map((frame, i) => ({ frame, out: join(outDir, `${base}-portrait-${i + 1}.png`) })),
    ...f.landscape.slice(0, 4).map((frame, i) => ({ frame, out: join(outDir, `${base}-landscape-${i + 1}.png`) })),
    ...f.vertical.map((frame, i) => ({ frame, out: join(work, `${base}-v${i + 1}.png`) })),
  ];
  try {
    await pool(jobs, 4, j => shoot(j.frame.html, j.frame.kind, j.out, work));
    const vFrames = jobs.filter(j => j.frame.kind === 'vertical').map(j => j.out);
    const mp4 = join(outDir, `${base}-video.mp4`);
    const cover = join(outDir, `${base}-cover.png`);
    await video(vFrames, mp4);
    await copyFile(vFrames[0], cover);
    return {
      portrait: jobs.filter(j => j.frame.kind === 'portrait').map(j => j.out),
      landscape: jobs.filter(j => j.frame.kind === 'landscape').map(j => j.out),
      video: mp4,
      cover,
      alt: f.portrait.map(p => p.alt ?? ''),
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// CLI: node scripts/social/render/render.ts <sample.json> <outDir>
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
  const [input, outDir] = process.argv.slice(2);
  if (!input || !outDir) { console.error('usage: render.ts <data.json> <outDir>'); process.exit(2); }
  const data = JSON.parse(await readFile(input, 'utf8'));
  delete data._sample;
  const t0 = Date.now();
  const set = await render(data as ThemeData, outDir);
  console.log(JSON.stringify({ ...set, seconds: +((Date.now() - t0) / 1000).toFixed(1) }, null, 2));
}
