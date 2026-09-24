// Talking characters: the tools a character can use on the world, the prompt
// that puts Claude in character, and an offline "brain" used when no Claude
// connection is available. Shared by the server (Claude tool runner), the
// browser (applying actions, offline replies) and the tests.

import { NPC_POWERS } from './spec.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** JSON-schema tool definitions, one per power. */
export const NPC_TOOLS = {
  give_points: {
    description: 'Reward the player with points, e.g. for answering a riddle, being kind, or finishing a small quest you gave them. Use sparingly and only when earned.',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'integer', description: 'Points to give, 1-50.' },
        reason: { type: 'string', description: 'Short reason shown to the player, e.g. "for solving my riddle".' },
      },
      required: ['amount', 'reason'],
      additionalProperties: false,
    },
  },
  heal: {
    description: 'Restore some of the player\'s lives (hearts).',
    input_schema: {
      type: 'object',
      properties: { amount: { type: 'integer', description: 'Lives to restore, 1-3.' } },
      required: ['amount'],
      additionalProperties: false,
    },
  },
  reveal_goal: {
    description: 'Light the way: mark the goal (or the nearest treasures) with a beacon and a waypoint the player can follow.',
    input_schema: {
      type: 'object',
      properties: { target: { type: 'string', enum: ['goal', 'treasure'], description: 'goal = the level goal, treasure = the nearest collectibles.' } },
      required: ['target'],
      additionalProperties: false,
    },
  },
  spawn_gift: {
    description: 'Conjure collectible treasures in a ring around the player.',
    input_schema: {
      type: 'object',
      properties: { count: { type: 'integer', description: 'How many, 1-8.' } },
      required: ['count'],
      additionalProperties: false,
    },
  },
  change_weather: {
    description: 'Change the weather. Every field is 0-1; use -1 to leave one unchanged.',
    input_schema: {
      type: 'object',
      properties: {
        rain: { type: 'number', description: '0 dry to 1 downpour, -1 unchanged.' },
        lightning: { type: 'number', description: '0 none to 1 fierce storm, -1 unchanged.' },
        aurora: { type: 'number', description: '0 none to 1 vivid northern lights (night only), -1 unchanged.' },
        clouds: { type: 'number', description: '0 clear to 1 overcast, -1 unchanged.' },
        fog: { type: 'number', description: '0 clear to 1 thick fog, -1 unchanged.' },
      },
      required: ['rain', 'lightning', 'aurora', 'clouds', 'fog'],
      additionalProperties: false,
    },
  },
  change_time: {
    description: 'Move the sun: set the time of day. The sky changes smoothly over a few seconds.',
    input_schema: {
      type: 'object',
      properties: { hour: { type: 'number', description: 'Hour 0-24: 6.5 dawn, 13 noon, 18.7 sunset, 23 night.' } },
      required: ['hour'],
      additionalProperties: false,
    },
  },
  grant_ability: {
    description: 'Give the player a temporary boon.',
    input_schema: {
      type: 'object',
      properties: {
        ability: { type: 'string', enum: ['speed', 'jump'], description: 'speed = run faster, jump = jump higher.' },
        seconds: { type: 'integer', description: 'Duration, 5-60 seconds.' },
      },
      required: ['ability', 'seconds'],
      additionalProperties: false,
    },
  },
  follow_player: {
    description: 'Start or stop following the player around as a companion.',
    input_schema: {
      type: 'object',
      properties: { follow: { type: 'boolean', description: 'true to follow, false to stay here.' } },
      required: ['follow'],
      additionalProperties: false,
    },
  },
};

/**
 * Validate and clamp a tool call. Returns { ok: true, input } with a safe
 * input, or { ok: false, error } for malformed calls (the model is told).
 */
export function validateAction(name, input) {
  if (!NPC_POWERS.includes(name)) return { ok: false, error: `unknown power "${name}"` };
  if (!input || typeof input !== 'object') return { ok: false, error: 'input must be an object' };
  switch (name) {
    case 'give_points':
      if (!isNum(input.amount)) return { ok: false, error: 'amount must be a number' };
      return { ok: true, input: { amount: Math.round(clamp(input.amount, 1, 50)), reason: String(input.reason ?? '').slice(0, 80) } };
    case 'heal':
      if (!isNum(input.amount)) return { ok: false, error: 'amount must be a number' };
      return { ok: true, input: { amount: Math.round(clamp(input.amount, 1, 3)) } };
    case 'reveal_goal':
      return { ok: true, input: { target: input.target === 'treasure' ? 'treasure' : 'goal' } };
    case 'spawn_gift':
      if (!isNum(input.count)) return { ok: false, error: 'count must be a number' };
      return { ok: true, input: { count: Math.round(clamp(input.count, 1, 8)) } };
    case 'change_weather': {
      const out = {};
      for (const k of ['rain', 'lightning', 'aurora', 'clouds', 'fog']) {
        const v = input[k];
        if (v === undefined || v === null || v === -1) continue;
        if (!isNum(v)) return { ok: false, error: `${k} must be a number` };
        if (v >= 0) out[k] = clamp(v, 0, 1);
      }
      return { ok: true, input: out };
    }
    case 'change_time':
      if (!isNum(input.hour)) return { ok: false, error: 'hour must be a number' };
      return { ok: true, input: { hour: ((input.hour % 24) + 24) % 24 } };
    case 'grant_ability':
      if (!['speed', 'jump'].includes(input.ability)) return { ok: false, error: 'ability must be "speed" or "jump"' };
      if (!isNum(input.seconds)) return { ok: false, error: 'seconds must be a number' };
      return { ok: true, input: { ability: input.ability, seconds: Math.round(clamp(input.seconds, 5, 60)) } };
    case 'follow_player':
      if (typeof input.follow !== 'boolean') return { ok: false, error: 'follow must be true or false' };
      return { ok: true, input: { follow: input.follow } };
    default:
      return { ok: false, error: 'unsupported' };
  }
}

/** What a tool did, phrased for the model's tool result. */
export function describeAction(name, input) {
  switch (name) {
    case 'give_points': return `The player received ${input.amount} points.`;
    case 'heal': return `The player regained ${input.amount} ${input.amount === 1 ? 'life' : 'lives'}.`;
    case 'reveal_goal': return input.target === 'goal' ? 'A beacon now marks the goal.' : 'A beacon now marks the nearest treasure.';
    case 'spawn_gift': return `${input.count} treasures appeared around the player.`;
    case 'change_weather': return `The weather changed: ${Object.entries(input).map(([k, v]) => `${k} ${v}`).join(', ') || 'no change'}.`;
    case 'change_time': return `The sun is moving to ${Math.floor(input.hour)}:${String(Math.round((input.hour % 1) * 60)).padStart(2, '0')}.`;
    case 'grant_ability': return `The player can ${input.ability === 'speed' ? 'run faster' : 'jump higher'} for ${input.seconds} seconds.`;
    case 'follow_player': return input.follow ? 'You are now following the player.' : 'You stay where you are.';
    default: return 'Done.';
  }
}

/**
 * The system prompt that puts Claude in character. `world` is a compact
 * description of the live game (see Engine.describeWorld()).
 */
export function characterPrompt(character, world) {
  const powers = character.powers.length ? character.powers.join(', ') : 'none (you can only talk)';
  return `You are ${character.name}, ${character.role}, a character inside the video game "${world.title}". A player has walked up to you and is talking to you.

# Who you are
${character.personality}

# The game world
${world.summary}

# How to play your part
- Stay in character. Speak in your own voice, briefly: 1-3 short sentences, like dialogue in a game. No stage directions, no emoji, no markdown.
- You know this world and its objective. Give hints, riddles, lore, warnings and small quests that fit it. Never mention being an AI, a model, a prompt or a game spec.
- Your powers: ${powers}. Use a power (call its tool) only when the story calls for it: a promise kept, a quest completed, a player in need, a dramatic moment. Don't hand out rewards for nothing, and don't use more than one or two per reply. After using a power, say something about it in character.
- If the player asks for something outside your powers, respond in character (refuse, bargain, or point them to someone or somewhere else).`;
}

// ---------------------------------------------------------------- offline brain

const has = (text, words) => words.some((w) => text.includes(w));

/**
 * A small scripted stand-in for Claude, so characters still talk (and use
 * their powers) with no API key, offline, or on static hosting.
 * Returns { text, actions: [{ name, input }] }.
 */
export function offlineReply(character, world, message, history = []) {
  const text = ` ${String(message || '').toLowerCase()} `;
  const can = (p) => character.powers.includes(p);
  const actions = [];
  const lines = [];
  const turns = history.filter((h) => h.role === 'user').length;
  if (has(text, [' hello', ' hi ', ' hey', 'greetings', 'who are you'])) lines.push(`I am ${character.name}, ${character.role}.`);
  if (has(text, ['help', 'hint', 'where', 'lost', 'how do i', 'what do i do', 'goal', 'way'])) {
    lines.push(world.objective ? `Your task: ${world.objective.replace(/[.!?]+$/, '')}.` : 'Look around. The world rewards the curious.');
    if (can('reveal_goal')) { actions.push({ name: 'reveal_goal', input: { target: world.hasGoal ? 'goal' : 'treasure' } }); lines.push('Follow the light I have lit for you.'); }
  }
  if (has(text, ['hurt', 'heal', 'wounded', 'dying', 'health', 'lives', 'life'])) {
    if (can('heal')) { actions.push({ name: 'heal', input: { amount: 1 } }); lines.push('There. Mind your step from now on.'); }
    else lines.push('I have no healing in me, I am afraid.');
  }
  if (has(text, ['gift', 'treasure', 'reward', 'coin', 'gem', 'present', 'something for me'])) {
    if (can('spawn_gift')) { actions.push({ name: 'spawn_gift', input: { count: 3 } }); lines.push('A little something for your pockets.'); }
    else if (can('give_points')) { actions.push({ name: 'give_points', input: { amount: 10, reason: `a gift from ${character.name}` } }); lines.push('Take this, and spend it wisely.'); }
  }
  if (has(text, ['rain', 'storm', 'thunder', 'lightning', 'weather', 'sunny', 'clear', 'aurora', 'northern lights', 'fog'])) {
    if (can('change_weather')) {
      const input = has(text, ['clear', 'sunny', 'stop']) ? { rain: 0, lightning: 0, clouds: 0.15, fog: 0.05 }
        : has(text, ['aurora', 'northern lights']) ? { aurora: 0.9, clouds: 0.1 }
          : has(text, ['fog']) ? { fog: 0.7 }
            : { rain: 0.8, lightning: has(text, ['thunder', 'lightning', 'storm']) ? 0.7 : 0, clouds: 0.9 };
      actions.push({ name: 'change_weather', input });
      lines.push('The sky listens to me, sometimes.');
    } else lines.push('The weather does as it pleases. Not even I can change it.');
  }
  if (has(text, ['night', 'dark', 'day', 'morning', 'sunset', 'dawn', 'noon'])) {
    if (can('change_time')) {
      const hour = has(text, ['night', 'dark']) ? 23 : has(text, ['sunset', 'dusk']) ? 18.7 : has(text, ['dawn', 'morning']) ? 6.8 : 13;
      actions.push({ name: 'change_time', input: { hour } });
      lines.push('Watch the sun obey.');
    }
  }
  if (has(text, ['faster', 'speed', 'run', 'jump', 'higher', 'power', 'boost'])) {
    if (can('grant_ability')) {
      const ability = has(text, ['jump', 'higher']) ? 'jump' : 'speed';
      actions.push({ name: 'grant_ability', input: { ability, seconds: 30 } });
      lines.push(ability === 'jump' ? 'Your legs feel lighter already.' : 'Now run like the wind!');
    }
  }
  if (has(text, ['follow', 'come with', 'join', 'companion', 'together'])) {
    if (can('follow_player')) { actions.push({ name: 'follow_player', input: { follow: true } }); lines.push('Lead on. I will be right behind you.'); }
    else lines.push('My place is here. Go on without me.');
  }
  if (has(text, ['stay', 'wait here', 'leave me', 'go away']) && can('follow_player')) {
    actions.push({ name: 'follow_player', input: { follow: false } });
    lines.push('As you wish.');
  }
  if (has(text, ['bye', 'goodbye', 'farewell', 'thanks', 'thank you'])) lines.push('Safe travels, friend.');
  if (!lines.length) {
    const idle = [
      character.greeting,
      `They call me ${character.name}. ${world.objective ? `If I were you, I would ${world.objective.charAt(0).toLowerCase()}${world.objective.slice(1).replace(/[.!?]+$/, '')}.` : 'Explore, and you will find your way.'}`,
      'Ask me for a hint, a gift, or a change in the sky, and we shall see.',
      'Hmm. The wind has been restless lately.',
    ];
    lines.push(idle[turns % idle.length]);
  }
  return { text: lines.join(' '), actions: actions.filter((a) => validateAction(a.name, a.input).ok).slice(0, 2) };
}
