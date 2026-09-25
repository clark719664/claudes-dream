export const GAME_INTENT_SCHEMA = {
  type: 'object',
  description: 'A compact semantic design describing the intent of the game.',
  properties: {
    title: { type: 'string', description: 'Short evocative game title (max 40 chars).' },
    tagline: { type: 'string', description: 'One-sentence pitch (max 120 chars).' },
    objective: { type: 'string', description: 'One-sentence instruction for the player.' },
    genre: { type: 'string', description: 'e.g. survival adventure, platformer, collect-a-thon.' },
    theme: { type: 'string', description: 'Visual theme mapping. Must be one of: meadow, forest, desert, snow, volcano, tropical, alien, neon, cave.' },
    timeOfDay: { type: 'number', description: 'Hour 0-24. 6.5 dawn, 13 noon, 18.7 golden sunset, 23 night.' },
    weather: { type: 'string', description: 'Ambient particle effect. Must be one of: none, fireflies, snow, embers, dust, rain, spores.' },
    music: { type: 'string', description: 'Must be one of: none, calm, upbeat, tense, mystic.' },
    camera: { type: 'string', description: 'third = over-the-shoulder, first = eyes view.' },
    water: { type: 'boolean', description: 'Whether the world has a global water plane (ocean/lake).' },
    enemies: { type: 'array', items: { type: 'string' }, description: 'Descriptions of enemies (e.g. "skeleton pirate"). Max 3.' },
    collectibles: { type: 'array', items: { type: 'string' }, description: 'Descriptions of collectibles (e.g. "gold coin"). Max 3.' },
    hazards: { type: 'array', items: { type: 'string' }, description: 'Descriptions of static or simple hazards (e.g. "spike trap"). Max 2.' },
    scenery: { type: 'array', items: { type: 'string' }, description: 'Descriptions of major scenery props (e.g. "pirate ship", "ancient ruins"). Max 5.' },
    characters: { type: 'array', items: { type: 'string' }, description: 'Names/roles of friendly NPCs (e.g. "old sailor"). Max 2.' },
    goalObject: { type: 'string', description: 'Description of the primary goal object to reach (e.g. "treasure chest"). Empty if survive/score game.' },
    difficulty: { type: 'string', description: 'easy, normal, or hard' }
  },
  required: ['title', 'tagline', 'objective', 'genre', 'theme', 'timeOfDay', 'weather', 'music', 'camera', 'water', 'enemies', 'collectibles', 'hazards', 'scenery', 'characters', 'goalObject', 'difficulty'],
  additionalProperties: false
};
