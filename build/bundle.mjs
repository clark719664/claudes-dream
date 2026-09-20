// Flattens the ES modules and the stylesheet into two single-file builds:
//
//   dist/lasts.html    a complete document that runs straight off a file:// path
//   dist/artifact.html body content only, for hosts that supply their own <head>
//
// No dependencies on purpose — the point of this app is that it keeps working.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const ENTRY = 'src/ui.js';
const IMPORT = /^import\b[\s\S]*?from\s*['"][^'"]*['"];[ \t]*\n/gm;
const FROM = /from\s*['"](\.[^'"]*)['"]/g;

/**
 * Walk the imports from the entry module so the module list cannot drift out of date —
 * a hand-maintained list silently omitted a module once, and the bug only showed at runtime.
 * Depth-first post-order, so a module is emitted after everything it depends on.
 */
function moduleOrder(entry) {
  const order = [];
  const done = new Set();
  const visit = (path) => {
    if (done.has(path)) return;
    done.add(path);
    const src = read(path);
    const dir = dirname(path);
    for (const m of src.matchAll(FROM)) visit(join(dir, m[1]));
    order.push(path);
  };
  visit(entry);
  return order;
}

function flatten() {
  const seen = new Map();
  const parts = [];
  const modules = moduleOrder(ENTRY);
  console.log(`modules: ${modules.join(' -> ')}`);
  for (const path of modules) {
    const src = read(path).replace(IMPORT, '').replace(/^export\s+/gm, '');
    // Flattening puts every module in one scope, so a name used twice would silently shadow.
    for (const m of src.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(m[1])) throw new Error(`"${m[1]}" is declared in both ${seen.get(m[1])} and ${path}`);
      seen.set(m[1], path);
    }
    parts.push(`/* ---- ${path} ---- */\n${src.trim()}`);
  }
  return parts.join('\n\n') + '\n\nstart();\n';
}

const html = read('index.html');
const css = read('app.css');
const js = flatten();

const FONTS = [...html.matchAll(/^\s*<link rel="(?:preconnect|stylesheet)"[^>]*fonts\.(?:googleapis|gstatic)\.com[^>]*>\s*$/gm)]
  .map((m) => m[0].trim())
  .join('\n');

// ---- complete document, no sibling files
let single = html
  .replace(/^\s*<link rel="(?:manifest|icon)"[^>]*>\s*$/gm, '')
  .replace('<link rel="stylesheet" href="app.css">', `<style>\n${css}\n</style>`)
  .replace(/<script type="module">[\s\S]*?<\/script>/, `<script>\n${js}</script>`);
writeFileSync(join(root, 'dist/lasts.html'), single);

// ---- body content only, title and styles first
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>')).trim();
const artifact = [
  '<title>Lasts</title>',
  FONTS,
  `<style>\n${css}\n</style>`,
  body.replace(/<script type="module">[\s\S]*?<\/script>/, `<script>\n${js}</script>`),
].join('\n');
writeFileSync(join(root, 'dist/artifact.html'), artifact);

for (const [name, out] of [['dist/lasts.html', single], ['dist/artifact.html', artifact]]) {
  const problems = [];
  if (/\bfrom\s+['"]\.\//.test(out)) problems.push('a module import survived');
  if (/^export\s/m.test(out)) problems.push('an export survived');
  if (/type="module"/.test(out)) problems.push('a module script survived');
  if (problems.length) throw new Error(`${name}: ${problems.join(', ')}`);
  console.log(`${name.padEnd(20)} ${(Buffer.byteLength(out) / 1024).toFixed(1)} KB`);
}
