// The Reverie Game Spec: one small JSON document that fully describes a game.
//
// This file is the contract between the AI designer (Claude or the offline
// designer) and the engine. It exports:
//   - the vocabularies (shapes, behaviours, biomes, ...)
//   - GAME_SPEC_SCHEMA: a JSON Schema used for Claude structured outputs
//   - normalizeSpec(): turns *any* input into a safe, playable spec
//
// The engine only ever consumes normalized specs, so a malformed or
// over-ambitious AI response can never crash the runtime or blow the
// performance budget.

export const SPEC_VERSION = 1;

export const VISUAL_ARCHETYPES = ['primitive', 'prop', 'architecture', 'creature', 'character', 'vehicle', 'vegetation', 'weapon', 'resource'];
export const SURFACES = ['painted', 'wood', 'stone', 'metal', 'glass', 'cloth', 'leather', 'skin', 'fur', 'scales', 'crystal', 'organic', 'ceramic'];
export const SHAPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'gem', 'coin', 'star', 'pyramid', 'crystal'];
export const BEHAVIORS = ['spin', 'bob', 'collectible', 'hazard', 'goal', 'checkpoint', 'bounce', 'patrol', 'chase', 'orbit', 'light', 'shooter', 'heal'];
export const AXES = ['x', 'y', 'z'];
/** What a character may do to the world when the conversation calls for it (see shared/npc.js). */
export const NPC_POWERS = ['give_points', 'heal', 'reveal_goal', 'spawn_gift', 'change_weather', 'change_time', 'grant_ability', 'follow_player'];
export const SCATTER_KINDS = ['pine', 'oak', 'palm', 'rock', 'grass', 'crystal', 'cactus', 'mushroom', 'pillar', 'flower'];
export const TERRAIN_STYLES = ['hills', 'mountains', 'islands', 'canyon', 'dunes', 'flat', 'terraces'];
export const PARTICLES = ['none', 'fireflies', 'snow', 'embers', 'dust', 'rain', 'spores'];
export const MUSIC = ['none', 'calm', 'upbeat', 'tense', 'mystic'];
export const GOALS = ['collect', 'reach', 'survive', 'score'];
export const PATTERNS = ['scatter', 'ring', 'path', 'cluster', 'line', 'grid'];
export const CAMERAS = ['third', 'first'];

/** Hard performance budget. Keeps every generated game light on any device. */
export const LIMITS = {
  prefabs: 32,
  placements: 400,
  spawns: 32,
  spawnCount: 200,
  entities: 900,
  scatter: 8,
  behaviorsPerPrefab: 5,
  characters: 6,
};

// ---------------------------------------------------------------------------
// JSON Schema (structured-outputs compatible: every object lists all of its
// properties as required and sets additionalProperties: false; numeric ranges
// are documented in descriptions and enforced by normalizeSpec instead).
// ---------------------------------------------------------------------------

const obj = (description, properties) => ({
  type: 'object',
  description,
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const num = (description) => ({ type: 'number', description });
const int = (description) => ({ type: 'integer', description });
const str = (description) => ({ type: 'string', description });
const bool = (description) => ({ type: 'boolean', description });
const oneOf = (values, description) => ({ type: 'string', enum: values, description });
const color = (description) => ({ type: 'string', description: `${description} Hex color, e.g. "#ffaa33".` });
const vec3 = (description) => ({ type: 'array', items: { type: 'number' }, description: `${description} Exactly 3 numbers.` });
const list = (description, items) => ({ type: 'array', description, items });

export const GAME_SPEC_SCHEMA = obj('A complete Reverie game.', {
  title: str('Short evocative game title (max 40 chars).'),
  tagline: str('One-sentence pitch shown on the title card (max 120 chars).'),
  seed: int('Random seed for procedural generation (any positive integer).'),
  environment: obj('Sky, lighting and atmosphere.', {
    timeOfDay: num('Hour 0-24. 6.5 dawn, 13 noon, 18.7 golden sunset, 23 night.'),
    sunAzimuth: num('Compass direction of the sun in degrees 0-360.'),
    cloudCover: num('0 clear sky to 1 fully overcast.'),
    fogDensity: num('0 crystal clear to 1 very thick fog.'),
    fogColor: color('Fog tint. Use "auto" to derive from the sky.'),
    skyTint: color('Multiplies the sky. "#ffffff" is a natural Earth sky; purple/green for alien worlds.'),
    particles: oneOf(PARTICLES, 'Ambient particle effect filling the air.'),
    wind: num('0 still to 1 stormy; sways foliage, grass, water and particles.'),
    rain: num('0 dry to 1 downpour. Rain comes in passing showers, soaks the ground (darker, glossy surfaces, puddles with ripples) and needs cloud cover.'),
    lightning: num('0 none to 1 frequent strikes. Bolts light up the clouds and the world, followed by thunder. Works with or without rain.'),
    aurora: num('0 none to 1 vivid. Northern-lights curtains that dance across the night sky (only visible at night).'),
  }),
  terrain: obj('Procedural landscape. The playable area is centred on the origin.', {
    style: oneOf(TERRAIN_STYLES, 'Landform generator.'),
    size: num('Playable width in meters, 60-400. 140 is a good default.'),
    height: num('Vertical relief in meters, 0-60.'),
    roughness: num('0 smooth to 1 rugged.'),
    palette: obj('Ground colors by altitude/slope.', {
      low: color('Lowlands / beaches.'),
      mid: color('Main ground cover (grass grows here).'),
      high: color('Peaks.'),
      cliff: color('Steep slopes.'),
    }),
  }),
  water: obj('Global water plane.', {
    enabled: bool('Whether there is water.'),
    level: num('Water height in meters relative to the lowest terrain (0-30).'),
    color: color('Deep water color. Bright orange/red makes lava.'),
  }),
  scatter: list('Procedural decoration spread over the terrain (max 8 entries).', obj('A decoration layer.', {
    kind: oneOf(SCATTER_KINDS, 'What to scatter. grass is a dense field of blades.'),
    density: num('0-1. 0.3 is moderate, 1 is dense.'),
    color: color('Main tint (leaves, grass, rock, crystal...).'),
    scale: num('Size multiplier 0.3-3.'),
  })),
  player: obj('The player character.', {
    color: color('Avatar color.'),
    speed: num('Run speed m/s, 3-20. 7 is normal.'),
    jump: num('Jump height in meters, 0.5-12. 2.2 is normal.'),
    camera: oneOf(CAMERAS, 'third = over-the-shoulder, first = eyes view.'),
    lives: int('Lives / hit points, 1-9.'),
    spawn: vec3('[x, heightAboveGround, z] start position.'),
  }),
  prefabs: list('Reusable object templates (max 32).', obj('A template.', {
    id: str('Unique identifier, lowercase letters/digits/underscores, e.g. "gold_coin".'),
    shape: oneOf(SHAPES, 'Immediate procedural fallback primitive.'),
    visual: obj('Semantic visual identity used for progressive high-fidelity assets. Keep description concrete and art-directable.', {
      archetype: oneOf(VISUAL_ARCHETYPES, 'Broad asset family. primitive keeps the procedural fallback only.'),
      description: str('Concise physical description: silhouette, construction, distinctive details and age/wear. Empty string disables enhancement.'),
      surface: oneOf(SURFACES, 'Dominant surface/material family.'),
      detail: num('Desired visual complexity 0-1. Hero objects should be near 1; repeated background props lower.'),
      variation: num('Allowed procedural variation 0-1. Use low values for signature objects.'),
    }),
    color: color('Base color.'),
    emissive: num('Glow strength 0-8. 0 is not glowing; 2-4 glows with bloom.'),
    metallic: num('0 dielectric to 1 metal.'),
    roughness: num('0 mirror to 1 matte.'),
    size: vec3('[width, height, depth] in meters.'),
    solid: bool('true if the player collides with it and can stand on it (platforms, walls).'),
    behaviors: list('Logic attached to the object (max 5).', obj('A behaviour. Unused numeric fields should be 0.', {
      type: oneOf(BEHAVIORS, 'spin: rotates (speed=deg/s). bob: floats (range=amplitude, speed=cycles/s). collectible: picked up (value=points). hazard: hurts player (value=damage). goal: touching wins. checkpoint: respawn point. bounce: launches player (value=launch speed). patrol: moves back and forth (range=distance, speed=m/s, axis). chase: follows player (speed, range=detection radius). orbit: circles its spawn point (range=radius, speed=rad/s). light: emits light (value=intensity, range=radius). shooter: fires orbs at player (value=seconds between shots, speed=orb speed, range=detection). heal: restores a life (value=lives).'),
      value: num('Primary parameter (see type).'),
      speed: num('Speed parameter (see type).'),
      range: num('Distance/radius parameter (see type).'),
      axis: oneOf(AXES, 'Axis for patrol; otherwise "y".'),
    })),
  })),
  placements: list('Hand-placed instances (max 400).', obj('One instance.', {
    prefab: str('Prefab id.'),
    position: vec3('[x, heightAboveGround, z]. y is the height of the object\'s base above the terrain (or water) surface at (x, z); 0 = standing on the ground.'),
    rotationY: num('Yaw in degrees.'),
    scale: num('Uniform scale multiplier, 0.1-10.'),
  })),
  spawns: list('Procedural groups of instances (max 32).', obj('A spawn group.', {
    prefab: str('Prefab id.'),
    count: int('How many (1-200).'),
    pattern: oneOf(PATTERNS, 'scatter: random in radius. ring: circle. path: winding trail from player spawn to center. cluster: tight clumps. line: straight row from player spawn to center. grid: square grid.'),
    center: vec3('[x, heightAboveGround, z] center of the group; y is the base height above the surface (0 = on the ground).'),
    radius: num('Radius / half-extent in meters.'),
    height: num('Extra random height variation in meters (0 = all at center height).'),
  })),
  characters: list('Characters the player can walk up to and talk with (max 6). Claude plays them live, in character, and they can use their powers on the world.', obj('A talking character.', {
    name: str('Display name, e.g. "Old Mossbeard" (max 30 chars).'),
    role: str('Who they are in one line, e.g. "a grumpy mushroom hermit who guards the grove".'),
    personality: str('How they talk, what they want, what they know about this world (hints, secrets, a small quest). 1-4 sentences.'),
    greeting: str('The first thing they say when the player walks up.'),
    color: color('Main color of the character.'),
    position: vec3('[x, heightAboveGround, z] where they stand.'),
    powers: list('What they may do when it makes sense in conversation: give_points (reward), heal (restore lives), reveal_goal (light the way to the goal or treasure), spawn_gift (conjure collectibles nearby), change_weather, change_time, grant_ability (temporary speed or jump boost), follow_player (become a companion).', oneOf(NPC_POWERS, 'A power.')),
  })),
  rules: obj('Win/lose logic.', {
    goal: oneOf(GOALS, 'collect: reach targetScore by collecting. reach: touch a goal object. survive: stay alive until timeLimit. score: highest score before timeLimit ends.'),
    targetScore: int('Points needed for collect (0 = collect everything).'),
    timeLimit: num('Seconds; 0 = no limit. Required for survive/score.'),
    objective: str('Short instruction shown in the HUD.'),
    winMessage: str('Shown on victory.'),
    loseMessage: str('Shown on defeat.'),
  }),
  post: obj('Cinematic post-processing / color grading.', {
    bloom: num('0-2, glow around bright things. 0.6 default.'),
    exposure: num('Exposure compensation in stops, -2 to 2. 0 default.'),
    saturation: num('0-2. 1 default.'),
    contrast: num('0.5-1.5. 1 default.'),
    vignette: num('0-1.'),
    warmth: num('-1 cool/blue to 1 warm/orange.'),
  }),
  audio: obj('Procedural soundtrack.', {
    music: oneOf(MUSIC, 'Generative music mood.'),
    tempo: num('Beats per minute 50-180.'),
  }),
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export function defaultSpec() {
  return {
    version: SPEC_VERSION,
    title: 'Untitled Dream',
    tagline: 'A little world waiting for an idea.',
    seed: 1337,
    environment: {
      timeOfDay: 16.5, sunAzimuth: 210, cloudCover: 0.35, fogDensity: 0.2,
      fogColor: 'auto', skyTint: '#ffffff', particles: 'none', wind: 0.3,
      rain: 0, lightning: 0, aurora: 0,
    },
    terrain: {
      style: 'hills', size: 140, height: 10, roughness: 0.45,
      palette: { low: '#c9b98a', mid: '#5d8a3a', high: '#e8eef2', cliff: '#6b5d52' },
    },
    water: { enabled: true, level: 1.2, color: '#1b4d6b' },
    scatter: [
      { kind: 'pine', density: 0.35, color: '#2f5d34', scale: 1 },
      { kind: 'rock', density: 0.2, color: '#8b8680', scale: 1 },
      { kind: 'grass', density: 0.6, color: '#6f9a3c', scale: 1 },
    ],
    player: { color: '#ff7a3d', speed: 7, jump: 2.2, camera: 'third', lives: 3, spawn: [0, 1, 0] },
    prefabs: [],
    placements: [],
    spawns: [],
    characters: [],
    rules: {
      goal: 'score', targetScore: 0, timeLimit: 0,
      objective: 'Explore the world.', winMessage: 'You did it!', loseMessage: 'Try again!',
    },
    post: { bloom: 0.6, exposure: 0, saturation: 1.05, contrast: 1.05, vignette: 0.3, warmth: 0.1 },
    audio: { music: 'calm', tempo: 84 },
  };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const NAMED_COLORS = {
  red: '#e03a3a', orange: '#ff8a1f', yellow: '#ffd93b', gold: '#ffc526', green: '#3fae4a',
  lime: '#9be34a', teal: '#1fb5a6', cyan: '#2fe0ff', blue: '#3a72e0', navy: '#1c2a5e',
  purple: '#8a4ce0', violet: '#a35cff', magenta: '#ff3ad0', pink: '#ff7ab8', white: '#ffffff',
  black: '#111111', gray: '#808080', grey: '#808080', silver: '#c0c6cc', brown: '#7a5234',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

class Normalizer {
  constructor() { this.warnings = []; }
  warn(path, message) { this.warnings.push(`${path}: ${message}`); }

  num(v, def, lo, hi, path) {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      if (v !== undefined) this.warn(path, `expected a number, using ${def}`);
      return def;
    }
    if (n < lo || n > hi) this.warn(path, `${n} out of range [${lo}, ${hi}], clamped`);
    return clamp(n, lo, hi);
  }
  int(v, def, lo, hi, path) { return Math.round(this.num(v, def, lo, hi, path)); }
  bool(v, def) { return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : def; }
  str(v, def, maxLen) {
    if (typeof v !== 'string') return def;
    const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return s ? s.slice(0, maxLen) : def;
  }
  oneOf(v, values, def, path) {
    if (typeof v === 'string') {
      const lower = v.toLowerCase().trim();
      if (values.includes(lower)) return lower;
    }
    if (v !== undefined) this.warn(path, `"${v}" is not one of ${values.join('/')}, using "${def}"`);
    return def;
  }
  color(v, def, path, allowAuto = false) {
    if (typeof v !== 'string') return def;
    const s = v.trim().toLowerCase();
    if (allowAuto && s === 'auto') return 'auto';
    if (NAMED_COLORS[s]) return NAMED_COLORS[s];
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
    if (!m) { this.warn(path, `"${v}" is not a hex color`); return def; }
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return `#${hex}`;
  }
  vec3(v, def, lo, hi, path) {
    const src = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.y, v.z] : [];
    return [0, 1, 2].map((i) => this.num(src[i], def[i], lo, hi, `${path}[${i}]`));
  }
  list(v, max, path) {
    if (!Array.isArray(v)) return [];
    if (v.length > max) this.warn(path, `${v.length} entries exceeds budget of ${max}, truncated`);
    return v.slice(0, max);
  }
}

function sanitizeId(id, fallback) {
  const s = String(id ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
  return s || fallback;
}

/**
 * Coerce anything into a valid, playable, budget-respecting game spec.
 * Returns { spec, warnings }. Never throws.
 */
export function normalizeSpec(input) {
  const n = new Normalizer();
  const d = defaultSpec();
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  if (src !== input) n.warn('spec', 'not an object, using defaults');

  const env = src.environment ?? {};
  const ter = src.terrain ?? {};
  const pal = ter.palette ?? {};
  const wat = src.water ?? {};
  const ply = src.player ?? {};
  const rul = src.rules ?? {};
  const pst = src.post ?? {};
  const aud = src.audio ?? {};

  const spec = {
    version: SPEC_VERSION,
    title: n.str(src.title, d.title, 60),
    tagline: n.str(src.tagline, d.tagline, 160),
    seed: n.int(src.seed, d.seed, 1, 2147483647, 'seed'),
    environment: {
      timeOfDay: ((n.num(env.timeOfDay, d.environment.timeOfDay, -48, 48, 'environment.timeOfDay') % 24) + 24) % 24,
      sunAzimuth: ((n.num(env.sunAzimuth, d.environment.sunAzimuth, -720, 720, 'environment.sunAzimuth') % 360) + 360) % 360,
      cloudCover: n.num(env.cloudCover, d.environment.cloudCover, 0, 1, 'environment.cloudCover'),
      fogDensity: n.num(env.fogDensity, d.environment.fogDensity, 0, 1, 'environment.fogDensity'),
      fogColor: n.color(env.fogColor, 'auto', 'environment.fogColor', true),
      skyTint: n.color(env.skyTint, d.environment.skyTint, 'environment.skyTint'),
      particles: n.oneOf(env.particles, PARTICLES, 'none', 'environment.particles'),
      wind: n.num(env.wind, d.environment.wind, 0, 1, 'environment.wind'),
      // older specs only had rain particles: treat them as a steady shower
      rain: n.num(env.rain, env.particles === 'rain' ? 0.6 : 0, 0, 1, 'environment.rain'),
      lightning: n.num(env.lightning, 0, 0, 1, 'environment.lightning'),
      aurora: n.num(env.aurora, 0, 0, 1, 'environment.aurora'),
    },
    terrain: {
      style: n.oneOf(ter.style, TERRAIN_STYLES, d.terrain.style, 'terrain.style'),
      size: n.num(ter.size, d.terrain.size, 60, 400, 'terrain.size'),
      height: n.num(ter.height, d.terrain.height, 0, 60, 'terrain.height'),
      roughness: n.num(ter.roughness, d.terrain.roughness, 0, 1, 'terrain.roughness'),
      palette: {
        low: n.color(pal.low, d.terrain.palette.low, 'terrain.palette.low'),
        mid: n.color(pal.mid, d.terrain.palette.mid, 'terrain.palette.mid'),
        high: n.color(pal.high, d.terrain.palette.high, 'terrain.palette.high'),
        cliff: n.color(pal.cliff, d.terrain.palette.cliff, 'terrain.palette.cliff'),
      },
    },
    water: {
      enabled: n.bool(wat.enabled, src.water ? true : d.water.enabled),
      level: n.num(wat.level, d.water.level, 0, 30, 'water.level'),
      color: n.color(wat.color, d.water.color, 'water.color'),
    },
    scatter: [],
    player: {
      color: n.color(ply.color, d.player.color, 'player.color'),
      speed: n.num(ply.speed, d.player.speed, 3, 20, 'player.speed'),
      jump: n.num(ply.jump, d.player.jump, 0.5, 12, 'player.jump'),
      camera: n.oneOf(ply.camera, CAMERAS, 'third', 'player.camera'),
      lives: n.int(ply.lives, d.player.lives, 1, 9, 'player.lives'),
      spawn: n.vec3(ply.spawn, d.player.spawn, -200, 200, 'player.spawn'),
    },
    prefabs: [],
    placements: [],
    spawns: [],
    characters: [],
    rules: {
      goal: n.oneOf(rul.goal, GOALS, d.rules.goal, 'rules.goal'),
      targetScore: n.int(rul.targetScore, 0, 0, 100000, 'rules.targetScore'),
      timeLimit: n.num(rul.timeLimit, 0, 0, 3600, 'rules.timeLimit'),
      objective: n.str(rul.objective, d.rules.objective, 120),
      winMessage: n.str(rul.winMessage, d.rules.winMessage, 120),
      loseMessage: n.str(rul.loseMessage, d.rules.loseMessage, 120),
    },
    post: {
      bloom: n.num(pst.bloom, d.post.bloom, 0, 2, 'post.bloom'),
      exposure: n.num(pst.exposure, d.post.exposure, -2, 2, 'post.exposure'),
      saturation: n.num(pst.saturation, d.post.saturation, 0, 2, 'post.saturation'),
      contrast: n.num(pst.contrast, d.post.contrast, 0.5, 1.5, 'post.contrast'),
      vignette: n.num(pst.vignette, d.post.vignette, 0, 1, 'post.vignette'),
      warmth: n.num(pst.warmth, d.post.warmth, -1, 1, 'post.warmth'),
    },
    audio: {
      music: n.oneOf(aud.music, MUSIC, d.audio.music, 'audio.music'),
      tempo: n.num(aud.tempo, d.audio.tempo, 50, 180, 'audio.tempo'),
    },
  };

  // Keep spawn inside the playable area.
  const half = spec.terrain.size / 2 - 4;
  spec.player.spawn[0] = clamp(spec.player.spawn[0], -half, half);
  spec.player.spawn[2] = clamp(spec.player.spawn[2], -half, half);
  spec.player.spawn[1] = clamp(spec.player.spawn[1], 0, 60);

  const scatterSrc = Array.isArray(src.scatter) ? src.scatter : d.scatter;
  n.list(scatterSrc, LIMITS.scatter, 'scatter').forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const kind = n.oneOf(s.kind, SCATTER_KINDS, null, `scatter[${i}].kind`);
    if (!kind) return;
    spec.scatter.push({
      kind,
      density: n.num(s.density, 0.3, 0, 1, `scatter[${i}].density`),
      color: n.color(s.color, '#5a7a3a', `scatter[${i}].color`),
      scale: n.num(s.scale, 1, 0.3, 3, `scatter[${i}].scale`),
    });
  });

  const ids = new Set();
  n.list(src.prefabs, LIMITS.prefabs, 'prefabs').forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    let id = sanitizeId(p.id, `prefab_${i}`);
    while (ids.has(id)) id = `${id}_${i}`;
    ids.add(id);
    const path = `prefabs[${i}]`;
    const behaviors = [];
    n.list(p.behaviors, LIMITS.behaviorsPerPrefab, `${path}.behaviors`).forEach((b, j) => {
      if (!b || typeof b !== 'object') return;
      const type = n.oneOf(b.type, BEHAVIORS, null, `${path}.behaviors[${j}].type`);
      if (!type) return;
      behaviors.push({
        type,
        value: n.num(b.value, 0, -1000, 1000, `${path}.behaviors[${j}].value`),
        speed: n.num(b.speed, 0, -100, 100, `${path}.behaviors[${j}].speed`),
        range: n.num(b.range, 0, 0, 200, `${path}.behaviors[${j}].range`),
        axis: n.oneOf(b.axis ?? 'y', AXES, 'y', `${path}.behaviors[${j}].axis`),
      });
    });
    spec.prefabs.push({
      id,
      shape: n.oneOf(p.shape, SHAPES, 'box', `${path}.shape`),
      visual: {
        archetype: n.oneOf(p.visual?.archetype, VISUAL_ARCHETYPES, 'primitive', `${path}.visual.archetype`),
        description: n.str(p.visual?.description, '', 500),
        surface: n.oneOf(p.visual?.surface, SURFACES, 'painted', `${path}.visual.surface`),
        detail: n.num(p.visual?.detail, 0.5, 0, 1, `${path}.visual.detail`),
        variation: n.num(p.visual?.variation, 0.35, 0, 1, `${path}.visual.variation`),
      },
      color: n.color(p.color, '#cccccc', `${path}.color`),
      emissive: n.num(p.emissive, 0, 0, 8, `${path}.emissive`),
      metallic: n.num(p.metallic, 0, 0, 1, `${path}.metallic`),
      roughness: n.num(p.roughness, 0.5, 0.02, 1, `${path}.roughness`),
      size: n.vec3(p.size, [1, 1, 1], 0.05, 80, `${path}.size`),
      solid: n.bool(p.solid, false),
      behaviors,
    });
  });

  const known = (id, path) => {
    const s = sanitizeId(id, '');
    if (!ids.has(s)) { n.warn(path, `unknown prefab "${id}", skipped`); return null; }
    return s;
  };

  let entityBudget = LIMITS.entities;
  n.list(src.placements, LIMITS.placements, 'placements').forEach((pl, i) => {
    if (!pl || typeof pl !== 'object' || entityBudget <= 0) return;
    const prefab = known(pl.prefab, `placements[${i}].prefab`);
    if (!prefab) return;
    const pos = n.vec3(pl.position, [0, 0, 0], -400, 400, `placements[${i}].position`);
    pos[0] = clamp(pos[0], -half, half);
    pos[2] = clamp(pos[2], -half, half);
    spec.placements.push({
      prefab,
      position: pos,
      rotationY: n.num(pl.rotationY, 0, -3600, 3600, `placements[${i}].rotationY`),
      scale: n.num(pl.scale, 1, 0.1, 10, `placements[${i}].scale`),
    });
    entityBudget--;
  });

  n.list(src.spawns, LIMITS.spawns, 'spawns').forEach((s, i) => {
    if (!s || typeof s !== 'object' || entityBudget <= 0) return;
    const prefab = known(s.prefab, `spawns[${i}].prefab`);
    if (!prefab) return;
    let count = n.int(s.count, 10, 1, LIMITS.spawnCount, `spawns[${i}].count`);
    if (count > entityBudget) { n.warn(`spawns[${i}].count`, 'entity budget reached, reduced'); count = entityBudget; }
    entityBudget -= count;
    spec.spawns.push({
      prefab,
      count,
      pattern: n.oneOf(s.pattern, PATTERNS, 'scatter', `spawns[${i}].pattern`),
      center: n.vec3(s.center, [0, 1, 0], -400, 400, `spawns[${i}].center`),
      radius: n.num(s.radius, 20, 0, 400, `spawns[${i}].radius`),
      height: n.num(s.height, 0, 0, 60, `spawns[${i}].height`),
    });
  });

  n.list(src.characters, LIMITS.characters, 'characters').forEach((c, i) => {
    if (!c || typeof c !== 'object') return;
    const path = `characters[${i}]`;
    const pos = n.vec3(c.position, [0, 0, 6], -400, 400, `${path}.position`);
    pos[0] = clamp(pos[0], -half, half);
    pos[2] = clamp(pos[2], -half, half);
    pos[1] = clamp(pos[1], 0, 60);
    const powers = [];
    for (const p of Array.isArray(c.powers) ? c.powers : []) if (NPC_POWERS.includes(p) && !powers.includes(p)) powers.push(p);
    spec.characters.push({
      name: n.str(c.name, `Stranger ${i + 1}`, 30),
      role: n.str(c.role, 'a curious wanderer', 160),
      personality: n.str(c.personality, 'Friendly and a little mysterious.', 700),
      greeting: n.str(c.greeting, 'Well met, traveller!', 240),
      color: n.color(c.color, '#8fd4ff', `${path}.color`),
      position: pos,
      powers,
    });
  });

  ensurePlayable(spec, n);
  return { spec, warnings: n.warnings };
}

/** Count instances of a prefab across placements and spawns. */
export function instanceCount(spec, prefabId) {
  let c = 0;
  for (const p of spec.placements) if (p.prefab === prefabId) c++;
  for (const s of spec.spawns) if (s.prefab === prefabId) c += s.count;
  return c;
}

/** Total points obtainable from collectibles. */
export function availablePoints(spec) {
  let total = 0;
  for (const p of spec.prefabs) {
    const b = p.behaviors.find((x) => x.type === 'collectible');
    if (b) total += Math.max(1, Math.round(b.value || 1)) * instanceCount(spec, p.id);
  }
  return total;
}

function hasBehavior(spec, type) {
  return spec.prefabs.some((p) => p.behaviors.some((b) => b.type === type) && instanceCount(spec, p.id) > 0);
}

/** Repair rule combinations that would make a game unwinnable. */
function ensurePlayable(spec, n) {
  const r = spec.rules;
  if (r.goal === 'collect') {
    const pts = availablePoints(spec);
    if (pts === 0) {
      n.warn('rules.goal', 'collect goal without collectibles, switched to "score"');
      r.goal = 'score';
    } else if (r.targetScore <= 0 || r.targetScore > pts) {
      if (r.targetScore > pts) n.warn('rules.targetScore', `only ${pts} points available, lowered`);
      r.targetScore = pts;
    }
  }
  if (r.goal === 'reach' && !hasBehavior(spec, 'goal')) {
    n.warn('rules.goal', 'reach goal without a goal object, added a beacon');
    const id = 'auto_goal_beacon';
    spec.prefabs.push({
      id, shape: 'crystal', visual: { archetype: 'primitive', description: '', surface: 'painted', detail: 0.5, variation: 0.35 }, color: '#7dfcff', emissive: 4, metallic: 0.2, roughness: 0.2,
      size: [1.6, 3.2, 1.6], solid: false,
      behaviors: [
        { type: 'goal', value: 0, speed: 0, range: 0, axis: 'y' },
        { type: 'spin', value: 0, speed: 45, range: 0, axis: 'y' },
        { type: 'light', value: 6, speed: 0, range: 14, axis: 'y' },
      ],
    });
    const half = spec.terrain.size / 2 - 10;
    spec.placements.push({ prefab: id, position: [half * 0.7, 1, -half * 0.7], rotationY: 0, scale: 1 });
  }
  if (r.goal === 'survive' && r.timeLimit <= 0) {
    n.warn('rules.timeLimit', 'survive goal needs a time limit, set to 90s');
    r.timeLimit = 90;
  }
  if (r.goal === 'score' && r.timeLimit <= 0 && availablePoints(spec) > 0) {
    // score attack without a clock: collecting everything is the natural finish
    r.goal = 'collect';
    r.targetScore = availablePoints(spec);
  }
}
