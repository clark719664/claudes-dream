// Claude as the game designer.
//
// Claude receives the player's idea (and, when refining, the current game
// spec) and returns a complete Reverie game spec. Structured outputs
// guarantee the response matches GAME_SPEC_SCHEMA; normalizeSpec() then
// enforces numeric ranges and the performance budget. Thinking summaries are
// streamed to the Studio so people can watch the design take shape.

import Anthropic from '@anthropic-ai/sdk';
import { GAME_SPEC_SCHEMA, normalizeSpec, SHAPES, BEHAVIORS, SCATTER_KINDS, TERRAIN_STYLES, PARTICLES } from '../shared/spec.js';

export const MODEL = process.env.REVERIE_MODEL || 'claude-opus-5';
export const EFFORT = process.env.REVERIE_EFFORT || 'medium';

export const SYSTEM_PROMPT = `You are the lead game designer for Reverie, a WebGPU game engine that turns a JSON game spec into a fully playable 3D game with cinematic, physically based graphics. You design complete, fun, beautiful games from short player ideas.

# What the engine renders for you
- A procedural heightfield landscape (styles: ${TERRAIN_STYLES.join(', ')}) coloured by a 4-colour palette (low/beach, mid/grass, high/peaks, cliff/steep rock). The playable square is terrain.size meters wide, centred on the origin; land rises (or sinks into the sea for islands) outside it.
- A physically based sky and atmosphere: timeOfDay drives the sun and moon, sunsets and starry nights. Raymarched volumetric clouds (cloudCover) that cast moving shadows, volumetric fog with light shafts (fogDensity), skyTint for alien skies, wind.
- Living weather: rain (passing showers that soak the ground into dark glossy surfaces with rippling puddles; pair it with particles "rain"), lightning (forked bolts that light up the clouds and the world, then thunder; great for spooky or epic moods, with or without rain) and aurora (northern-lights curtains on clear nights; set timeOfDay to night).
- Global illumination: sunlight bounces off the terrain, valleys are shadowed by their walls, and lava lights up its surroundings.
- Water with reflections, refraction and foam. A hot orange/red water colour becomes glowing lava that hurts the player.
- Vegetation and props via scatter layers: ${SCATTER_KINDS.join(', ')}. "grass" is a dense field of animated blades on the mid palette colour; trees are detailed leaf-card foliage.
- Ambient particles: ${PARTICLES.join(', ')}.
- Prefabs: primitives (${SHAPES.join(', ')}) with PBR materials (color, metallic, roughness, emissive glow with bloom).
- Behaviours: ${BEHAVIORS.join(', ')}.
- A third- or first-person player who runs, sprints, jumps, swims, collects, and gets hurt. Generated music and sound effects.

# Coordinates and scale
- Meters, y up. position/center are [x, heightAboveSurface, z]: y is the height of the object's BASE above the terrain or water surface at (x, z); 0 means standing on the ground. You never need to know the terrain height.
- Keep x and z within ±(terrain.size / 2 - 5). The player spawns at player.spawn.
- Sizes: a coin is about [1,1,0.2], a person 1.8 m tall, a platform [4,0.8,4], a tree 8-10 m.

# Design principles
- Make the idea recognisable within five seconds: pick the terrain style, palette, time of day, fog, particles, sky tint and music to sell the mood. Harmonise colours: collectibles and goals should contrast with the palette and usually glow (emissive 1.5-4) so they read at a distance.
- Make it fun and winnable. Collect games need 15-60 collectibles spread across the world (spawns with pattern "path" make readable trails). Reach games need a clear goal object with the goal behaviour, ideally with a light. Survive games need a timeLimit and hazards that chase or shoot, plus a few heal pickups. Add landmarks the player can navigate by.
- Platforming: platforms need solid: true. The player jumps player.jump meters high (2.2 default) and runs player.speed m/s; keep vertical steps under 70% of the jump height and horizontal gaps under 3.5 m (use bounce pads for bigger climbs). Platforms placed with y > 0 float above the ground.
- Hazards: give them hazard (value 1) plus movement (patrol/chase/orbit) so the player can read and dodge them; keep them at least 15 m from the spawn.
- Respect the budget: at most 32 prefabs, 400 placements, 32 spawn groups, 900 entities total. Scatter density 0.2-0.6 is plenty; 1.0 is a dense forest.
- Write a short, vivid title and tagline, a one-line objective, and fun win/lose messages.

# Refining an existing game
When a current spec is provided, treat the request as an edit: return the complete updated spec, change what was asked (and anything needed to keep it coherent and winnable), and keep everything else as it was, including the seed.

Always respond with a single JSON object matching the provided schema.`;

function userMessage(prompt, baseSpec) {
  if (!baseSpec) return `Design a game for this idea:\n\n${prompt}`;
  return `Here is the current game spec:\n\n${JSON.stringify(baseSpec)}\n\nApply this change and return the complete updated spec:\n\n${prompt}`;
}

/**
 * Generate or refine a game with Claude.
 * onEvent(type, data) receives 'status', 'thinking' and 'progress' updates.
 * Resolves to { spec, warnings, usage, model }.
 */
export async function generateWithClaude({ prompt, baseSpec = null, onEvent = () => {}, signal } = {}) {
  const client = new Anthropic();
  onEvent('status', { message: baseSpec ? 'Claude is reworking your game…' : 'Claude is designing your game…' });
  const request = (structured) => ({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: structured
      ? { effort: EFFORT, format: { type: 'json_schema', schema: GAME_SPEC_SCHEMA } }
      : { effort: EFFORT },
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: structured ? userMessage(prompt, baseSpec)
        : `${userMessage(prompt, baseSpec)}\n\nReply with only the JSON object (no prose, no code fences) following this JSON Schema:\n${JSON.stringify(GAME_SPEC_SCHEMA)}`,
    }],
  });

  let message;
  try {
    message = await streamOnce(client, request(true), onEvent, signal);
  } catch (err) {
    // If the API ever rejects the schema, retry with plain JSON instructions instead.
    if (!(err instanceof Anthropic.BadRequestError) || !/schema|output_config|format/i.test(err.message)) throw err;
    onEvent('status', { message: 'Retrying without structured output…' });
    message = await streamOnce(client, request(false), onEvent, signal);
  }

  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined this request. Try describing the game differently.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('The design was cut off before it finished. Try a simpler idea.');
  }
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const raw = parseJSON(text);
  if (baseSpec && raw && typeof raw === 'object' && baseSpec.seed && !raw.seed) raw.seed = baseSpec.seed;
  const { spec, warnings } = normalizeSpec(raw);
  return { spec, warnings, usage: message.usage, model: message.model };
}

async function streamOnce(client, params, onEvent, signal) {
  const stream = client.beta.messages.stream(params, { signal });
  let chars = 0;
  let lastProgress = 0;
  stream.on('thinking', (delta) => onEvent('thinking', { text: delta }));
  stream.on('text', (delta) => {
    chars += delta.length;
    if (chars - lastProgress > 400) {
      lastProgress = chars;
      onEvent('progress', { chars });
    }
  });
  return stream.finalMessage();
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ }
    }
    throw new Error('Claude returned an unreadable design. Please try again.');
  }
}

/** True when some Anthropic credential is configured for this process. */
export function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);
}
