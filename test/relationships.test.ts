import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import {
  adjustBond, areFriends, areRivals, bondBetween, dailyRelationships, friendsOf, hostilityCount,
  recordHostility, rivalsOf, socialCompatibility,
} from '../src/citizens/relationships.ts';

test('bonds default to 0 and adjust mutually with clamping', () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const b = makeCitizen(w);
  assert.equal(bondBetween(w, a.id, b.id), 0);
  adjustBond(w, a.id, b.id, 15);
  assert.equal(bondBetween(w, a.id, b.id), 15);
  assert.equal(bondBetween(w, b.id, a.id), 15);
  adjustBond(w, a.id, b.id, 500);
  assert.equal(bondBetween(w, a.id, b.id), 100);
  adjustBond(w, a.id, b.id, -1000);
  assert.equal(bondBetween(w, a.id, b.id), -100);
  assert.equal(bondBetween(w, b.id, a.id), -100);
});

test('one-way adjustments only touch the actor side; self and unknown ids are ignored', () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const b = makeCitizen(w);
  adjustBond(w, a.id, b.id, 20, false);
  assert.equal(bondBetween(w, a.id, b.id), 20);
  assert.equal(bondBetween(w, b.id, a.id), 0);
  adjustBond(w, a.id, a.id, 50);
  assert.equal(bondBetween(w, a.id, a.id), 0);
  adjustBond(w, a.id, 'c_999', 50);
  assert.equal(bondBetween(w, a.id, 'c_999'), 0);
  assert.equal(a.bonds['c_999'], undefined);
});

test('a bond that returns to zero is dropped from the map', () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const b = makeCitizen(w);
  adjustBond(w, a.id, b.id, 5);
  adjustBond(w, a.id, b.id, -5);
  assert.equal(a.bonds[b.id], undefined);
  assert.equal(b.bonds[a.id], undefined);
});

test('friendsOf and rivalsOf use thresholds, sort by strength and skip the exiled and departed', () => {
  const w = makeWorld();
  const me = makeCitizen(w);
  const best = makeCitizen(w);
  const good = makeCitizen(w);
  const meh = makeCitizen(w);
  const foe = makeCitizen(w);
  const nemesis = makeCitizen(w);
  const exiledFriend = makeCitizen(w, { standing: 'exiled' });
  const goneFriend = makeCitizen(w);
  adjustBond(w, me.id, best.id, 80);
  adjustBond(w, me.id, good.id, 45);
  adjustBond(w, me.id, meh.id, 20);
  adjustBond(w, me.id, foe.id, -35);
  adjustBond(w, me.id, nemesis.id, -90);
  adjustBond(w, me.id, exiledFriend.id, 95);
  adjustBond(w, me.id, goneFriend.id, 90);
  w.order = w.order.filter((id) => id !== goneFriend.id);

  assert.deepEqual(friendsOf(w, me.id), [best.id, good.id]);
  assert.deepEqual(friendsOf(w, me.id, 10), [best.id, good.id, meh.id]);
  assert.deepEqual(rivalsOf(w, me.id), [nemesis.id, foe.id]);
  assert.deepEqual(rivalsOf(w, me.id, -50), [nemesis.id]);
  assert.deepEqual(friendsOf(w, 'c_404'), []);
  assert.deepEqual(rivalsOf(w, 'c_404'), []);
});

test('areFriends and areRivals hold in either direction', () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const b = makeCitizen(w);
  assert.equal(areFriends(w, a.id, b.id), false);
  adjustBond(w, a.id, b.id, 39);
  assert.equal(areFriends(w, a.id, b.id), false);
  adjustBond(w, a.id, b.id, 1, false);
  assert.equal(areFriends(w, a.id, b.id), true);
  assert.equal(areFriends(w, b.id, a.id), true);
  assert.equal(areFriends(w, a.id, a.id), false);
  const c = makeCitizen(w);
  adjustBond(w, c.id, a.id, -30, false);
  assert.equal(areRivals(w, a.id, c.id), true);
  assert.equal(areRivals(w, a.id, b.id), false);
});

test('socialCompatibility is 1 for identical personalities and falls with trait distance', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { personality: { curiosity: 0.2, diligence: 0.2, sociability: 0.2, honesty: 0.2, ambition: 0.2 } });
  const b = makeCitizen(w, { personality: { curiosity: 0.2, diligence: 0.2, sociability: 0.2, honesty: 0.2, ambition: 0.2 } });
  const c = makeCitizen(w, { personality: { curiosity: 1, diligence: 1, sociability: 1, honesty: 1, ambition: 1 } });
  const d = makeCitizen(w, { personality: { curiosity: 0.7, diligence: 0.2, sociability: 0.2, honesty: 0.2, ambition: 0.2 } });
  assert.equal(socialCompatibility(w, a.id, b.id), 1);
  assert.ok(Math.abs(socialCompatibility(w, a.id, c.id) - 0.2) < 1e-9);
  assert.ok(Math.abs(socialCompatibility(w, a.id, d.id) - 0.9) < 1e-9);
  assert.equal(socialCompatibility(w, a.id, a.id), 1);
  assert.equal(socialCompatibility(w, a.id, 'c_404'), 0);
});

test('recordHostility counts acts inside a 24-tick window and prunes older ones', () => {
  const w = makeWorld();
  const bully = makeCitizen(w);
  const victim = makeCitizen(w);
  w.tick = 100;
  assert.equal(recordHostility(w, bully.id, victim.id), 1);
  w.tick = 110;
  assert.equal(recordHostility(w, bully.id, victim.id), 2);
  assert.equal(hostilityCount(w, bully.id, victim.id), 2);
  w.tick = 125;
  assert.equal(recordHostility(w, bully.id, victim.id), 2); // the tick-100 act aged out
  assert.deepEqual(victim.hostilityFrom[bully.id], [110, 125]);
  assert.equal(recordHostility(w, bully.id, bully.id), 0);
  assert.equal(recordHostility(w, bully.id, 'c_404'), 0);
  assert.equal(hostilityCount(w, 'c_404', victim.id), 0);
});

test('dailyRelationships decays bonds toward zero, drops zeros and prunes stale hostility', () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const b = makeCitizen(w);
  const c = makeCitizen(w);
  const banished = makeCitizen(w, { standing: 'exiled' });
  adjustBond(w, a.id, b.id, 50);
  adjustBond(w, a.id, c.id, -1);
  adjustBond(w, a.id, banished.id, 30);
  adjustBond(w, banished.id, c.id, 10, false);
  w.tick = 10;
  recordHostility(w, c.id, a.id);
  w.tick = 40;
  recordHostility(w, b.id, a.id);
  w.tick = 48;
  dailyRelationships(w);
  assert.equal(bondBetween(w, a.id, b.id), 49);
  assert.equal(bondBetween(w, b.id, a.id), 49);
  assert.equal(a.bonds[c.id], undefined);
  assert.equal(bondBetween(w, a.id, banished.id), 29); // kept, just decaying
  assert.equal(bondBetween(w, banished.id, c.id), 10); // the exile's own record is frozen
  assert.equal(a.hostilityFrom[c.id], undefined);
  assert.deepEqual(a.hostilityFrom[b.id], [40]);
});
