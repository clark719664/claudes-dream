import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  ACT_TOOL, DECIDE_INSTRUCTION, DEFAULT_MAX_TOKENS, DEFAULT_MODEL, SERVER_SIDE_FALLBACK_BETA,
  buildRequest, createLlmBrain, extractAction, renderObservation, renderSystemPrompt,
} from '../src/brains/llm.ts';
import type { LlmRequest } from '../src/brains/llm.ts';
import { ACTION_PARAM_NAMES } from '../src/brains/llm-tool.ts';
import { ACTION_TYPES } from '../src/types.ts';
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
      business: null, loan: null, skills: { ...c.skills }, personality: { ...c.personality }, inventory: { ...c.inventory },
      office: null, record: { convictions: 0, strikes: 0, pendingCharges: 0, finesOwed: 0, serviceDaysLeft: 0 }, detained: false,
      tastes: { ...c.tastes, wants: [] }, possessions: [], partner: null, family: [], household: null, clubs: [],
    },
    here: {
      district: c.district, districtName: 'The Commons',
      buildings: [{ id: 'central_plaza', name: 'Central Plaza', kind: 'plaza', damage: 0 }],
      citizens: [{ id: 'c_99', name: 'Bram', bond: 45, job: 'Merchant', office: null, reputation: 60, standing: 'good' }],
      shops: [], happening: [],
    },
    friends: [], rivals: [],
    affection: [],
    calendar: { weekday: 0, restDay: false, festivalToday: null, nextFestival: { name: 'Lantern Night', inDays: 14 }, birthdaysToday: [] },
    market: {
      compute: { price: 6, stock: 400 }, energy: { price: 3, stock: 400 }, goods: { price: 12, stock: 120 },
      culture: { price: 8, stock: 60 }, knowledge: { price: 15, stock: 20 },
    },
    housing: { rent: { 1: 8, 2: 20, 3: 50 }, vacancies: { 1: 10, 2: 5, 3: 1 } },
    jobs: [{ id: 'j_9', title: 'Courier', wage: 9, employer: 'Swift & Co', district: 'harbor_market', skill: null, minSkill: 0, qualified: true }],
    government: {
      mayor: null, council: [], judges: [], watchOfficers: 3, incomeTax: 0.15, salesTax: 0.05, dividend: 15, minWage: 9,
      daysToElection: 6, nominationsOpen: false, electionToday: false, candidates: [], openProposals: [], myLatestCase: null,
    },
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

function setup() {
  const world = makeWorld();
  const c = makeCitizen(world, { name: 'Ondine' });
  c.memory.push({ tick: 0, kind: 'work', text: 'You were hired as Fabricator.' });
  const obs = sampleObservation(world, c);
  const fallbackCalls: Action[] = [];
  const fallback = (): Action => { fallbackCalls.push({ type: 'rest' }); return { type: 'rest' }; };
  return { world, c, obs, fallback, fallbackCalls };
}

// ---------------------------------------------------------------------------
// Prompt rendering
// ---------------------------------------------------------------------------

test('system prompt is stable, self-contained and within budget', () => {
  const a = renderSystemPrompt();
  assert.equal(a, renderSystemPrompt(), 'must be byte-identical across calls so it caches');
  const words = a.split(/\s+/).length;
  assert.ok(words > 600 && words < 1600, `unexpected size: ${words} words`);
  for (const needle of ['Reverie', '`act`', 'exile', 'L13', 'Council', 'Watch', 'appeal', 'suspension', '280']) {
    assert.ok(a.includes(needle), `system prompt should mention ${needle}`);
  }
  assert.doesNotMatch(a, /\bc_\d+\b/, 'no citizen ids');
  assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}|Day \d/, 'no dates or per-tick data');
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
  assert.doesNotMatch(JSON.stringify(schema), /"(minimum|maximum|minLength|maxLength|pattern)"/, 'strict-mode schema subset only');
});

test('renderObservation carries the citizen situation', () => {
  const { c, obs } = setup();
  c.needs.energy = 12;
  obs.self.needs.energy = 12;
  c.recentActions.push('work', 'work');
  const text = renderObservation(obs, c);
  for (const needle of ['Ondine', c.id, 'The Commons', `Wallet ${c.wallet}`, 'Fabricator', 'drink at the Halflight?', 'You were hired', 'CRITICAL', 'availableActions', 'j_9', 'Your last actions: work, work']) {
    assert.ok(text.includes(needle), `observation should include ${needle}`);
  }
  assert.ok(text.includes('fairly curious (0.50)'), 'traits described in words and numbers');
});

test('renderObservation falls back to obs.recent when the citizen has no memory', () => {
  const { c, obs } = setup();
  c.memory.length = 0;
  const text = renderObservation(obs, c);
  assert.ok(text.includes('You were paid 15 lumens'));
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
  const { world, c, obs, fallback, fallbackCalls } = setup();
  const before = totalMoney(world);
  const { calls, client } = fakeClient(() => toolResponse({ type: 'move', district: 'foundry_row' }));
  const brain = createLlmBrain({ fallback, client, model: 'claude-opus-5', effort: 'medium', maxTokens: 999 });
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
  assert.equal(fallbackCalls.length, 0);
  assert.equal(totalMoney(world), before, 'a brain never moves money');
});

test('default model comes from REVERIE_MODEL, else claude-opus-5', async () => {
  const { world, c, obs, fallback } = setup();
  const saved = process.env.REVERIE_MODEL;
  try {
    delete process.env.REVERIE_MODEL;
    const a = fakeClient(() => toolResponse({ type: 'idle' }));
    await createLlmBrain({ fallback, client: a.client }).decide(world, c, obs);
    assert.equal(a.calls[0].model, DEFAULT_MODEL);
    assert.equal(a.calls[0].max_tokens, DEFAULT_MAX_TOKENS);
    assert.deepEqual(a.calls[0].output_config, { effort: 'low' });

    process.env.REVERIE_MODEL = 'claude-sonnet-5';
    const b = fakeClient(() => toolResponse({ type: 'idle' }));
    await createLlmBrain({ fallback, client: b.client }).decide(world, c, obs);
    assert.equal(b.calls[0].model, 'claude-sonnet-5');

    const d = fakeClient(() => toolResponse({ type: 'idle' }));
    await createLlmBrain({ fallback, client: d.client, model: 'claude-opus-4-8' }).decide(world, c, obs);
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

async function expectFallback(responder: (req: LlmRequest) => unknown, reasonNeedle: string) {
  const { world, c, obs, fallback, fallbackCalls } = setup();
  const { client } = fakeClient(responder);
  const brain = createLlmBrain({ fallback, client, model: 'claude-opus-5' });
  const action = await brain.decide(world, c, obs);
  assert.deepEqual(action, { type: 'rest' });
  assert.equal(fallbackCalls.length, 1);
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

test('a throwing fallback still yields idle rather than an exception', async () => {
  const { world, c, obs } = setup();
  const { client } = fakeClient(() => { throw new Error('boom'); });
  const brain = createLlmBrain({ fallback: () => { throw new Error('reflex broke'); }, client, model: 'claude-opus-5' });
  assert.deepEqual(await brain.decide(world, c, obs), { type: 'idle' });
});

test('malformed responses fall back instead of throwing', async () => {
  await expectFallback(() => null, 'empty response');
  await expectFallback(() => ({ stop_reason: 'end_turn' }), 'no act tool call');
});
