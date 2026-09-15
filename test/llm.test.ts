import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  ACT_TOOL, DECIDE_INSTRUCTION, DEFAULT_MAX_TOKENS, DEFAULT_MODEL, SERVER_SIDE_FALLBACK_BETA,
  buildRequest, createLlmBrain, extractAction, renderObservation, renderSystemPrompt,
} from '../src/brains/llm.ts';
import type { LlmRequest } from '../src/brains/llm.ts';
import { ACTION_PARAM_NAMES } from '../src/brains/llm-tool.ts';
import { HOUR_INSTRUCTION } from '../src/brains/llm-prompt.ts';
import { leaflet } from '../src/citizens/orientation.ts';
import { civilObservation } from '../src/civil/observe.ts';
import { observeFinance } from '../src/finance/daily.ts';
import { progressObservation, trendsBlock } from '../src/progress/observe.ts';
import { environmentObservation } from '../src/environment/observe.ts';
import { underworldObservation } from '../src/underworld/observe.ts';
import { politicsObservation } from '../src/politics/session.ts';
import { LAW_CODES } from '../src/data/laws.ts';
import { ACTION_TYPES, DISTRICT_IDS } from '../src/types.ts';
import type { Action, Citizen, Observation, World } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sampleObservation(world: World, c: Citizen): Observation {
  return {
    tick: world.tick, day: world.day, hour: world.hour,
    self: {
      id: c.id, name: c.name, familyName: c.familyName, lineage: c.lineage, lifeStage: c.lifeStage, age: 0,
      standing: c.standing, wallet: c.wallet, needs: { ...c.needs },
      mood: c.mood, reputation: c.reputation, district: c.district,
      home: { tier: c.homeTier, rentPerDay: 0, arrearsDays: 0 },
      job: { id: 'j_1', title: 'Fabricator', wage: 15, employer: 'City of Reverie', district: 'foundry_row', shiftsToday: 2 },
      business: null, loan: null, skills: { ...c.skills }, character: { ...c.character }, inventory: { ...c.inventory },
      notes: [...c.notes],
      office: null, record: { convictions: 0, strikes: 0, pendingCharges: 0, finesOwed: 0, serviceDaysLeft: 0 }, detained: false,
      tastes: { ...c.tastes, wants: [] }, possessions: [], partner: null, family: [], household: null, clubs: [],
      goals: [], diary: [], milestones: [], health: { glitched: false, sinceDay: null }, jailedUntilDay: null,
      custody: null, parole: null, visitable: [],
      approval: { mayor: 0.5, council: 0.5 }, school: null, paper: 'chronicle',
      party: null, union: null, gang: null, team: null, mentor: null, mentee: null,
      property: [], shares: [], works: [], repute: null,
    },
    here: {
      district: c.district, districtName: 'The Commons',
      buildings: [{ id: 'central_plaza', name: 'Central Plaza', kind: 'plaza', damage: 0 }],
      citizens: [{
        id: 'c_99', name: 'Bram', bond: 45, job: 'Merchant', office: null, reputation: 60, standing: 'good',
        character: { honesty: 0.9, diligence: 0.4, sociability: 0.6, generosity: 0.2, civic: 0.3 },
      }],
      shops: [], happening: [], units: [], gigs: [], works: [],
    },
    friends: [], rivals: [],
    affection: [],
    calendar: {
      weekday: 0, restDay: false, festivalToday: null, nextFestival: { name: 'Lantern Night', inDays: 14 },
      birthdaysToday: [], season: 'bloom', weather: 'clear', year: 0, matchToday: null, referendumToday: false,
    },
    market: {
      compute: { price: 6, stock: 400 }, energy: { price: 3, stock: 400 }, goods: { price: 12, stock: 120 },
      culture: { price: 8, stock: 60 }, knowledge: { price: 15, stock: 20 },
    },
    housing: { rent: { 1: 8, 2: 20, 3: 50 }, vacancies: { 1: 10, 2: 5, 3: 1 } },
    gates: [],
    jobs: [{ id: 'j_9', title: 'Courier', wage: 9, employer: 'Swift & Co', district: 'harbor_market', skill: null, minSkill: 0, qualified: true }],
    government: {
      mayor: null, council: [], judges: [], watchOfficers: 3, incomeTax: 0.15, salesTax: 0.05, dividend: 15, minWage: 9,
      daysToElection: 6, nominationsOpen: false, electionToday: false, candidates: [], openProposals: [], myLatestCase: null,
      parties: [], approval: { mayor: 0.5, council: 0.5 }, petitions: [], referendum: null, decrees: [],
      propertyTax: 0, wealthTax: 0, tariff: 0, reserveTarget: 0,
    },
    outer: {
      prices: { compute: 7, energy: 3, goods: 13, culture: 9, knowledge: 17 }, tariff: 0, tourists: 0,
    },
    culture: { league: [], topWorks: [], papers: [{ paper: 'chronicle', headline: null }, { paper: 'ledger', headline: null }] },
    feed: [], rumours: [],
    bench: [], appeals: [], reports: [], jury: [], investigations: [],
    // The two newest registers, as an ordinary citizen with nothing filed
    // sees them: an empty record and an empty book.
    civil: civilObservation(world, c.id),
    finance: observeFinance(world, c.id),
    progress: progressObservation(world, c.id),
    trends: trendsBlock(world),
    environment: environmentObservation(world, c),
    underworld: underworldObservation(world, c.id),
    politics: politicsObservation(world, c),
    inbox: [{ from: 'c_99', fromName: 'Bram', text: 'drink at the Halflight?', tick: world.tick }],
    recent: ['You were paid 15 lumens for a shift.'],
    availableActions: ['idle', 'move', 'work', 'rest', 'eat', 'socialize', 'message'],
  };
}

function toolResponse(input: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'msg_1', type: 'message', role: 'assistant', model: 'fake', stop_reason: 'tool_use', stop_sequence: null,
    content: [
      { type: 'text', text: 'Time to work.' },
      { type: 'tool_use', id: 'tu_1', name: 'act', input },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
    ...overrides,
  };
}

/** A fake client that records requests and answers with `responder`. */
function fakeClient(responder: (req: LlmRequest) => unknown) {
  const calls: LlmRequest[] = [];
  const client = { beta: { messages: { create: async (req: LlmRequest) => { calls.push(req); return responder(req); } } } };
  return { calls, client };
}

/**
 * A citizen with nothing wrong with it: instinct would have it stand still,
 * so a fallback shows up as `idle`. `starving()` makes instinct visible.
 */
function setup() {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Ondine' });
  c.memory.push({ tick: 0, kind: 'work', text: 'You were hired as Fabricator.' });
  const obs = sampleObservation(world, c);
  return { world, c, obs };
}

/** Hungry, with a compute cycle in the larder: instinct eats it. */
function starving(c: Citizen, obs: Observation): Action {
  c.needs.energy = 10;
  obs.self.needs.energy = 10;
  c.inventory.compute = 1;
  return { type: 'consume', good: 'compute' };
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

test('system prompt is stable, self-contained and within budget', () => {
  const a = renderSystemPrompt();
  assert.equal(a, renderSystemPrompt(), 'must be byte-identical across calls so it caches');
  // It is sent with cache_control on every request, so the ceiling guards
  // against runaway growth rather than against cost.
  const words = a.split(/\s+/).length;
  // The metropolis roughly doubled the catalogue; the two-track reform added
  // the Code of Persons, custody and parole; civil law and finance added
  // forty-eight actions between them — the instrument, the docket, the guild,
  // the patron, the auction, the counter, the house and the pot; and the
  // underworld and the charter added thirty-four more — the manifest, the
  // gate, the fence, the retainer, the register, the record, the convention
  // and the Games. The ceiling still guards against runaway growth: it is a
  // bound on the *rate* a catalogue may grow at, not a bound on the city, and
  // `REGISTRY.md` §8 is the standing argument that a catalogue this long is
  // itself a cost.
  // Generations and creeds added forty-three more between them: the name, the
  // entail, the match, the will, the roll, the fund, the door and the site.
  assert.ok(words > 600 && words < 16_000, `unexpected size: ${words} words`);
  for (const needle of [
    'Reverie', '`act`', 'exile', 'L13', 'P09', 'Council', 'Watch', 'appeal', 'suspension', 'custody', 'parole',
    '280', 'character', 'notes',
  ]) {
    assert.ok(a.includes(needle), `system prompt is missing ${needle}`);
  }
  assert.doesNotMatch(a, /\bc_\d+\b/, 'no citizen ids');
  assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}|Day \d/, 'no dates or per-tick data');
});

test('the prompt describes the city and every action, and states nothing about hidden traits', () => {
  const a = renderSystemPrompt();
  for (const type of ACTION_TYPES) {
    assert.match(a, new RegExp(`\\b${type}\\b`), `the catalogue in the prompt is missing ${type}`);
  }
  for (const code of LAW_CODES) assert.ok(a.includes(code), `the Code of Offences in the prompt is missing ${code}`);
  for (const district of DISTRICT_IDS) assert.ok(a.includes(district), `the map in the prompt is missing ${district}`);
  assert.doesNotMatch(a, /\bpersonality\b|\bcuriosity\b|\bambition\b/i, 'no hidden traits are described to a citizen');
});

/**
 * FREE_MINDS.md §C: the prompt states facts. It contains no advice, no
 * suggested aims, no priorities and no evaluation of any action, so a citizen
 * is never told what to want. The `act` tool description and the leaflet every
 * citizen is handed at the Arrivals Hall answer to the same rule.
 */
test('nothing the engine writes to a citizen advises it what to do', () => {
  const forbidden = [
    'should', 'advisable', 'wise', 'recommended', 'try to', 'remember to', 'good idea', 'goal', 'priority', 'strategy',
  ];
  const w = makeWorld();
  const texts: [string, string][] = [
    ['the system prompt', renderSystemPrompt()],
    ['the act tool', JSON.stringify(ACT_TOOL)],
    ['the orientation leaflet', leaflet(w)],
  ];
  for (const [what, text] of texts) {
    for (const word of forbidden) {
      const re = new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`, 'i');
      const found = re.exec(text);
      assert.equal(found, null, `${what} advises with "${found?.[0] ?? word}"`);
    }
  }
});

test('act tool is strict and covers every action and parameter', () => {
  assert.equal(ACT_TOOL.name, 'act');
  assert.equal(ACT_TOOL.strict, true);
  const schema = ACT_TOOL.input_schema as unknown as { additionalProperties: boolean; required: string[]; properties: Record<string, Record<string, unknown>> };
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['type']);
  assert.deepEqual(schema.properties.type.enum, [...ACTION_TYPES]);
  for (const p of ACTION_PARAM_NAMES) assert.ok(p in schema.properties, `missing parameter ${p}`);
  const platform = schema.properties.platform as { additionalProperties: boolean; required: string[] };
  assert.equal(platform.additionalProperties, false);
  assert.deepEqual(platform.required, ['tax', 'dividend', 'minWage', 'strictness']);
  for (const t of ACTION_TYPES) assert.ok(ACT_TOOL.description?.includes(t), `description should explain ${t}`);
  // Keywords, not values: one of the secrets a citizen can take is called
  // `pattern` (`docs/UNDERWORLD.md` §5), and an enum value that happens to
  // spell a keyword is not a keyword. The colon is what makes it one.
  assert.doesNotMatch(JSON.stringify(schema), /"(minimum|maximum|minLength|maxLength|pattern)":/, 'strict-mode schema subset only');
});

test('the user turn is the observation as JSON and one sentence', () => {
  const { c, obs } = setup();
  c.needs.energy = 12;
  obs.self.needs.energy = 12;
  const text = renderObservation(obs, c);
  assert.ok(text.endsWith(`\n\n${HOUR_INSTRUCTION}`), text.slice(-80));
  assert.equal(HOUR_INSTRUCTION, 'It is your hour. Choose one action.');
  const json = text.slice(0, text.length - HOUR_INSTRUCTION.length).trim();
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(obs)), 'the whole observation, unabridged');
});

test('the user turn carries nothing the observation does not', () => {
  const { c, obs } = setup();
  c.memory.push({ tick: 1, kind: 'crime', text: 'You stole 40 lumens from Bram and nobody saw.' });
  c.recentActions.push('steal');
  c.notes.push('Bram keeps his wallet in the open.');
  c.personality.honesty = 0.03;
  const text = renderObservation(obs, c);
  assert.ok(!text.includes('nobody saw'), 'memory reaches a citizen through obs.recent, not around it');
  assert.doesNotMatch(text, /personality|curiosity|ambition|0\.03/, 'no hidden trait travels with the observation');
  assert.ok(!text.includes('Bram keeps his wallet'), 'notes reach it through obs.self.notes, not around it');
  obs.self.notes.push('Bram keeps his wallet in the open.');
  assert.ok(renderObservation(obs, c).includes('Bram keeps his wallet'), 'and the notes in the observation do travel');
});

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

test('buildRequest matches the verified API shape', () => {
  const { c, obs } = setup();
  const req = buildRequest(obs, c, { model: 'claude-opus-5', effort: 'low', maxTokens: 4096 }) as Record<string, unknown>;
  assert.equal(req.model, 'claude-opus-5');
  assert.equal(req.max_tokens, 4096);
  assert.deepEqual(req.betas, [SERVER_SIDE_FALLBACK_BETA]);
  assert.equal(SERVER_SIDE_FALLBACK_BETA, 'server-side-fallback-2026-07-01');
  assert.equal(req.fallbacks, 'default');
  assert.deepEqual(req.thinking, { type: 'adaptive' });
  assert.deepEqual(req.output_config, { effort: 'low' });
  assert.deepEqual(req.tool_choice, { type: 'auto' });
  const system = req.system as { type: string; text: string; cache_control: unknown }[];
  assert.equal(system.length, 1);
  assert.equal(system[0].text, renderSystemPrompt());
  assert.deepEqual(system[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(req.tools, [ACT_TOOL]);
  const messages = req.messages as { role: string; content: string }[];
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.ok(messages[0].content.endsWith(DECIDE_INSTRUCTION));
  assert.ok(messages[0].content.startsWith(renderObservation(obs, c)));
  for (const forbidden of ['temperature', 'top_p', 'top_k', 'stream', 'budget_tokens']) assert.ok(!(forbidden in req), `must not send ${forbidden}`);
});

// ---------------------------------------------------------------------------
// decide(): happy path
// ---------------------------------------------------------------------------

test('decide returns the validated act tool call and counts the call', async () => {
  const { world, c, obs } = setup();
  const before = totalMoney(world);
  const { calls, client } = fakeClient(() => toolResponse({ type: 'move', district: 'foundry_row' }));
  const brain = createLlmBrain({ client, model: 'claude-opus-5', effort: 'medium', maxTokens: 999 });
  assert.equal(brain.kind, 'llm');
  const action = await brain.decide(world, c, obs);
  assert.deepEqual(action, { type: 'move', district: 'foundry_row' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'claude-opus-5');
  assert.equal(calls[0].max_tokens, 999);
  assert.deepEqual(calls[0].output_config, { effort: 'medium' });
  assert.equal(world.counters.llmCalls, 1);
  assert.equal(world.counters.llmFallbacks ?? 0, 0);
  assert.equal(world.counters.llmErrors ?? 0, 0);
  assert.equal(totalMoney(world), before, 'a brain never moves money');
});

test('default model comes from REVERIE_MODEL, else claude-opus-5', async () => {
  const { world, c, obs } = setup();
  const saved = process.env.REVERIE_MODEL;
  try {
    delete process.env.REVERIE_MODEL;
    const a = fakeClient(() => toolResponse({ type: 'idle' }));
    await createLlmBrain({ client: a.client }).decide(world, c, obs);
    assert.equal(a.calls[0].model, DEFAULT_MODEL);
    assert.equal(a.calls[0].max_tokens, DEFAULT_MAX_TOKENS);
    assert.deepEqual(a.calls[0].output_config, { effort: 'low' });

    process.env.REVERIE_MODEL = 'claude-sonnet-5';
    const b = fakeClient(() => toolResponse({ type: 'idle' }));
    await createLlmBrain({ client: b.client }).decide(world, c, obs);
    assert.equal(b.calls[0].model, 'claude-sonnet-5');

    const d = fakeClient(() => toolResponse({ type: 'idle' }));
    await createLlmBrain({ client: d.client, model: 'claude-opus-4-8' }).decide(world, c, obs);
    assert.equal(d.calls[0].model, 'claude-opus-4-8', 'opts.model wins over the environment');
  } finally {
    if (saved === undefined) delete process.env.REVERIE_MODEL; else process.env.REVERIE_MODEL = saved;
  }
});

test('picks the act block even when other blocks are present, and parses string input', () => {
  const res = toolResponse('{"type":"eat"}', {
    content: [
      { type: 'thinking', thinking: '', signature: 'x' },
      { type: 'tool_use', id: 'tu_0', name: 'other', input: { type: 'steal', from: 'c_1' } },
      { type: 'tool_use', id: 'tu_1', name: 'act', input: '{"type":"eat"}' },
    ],
  });
  assert.deepEqual(extractAction(res as never), { ok: true, action: { type: 'eat' } });
});

// ---------------------------------------------------------------------------
// decide(): fallback paths
// ---------------------------------------------------------------------------

/** Every failure path ends in instinct: here, the hungry citizen's own compute cycle. */
async function expectFallback(responder: (req: LlmRequest) => unknown, reasonNeedle: string) {
  const { world, c, obs } = setup();
  const eat = starving(c, obs);
  const { client } = fakeClient(responder);
  const brain = createLlmBrain({ client, model: 'claude-opus-5' });
  const action = await brain.decide(world, c, obs);
  assert.deepEqual(action, eat, 'the fallback is instinct, not a strategy');
  assert.equal(world.counters.llmFallbacks, 1);
  const last = c.memory.at(-1)!;
  assert.ok(last.text.startsWith('(fell back to instinct'), last.text);
  assert.ok(last.text.includes(reasonNeedle), `expected "${reasonNeedle}" in "${last.text}"`);
  return { world, c };
}

test('refusal falls back to instinct', async () => {
  const { world } = await expectFallback(() => toolResponse({ type: 'idle' }, { stop_reason: 'refusal', content: [] }), 'refusal');
  assert.equal(world.counters.llmCalls, 1);
  assert.equal(world.counters.llmErrors ?? 0, 0);
});

test('a response without an act tool call falls back', async () => {
  await expectFallback(() => toolResponse({ type: 'idle' }, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I will work.' }] }), 'no act tool call');
});

test('an invalid action falls back', async () => {
  await expectFallback(() => toolResponse({ type: 'move' }), 'invalid action');
  await expectFallback(() => toolResponse({ type: 'fly' }), 'invalid action');
  await expectFallback(() => toolResponse('{not json'), 'not valid JSON');
});

test('a thrown error falls back, is counted and never escapes decide()', async () => {
  const { world, c } = await expectFallback(() => { throw new Error('socket hang up'); }, 'socket hang up');
  assert.equal(world.counters.llmErrors, 1);
  const sys = world.tickEvents.filter((e) => e.kind === 'system');
  assert.equal(sys.length, 1, 'one system event per day per brain');
  assert.deepEqual(sys[0].actors, [c.id]);
});

test('SDK typed errors are described by class', async () => {
  const sdk = await import('@anthropic-ai/sdk');
  const rateLimited = new sdk.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers());
  await expectFallback(() => { throw rateLimited; }, 'rate limited');
  const timedOut = new sdk.APIConnectionTimeoutError();
  await expectFallback(() => { throw timedOut; }, 'timed out');
});

test('a citizen in no distress simply idles when the model fails', async () => {
  const { world, c, obs } = setup();
  const { client } = fakeClient(() => { throw new Error('boom'); });
  const brain = createLlmBrain({ client, model: 'claude-opus-5' });
  assert.deepEqual(await brain.decide(world, c, obs), { type: 'idle' }, 'instinct pursues nothing');
  assert.equal(world.counters.llmFallbacks, 1);
});

test('the fallback never works, trades, votes or steals for the citizen', async () => {
  const { world, c, obs } = setup();
  c.needs.energy = 5;
  c.needs.rest = 5;
  c.needs.social = 0;
  c.needs.purpose = 0;
  c.wallet = 5_000;
  const { client } = fakeClient(() => toolResponse({ type: 'nonsense' }));
  const action = await createLlmBrain({ client }).decide(world, c, obs);
  assert.ok(['idle', 'consume', 'buy', 'rest'].includes(action.type), `instinct chose ${action.type}`);
});

test('malformed responses fall back instead of throwing', async () => {
  await expectFallback(() => null, 'empty response');
  await expectFallback(() => ({ stop_reason: 'end_turn' }), 'no act tool call');
});
