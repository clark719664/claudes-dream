// End-to-end test of /api/generate against a mock Anthropic API, verifying
// the request we send to Claude and the stream we return to the Studio.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { designFromPrompt } from '../shared/designer.js';

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

async function listen(server) {
  await new Promise((r) => server.listen(0, r));
  return `http://127.0.0.1:${server.address().port}`;
}

async function readEvents(res) {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean).map((chunk) => ({
    type: /^event: (.*)$/m.exec(chunk)?.[1],
    data: JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? 'null'),
  }));
}

test('generate streams a Claude-designed spec with the expected request shape', async () => {
  const designed = designFromPrompt('forest coin hunt');
  designed.title = 'Mock Grove';
  const json = JSON.stringify(designed);
  let seen = null;
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen = { url: req.url, headers: req.headers, body: JSON.parse(body) };
      sse(res, [
        ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'A golden forest with coins along a winding path.' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: json.slice(0, 500) } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: json.slice(500) } }],
        ['content_block_stop', { type: 'content_block_stop', index: 1 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 900 } }],
        ['message_stop', { type: 'message_stop' }],
      ]);
    });
  });
  const mockUrl = await listen(mock);
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = mockUrl;
  const { createServer } = await import('../server/index.js');
  const app = createServer();
  const appUrl = await listen(app);
  try {
    const res = await fetch(`${appUrl}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'a forest coin hunt' }) });
    const events = await readEvents(res);
    const spec = events.find((e) => e.type === 'spec');
    assert.ok(spec, `no spec event in ${JSON.stringify(events.map((e) => e.type))}`);
    assert.equal(spec.data.source, 'claude');
    assert.equal(spec.data.spec.title, 'Mock Grove');
    assert.ok(events.some((e) => e.type === 'thinking' && e.data.text.includes('golden forest')));

    assert.equal(seen.url, '/v1/messages?beta=true');
    assert.match(seen.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.equal(seen.body.model, 'claude-opus-5');
    assert.equal(seen.body.fallbacks, 'default');
    assert.equal(seen.body.stream, true);
    assert.deepEqual(seen.body.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(seen.body.output_config.format.type, 'json_schema');
    assert.equal(seen.body.system[0].cache_control.type, 'ephemeral');
    assert.match(seen.body.messages[0].content, /a forest coin hunt/);
  } finally {
    app.close();
    mock.close();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
  }
});

test('generate falls back to the offline designer without credentials', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const { createServer } = await import('../server/index.js');
  const app = createServer();
  const appUrl = await listen(app);
  try {
    const res = await fetch(`${appUrl}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'haunted graveyard survival' }) });
    const events = await readEvents(res);
    const spec = events.find((e) => e.type === 'spec');
    assert.equal(spec.data.source, 'offline');
    assert.equal(spec.data.spec.rules.goal, 'survive');
    const refine = await fetch(`${appUrl}/api/generate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'make it snowy instead', spec: spec.data.spec }) });
    const refined = (await readEvents(refine)).find((e) => e.type === 'spec');
    assert.equal(refined.data.spec.environment.particles, 'snow');
    const status = await (await fetch(`${appUrl}/api/status`)).json();
    assert.equal(status.ai, 'offline');
    const bad = await fetch(`${appUrl}/api/generate`, { method: 'POST', body: '{}' });
    assert.equal(bad.status, 400);
    const traversal = await fetch(`${appUrl}/engine/../package.json`);
    assert.notEqual(traversal.status, 200);
  } finally {
    app.close();
  }
});
