// The offline game designer.
//
// When no Claude API key is configured (or the network is down) Reverie still
// turns a prompt into a playable game. It reads themes, genres, time of day,
// difficulty and object names from the prompt and assembles a spec from a
// library of hand-tuned building blocks. The output always goes through
// normalizeSpec(), exactly like Claude's output does.

import { Rng, hashString } from './rng.js';
import { normalizeSpec, defaultSpec } from './spec.js';

// ---------------------------------------------------------------------------
// Themes: look & feel
// ---------------------------------------------------------------------------

const THEMES = {
  meadow: {
    words: ['meadow', 'field', 'countryside', 'farm', 'garden', 'valley', 'spring', 'village', 'grassland', 'prairie'],
    time: 15.5, clouds: 0.35, fog: 0.15, tint: '#ffffff', particles: 'none', music: 'calm',
    terrain: { style: 'hills', height: 9, roughness: 0.35, palette: { low: '#cdb98a', mid: '#6a9a3c', high: '#7f8c6a', cliff: '#6e6152' } },
    water: { enabled: true, level: 1.0, color: '#21607a' },
    scatter: [['oak', 0.25, '#4f8a2f'], ['flower', 0.4, '#ff8fb8'], ['grass', 0.8, '#7aa843'], ['rock', 0.12, '#8d8a82']],
    player: '#ff7a3d', accent: '#ffcc33', danger: '#e2433b',
    names: [['Sunny', 'Golden', 'Clover', 'Lazy', 'Bright'], ['Meadows', 'Fields', 'Hollow', 'Valley', 'Acres']],
    post: { bloom: 0.5, saturation: 1.1, contrast: 1.05, vignette: 0.25, warmth: 0.2 },
  },
  forest: {
    words: ['forest', 'woods', 'woodland', 'jungle', 'grove', 'tree', 'elf', 'druid', 'nature', 'fairy', 'enchanted'],
    time: 17.8, clouds: 0.3, fog: 0.35, tint: '#ffffff', particles: 'fireflies', music: 'mystic',
    terrain: { style: 'hills', height: 12, roughness: 0.5, palette: { low: '#6f6a3e', mid: '#3f6b2a', high: '#5b6b4a', cliff: '#5a4c3e' } },
    water: { enabled: true, level: 1.2, color: '#1d4a45' },
    scatter: [['pine', 0.5, '#24502c'], ['oak', 0.35, '#3d7a2a'], ['grass', 0.9, '#5c8a33'], ['mushroom', 0.15, '#d8452f'], ['rock', 0.15, '#7d7a70']],
    player: '#ff8c42', accent: '#9dff6a', danger: '#b33cff',
    names: [['Whispering', 'Mossy', 'Elder', 'Emerald', 'Hidden'], ['Pines', 'Grove', 'Thicket', 'Woods', 'Glade']],
    post: { bloom: 0.7, saturation: 1.08, contrast: 1.08, vignette: 0.35, warmth: 0.25 },
  },
  desert: {
    words: ['desert', 'sand', 'sandy', 'dune', 'egypt', 'pyramid', 'sahara', 'oasis', 'western', 'cowboy', 'mirage', 'canyon'],
    time: 17.2, clouds: 0.1, fog: 0.18, tint: '#fff2dc', particles: 'dust', music: 'mystic',
    terrain: { style: 'dunes', height: 10, roughness: 0.3, palette: { low: '#d9b27a', mid: '#e3bf83', high: '#c9955a', cliff: '#a8683f' } },
    water: { enabled: false, level: 0.5, color: '#2a8a9a' },
    scatter: [['cactus', 0.2, '#4d7a3a'], ['rock', 0.2, '#b07a4f'], ['palm', 0.05, '#5a8a32'], ['pillar', 0.04, '#d7b98a']],
    player: '#3a7bd5', accent: '#ffd23b', danger: '#d9412b',
    names: [['Burning', 'Endless', 'Amber', 'Scorched', 'Golden'], ['Dunes', 'Sands', 'Mirage', 'Wastes', 'Expanse']],
    post: { bloom: 0.55, saturation: 1.05, contrast: 1.1, vignette: 0.3, warmth: 0.45 },
  },
  snow: {
    words: ['snow', 'snowy', 'ice', 'icy', 'winter', 'frozen', 'arctic', 'christmas', 'glacier', 'frost', 'frosty', 'polar', 'penguin', 'yeti', 'ski'],
    time: 11.5, clouds: 0.5, fog: 0.35, tint: '#eef6ff', particles: 'snow', music: 'calm',
    terrain: { style: 'mountains', height: 22, roughness: 0.55, palette: { low: '#e8eef5', mid: '#f4f8fc', high: '#ffffff', cliff: '#7d8792' } },
    water: { enabled: true, level: 1.0, color: '#2b5f82' },
    scatter: [['pine', 0.45, '#2c4f3a'], ['rock', 0.2, '#8e97a3'], ['crystal', 0.05, '#aee8ff']],
    player: '#e2433b', accent: '#7fe3ff', danger: '#4a3aff',
    names: [['Frozen', 'Silent', 'Crystal', 'Frostbite', 'Northern'], ['Peaks', 'Tundra', 'Summit', 'Glacier', 'Pass']],
    post: { bloom: 0.6, saturation: 0.95, contrast: 1.05, vignette: 0.3, warmth: -0.3 },
  },
  volcano: {
    words: ['lava', 'volcano', 'fire', 'hell', 'inferno', 'magma', 'dragon', 'molten', 'ash', 'demon', 'forge'],
    time: 19.2, clouds: 0.6, fog: 0.45, tint: '#ffb08a', particles: 'embers', music: 'tense',
    terrain: { style: 'mountains', height: 26, roughness: 0.7, palette: { low: '#2a1e1a', mid: '#3a2b26', high: '#1f1a18', cliff: '#4a2a1c' } },
    water: { enabled: true, level: 1.5, color: '#ff4a0a' },
    scatter: [['rock', 0.35, '#3b302b'], ['crystal', 0.12, '#ff5a1f'], ['pillar', 0.04, '#40302a']],
    player: '#3fd0ff', accent: '#ffcf4a', danger: '#ff3a1a',
    names: [['Molten', 'Ashen', 'Crimson', 'Burning', 'Obsidian'], ['Depths', 'Caldera', 'Forge', 'Inferno', 'Rift']],
    post: { bloom: 1.1, saturation: 1.12, contrast: 1.15, vignette: 0.45, warmth: 0.5 },
  },
  tropical: {
    words: ['island', 'beach', 'tropical', 'ocean', 'sea', 'pirate', 'coast', 'lagoon', 'paradise', 'surf', 'treasure'],
    time: 14.5, clouds: 0.3, fog: 0.1, tint: '#ffffff', particles: 'none', music: 'upbeat',
    terrain: { style: 'islands', height: 14, roughness: 0.4, palette: { low: '#f0dca8', mid: '#5aa03c', high: '#6c8a4a', cliff: '#8a735a' } },
    water: { enabled: true, level: 3.5, color: '#127a8f' },
    scatter: [['palm', 0.35, '#3f8f2c'], ['grass', 0.6, '#6cb040'], ['rock', 0.12, '#a09683'], ['flower', 0.2, '#ff5a8a']],
    player: '#ff5a5a', accent: '#ffd23b', danger: '#8a2be2',
    names: [['Coral', 'Sunken', 'Turquoise', 'Castaway', 'Lost'], ['Cove', 'Isles', 'Lagoon', 'Atoll', 'Bay']],
    post: { bloom: 0.55, saturation: 1.15, contrast: 1.06, vignette: 0.2, warmth: 0.15 },
  },
  alien: {
    words: ['alien', 'space', 'planet', 'moon', 'mars', 'cosmic', 'galaxy', 'star', 'ufo', 'sci-fi', 'scifi', 'extraterrestrial', 'asteroid', 'nebula'],
    time: 20.5, clouds: 0.2, fog: 0.3, tint: '#c7a0ff', particles: 'spores', music: 'mystic',
    terrain: { style: 'canyon', height: 18, roughness: 0.6, palette: { low: '#3a2a5a', mid: '#5a3a7a', high: '#8a6ab0', cliff: '#2a1f3a' } },
    water: { enabled: true, level: 1.0, color: '#1adfb0' },
    scatter: [['crystal', 0.3, '#6affd8'], ['rock', 0.25, '#4a3a6a'], ['mushroom', 0.2, '#ff5ad8']],
    player: '#e8e8ff', accent: '#6affd8', danger: '#ff3a6a',
    names: [['Xeno', 'Violet', 'Nebula', 'Void', 'Astral'], ['Frontier', 'Colony', 'Planet', 'Drift', 'Outpost']],
    post: { bloom: 1.0, saturation: 1.2, contrast: 1.1, vignette: 0.4, warmth: -0.2 },
  },
  neon: {
    words: ['neon', 'cyber', 'cyberpunk', 'synthwave', 'retro', 'city', 'arcade', 'tron', 'future', 'futuristic', 'rooftop', 'hacker', 'vaporwave'],
    time: 22.5, clouds: 0.15, fog: 0.35, tint: '#ff9aff', particles: 'rain', music: 'upbeat',
    terrain: { style: 'flat', height: 1, roughness: 0.1, palette: { low: '#15101f', mid: '#1c1530', high: '#2a1f40', cliff: '#0e0a16' } },
    water: { enabled: false, level: 0.5, color: '#1a0a3a' },
    scatter: [['pillar', 0.2, '#2a2440']],
    player: '#2fe0ff', accent: '#ff3ad0', danger: '#ff5a1f',
    names: [['Neon', 'Chrome', 'Midnight', 'Pixel', 'Hyper'], ['Runner', 'Grid', 'Drive', 'Circuit', 'Skyline']],
    post: { bloom: 1.4, saturation: 1.2, contrast: 1.12, vignette: 0.45, warmth: -0.1 },
    neonTowers: true,
  },
  cave: {
    words: ['cave', 'crystal', 'underground', 'mine', 'cavern', 'dungeon', 'gem', 'geode', 'dwarf', 'abyss'],
    time: 21.5, clouds: 0.8, fog: 0.6, tint: '#8aa0ff', particles: 'spores', music: 'mystic',
    terrain: { style: 'canyon', height: 24, roughness: 0.75, palette: { low: '#2a2a35', mid: '#35323f', high: '#4a4658', cliff: '#1f1d26' } },
    water: { enabled: true, level: 1.0, color: '#0a6a8a' },
    scatter: [['crystal', 0.45, '#8a7dff'], ['rock', 0.3, '#44404f'], ['mushroom', 0.15, '#3affc4']],
    player: '#ffb03a', accent: '#b07dff', danger: '#ff3a3a',
    names: [['Crystal', 'Glimmering', 'Deep', 'Echoing', 'Prismatic'], ['Caverns', 'Hollows', 'Depths', 'Mines', 'Grotto']],
    post: { bloom: 1.2, saturation: 1.15, contrast: 1.1, vignette: 0.5, warmth: -0.1 },
  },
  candy: {
    words: ['candy', 'sweet', 'cute', 'pastel', 'kawaii', 'toy', 'rainbow', 'unicorn', 'bubblegum', 'dream', 'kids'],
    time: 13, clouds: 0.4, fog: 0.15, tint: '#ffe8f6', particles: 'spores', music: 'upbeat',
    terrain: { style: 'hills', height: 10, roughness: 0.3, palette: { low: '#ffd6e8', mid: '#b8f0c8', high: '#fff0a8', cliff: '#f0a8d0' } },
    water: { enabled: true, level: 1.2, color: '#7ad0ff' },
    scatter: [['mushroom', 0.3, '#ff7ab8'], ['flower', 0.5, '#ffd23b'], ['oak', 0.2, '#ff9ad0'], ['grass', 0.6, '#9ae8a8'], ['crystal', 0.1, '#a8f0ff']],
    player: '#8a5cff', accent: '#ff5ab0', danger: '#5a3aff',
    names: [['Sugar', 'Bubblegum', 'Marshmallow', 'Sprinkle', 'Cotton'], ['Kingdom', 'Hills', 'Land', 'Parade', 'Clouds']],
    post: { bloom: 0.7, saturation: 1.2, contrast: 0.95, vignette: 0.15, warmth: 0.1 },
  },
  spooky: {
    words: ['spooky', 'haunted', 'halloween', 'ghost', 'graveyard', 'zombie', 'horror', 'vampire', 'witch', 'creepy', 'scary', 'cursed', 'undead'],
    time: 23.2, clouds: 0.5, fog: 0.55, tint: '#9ab0ff', particles: 'fireflies', music: 'tense',
    terrain: { style: 'hills', height: 8, roughness: 0.5, palette: { low: '#2d2a26', mid: '#34402a', high: '#4a4a44', cliff: '#2a241f' } },
    water: { enabled: true, level: 0.8, color: '#1a2a1f' },
    scatter: [['oak', 0.3, '#3a3a22'], ['rock', 0.2, '#5a5a5a'], ['pillar', 0.06, '#6a6a6a'], ['mushroom', 0.12, '#7aff5a'], ['grass', 0.6, '#4a5a2a']],
    player: '#ffb03a', accent: '#ff8a1f', danger: '#7aff5a',
    names: [['Hollow', 'Moonlit', 'Cursed', 'Grim', 'Haunted'], ['Manor', 'Graves', 'Marsh', 'Night', 'Moor']],
    post: { bloom: 0.9, saturation: 0.85, contrast: 1.15, vignette: 0.6, warmth: -0.35 },
  },
  swamp: {
    words: ['swamp', 'bog', 'marsh', 'bayou', 'wetland', 'frog', 'toxic'],
    time: 18.2, clouds: 0.55, fog: 0.55, tint: '#e0ffd0', particles: 'fireflies', music: 'mystic',
    terrain: { style: 'hills', height: 4, roughness: 0.4, palette: { low: '#3a3a22', mid: '#4a5a2a', high: '#5a6a3a', cliff: '#3a3022' } },
    water: { enabled: true, level: 1.4, color: '#2a3a1a' },
    scatter: [['oak', 0.3, '#3a5a22'], ['grass', 0.9, '#5a7a2a'], ['mushroom', 0.25, '#c0ff5a']],
    player: '#ff6a3a', accent: '#c0ff5a', danger: '#a03aff',
    names: [['Murky', 'Sunken', 'Misty', 'Rotting', 'Green'], ['Bayou', 'Mire', 'Fen', 'Marsh', 'Bog']],
    post: { bloom: 0.7, saturation: 0.95, contrast: 1.05, vignette: 0.45, warmth: 0.1 },
  },
  ruins: {
    words: ['ruin', 'ruins', 'ancient', 'temple', 'aztec', 'maya', 'greek', 'rome', 'roman', 'lost city', 'relic', 'archaeolog', 'myth'],
    time: 8.0, clouds: 0.25, fog: 0.3, tint: '#fff4e0', particles: 'dust', music: 'mystic',
    terrain: { style: 'terraces', height: 14, roughness: 0.45, palette: { low: '#b8a27a', mid: '#7a8a4a', high: '#a89a7a', cliff: '#8a7a62' } },
    water: { enabled: true, level: 1.0, color: '#2a6a6a' },
    scatter: [['pillar', 0.15, '#d4c6a8'], ['palm', 0.1, '#4a7a2a'], ['grass', 0.6, '#7a9a4a'], ['rock', 0.2, '#a09a8a']],
    player: '#3a8ad5', accent: '#ffd23b', danger: '#d5433a',
    names: [['Forgotten', 'Sunken', 'Eternal', 'Sacred', 'Lost'], ['Temple', 'Ruins', 'Sanctum', 'Citadel', 'Relics']],
    post: { bloom: 0.6, saturation: 1.05, contrast: 1.08, vignette: 0.3, warmth: 0.35 },
  },
  mountain: {
    words: ['mountain', 'alpine', 'peak', 'cliff', 'highland', 'climb', 'summit', 'hike', 'viking', 'norse'],
    time: 9.5, clouds: 0.4, fog: 0.25, tint: '#ffffff', particles: 'none', music: 'calm',
    terrain: { style: 'mountains', height: 34, roughness: 0.6, palette: { low: '#8a9a5a', mid: '#4f7a36', high: '#e8eef2', cliff: '#6a6a6a' } },
    water: { enabled: true, level: 2.0, color: '#1f5a7a' },
    scatter: [['pine', 0.45, '#2a4f30'], ['rock', 0.3, '#8a8a88'], ['grass', 0.7, '#6a9a3a']],
    player: '#e2433b', accent: '#ffd23b', danger: '#6a3aff',
    names: [['High', 'Windswept', 'Granite', 'Soaring', 'Misty'], ['Peaks', 'Ridge', 'Heights', 'Crags', 'Summit']],
    post: { bloom: 0.5, saturation: 1.05, contrast: 1.08, vignette: 0.25, warmth: 0.05 },
  },
};

// ---------------------------------------------------------------------------
// Vocabulary for objects the player can name in a prompt
// ---------------------------------------------------------------------------

const COLLECTIBLES = [
  { words: ['coin', 'gold', 'money', 'cash', 'treasure', 'doubloon'], id: 'coin', shape: 'coin', color: '#ffc526', metallic: 1, roughness: 0.25, emissive: 0.6, size: [1, 1, 0.18] },
  { words: ['gem', 'jewel', 'diamond', 'ruby', 'emerald', 'sapphire'], id: 'gem', shape: 'gem', color: null, metallic: 0.1, roughness: 0.08, emissive: 1.5, size: [0.9, 1.2, 0.9] },
  { words: ['crystal', 'shard'], id: 'crystal_shard', shape: 'crystal', color: null, metallic: 0.1, roughness: 0.1, emissive: 2.2, size: [0.7, 1.4, 0.7] },
  { words: ['star'], id: 'star', shape: 'star', color: '#ffe14a', metallic: 0.3, roughness: 0.3, emissive: 2.5, size: [1.2, 1.2, 0.35] },
  { words: ['orb', 'wisp', 'spirit', 'soul', 'light', 'energy', 'firefl', 'spark'], id: 'orb', shape: 'sphere', color: null, metallic: 0, roughness: 0.3, emissive: 4, size: [0.6, 0.6, 0.6] },
  { words: ['ring', 'donut'], id: 'ring', shape: 'torus', color: '#ffd23b', metallic: 1, roughness: 0.2, emissive: 0.8, size: [1.2, 1.2, 0.3] },
  { words: ['candy', 'sweet', 'gumball', 'egg'], id: 'candy', shape: 'sphere', color: '#ff5ab0', metallic: 0, roughness: 0.15, emissive: 0.8, size: [0.8, 0.8, 0.8] },
  { words: ['pumpkin'], id: 'pumpkin', shape: 'sphere', color: '#ff8a1f', metallic: 0, roughness: 0.6, emissive: 1.2, size: [1.2, 0.9, 1.2] },
  { words: ['relic', 'artifact', 'idol', 'rune'], id: 'relic', shape: 'pyramid', color: '#ffd23b', metallic: 0.9, roughness: 0.3, emissive: 1.2, size: [1, 1.2, 1] },
  { words: ['battery', 'data', 'chip', 'cell'], id: 'data_cell', shape: 'capsule', color: null, metallic: 0.6, roughness: 0.2, emissive: 3, size: [0.5, 1.1, 0.5] },
  { words: ['mushroom', 'shroom', 'fungus', 'fungi'], id: 'glow_mushroom', shape: 'sphere', color: '#7affc4', metallic: 0, roughness: 0.35, emissive: 3, size: [1, 0.55, 1] },
  { words: ['gift', 'present', 'mitten', 'sock', 'package', 'parcel', 'box'], id: 'gift', shape: 'box', color: '#ff4a5a', metallic: 0, roughness: 0.5, emissive: 0.8, size: [0.8, 0.8, 0.8] },
  { words: ['apple', 'fruit', 'berry', 'cherry'], id: 'fruit', shape: 'sphere', color: '#ff3a3a', metallic: 0, roughness: 0.35, emissive: 0.6, size: [0.6, 0.6, 0.6] },
  { words: ['key'], id: 'key', shape: 'torus', color: '#ffd23b', metallic: 1, roughness: 0.25, emissive: 1, size: [0.8, 0.8, 0.2] },
  { words: ['feather', 'leaf', 'petal'], id: 'feather', shape: 'gem', color: '#b0f0ff', metallic: 0, roughness: 0.4, emissive: 2, size: [0.4, 1, 0.4] },
];

const ENEMIES = [
  { words: ['slime', 'blob', 'goo'], id: 'slime', shape: 'sphere', color: '#6aff5a', emissive: 0.6, metallic: 0, roughness: 0.15, size: [1.4, 1.1, 1.4], mode: 'chase' },
  { words: ['ghost', 'spirit', 'phantom', 'specter', 'wraith'], id: 'ghost', shape: 'capsule', color: '#cfe0ff', emissive: 2, metallic: 0, roughness: 0.4, size: [1, 1.8, 1], mode: 'chase', float: 1.2 },
  { words: ['robot', 'drone', 'bot', 'sentinel', 'mech'], id: 'drone', shape: 'box', color: '#9aa4b0', emissive: 0.2, metallic: 0.9, roughness: 0.3, size: [1.2, 1.2, 1.2], mode: 'patrol', float: 1.5, light: true },
  { words: ['zombie', 'undead', 'monster', 'goblin', 'orc', 'troll', 'beast'], id: 'monster', shape: 'capsule', color: '#5a8a3a', emissive: 0, metallic: 0, roughness: 0.8, size: [1, 1.9, 1], mode: 'chase' },
  { words: ['spike', 'trap', 'saw', 'blade', 'thorn'], id: 'spikes', shape: 'cone', color: '#b0b8c0', emissive: 0, metallic: 0.8, roughness: 0.3, size: [1.2, 1.4, 1.2], mode: 'static' },
  { words: ['fireball', 'meteor', 'bomb', 'mine'], id: 'fire_orb', shape: 'sphere', color: '#ff5a1a', emissive: 5, metallic: 0, roughness: 0.5, size: [1, 1, 1], mode: 'orbit', float: 1.2 },
  { words: ['turret', 'cannon', 'tower', 'laser'], id: 'turret', shape: 'cylinder', color: '#5a5f6a', emissive: 0.4, metallic: 0.8, roughness: 0.35, size: [1.4, 2, 1.4], mode: 'shooter' },
  { words: ['bee', 'wasp', 'bat', 'bird', 'dragon'], id: 'flyer', shape: 'gem', color: '#ffb03a', emissive: 1, metallic: 0.2, roughness: 0.4, size: [1, 0.8, 1], mode: 'chase', float: 2.5 },
];

const COLOR_WORDS = {
  red: '#ff3a3a', crimson: '#d01a3a', orange: '#ff8a1f', yellow: '#ffe14a', golden: '#ffc526', gold: '#ffc526',
  green: '#4aef6a', emerald: '#2ad07a', teal: '#1fd5c0', cyan: '#2fe0ff', aqua: '#2fe0ff', blue: '#3a8aff',
  purple: '#a35cff', violet: '#a35cff', pink: '#ff6ac8', magenta: '#ff3ad0', white: '#f4f8ff', silver: '#d0d8e0',
  ruby: '#ff2a4a', sapphire: '#2a6aff', amethyst: '#b05aff', diamond: '#e0f8ff',
};

// ---------------------------------------------------------------------------
// Prompt analysis
// ---------------------------------------------------------------------------

// Word matching: phrases match as substrings; single words match whole tokens
// (plus simple plurals), and words of 5+ letters also match as prefixes so
// "firefl" finds "fireflies" while "star" does not match "start".
const tokenCache = new Map();
function tokens(text) {
  let t = tokenCache.get(text);
  if (!t) {
    t = text.split(/[^a-z0-9-]+/).filter(Boolean);
    if (tokenCache.size > 64) tokenCache.clear();
    tokenCache.set(text, t);
  }
  return t;
}
function matches(text, w) {
  const word = w.trim();
  if (word.includes(' ')) return text.includes(word);
  return tokens(text).some((t) => t === word || t === `${word}s` || t === `${word}es` || (word.length >= 5 && t.startsWith(word)));
}
const has = (text, words) => words.some((w) => matches(text, w));
const scoreWords = (text, words) => words.reduce((s, w) => s + (matches(text, w) ? 1 : 0), 0);

export function analyzePrompt(prompt) {
  const text = ` ${String(prompt || '').toLowerCase()} `;
  let theme = 'meadow', best = 0;
  for (const [name, t] of Object.entries(THEMES)) {
    const s = scoreWords(text, t.words);
    if (s > best) { best = s; theme = name; }
  }

  let genre = 'collect';
  const wantsCollect = has(text, ['collect', 'gather', 'find', 'hunt', 'pick up', 'grab', 'treasure hunt']);
  if (has(text, ['platform', 'parkour', 'jump', 'climb', 'tower', 'obby', 'obstacle course', 'mario'])) genre = 'platformer';
  else if (has(text, ['survive', 'survival', 'horde', 'until dawn', 'till dawn', 'hold out']) || (!wantsCollect && has(text, ['dodge', 'avoid', 'escape', 'run from', 'chased', 'hunting you']))) genre = 'survive';
  else if (has(text, ['race', 'racing', 'speedrun', 'time trial', 'checkpoint', 'fast as'])) genre = 'race';
  else if (!wantsCollect && has(text, ['explore', 'exploration', 'relax', 'peaceful', 'walk', 'wander', 'chill', 'zen', 'meditat', 'cozy'])) genre = 'explore';
  else if (has(text, ['arena', 'high score', 'score attack', 'as many as'])) genre = 'arena';

  let time = null;
  if (has(text, ['midnight', 'night', 'nighttime', 'moonlit', 'moonlight', 'starry', 'dark', 'until dawn', 'till dawn', 'before dawn'])) time = 23;
  else if (has(text, ['sunset', 'dusk', 'evening', 'golden hour', 'twilight'])) time = 18.7;
  else if (has(text, ['sunrise', 'dawn', 'morning'])) time = 6.8;
  else if (has(text, ['noon', 'midday', 'sunny', 'bright day', 'daytime'])) time = 12.5;

  let difficulty = 1;
  if (has(text, ['easy', 'relax', 'cozy', 'chill', 'kids', 'casual', 'peaceful', 'gentle'])) difficulty = 0;
  if (has(text, ['hard', 'difficult', 'challenging', 'brutal', 'insane', 'intense', 'deadly', 'nightmare'])) difficulty = 2;

  let size = 1;
  if (has(text, ['huge', 'vast', 'open world', 'massive', 'enormous', 'big', 'large', 'epic'])) size = 1.6;
  if (has(text, ['small', 'tiny', 'compact', 'little', 'mini'])) size = 0.7;

  const collectible = COLLECTIBLES.find((c) => has(text, c.words)) ?? null;
  const enemies = ENEMIES.filter((e) => has(text, e.words));
  const weather = has(text, ['storm', 'rain', 'thunder']) ? 'rain' : has(text, ['snowing', 'blizzard']) ? 'snow' : null;
  const foggy = has(text, ['fog', 'mist', 'haze']);
  const firstPerson = has(text, ['first person', 'first-person', 'fps', 'pov']);
  let accent = null;
  for (const [word, hex] of Object.entries(COLOR_WORDS)) {
    if (tokens(text).includes(word)) { accent = hex; break; }
  }
  return { text, theme, genre, time, difficulty, size, collectible, enemies, weather, foggy, firstPerson, accent };
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const B = (type, value = 0, speed = 0, range = 0, axis = 'y') => ({ type, value, speed, range, axis });
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function makeCollectible(info, theme, accent) {
  const c = info.collectible ?? (theme.water.color === '#ff4a0a' ? COLLECTIBLES[2] : info.theme === 'neon' ? COLLECTIBLES[9] : info.theme === 'spooky' ? COLLECTIBLES[7] : COLLECTIBLES[0]);
  const spinSpeed = c.shape === 'coin' || c.shape === 'star' || c.shape === 'torus' ? 140 : 70;
  return {
    id: c.id, shape: c.shape, color: accent ?? c.color ?? theme.accent, emissive: c.emissive,
    metallic: c.metallic, roughness: c.roughness, size: c.size, solid: false,
    behaviors: [B('collectible', 10), B('spin', 0, spinSpeed), B('bob', 0, 0.6, 0.25), B('light', 1.5, 0, 4)],
  };
}

function makeEnemy(e, theme, difficulty) {
  const speed = [2.2, 3.4, 4.8][difficulty];
  const behaviors = [B('hazard', 1)];
  if (e.mode === 'chase') behaviors.push(B('chase', 0, speed, 22 + difficulty * 8));
  if (e.mode === 'patrol') behaviors.push(B('patrol', 0, speed, 10, 'x'));
  if (e.mode === 'orbit') behaviors.push(B('orbit', 0, 0.8 + difficulty * 0.4, 5));
  if (e.mode === 'shooter') behaviors.push(B('shooter', [3, 2, 1.2][difficulty], 9 + difficulty * 3, 30));
  if (e.float) behaviors.push(B('bob', 0, 0.5, 0.35));
  if (e.light || e.emissive > 1.5) behaviors.push(B('light', 3, 0, 8));
  return {
    id: e.id, shape: e.shape, color: e.color ?? theme.danger, emissive: e.emissive, metallic: e.metallic,
    roughness: e.roughness, size: e.size, solid: false, behaviors, float: e.float ?? 0,
  };
}

function goalBeacon(theme) {
  return {
    id: 'goal_beacon', shape: 'crystal', color: theme.accent, emissive: 4, metallic: 0.2, roughness: 0.15,
    size: [1.8, 3.6, 1.8], solid: false,
    behaviors: [B('goal'), B('spin', 0, 40), B('bob', 0, 0.4, 0.3), B('light', 8, 0, 16)],
  };
}

function platform(id, color, size, extra = []) {
  return { id, shape: 'box', color, emissive: 0, metallic: 0.1, roughness: 0.6, size, solid: true, behaviors: extra };
}

function makeTitle(rng, theme, genre) {
  const [adj, noun] = theme.names;
  const suffix = { platformer: ['Ascent', 'Leap', 'Climb'], survive: ['Survival', 'Escape', 'Siege'], race: ['Rush', 'Dash', 'Run'], explore: ['Wanderer', 'Stroll', 'Journey'], arena: ['Frenzy', 'Arena', 'Rumble'], collect: ['Hunt', 'Quest', 'Seeker'] }[genre];
  return rng.chance(0.5) ? `${rng.pick(adj)} ${rng.pick(noun)}` : `${rng.pick(adj)} ${rng.pick(noun)}: ${rng.pick(suffix)}`;
}

// ---------------------------------------------------------------------------
// Genre layouts
// ---------------------------------------------------------------------------

function addEnemies(spec, ctx, difficulty, scale = 1) {
  const { theme, info, half } = ctx;
  const kinds = info.enemies.length ? info.enemies : [ENEMIES[info.theme === 'neon' ? 2 : info.theme === 'spooky' ? 1 : 0]];
  const n = Math.round([3, 6, 10][difficulty] * scale);
  kinds.forEach((k, i) => {
    const enemy = makeEnemy(k, theme, difficulty);
    const float = enemy.float; delete enemy.float;
    if (!spec.prefabs.some((p) => p.id === enemy.id)) spec.prefabs.push(enemy);
    spec.spawns.push({
      prefab: enemy.id, count: Math.max(1, Math.round(n / kinds.length)), pattern: i % 2 ? 'ring' : 'scatter',
      center: [0, round(float), 0], radius: round(half * (0.35 + 0.2 * i)), height: 0,
    });
  });
  if (difficulty >= 1) {
    spec.prefabs.push({ id: 'heart', shape: 'sphere', color: '#ff4a6a', emissive: 3, metallic: 0, roughness: 0.3, size: [0.7, 0.7, 0.7], solid: false, behaviors: [B('heal', 1), B('bob', 0, 0.8, 0.3), B('light', 2, 0, 5)] });
    spec.spawns.push({ prefab: 'heart', count: 2 + difficulty, pattern: 'scatter', center: [0, 0.8, 0], radius: half * 0.7, height: 0 });
  }
}

function layoutCollect(spec, ctx, { count = 30, hazards = true, timeLimit = 0, goal = 'collect' } = {}) {
  const { rng, theme, info, half } = ctx;
  const item = makeCollectible(info, theme, info.accent);
  spec.prefabs.push(item);
  spec.spawns.push({ prefab: item.id, count: Math.round(count * 0.6), pattern: 'scatter', center: [0, 0.8, 0], radius: round(half * 0.85), height: 0 });
  spec.spawns.push({ prefab: item.id, count: Math.round(count * 0.4), pattern: 'path', center: [round(half * 0.5), 0.8, round(-half * 0.4)], radius: 2, height: 0 });
  spec.prefabs.push({
    id: 'landmark', shape: 'crystal', color: theme.accent, emissive: 3, metallic: 0.2, roughness: 0.2,
    size: [2.5, 6, 2.5], solid: true, behaviors: [B('light', 10, 0, 22)],
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rng.range(0, 1);
    spec.placements.push({ prefab: 'landmark', position: [round(Math.cos(a) * half * 0.6), 0, round(Math.sin(a) * half * 0.6)], rotationY: rng.int(0, 360), scale: 1 });
  }
  if (hazards) addEnemies(spec, ctx, info.difficulty);
  spec.rules.goal = goal;
  spec.rules.targetScore = 0;
  spec.rules.timeLimit = timeLimit;
  const noun = item.id.replace(/_/g, ' ');
  spec.rules.objective = goal === 'score' ? `Grab as many ${noun}s as you can before time runs out!` : `Collect every ${noun}!`;
}

function layoutPlatformer(spec, ctx) {
  const { rng, theme, info } = ctx;
  spec.terrain.style = 'flat';
  spec.terrain.height = 2;
  spec.water.enabled = true;
  spec.water.level = 1.5;
  const dark = info.theme === 'neon' || info.theme === 'spooky' || info.theme === 'cave';
  const plat = platform('platform', dark ? '#2a2440' : '#e8e2d4', [4, 0.8, 4]);
  const mover = platform('moving_platform', theme.accent, [3.5, 0.6, 3.5], [B('patrol', 0, 2 + info.difficulty, 5, 'x')]);
  const bouncer = { id: 'bounce_pad', shape: 'cylinder', color: '#5aff8a', emissive: 2, metallic: 0.2, roughness: 0.4, size: [2.2, 0.4, 2.2], solid: false, behaviors: [B('bounce', 16), B('light', 2, 0, 6)] };
  const item = makeCollectible(info, theme, info.accent);
  spec.prefabs.push(plat, mover, bouncer, item, goalBeacon(theme));
  let y = 1.2, angle = 0;
  const steps = [14, 20, 26][info.difficulty];
  const radius = 16;
  for (let i = 0; i < steps; i++) {
    angle += (5.2 + info.difficulty * 0.5) / radius;
    const r = radius + Math.sin(i * 0.7) * 3;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    y += rng.range(0.6, 1.3 + info.difficulty * 0.15);
    const kind = i > 2 && i % 5 === 3 ? 'moving_platform' : 'platform';
    spec.placements.push({ prefab: kind, position: [round(x), round(y), round(z)], rotationY: round((-angle * 180) / Math.PI), scale: 1 });
    if (i % 2 === 0) spec.placements.push({ prefab: item.id, position: [round(x), round(y + 1.6), round(z)], rotationY: 0, scale: 1 });
    if (i === Math.floor(steps / 2)) {
      spec.placements.push({ prefab: 'bounce_pad', position: [round(x), round(y + 0.8), round(z)], rotationY: 0, scale: 1 });
      y += 4;
    }
  }
  spec.placements.push({ prefab: 'platform', position: [0, round(y + 1), 0], rotationY: 0, scale: 1.6 });
  spec.placements.push({ prefab: 'goal_beacon', position: [0, round(y + 3.2), 0], rotationY: 0, scale: 1 });
  if (info.difficulty > 0) {
    const enemy = makeEnemy(info.enemies[0] ?? ENEMIES[5], theme, info.difficulty);
    delete enemy.float;
    spec.prefabs.push(enemy);
    spec.spawns.push({ prefab: enemy.id, count: 3 + info.difficulty * 2, pattern: 'ring', center: [0, round(y * 0.5), 0], radius: 12, height: round(y * 0.4) });
  }
  spec.player.spawn = [0, 1, 0];
  spec.player.jump = 2.6;
  spec.rules.goal = 'reach';
  spec.rules.timeLimit = info.difficulty === 2 ? 180 : 0;
  spec.rules.objective = 'Climb the spiral and touch the beacon at the top!';
  spec.scatter = spec.scatter.filter((s) => s.kind !== 'pine' && s.kind !== 'oak' && s.kind !== 'palm');
}

function layoutSurvive(spec, ctx) {
  const { info } = ctx;
  addEnemies(spec, ctx, info.difficulty, 1.6);
  const item = makeCollectible(info, ctx.theme, info.accent);
  spec.prefabs.push(item);
  spec.spawns.push({ prefab: item.id, count: 20, pattern: 'scatter', center: [0, 0.8, 0], radius: round(ctx.half * 0.8), height: 0 });
  spec.rules.goal = 'survive';
  spec.rules.timeLimit = [60, 90, 120][info.difficulty];
  spec.rules.objective = `Survive for ${spec.rules.timeLimit} seconds! Grab pickups for points.`;
  spec.player.speed = 8;
}

function layoutRace(spec, ctx) {
  const { theme, info, half } = ctx;
  const cp = { id: 'checkpoint', shape: 'torus', color: theme.accent, emissive: 3, metallic: 0.5, roughness: 0.3, size: [4, 4, 0.5], solid: false, behaviors: [B('checkpoint'), B('spin', 0, 30), B('light', 4, 0, 10)] };
  const booster = { id: 'booster', shape: 'cylinder', color: '#5aff8a', emissive: 2.5, metallic: 0.2, roughness: 0.4, size: [2.5, 0.3, 2.5], solid: false, behaviors: [B('bounce', 14)] };
  spec.prefabs.push(cp, booster, goalBeacon(theme));
  const n = 6;
  for (let i = 1; i <= n; i++) {
    const a = (i / (n + 1)) * Math.PI * 1.6;
    const r = half * (0.25 + 0.55 * (i / n));
    spec.placements.push({ prefab: 'checkpoint', position: [round(Math.cos(a) * r), 0.3, round(Math.sin(a) * r)], rotationY: round((-a * 180) / Math.PI), scale: 1 });
    spec.placements.push({ prefab: 'booster', position: [round(Math.cos(a - 0.12) * r), 0, round(Math.sin(a - 0.12) * r)], rotationY: 0, scale: 1 });
  }
  const end = Math.PI * 1.6;
  spec.placements.push({ prefab: 'goal_beacon', position: [round(Math.cos(end) * half * 0.85), 0.5, round(Math.sin(end) * half * 0.85)], rotationY: 0, scale: 1 });
  if (info.difficulty > 0) addEnemies(spec, ctx, info.difficulty - 1);
  spec.rules.goal = 'reach';
  spec.rules.timeLimit = [150, 110, 80][info.difficulty];
  spec.rules.objective = 'Race through the rings to the beacon before time runs out!';
  spec.player.speed = 10;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Turn a natural-language prompt into a normalized game spec. */
export function designFromPrompt(prompt, options = {}) {
  const info = analyzePrompt(prompt);
  const seed = options.seed ?? (hashString(String(prompt)) % 2147483646) + 1;
  const rng = new Rng(seed);
  const theme = THEMES[info.theme];
  const spec = defaultSpec();
  const size = Math.round(Math.min(360, 140 * info.size));
  const half = size / 2;

  spec.seed = seed;
  spec.title = makeTitle(rng, theme, info.genre);
  spec.tagline = String(prompt || 'A dream made playable.').trim().slice(0, 150) || 'A dream made playable.';
  spec.environment = {
    timeOfDay: info.time ?? theme.time,
    sunAzimuth: rng.int(0, 359),
    cloudCover: info.weather ? 0.85 : theme.clouds,
    fogDensity: Math.min(1, theme.fog + (info.foggy ? 0.35 : 0)),
    fogColor: 'auto',
    skyTint: theme.tint,
    particles: info.weather ?? theme.particles,
    wind: info.weather ? 0.8 : 0.35,
  };
  if (info.time === 23 && spec.environment.particles === 'none') spec.environment.particles = 'fireflies';
  spec.terrain = { ...structuredClone(theme.terrain), size };
  spec.water = { ...theme.water };
  spec.scatter = theme.scatter.map(([kind, density, color]) => ({ kind, density, color, scale: 1 }));
  spec.player = { color: theme.player, speed: 7, jump: 2.2, camera: info.firstPerson ? 'first' : 'third', lives: [5, 3, 2][info.difficulty], spawn: [0, 1, 0] };
  spec.post = { exposure: 0, ...theme.post };
  spec.audio = { music: theme.music, tempo: { calm: 76, mystic: 70, upbeat: 116, tense: 132, none: 90 }[theme.music] };
  spec.rules.winMessage = rng.pick(['You did it!', 'Legendary!', 'Dream complete!', 'Victory!']);
  spec.rules.loseMessage = rng.pick(['So close! Try again.', 'The dream fades... try again!', 'Game over!']);

  const ctx = { rng, theme, info, half };
  switch (info.genre) {
    case 'platformer': layoutPlatformer(spec, ctx); break;
    case 'survive': layoutSurvive(spec, ctx); break;
    case 'race': layoutRace(spec, ctx); break;
    case 'explore': layoutCollect(spec, ctx, { count: 16, hazards: false }); spec.audio.music = 'calm'; break;
    case 'arena': layoutCollect(spec, ctx, { count: 60, hazards: true, timeLimit: 90, goal: 'score' }); break;
    default: layoutCollect(spec, ctx, { count: [24, 30, 40][info.difficulty], hazards: info.difficulty > 0 || info.enemies.length > 0 || has(info.text, ['avoid', 'dodge', 'enemy', 'enemies']) });
  }

  if (theme.neonTowers) {
    spec.prefabs.push({ id: 'neon_tower', shape: 'box', color: '#1a1528', emissive: 0, metallic: 0.8, roughness: 0.25, size: [5, 18, 5], solid: true, behaviors: [] });
    spec.prefabs.push({ id: 'neon_sign', shape: 'box', color: theme.accent, emissive: 5, metallic: 0, roughness: 0.5, size: [5.2, 0.4, 5.2], solid: false, behaviors: [B('light', 6, 0, 14)] });
    spec.spawns.push({ prefab: 'neon_tower', count: 14, pattern: 'ring', center: [0, 0, 0], radius: round(half * 0.75), height: 0 });
    spec.spawns.push({ prefab: 'neon_sign', count: 14, pattern: 'ring', center: [0, 6, 0], radius: round(half * 0.75), height: 10 });
  }
  return normalizeSpec(spec).spec;
}

/**
 * Apply a natural-language tweak ("make it night", "more enemies", "harder",
 * "make it snowy") to an existing spec. Returns { spec, changes }.
 */
export function refineSpec(input, request) {
  const spec = structuredClone(normalizeSpec(input).spec);
  const text = ` ${String(request || '').toLowerCase()} `;
  const info = analyzePrompt(request);
  const changes = [];
  const less = has(text, ['less', 'fewer', 'remove', 'no', 'reduce', 'without', 'smaller', 'decrease']);

  const wantsRestyle = has(text, ['make it', 'turn it', 'turn the', 'set it', 'set in', 'change', 'theme', 'style', 'into', 'become', 'look like', 'looks like', 'instead']);
  const themeHit = wantsRestyle && Object.entries(THEMES).find(([, t]) => has(text, t.words));
  if (themeHit) {
    const theme = themeHit[1];
    spec.terrain.palette = { ...theme.terrain.palette };
    spec.terrain.style = spec.terrain.style === 'flat' ? 'flat' : theme.terrain.style;
    spec.environment.skyTint = theme.tint;
    spec.environment.particles = theme.particles;
    spec.environment.timeOfDay = theme.time;
    spec.environment.fogDensity = theme.fog;
    spec.water = { ...theme.water, enabled: spec.water.enabled || theme.water.enabled };
    spec.scatter = theme.scatter.map(([kind, density, color]) => ({ kind, density, color, scale: 1 }));
    spec.post = { ...spec.post, ...theme.post };
    spec.audio.music = theme.music;
    changes.push(`restyled the world as ${themeHit[0]}`);
  }
  if (info.time !== null) { spec.environment.timeOfDay = info.time; changes.push(`set the time of day to ${info.time}:00`); }
  if (info.weather) { spec.environment.particles = info.weather; spec.environment.cloudCover = 0.85; spec.environment.wind = 0.8; changes.push(`added ${info.weather}`); }
  if (info.foggy) { spec.environment.fogDensity = less ? 0.05 : Math.min(1, spec.environment.fogDensity + 0.35); changes.push(less ? 'cleared the fog' : 'thickened the fog'); }
  if (has(text, ['cloud', 'cloudy', 'overcast'])) { spec.environment.cloudCover = less ? 0.05 : 0.8; changes.push('adjusted the clouds'); }

  const hazardPrefabs = spec.prefabs.filter((p) => p.behaviors.some((b) => b.type === 'hazard'));
  const collectPrefabs = spec.prefabs.filter((p) => p.behaviors.some((b) => b.type === 'collectible'));
  const scaleSpawns = (prefabs, factor) => {
    for (const s of spec.spawns) if (prefabs.some((p) => p.id === s.prefab)) s.count = Math.max(1, Math.round(s.count * factor));
  };

  if (has(text, ['enemy', 'enemies', 'monster', 'hazard', 'danger', ...ENEMIES.flatMap((e) => e.words)])) {
    if (less && hazardPrefabs.length) { scaleSpawns(hazardPrefabs, 0.5); changes.push('halved the enemies'); }
    else if (hazardPrefabs.length && !info.enemies.length) { scaleSpawns(hazardPrefabs, 1.8); changes.push('added more enemies'); }
    else {
      const half = spec.terrain.size / 2;
      const kinds = info.enemies.length ? info.enemies : [ENEMIES[0]];
      for (const k of kinds) {
        const e = makeEnemy(k, { danger: '#ff3a3a' }, 1);
        const float = e.float; delete e.float;
        if (!spec.prefabs.some((p) => p.id === e.id)) spec.prefabs.push(e);
        spec.spawns.push({ prefab: e.id, count: 6, pattern: 'scatter', center: [0, float, 0], radius: half * 0.6, height: 0 });
        changes.push(`added ${k.id}s`);
      }
    }
  }
  if (has(text, ['coin', 'gem', 'collectible', 'pickup', 'item', 'treasure', 'star', 'orb', 'crystal'])) {
    if (collectPrefabs.length) { scaleSpawns(collectPrefabs, less ? 0.5 : 1.8); changes.push(less ? 'fewer collectibles' : 'more collectibles'); }
    if (info.accent) for (const p of collectPrefabs) p.color = info.accent;
  }
  if (has(text, ['tree', 'forest', 'vegetation', 'plants', 'foliage', 'grass'])) {
    for (const s of spec.scatter) if (['pine', 'oak', 'palm', 'grass', 'flower'].includes(s.kind)) s.density = Math.min(1, s.density * (less ? 0.4 : 1.8));
    if (!spec.scatter.some((s) => s.kind === 'pine' || s.kind === 'oak') && !less) spec.scatter.push({ kind: 'oak', density: 0.4, color: '#3d7a2a', scale: 1 });
    changes.push(less ? 'thinned the vegetation' : 'grew more vegetation');
  }
  if (has(text, ['harder', 'difficult', 'challenging', 'tougher'])) {
    scaleSpawns(hazardPrefabs, 1.5);
    for (const p of hazardPrefabs) for (const b of p.behaviors) if (b.type === 'chase' || b.type === 'patrol') b.speed *= 1.3;
    spec.player.lives = Math.max(1, spec.player.lives - 1);
    if (spec.rules.timeLimit) spec.rules.timeLimit = Math.round(spec.rules.timeLimit * 0.8);
    changes.push('made it harder');
  }
  if (has(text, ['easier', 'simpler', 'less hard'])) {
    scaleSpawns(hazardPrefabs, 0.6);
    for (const p of hazardPrefabs) for (const b of p.behaviors) if (b.type === 'chase' || b.type === 'patrol') b.speed *= 0.7;
    spec.player.lives = Math.min(9, spec.player.lives + 2);
    if (spec.rules.timeLimit) spec.rules.timeLimit = Math.round(spec.rules.timeLimit * 1.3);
    changes.push('made it easier');
  }
  if (has(text, ['faster', 'speed up', 'quicker'])) { spec.player.speed = Math.min(20, spec.player.speed * 1.35); changes.push('the player runs faster'); }
  if (has(text, ['slower'])) { spec.player.speed = Math.max(3, spec.player.speed * 0.75); changes.push('the player runs slower'); }
  if (has(text, ['higher jump', 'jump higher', 'moon gravity', 'low gravity', 'bouncier'])) { spec.player.jump = Math.min(12, spec.player.jump * 1.6); changes.push('jumps go higher'); }
  if (info.firstPerson) { spec.player.camera = 'first'; changes.push('switched to first-person'); }
  if (has(text, ['third person', 'third-person'])) { spec.player.camera = 'third'; changes.push('switched to third-person'); }
  if (has(text, ['glow', 'bloom', 'shiny'])) { spec.post.bloom = Math.min(2, Math.max(0, spec.post.bloom + (less ? -0.5 : 0.5))); changes.push('adjusted the glow'); }
  if (has(text, ['water', 'lake', 'flood'])) {
    spec.water.enabled = !less;
    if (!less && has(text, ['flood', 'more water', 'higher water'])) spec.water.level = Math.min(30, spec.water.level + 3);
    changes.push(less ? 'drained the water' : 'added water');
  }
  if (has(text, ['taller', 'steeper'])) { spec.terrain.height = Math.min(60, spec.terrain.height * 1.6 + 4); changes.push('raised the mountains'); }
  if (has(text, ['flatter'])) { spec.terrain.height = Math.max(0, spec.terrain.height * 0.4); changes.push('flattened the land'); }
  if (has(text, ['bigger world', 'larger world', 'bigger map', 'larger map', 'huge world'])) { spec.terrain.size = Math.min(400, spec.terrain.size * 1.5); changes.push('expanded the world'); }
  if (has(text, ['music'])) {
    const mood = ['calm', 'upbeat', 'tense', 'mystic'].find((m) => text.includes(m));
    spec.audio.music = less ? 'none' : mood ?? 'upbeat';
    changes.push(`music: ${spec.audio.music}`);
  }
  if (!changes.length) changes.push('no recognised changes - try words like "night", "more enemies", "make it snowy", "harder" or "first person"');
  return { spec: normalizeSpec(spec).spec, changes };
}

export const THEME_NAMES = Object.keys(THEMES);
