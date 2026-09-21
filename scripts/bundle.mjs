/**
 * Packages the whole project into two things you can hand to another model:
 *
 *   package/prism-break-source.md   one file, brief first, then every source
 *                                   file — paste or upload this straight into
 *                                   Gemini
 *   package/prism-break-source.zip  the same files as a normal archive
 *
 * The brief goes first on purpose: a model should read the task before the
 * 130 KB of code it applies to.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './zip.mjs';

// fileURLToPath, not URL.pathname: on Windows the latter yields "/C:/..." and
// every path built from it is wrong.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'package');

/** Ordered so a reader meets the task, then the design, then the code. */
const FILES = [
  'docs/GEMINI_ART_BRIEF.md',
  'README.md',
  'docs/SETUP.md',
  'docs/GAME_DESIGN.md',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'capacitor.config.ts',
  'index.html',
  'src/main.ts',
  'src/style.css',
  'src/game/config.ts',
  'src/game/types.ts',
  'src/game/shapes.ts',
  'src/game/board.ts',
  'src/game/levels.ts',
  'src/game/game.ts',
  'src/game/render.ts',
  'src/core/rng.ts',
  'src/core/storage.ts',
  'src/core/audio.ts',
  'src/core/haptics.ts',
  'src/meta/stickers.ts',
  'src/meta/progression.ts',
  'src/meta/circuit.ts',
  'src/meta/profile.ts',
  'src/meta/packs.ts',
  'src/ui/dom.ts',
  'src/ui/screens.ts',
  'src/ui/circuit.ts',
  'docs/IP_NOTES.md',
  'test/run.ts',
  'test/bot.ts',
  'test/smoke.mjs',
  'test/smoke-meta.mjs',
  'test/tsconfig.json',
];

const LANG = {
  ts: 'ts',
  mjs: 'js',
  js: 'js',
  json: 'json',
  css: 'css',
  html: 'html',
  md: 'md',
};

/** Files that matter most to an art pass, called out up front. */
const HOTSPOTS = {
  'src/game/render.ts': 'All drawing. `drawTile`, `drawDamage` and `drawShape` are what the art replaces.',
  'src/game/config.ts': 'Every tunable, plus PALETTE — the five hues and their exact hex.',
  'src/game/types.ts': 'Tile, ShapeDef, TrayItem and the TileKind enum a new tile type extends.',
  'src/game/board.ts': 'Placement, line and colour-group clears, bomb chains, obstacle wear.',
  'src/game/levels.ts': 'All 24 levels as text grids, with objectives and star thresholds.',
  'src/game/game.ts': 'The level state machine, the deal, and the FX the renderer consumes.',
  'src/game/shapes.ts': 'The polyomino set and how often each is dealt.',
};

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const parts = [];
const missing = [];

parts.push(`# Prism Break — complete source bundle

Generated ${new Date().toISOString().slice(0, 10)} · ${FILES.length} files.

This single file contains the entire game. The art & design brief is first;
everything after it is the code that brief applies to.

## Where to look first

${Object.entries(HOTSPOTS)
  .map(([f, why]) => `- \`${f}\` — ${why}`)
  .join('\n')}

## Everything in this bundle

${FILES.map((f) => `- \`${f}\``).join('\n')}

## How it fits together

\`src/game/\` is the simulation and has no DOM or canvas reference anywhere in
it, which is what lets the test suite play all 24 levels headlessly.
\`src/game/render.ts\` is the only file that draws. \`src/meta/\` is the sticker
album and economy. \`src/ui/\` is the menu layer, plain DOM over the canvas.

---
`);

for (const rel of FILES) {
  let body;
  try {
    body = readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    missing.push(rel);
    continue;
  }
  const ext = rel.split('.').pop() ?? '';
  const lang = LANG[ext] ?? '';
  // Markdown files get an extra-long fence so any fences inside survive.
  const fence = lang === 'md' ? '`````' : '```';
  parts.push(`\n---\n\n## \`${rel}\`\n\n${fence}${lang}\n${body.trimEnd()}\n${fence}\n`);
}

const bundle = parts.join('');
const mdPath = join(OUT, 'prism-break-source.md');
writeFileSync(mdPath, bundle);

// The zip carries the real files, for anyone who would rather open a project.
const zipPath = join(OUT, 'prism-break-source.zip');
writeZip(zipPath, [
  ...FILES.filter((rel) => !missing.includes(rel)).map((rel) => ({
    name: rel,
    data: readFileSync(join(ROOT, rel)),
  })),
  { name: 'package/prism-break-source.md', data: Buffer.from(bundle, 'utf8') },
]);

const kb = (p) => `${(statSync(p).size / 1024).toFixed(1)} KB`;
console.log(`prism-break-source.md   ${kb(mdPath)}  (${FILES.length} files)`);
console.log(`prism-break-source.zip  ${kb(zipPath)}`);
console.log(`~${Math.round(bundle.length / 4 / 1000)}k tokens, well inside Gemini's window`);
if (missing.length) {
  console.error(`\nMISSING (not bundled): ${missing.join(', ')}`);
  process.exit(1);
}
