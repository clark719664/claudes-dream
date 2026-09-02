import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';

test('helpers build a world and citizen', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 100 });
  assert.equal(w.citizens[c.id].wallet, 100);
  assert.equal(totalMoney(w), w.treasury.balance + 100);
});
