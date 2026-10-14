// Inlines src/ into a single self-contained page.
//   index.html          full HTML document (open directly or serve anywhere)
//   dist/artifact.html  body-only variant for hosts that supply their own <head>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = f => readFileSync(new URL(f, import.meta.url), 'utf8');
const css = read('./src/style.css');
const body = read('./src/page.html');
const engine = read('./src/engine.js');
const app = read('./src/app.js');

const title = 'Cron Almanac';
const description = 'Read, check and translate cron schedules for crontab, GitHub Actions, Kubernetes, EventBridge, Quartz and Spring.';
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=Martian+Mono:wght@400;600;700&display=swap">';
const scripts = `<script>\n${engine}</script>\n<script>\n${app}</script>`;

const full = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${title}</title>
<meta name="description" content="${description}">
${fonts}
<style>
${css}</style>
</head>
<body>
${body}
${scripts}
</body>
</html>
`;

const artifact = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
${fonts}
<style>
${css}</style>
${body}
${scripts}
`;

writeFileSync(new URL('./index.html', import.meta.url), full);
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/artifact.html', import.meta.url), artifact);
console.log(`index.html ${(full.length / 1024).toFixed(1)} KB, dist/artifact.html ${(artifact.length / 1024).toFixed(1)} KB`);
