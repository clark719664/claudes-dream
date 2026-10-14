// Inlines src/ into a single page.
//   index.html          the public page: full HTML document, self-hosted fonts (fonts/), no third-party requests
//   dist/artifact.html  body-only variant for hosts that supply their own <head>; loads fonts from Google Fonts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const { version, description } = JSON.parse(read('./package.json'));
const css = read('./src/style.css');
const fontsCss = read('./src/fonts.css');
const body = read('./src/page.html').replaceAll('{{VERSION}}', version.replace(/\.0$/, ''));
const engine = read('./src/engine.js');
const why = read('./src/why.js');
const fleet = read('./src/fleet.js');
const app = read('./src/app.js');

const title = 'Cron Almanac';
const icon = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28">' +
  [[1, 1, 1], [10.5, 1, 0], [20, 1, 0], [1, 10.5, 0], [10.5, 10.5, 1], [20, 10.5, 0], [1, 20, 0], [10.5, 20, 0], [20, 20, 1]]
    .map(([x, y, on]) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="${on ? '#2741c9' : '#b9c3ce'}"/>`).join('') +
  '</svg>');
const googleFonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Martian+Mono:wght@400;600;700&display=swap">';
const scripts = [engine, why, fleet, app].map(js => `<script>\n${js}</script>`).join('\n');

const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#edf0f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1117" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${icon}">
<style>
${fontsCss}
${css}</style>
</head>
<body>
<noscript><p style="padding: 16px">Cron Almanac needs JavaScript to read and check schedules.</p></noscript>
${body}
${scripts}
</body>
</html>
`;

const artifact = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${googleFonts}
<style>
${css}</style>
${body}
${scripts}
`;

writeFileSync(new URL('./index.html', import.meta.url), full);
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/artifact.html', import.meta.url), artifact);
console.log(`index.html ${(full.length / 1024).toFixed(1)} KB, dist/artifact.html ${(artifact.length / 1024).toFixed(1)} KB`);
