#!/usr/bin/env node
// Inject <head> metadata into the exported web build.
//
// Expo Router's app/+html.tsx only applies when web.output is "static". This
// project uses "single" (a true SPA), so Expo generates index.html from its own
// template and +html.tsx is silently ignored -- which is why an earlier
// attempt at that file changed nothing. Post-processing the export is the
// supported path for "single".
//
// Run after `expo export --platform web`, before deploying:
//   node scripts/web-head.mjs /tmp/webbuild
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/web-head.mjs <export-dir>'); process.exit(1); }

const DESC = 'AIOmni reads your actual fantasy football roster, scoring and league rules, then gives advice grounded in them.';
const TITLE = 'AIOmni — AI Fantasy Football Coach';

const TAGS = `
    <meta name="description" content="${DESC}">
    <!-- The app is not indexable: everything of value is behind a sign-in, and
         the SPA catch-all makes every invented URL a soft 404. getaiomni.com
         is the public face. -->
    <meta name="robots" content="noindex, follow">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="AIOmni">
    <meta property="og:url" content="https://app.getaiomni.com/">
    <meta property="og:title" content="${TITLE}">
    <meta property="og:description" content="${DESC}">
    <meta property="og:image" content="https://getaiomni.com/og.png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${TITLE}">
    <meta name="twitter:description" content="${DESC}">
    <meta name="twitter:image" content="https://getaiomni.com/og.png">
    <meta name="theme-color" content="#0a1214">
    <style>
      /* Painted before the JS bundle boots. Without this the browser shows a
         white page until React Native Web mounts and applies the theme --
         a full-screen white flash on every load and every refresh of a
         dark-themed app. */
      html, body, #root { height: 100%; margin: 0; background: #0a1214; }
      body { overscroll-behavior-y: none; -webkit-tap-highlight-color: transparent; }
    </style>
`;

const p = join(dir, 'index.html');
let html = readFileSync(p, 'utf8');

if (html.includes('og:title')) { console.log('web-head: already injected, skipping'); process.exit(0); }
if (!html.includes('</head>')) { console.error('web-head: no </head> found in ' + p); process.exit(1); }

html = html.replace(/<title>.*?<\/title>/i, `<title>${TITLE}</title>`);
if (!/<title>/i.test(html)) html = html.replace('</head>', `    <title>${TITLE}</title>\n</head>`);
html = html.replace('</head>', TAGS + '</head>');
writeFileSync(p, html);
console.log('web-head: title + description + OG injected into ' + p);
