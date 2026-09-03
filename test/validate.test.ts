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

test('accepts well-formed society actions', () => {
  const okCases: unknown[] = [
    { type: 'buy_item', productId: 'tin_whistle' },
    { type: 'use_item', itemId: 'i_3' },
    { type: 'gift_item', to: 'c_2', itemId: 'i_3' },
    { type: 'craft', productId: 'shard_chess' },
    { type: 'set_price', productId: 'shard_chess', price: 60 },
    { type: 'date', with: 'c_2' },
    { type: 'propose_partnership', to: 'c_2' },
    { type: 'marry', to: 'c_2' },
    { type: 'break_up' },
    { type: 'move_in', with: 'c_2' },
    { type: 'start_family' },
    { type: 'found_club', hobby: 'games', name: 'Halflight Chess Circle' },
    { type: 'join_club', clubId: 'u_1' },
    { type: 'leave_club', clubId: 'u_1' },
    { type: 'attend_club', clubId: 'u_1' },
    { type: 'dine' },
    { type: 'dine', with: 'c_2' },
    { type: 'play', with: null },
    { type: 'celebrate' },
    { type: 'donate', amount: 25 },
    { type: 'propose', kind: 'charity', value: 300, summary: 'Top up the Chest' },
  ];
  for (const input of okCases) {
    const r = validateAction(input);
    assert.equal(r.ok, true, `${JSON.stringify(input)}: ${r.ok ? '' : r.error}`);
  }
  assert.deepEqual(validateAction({ type: 'dine' }), { ok: true, action: { type: 'dine' } });
  assert.deepEqual(validateAction({ type: 'play', with: null }), { ok: true, action: { type: 'play' } });
  assert.deepEqual(validateAction({ type: 'set_price', productId: 'tin_whistle', price: 33.4 }), { ok: true, action: { type: 'set_price', productId: 'tin_whistle', price: 33 } });
});

test('rejects malformed society actions', () => {
  const bad: unknown[] = [
    { type: 'buy_item', productId: 'philosophers_stone' },
    { type: 'buy_item' },
    { type: 'use_item', itemId: 'c_3' },
    { type: 'gift_item', to: 'c_2', itemId: 'whistle' },
    { type: 'set_price', productId: 'tin_whistle', price: 0 },
    { type: 'set_price', productId: 'tin_whistle', price: 1e9 },
    { type: 'date', with: 'bob' },
    { type: 'found_club', hobby: 'knitting', name: 'Knitters' },
    { type: 'found_club', hobby: 'games', name: '' },
    { type: 'found_club', hobby: 'games', name: 'x'.repeat(41) },
    { type: 'join_club', clubId: 'k_1' },
    { type: 'dine', with: 'nobody' },
    { type: 'donate', amount: 0 },
    { type: 'donate', amount: -5 },
    { type: 'donate' },
  ];
  for (const input of bad) assert.equal(validateAction(input).ok, false, `${JSON.stringify(input)} should be rejected`);
});
