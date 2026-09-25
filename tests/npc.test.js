// Talking characters: tool validation, the offline brain, and /api/npc
// against a mock Anthropic API that makes Claude call a tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { NPC_TOOLS, validateAction, offlineReply, characterPrompt } from '../shared/npc.js';
import { NPC_POWERS, normalizeSpec } from '../shared/spec.js';
import { designFromPrompt } from '../shared/designer.js';

const guide = normalizeSpec({ characters: [{ name: 'Mossbeard', role: 'an old tree spirit', personality: 'Slow and kind.', greeting: 'Mmm, a visitor.', color: '#6f9a4a', position: [3, 0, 6], powers: [...NPC_POWERS] }] }).spec.characters[0];
const world = { title: 'Mock Grove', summary: 'Objective: collect 20 acorns.', objective: 'Collect 20 acorns.', hasGoal: false };

test('every power has a strict tool schema', () => {
  for (const p of NPC_POWERS) {
    const t = NPC_TOOLS[p];
    assert.ok(t, p);
    assert.equal(t.input_schema.type, 'object');
    assert.equal(t.input_schema.additionalProperties, false);
    assert.deepEqual(t.input_schema.required.sort(), Object.keys(t.input_schema.properties).sort());
  }
});

test('tool inputs are validated and clamped', () => {
  assert.deepEqual(validateAction('give_points', { amount: 500, reason: 'x' }).input, { amount: 50, reason: 'x' });
  assert.equal(validateAction('give_points', { amount: 'lots' }).ok, false);
  assert.deepEqual(validateAction('change_weather', { rain: 2, lightning: -1, aurora: 0.5, clouds: -1, fog: 0 }).input, { rain: 1, aurora: 0.5, fog: 0 });
  assert.equal(validateAction('change_time', { hour: 25 }).input.hour, 1);
  assert.equal(validateAction('grant_ability', { ability: 'fly', seconds: 10 }).ok, false);
  assert.equal(validateAction('follow_player', { follow: 'yes' }).ok, false);
  assert.equal(validateAction('explode', {}).ok, false);
});

test('the offline brain answers in character and uses powers it has', () => {
  const r = offlineReply(guide, world, 'I am lost, any hint?');
  assert.ok(r.text.length > 0);
  assert.ok(r.actions.some((a) => a.name === 'reveal_goal'));
  const storm = offlineReply(guide, world, 'Can you make it storm?');
  assert.ok(storm.actions.some((a) => a.name === 'change_weather' && a.input.rain > 0));
  const mute = offlineReply({ ...guide, powers: [] }, world, 'heal me please, give me a gift');
  assert.equal(mute.actions.length, 0);
  const idle = offlineReply(guide, world, 'nice weather today');
  assert.ok(idle.text.length > 0);
});

test('the character prompt carries persona, world and powers', () => {
  const p = characterPrompt(guide, world);
  assert.match(p, /Mossbeard/);
  assert.match(p, /collect 20 acorns/);
  assert.match(p, /reveal_goal/);
});

test('designed games come with a guide who can help', () => {
  const s = designFromPrompt('a spooky graveyard');
  assert.ok(s.characters.length >= 1);
  assert.ok(s.characters[0].powers.includes('reveal_goal'));
});

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}
const start = (id) => ['message_start', { type: 'message_start', message: { id, type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }];
const stop = (reason) => [['message_delta', { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 20 } }], ['message_stop', { type: 'message_stop' }]];

test('/api/npc streams Claude\'s reply and relays the powers it uses', async () => {
  const requests = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      if (requests.length === 1) {
        // first turn: say something, then call reveal_goal
        sse(res, [
          start('msg_1'),
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Follow the light, little one.' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'reveal_goal', input: {} } }],
          ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"target": "treasure"}' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 1 }],
          ...stop('tool_use'),
        ]);
      } else {
        sse(res, [
          start('msg_2'),
          ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
          ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'There. Do not dawdle.' } }],
          ['content_block_stop', { type: 'content_block_stop', index: 0 }],
          ...stop('end_turn'),
        ]);
      }
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'test-key'; process.env.GROQ_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  const { createServer } = await import('../server/index.js');
  const app = createServer();
  await new Promise((r) => app.listen(0, r));
  try {
    const res = await fetch(`http://127.0.0.1:${app.address().port}/api/npc`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ character: guide, world, history: [{ role: 'assistant', text: guide.greeting }], message: 'Where is the treasure?' }),
    });
    const events = (await res.text()).split('\n\n').filter(Boolean).map((c) => ({ type: /^event: (.*)$/m.exec(c)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(c)?.[1] ?? 'null') }));
    const text = events.filter((e) => e.type === 'text').map((e) => e.data.text).join('');
    assert.match(text, /Follow the light/);
    assert.match(text, /Do not dawdle/);
    const actions = events.filter((e) => e.type === 'action');
    assert.deepEqual(actions.map((a) => a.data), [{ name: 'reveal_goal', input: { target: 'treasure' } }]);
    assert.equal(events.at(-1).type, 'done');
    assert.equal(events.at(-1).data.source, 'claude');

    // request shape: persona system prompt, tools with eager streaming, alternating history
    const first = requests[0];
    assert.equal(first.model, 'claude-opus-5');
    assert.equal(first.stream, true);
    assert.match(first.system, /Mossbeard/);
    assert.deepEqual(first.tools.map((t) => t.name).sort(), [...NPC_POWERS].sort());
    assert.ok(first.tools.every((t) => t.eager_input_streaming === true && t.input_schema));
    assert.deepEqual(first.messages.map((m) => m.role), ['user']);
    assert.match(first.messages[0].content, /Where is the treasure/);
    // second request carries the tool result back to Claude
    const toolResult = requests[1].messages.at(-1).content[0];
    assert.equal(toolResult.type, 'tool_result');
    assert.equal(toolResult.tool_use_id, 'toolu_1');
    assert.match(String(toolResult.content), /beacon/);
  } finally {
    app.close();
    mock.close();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
  }
});
