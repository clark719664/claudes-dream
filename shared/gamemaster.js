// Offline game master and art director: the fallbacks used when Claude is
// not available. The game master designs a next level that adapts to how
// the player did; the art director grades the look from screenshot
// statistics.

import { normalizeSpec } from './spec.js';
import { hashString } from './rng.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const NUMERALS = ['', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];
const CHAPTERS = ['The Journey Deepens', 'Beyond the Ridge', 'Into the Storm', 'The Long Night', 'The Last Light', 'Echoes', 'The Hidden Path', 'Homecoming'];

/** 0 = struggled, 0.5 = about right, 1 = breezed through. */
export function skillFromTelemetry(t = {}) {
  let s = 0.5;
  if (t.outcome === 'won') s += 0.2;
  if (t.outcome === 'lost') s -= 0.3;
  if (t.maxLives) s += ((t.lives ?? 0) / t.maxLives - 0.5) * 0.4;
  const hurts = Object.values(t.hurts ?? {}).reduce((a, b) => a + b, 0) + (t.falls ?? 0);
  s -= Math.min(0.3, hurts * 0.05);
  if (t.outcome === 'won' && t.time && t.time < 60) s += 0.1;
  return clamp(s, 0, 1);
}

/**
 * Design the next level without Claude: new layout (seed), the story moves
 * on (time of day, weather), and difficulty follows the player's skill.
 * Returns { spec, notes }.
 */
export function planNextLevel(input, telemetry = {}) {
  const spec = structuredClone(normalizeSpec(input).spec);
  const level = (telemetry.level ?? 1) + 1;
  const skill = skillFromTelemetry(telemetry);
  const notes = [];
  const base = spec.title.replace(/\s+(II|III|IV|V|VI|VII|VIII|IX|X)(:.*)?$/, '');
  spec.seed = (hashString(`${spec.seed}:${level}`) % 2147483646) + 1;
  spec.title = `${base}${NUMERALS[Math.min(level - 1, 9)]}`.slice(0, 60);
  spec.tagline = `Chapter ${level}: ${CHAPTERS[(level - 2) % CHAPTERS.length]}.`;

  // the story moves on: later in the day, wilder weather
  const env = spec.environment;
  env.timeOfDay = (env.timeOfDay + 3.5) % 24;
  if (level % 2 === 1 && env.rain < 0.8) { env.rain = Math.min(1, env.rain + 0.4); env.cloudCover = Math.max(env.cloudCover, 0.7); notes.push('a storm rolls in'); }
  if (level >= 3) env.lightning = Math.min(1, env.lightning + 0.3);
  if (env.timeOfDay > 20 || env.timeOfDay < 5) env.aurora = Math.max(env.aurora, 0.5);
  env.sunAzimuth = (env.sunAzimuth + 70) % 360;
  if (spec.terrain.style !== 'flat') {
    const next = { hills: 'mountains', mountains: 'canyon', canyon: 'terraces', terraces: 'hills', islands: 'islands', dunes: 'canyon' };
    spec.terrain.style = next[spec.terrain.style] ?? spec.terrain.style;
    spec.terrain.height = clamp(spec.terrain.height * 1.15, 0, 60);
  }

  // difficulty follows skill
  const hazardIds = new Set(spec.prefabs.filter((p) => p.behaviors.some((b) => b.type === 'hazard')).map((p) => p.id));
  const factor = skill > 0.65 ? 1.5 : skill < 0.35 ? 0.6 : 1.15;
  for (const s of spec.spawns) if (hazardIds.has(s.prefab)) s.count = Math.max(1, Math.round(s.count * factor));
  for (const p of spec.prefabs) {
    if (!hazardIds.has(p.id)) continue;
    for (const b of p.behaviors) if (['chase', 'patrol', 'orbit'].includes(b.type)) b.speed *= skill > 0.65 ? 1.2 : skill < 0.35 ? 0.8 : 1.05;
  }
  if (skill > 0.65) {
    notes.push('you breezed through, so the hazards are fiercer');
    if (spec.rules.timeLimit > 0) spec.rules.timeLimit = Math.max(30, Math.round(spec.rules.timeLimit * 0.85));
  } else if (skill < 0.35) {
    notes.push('that was tough, so this chapter is kinder');
    spec.player.lives = Math.min(9, spec.player.lives + 1);
    if (spec.rules.timeLimit > 0) spec.rules.timeLimit = Math.round(spec.rules.timeLimit * 1.2);
    for (const c of spec.characters) if (!c.powers.includes('heal')) c.powers.push('heal');
  } else {
    notes.push('a little harder than last time');
  }
  for (const c of spec.characters) {
    c.greeting = telemetry.outcome === 'won'
      ? `You made it through! ${c.greeting}`.slice(0, 240)
      : `Back again? Do not give up now. ${c.greeting}`.slice(0, 240);
  }
  spec.rules.objective = `${spec.rules.objective.replace(/\s*\(Chapter \d+\)$/, '')}`;
  const { spec: out } = normalizeSpec(spec);
  return { spec: out, notes };
}

/**
 * Offline art direction from screenshot statistics ({ luma, saturation,
 * contrast } averaged over the frames, all 0-1). Nudges exposure, saturation
 * and contrast towards a pleasing range. Returns { spec, notes }.
 */
export function gradeFromStats(input, stats) {
  const spec = structuredClone(normalizeSpec(input).spec);
  const p = spec.post;
  const notes = [];
  if (stats.luma < 0.22) { p.exposure = clamp(p.exposure + Math.min(1, (0.3 - stats.luma) * 5), -2, 2); notes.push('lifted the exposure'); }
  else if (stats.luma > 0.62) { p.exposure = clamp(p.exposure - Math.min(1, (stats.luma - 0.55) * 5), -2, 2); notes.push('pulled the exposure down'); }
  if (stats.saturation < 0.22) { p.saturation = clamp(p.saturation + 0.15, 0, 2); notes.push('richer colour'); }
  else if (stats.saturation > 0.6) { p.saturation = clamp(p.saturation - 0.12, 0, 2); notes.push('calmer colour'); }
  if (stats.contrast < 0.16) { p.contrast = clamp(p.contrast + 0.08, 0.5, 1.5); notes.push('more contrast'); }
  if (spec.environment.fogDensity > 0.6 && stats.contrast < 0.12) { spec.environment.fogDensity -= 0.15; notes.push('thinned the fog'); }
  if (!notes.length) notes.push('the look is already balanced');
  return { spec: normalizeSpec(spec).spec, notes };
}
