import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, REMOTE_TIMEOUT_MS } from '../src/index.ts';

test('parseArgs reads the command, --key value, --key=value and bare flags', () => {
  const { command, flags } = parseArgs(['sim', '--days', '5', '--seed=9', '--quiet', '--save', 'out.json']);
  assert.equal(command, 'sim');
  assert.deepEqual(flags, { days: '5', seed: '9', quiet: true, save: 'out.json' });
});

test('parseArgs: a flag before the command, help, and a bare flag followed by another flag', () => {
  const { command, flags } = parseArgs(['--pop', '10', 'serve', '--wait-for-remote', '--port', '5000', '-h']);
  assert.equal(command, 'serve');
  assert.deepEqual(flags, { pop: '10', 'wait-for-remote': true, port: '5000', help: true });
  assert.deepEqual(parseArgs([]), { command: null, flags: {} });
  assert.throws(() => parseArgs(['sim', 'extra']), /unexpected argument/);
});

test('remote agents get a bounded deadline by default', () => {
  assert.ok(REMOTE_TIMEOUT_MS > 0 && REMOTE_TIMEOUT_MS <= 10_000);
});
