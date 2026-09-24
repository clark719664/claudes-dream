// Art director and game master: offline behaviour and the requests sent to Claude.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { planNextLevel, gradeFromStats, skillFromTelemetry } from '../shared/gamemaster.js';
import { imageBlocks, describeTelemetry } from '../server/director.js';
import { designFromPrompt } from '../shared/designer.js';

const base = designFromPrompt('a haunted graveyard, avoid the ghosts and collect candles');
const hazardCount = (s) => {
  const ids = new Set(s.prefabs.filter((p) => p.behaviors.some((b) => b.type === 'hazard')).map((p) => p.id));
  return s.spawns.filter((sp) => ids.has(sp.prefab)).reduce((n, sp) => n + sp.count, 0);
};

test('skill estimate reads the telemetry', () => {
  const easy = skillFromTelemetry({ outcome: 'won', lives: 3, maxLives: 3, time: 40, hurts: {} });
  const hard = skillFromTelemetry({ outcome: 'lost', lives: 0, maxLives: 3, time: 200, hurts: { ghost: 4 }, falls: 2 });
  assert.ok(easy > 0.65 && hard < 0.35);
});

test('the offline game master continues the story and adapts difficulty', () => {
  const won = planNextLevel(base, { outcome: 'won', lives: 3, maxLives: 3, time: 40, hurts: {}, level: 1 });
  const lost = planNextLevel(base, { outcome: 'lost', lives: 0, maxLives: 3, time: 150, hurts: { ghost: 4 }, level: 1 });
  for (const r of [won, lost]) {
    assert.notEqual(r.spec.seed, base.seed);
    assert.match(r.spec.title, / II$/);
    assert.ok(r.notes.length);
  }
  if (hazardCount(base) > 0) assert.ok(hazardCount(won.spec) > hazardCount(lost.spec));
  assert.ok(lost.spec.player.lives >= base.player.lives);
  const third = planNextLevel(won.spec, { outcome: 'won', level: 2 });
  assert.match(third.spec.title, / III$/);
});

test('offline art direction nudges exposure and colour from screenshot stats', () => {
  const dark = gradeFromStats(base, { luma: 0.1, saturation: 0.1, contrast: 0.1 });
  assert.ok(dark.spec.post.exposure > base.post.exposure);
  assert.ok(dark.spec.post.saturation > base.post.saturation);
  const fine = gradeFromStats(base, { luma: 0.4, saturation: 0.35, contrast: 0.25 });
  assert.deepEqual(fine.spec.post, base.post);
});

test('screenshots become image blocks; junk is ignored', () => {
  const blocks = imageBlocks([
    { label: 'wide', data: 'data:image/jpeg;base64,AAAA' },
    { label: 'bad', data: 'javascript:alert(1)' },
    { label: 'png', data: 'data:image/png;base64,BBBB' },
  ]);
  assert.equal(blocks.filter((b) => b.type === 'image').length, 2);
  assert.deepEqual(blocks[1].source, { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' });
  assert.match(describeTelemetry({ outcome: 'lost', hurts: { ghost: 3 }, level: 2 }), /LOST.*level 2[\s\S]*3× ghost/);
});

test('/api/art-director sends the screenshots to Claude and /api/next-level the telemetry', async () => {
  const designed = designFromPrompt('forest coin hunt');
  const json = JSON.stringify({ ...designed, title: 'Polished Grove' });
  const seen = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ev = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
      ev('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } });
      ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: json } });
      ev('content_block_stop', { type: 'content_block_stop', index: 0 });
      ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } });
      ev('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  await new Promise((r) => mock.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'test-key';
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  const { createServer } = await import('../server/index.js');
  const app = createServer();
  await new Promise((r) => app.listen(0, r));
  const post = async (path, body) => {
    const res = await fetch(`http://127.0.0.1:${app.address().port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await res.text()).split('\n\n').filter(Boolean).map((c) => ({ type: /^event: (.*)$/m.exec(c)?.[1], data: JSON.parse(/^data: (.*)$/m.exec(c)?.[1] ?? 'null') }));
  };
  try {
    const art = await post('/api/art-director', { spec: designed, intent: 'a golden forest', images: [{ label: 'wide', data: 'data:image/jpeg;base64,AAAA' }] });
    const spec = art.find((e) => e.type === 'spec');
    assert.equal(spec.data.source, 'claude');
    assert.equal(spec.data.spec.title, 'Polished Grove');
    const content = seen[0].messages[0].content;
    assert.ok(Array.isArray(content));
    assert.ok(content.some((b) => b.type === 'image' && b.source.data === 'AAAA'));
    assert.ok(content.some((b) => b.type === 'text' && /art director/.test(b.text)));
    assert.equal(seen[0].output_config.format.type, 'json_schema');

    const next = await post('/api/next-level', { spec: designed, telemetry: { outcome: 'won', lives: 3, maxLives: 3, level: 1, hurts: { slime: 1 } } });
    assert.ok(next.find((e) => e.type === 'spec'));
    assert.match(seen[1].messages[0].content, /game master/);
    assert.match(seen[1].messages[0].content, /WON/);
    assert.match(seen[1].messages[0].content, /1× slime/);
  } finally {
    app.close();
    mock.close();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
  }
});
