// Claude as art director and game master.
//
// Art director: Claude looks at screenshots the engine rendered of the
// current game (vision), critiques them against the player's idea, and
// returns an improved spec. Its thinking summary, streamed to the Studio,
// is the critique.
//
// Game master: when a level ends, Claude reads how the player did
// (telemetry) and designs the next level: the story continues, and the
// challenge adapts to the player's skill.

import { designSpec } from './claude.js';

const MEDIA = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/;

/** Turn data URLs from the browser into image content blocks (max 4). */
export function imageBlocks(images) {
  const out = [];
  for (const [i, img] of (Array.isArray(images) ? images : []).slice(0, 4).entries()) {
    const m = MEDIA.exec(String(img?.data ?? ''));
    if (!m) continue;
    out.push({ type: 'text', text: `Screenshot ${i + 1}: ${String(img.label ?? 'view').slice(0, 80)}` });
    out.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  return out;
}

export async function artDirect({ spec, images, intent = '', onEvent = () => {}, signal } = {}) {
  onEvent('status', { message: 'Claude is studying screenshots of your game…' });
  const shots = imageBlocks(images);
  if (!shots.length) throw new Error('No screenshots to review.');
  const content = [
    { type: 'text', text: `You are the art director for this game. ${intent ? `The player's idea was: "${String(intent).slice(0, 600)}".` : ''}\n\nCurrent game spec:\n${JSON.stringify(spec)}\n\nThese screenshots were just rendered by the engine from this spec:` },
    ...shots,
    { type: 'text', text: `Critique what you see against the idea, like a lead artist reviewing a build: mood and lighting, time of day, sky and weather, fog, colour harmony and contrast, exposure, how well collectibles, hazards and the goal read against the ground, vegetation density, and composition from the player's camera. Then return the complete improved spec.

Rules for your changes:
- Improve the look: environment, terrain palette, scatter, prefab colours / emissive / materials, post-processing and music mood. Make a few confident, purposeful changes rather than many tiny ones.
- Keep the gameplay: keep rules, placements, spawns, characters, player settings and the seed unless something is unreadable or broken in the screenshots.
- Stay true to the player's idea.` },
  ];
  return designSpec({ content, baseSpec: spec, onEvent, signal });
}

/** A readable summary of how a level went, for the game master. */
export function describeTelemetry(t = {}) {
  const lines = [];
  const n = (v, d = 0) => (Number.isFinite(v) ? v : d);
  lines.push(`Outcome: ${t.outcome === 'won' ? 'WON' : t.outcome === 'lost' ? 'LOST' : 'unfinished'} after ${Math.round(n(t.time))} seconds (level ${n(t.level, 1)}).`);
  lines.push(`Score ${n(t.score)}${t.target ? ` of ${t.target}` : ''}; collected ${n(t.collected)} of ${n(t.total)} treasures; ${n(t.lives)} of ${n(t.maxLives)} lives left.`);
  const hurts = Object.entries(t.hurts ?? {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}× ${k}`).join(', ');
  lines.push(`Damage taken: ${hurts || 'none'}. Respawns after falling or lava: ${n(t.falls)}.`);
  lines.push(`Movement: ${Math.round(n(t.distance))} m travelled, ${n(t.jumps)} jumps.`);
  if (Array.isArray(t.talks) && t.talks.length) lines.push(`Talked with: ${t.talks.map((c) => `${c.name} (${c.lines} messages)`).join(', ')}.`);
  return lines.join('\n');
}

export async function nextLevel({ spec, telemetry, onEvent = () => {}, signal } = {}) {
  onEvent('status', { message: 'The game master is designing your next level…' });
  const content = `You are the game master. The player just finished a level of this game.

Current level spec:
${JSON.stringify(spec)}

How the player did:
${describeTelemetry(telemetry)}

Design the NEXT level and return its complete spec:
- Continue the same world and story: a new area, a new seed, a new title that reads like the next chapter (e.g. "… II: The Frozen Pass"), and a tagline that follows on.
- Adapt the challenge to this player. If they won easily (lives intact, quick), raise it: more or faster hazards, trickier jumps, a tighter time limit. If they struggled or lost, ease off: fewer hazards, more heal pickups, clearer paths, a friendly character with helpful powers. Aim to keep them in flow.
- Escalate the drama: move the time of day on, change the weather or terrain style, introduce one new mechanic or hazard type they have not seen yet.
- Keep or evolve the characters: have their greetings remember what happened in the last level.`;
  return designSpec({ content, baseSpec: { seed: 0 }, onEvent, signal });
}
