// Generates docs/GAME_SPEC.md from the JSON Schema so the docs never drift.
import fs from 'node:fs';
import { GAME_SPEC_SCHEMA, LIMITS } from '../shared/spec.js';

const lines = [
  '# Game spec reference',
  '',
  'A Reverie game is one JSON document. The AI designer (Claude or the offline designer) writes it, the Studio edits it, and the engine turns it into a playable world. Everything is validated by `normalizeSpec()` in [`shared/spec.js`](../shared/spec.js): out-of-range numbers are clamped, unknown references dropped, unwinnable rules repaired and the performance budget enforced, so any input is safe to load.',
  '',
  '> This file is generated from `GAME_SPEC_SCHEMA` by `node tools/gen-spec-docs.mjs`.',
  '',
  '## Budget',
  '',
  '| Limit | Value |',
  '| --- | --- |',
  ...Object.entries(LIMITS).map(([k, v]) => `| ${k} | ${v} |`),
  '',
  '## Fields',
  '',
];

function typeOf(node) {
  if (node.enum) return node.enum.map((v) => `\`${v}\``).join(' \\| ');
  if (node.type === 'array') return `array of ${node.items.type === 'object' ? 'objects' : node.items.type}`;
  return node.type;
}

function walk(node, path, depth) {
  if (node.type !== 'object') return;
  const rows = [];
  for (const [key, child] of Object.entries(node.properties)) {
    const p = path ? `${path}.${key}` : key;
    rows.push(`| \`${p}\` | ${typeOf(child)} | ${(child.description ?? '').replace(/\|/g, '\\|')} |`);
  }
  lines.push(`${'#'.repeat(Math.min(depth, 4))} \`${path || 'spec'}\``, '', node.description ?? '', '', '| Field | Type | Description |', '| --- | --- | --- |', ...rows, '');
  for (const [key, child] of Object.entries(node.properties)) {
    const p = path ? `${path}.${key}` : key;
    if (child.type === 'object') walk(child, p, depth + 1);
    if (child.type === 'array' && child.items.type === 'object') walk(child.items, `${p}[]`, depth + 1);
  }
}
walk(GAME_SPEC_SCHEMA, '', 3);
lines.push('## Minimal example', '', '```json', JSON.stringify({
  title: 'Coin Meadow',
  prefabs: [{ id: 'coin', shape: 'coin', color: '#ffc526', emissive: 1, metallic: 1, roughness: 0.25, size: [1, 1, 0.2], solid: false, behaviors: [{ type: 'collectible', value: 10, speed: 0, range: 0, axis: 'y' }, { type: 'spin', value: 0, speed: 120, range: 0, axis: 'y' }] }],
  spawns: [{ prefab: 'coin', count: 20, pattern: 'path', center: [40, 0.8, 30], radius: 2, height: 0 }],
  rules: { goal: 'collect' },
}, null, 2), '```', '', 'Everything omitted takes a sensible default.', '');
fs.writeFileSync(new URL('../docs/GAME_SPEC.md', import.meta.url), lines.join('\n'));
console.log('wrote docs/GAME_SPEC.md');
