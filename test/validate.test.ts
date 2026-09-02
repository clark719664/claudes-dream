import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAction } from '../src/actions/validate.ts';

test('accepts well-formed actions', () => {
  assert.deepEqual(validateAction({ type: 'idle' }), { ok: true, action: { type: 'idle' } });
  assert.deepEqual(validateAction({ type: 'buy', good: 'compute', qty: 2.4 }), { ok: true, action: { type: 'buy', good: 'compute', qty: 2 } });
  const r = validateAction({ type: 'nominate', platform: { tax: 0.2, dividend: 0.5, minWage: 0.3, strictness: 0.9 } });
  assert.equal(r.ok, true);
});

test('rejects malformed actions', () => {
  assert.equal(validateAction(null).ok, false);
  assert.equal(validateAction({ type: 'fly' }).ok, false);
  assert.equal(validateAction({ type: 'move', district: 'mars' }).ok, false);
  assert.equal(validateAction({ type: 'gift', to: 'c_1', amount: -5 }).ok, false);
  assert.equal(validateAction({ type: 'message', to: 'bob', text: 'hi' }).ok, false);
  assert.equal(validateAction({ type: 'broadcast', text: 'x'.repeat(300) }).ok, false);
});
