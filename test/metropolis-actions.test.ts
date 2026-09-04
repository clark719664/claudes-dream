/**
 * The metropolis actions, end to end: every one of them is in the catalogue,
 * validates in its right shape and fails in three wrong ones, is dispatched by
 * executeAction rather than falling through to "unknown action", is refused
 * for a child when the layer forbids it, and is refused for a citizen in the
 * cells unless it is one of the six a term leaves alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { ACTION_TYPES, JAILED_ACTIONS, METROPOLIS_ACTIONS, SUSPENDED_ACTIONS } from '../src/types.ts';
import type { Action, ActionType, World } from '../src/types.ts';
import { ACTION_CATALOGUE, catalogueByGroup } from '../src/data/actions.ts';
import { CHILD_FORBIDDEN, availableActions, executeAction, validateAction } from '../src/actions/execute.ts';
import { dispatchMetropolis } from '../src/actions/execute-metro.ts';

/** One valid shape per metropolis action, for the validator and the dispatcher. */
const SHAPES: Record<string, Record<string, unknown>> = {
  write_diary: { text: 'A long day at the forge.' },
  visit_hospital: {},
  hire_advocate: { advocate: 'c_2' },
  advocate: { case: 'k_1' },
  found_gang: { name: 'The Quiet Hands' },
  recruit: { citizen: 'c_2' },
  racket: { business: 'b_1' },
  pay_racket: {},
  found_party: { name: 'Open Front', platform: { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: 0.5 } },
  join_party: { partyId: 'f_1' },
  leave_party: {},
  endorse: { candidate: 'c_2' },
  sign_petition: { proposalId: 'p_1' },
  vote_referendum: { referendumId: 'd_1', aye: true },
  found_union: { role: 'fabricator', name: 'Fabricators of Reverie' },
  join_union: { unionId: 'n_1' },
  strike: {},
  decree: { kind: 'relief', value: 20 },
  buy_property: { unitId: 'y_1' },
  sell_property: { unitId: 'y_1' },
  let_property: { unitId: 'y_1', rent: 12 },
  list_shares: {},
  buy_shares: { businessId: 'b_1', qty: 3 },
  sell_shares: { businessId: 'b_1', qty: 3 },
  post_gig: { title: 'A crate carried to the Harbor', pay: 15, skill: null, minSkill: 0 },
  take_gig: { gigId: 'q_1' },
  import: { good: 'goods', qty: 4 },
  export: { good: 'compute', qty: 2 },
  create_work: { kind: 'song', title: 'Lantern Hour' },
  exhibit: { workId: 'w_1' },
  review: { workId: 'w_1', score: 70 },
  join_team: {},
  attend_match: {},
  train: {},
  adopt_school: { school: 'makers' },
  set_menu: { dish: 'lantern_broth' },
  commission_monument: { honoree: 'c_2', inscription: 'Who the city was better for.' },
  read_paper: { paper: 'ledger' },
  sunset: {},
  gossip: { about: 'c_2', claim: 'has not been seen at work in days' },
  apologize: { to: 'c_2' },
  mentor: { citizen: 'c_2' },
  post: { text: 'Quiet evening in the Plaza.' },
  react: { postId: 'o_1', kind: 'cheer' },
};

/** Three shapes that must be refused for each action that takes parameters. */
const BAD_SHAPES: Record<string, Record<string, unknown>[]> = {
  hire_advocate: [{}, { advocate: 'b_2' }, { advocate: 12 }],
  advocate: [{}, { case: 'c_1' }, { case: 'k_x' }],
  found_gang: [{}, { name: '' }, { name: 'x'.repeat(41) }],
  recruit: [{}, { citizen: 'nobody' }, { citizen: 3 }],
  racket: [{}, { business: 'compute_forge' }, { business: 'b_' }],
  found_party: [{}, { name: 'A', platform: { tax: 2, dividend: 0.5, minWage: 0.5, strictness: 0.5 } }, { name: 'A' }],
  join_party: [{}, { partyId: 'p_1' }, { partyId: 'f_' }],
  endorse: [{}, { candidate: 'f_1' }, { candidate: null }],
  sign_petition: [{}, { proposalId: 'f_1' }, { proposalId: 3 }],
  vote_referendum: [{}, { referendumId: 'p_1', aye: true }, { referendumId: 'd_x', aye: true }],
  found_union: [{}, { role: 'astronaut', name: 'A' }, { role: 'fabricator', name: '' }],
  join_union: [{}, { unionId: 'u_1' }, { unionId: 12 }],
  decree: [{}, { kind: 'party' }, { kind: 'relief', value: -5 }],
  buy_property: [{}, { unitId: 'b_1' }, { unitId: 'y_' }],
  sell_property: [{}, { unitId: 'q_1' }, { unitId: null }],
  let_property: [{}, { unitId: 'y_1' }, { unitId: 'y_1', rent: 0 }],
  buy_shares: [{}, { businessId: 'b_1' }, { businessId: 'b_1', qty: 0 }],
  sell_shares: [{}, { businessId: 'compute_forge', qty: 1 }, { businessId: 'b_1', qty: 5000 }],
  post_gig: [{}, { title: 'A', pay: 0, minSkill: 0 }, { title: 'A', pay: 20, minSkill: 400 }],
  take_gig: [{}, { gigId: 'y_1' }, { gigId: 'q_' }],
  import: [{}, { good: 'lumens', qty: 1 }, { good: 'goods', qty: 0 }],
  export: [{}, { good: 'goods' }, { good: 'goods', qty: 100000 }],
  create_work: [{}, { kind: 'statue', title: 'A' }, { kind: 'song' }],
  exhibit: [{}, { workId: 'c_1' }, { workId: 'w_' }],
  review: [{}, { workId: 'w_1' }, { workId: 'w_1', score: 900 }],
  adopt_school: [{}, { school: 'engineers' }, { school: null }],
  set_menu: [{}, { dish: 'gruel' }, { dish: 12 }],
  commission_monument: [{}, { honoree: 'c_2' }, { honoree: 'b_1', inscription: 'x' }],
  read_paper: [{}, { paper: 'gazette' }, { paper: 4 }],
  gossip: [{}, { about: 'c_2' }, { about: 'c_2', claim: 'x'.repeat(141) }],
  apologize: [{}, { to: 'y_1' }, { to: null }],
  mentor: [{}, { citizen: 'w_1' }, { citizen: 0 }],
  post: [{}, { text: '' }, { text: 'x'.repeat(281) }],
  react: [{}, { postId: 'o_1' }, { postId: 'o_1', kind: 'shrug' }],
  write_diary: [{}, { text: '' }, { text: 'x'.repeat(281) }],
};

function actionFor(type: ActionType): Action {
  return { type, ...(SHAPES[type] ?? {}) } as Action;
}

function city(): World {
  const w = makeWorld();
  const a = makeCitizen(w, { name: 'Ondine', district: 'commons', wallet: 400, homeTier: 1 });
  makeCitizen(w, { name: 'Bram', district: 'commons', wallet: 200, homeTier: 1 });
  return Object.assign(w, { firstId: a.id }) as World;
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

test('every metropolis action is in ACTION_TYPES, the catalogue and a group', () => {
  const types = new Set(ACTION_TYPES);
  const grouped = new Set(catalogueByGroup().flatMap(({ lines }) => lines.map((l) => l.split(/[( —]/)[0])));
  for (const type of METROPOLIS_ACTIONS) {
    assert.ok(types.has(type), `${type} is not in ACTION_TYPES`);
    assert.ok(ACTION_CATALOGUE[type], `${type} has no catalogue line`);
    assert.ok(grouped.has(type), `${type} is in no catalogue group`);
    assert.ok(SHAPES[type], `${type} has no shape in this test`);
  }
  assert.equal(new Set(METROPOLIS_ACTIONS).size, METROPOLIS_ACTIONS.length, 'no duplicates');
  assert.equal(new Set(ACTION_TYPES).size, ACTION_TYPES.length, 'no duplicates in the whole list');
});

test('the catalogue states facts and never advises', () => {
  const forbidden = /\b(should|advisable|wise|recommended|try to|remember to|good idea|priority|strategy)\b/i;
  for (const type of METROPOLIS_ACTIONS) {
    const spec = ACTION_CATALOGUE[type];
    assert.ok(spec && spec.text.length > 10, `${type} has no description`);
    assert.equal(forbidden.exec(spec.text), null, `${type} advises: "${spec.text}"`);
  }
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('every metropolis action validates in its right shape', () => {
  for (const type of METROPOLIS_ACTIONS) {
    const r = validateAction({ type, ...SHAPES[type] });
    assert.equal(r.ok, true, `${type} was refused: ${r.ok ? '' : r.error}`);
    if (r.ok) assert.equal(r.action.type, type);
  }
});

test('every metropolis action with parameters is refused in three wrong shapes', () => {
  for (const [type, shapes] of Object.entries(BAD_SHAPES)) {
    assert.equal(shapes.length, 3, `${type} needs three wrong shapes`);
    for (const bad of shapes) {
      const r = validateAction({ type, ...bad });
      assert.equal(r.ok, false, `${type} accepted ${JSON.stringify(bad)}`);
    }
  }
  assert.equal(validateAction({ type: 'not_a_thing' }).ok, false);
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

test('executeAction dispatches every metropolis action instead of falling through', () => {
  const w = city();
  const c = w.citizens[w.order[0]];
  const before = totalMoney(w);
  for (const type of METROPOLIS_ACTIONS) {
    const r = executeAction(w, c.id, actionFor(type));
    assert.ok(typeof r.message === 'string' && r.message.length > 0, `${type} answered with nothing`);
    assert.ok(!/^Unknown action/.test(r.message), `${type} fell through to the default case`);
    assert.ok(!/has no .* to offer/.test(r.message), `${type} is not in the dispatch table`);
  }
  assert.equal(totalMoney(w), before, 'a refused action moves no money');
});

test('dispatchMetropolis owns the metropolis actions and nothing else', () => {
  const w = city();
  const c = w.citizens[w.order[0]];
  for (const type of METROPOLIS_ACTIONS) {
    assert.notEqual(dispatchMetropolis(w, c, actionFor(type)), null, `${type} is not dispatched`);
  }
  for (const type of ['idle', 'move', 'work', 'socialize', 'dine'] as ActionType[]) {
    assert.equal(dispatchMetropolis(w, c, { type } as Action), null, `${type} is not the metropolis table's`);
  }
});

// ---------------------------------------------------------------------------
// Children and the cells
// ---------------------------------------------------------------------------

test('a child is refused every metropolis action the layer forbids it, and allowed the seven it does not', () => {
  const w = city();
  const child = makeCitizen(w, { name: 'Wren', district: 'commons', lifeStage: 'child', wallet: 60 });
  const allowed: ActionType[] = ['write_diary', 'read_paper', 'visit_hospital', 'post', 'react', 'apologize', 'attend_match'];
  for (const type of METROPOLIS_ACTIONS) {
    const forbidden = CHILD_FORBIDDEN.includes(type);
    assert.equal(forbidden, !allowed.includes(type), `${type} is on the wrong side of childhood`);
    const r = executeAction(w, child.id, actionFor(type));
    if (forbidden) assert.match(r.message, /You are a child/, `${type} was not refused for a child`);
    else assert.doesNotMatch(r.message, /You are a child/, `${type} should reach a child's hands`);
  }
  const offered = new Set(availableActions(w, child));
  for (const type of CHILD_FORBIDDEN) assert.ok(!offered.has(type), `${type} was offered to a child`);
});

test('a citizen in the cells may take only the six actions a term leaves alone', () => {
  const w = city();
  const c = w.citizens[w.order[0]];
  c.jailedUntilDay = w.day + 3;
  c.notes.push('The cells are cold.');
  const offered = availableActions(w, c);
  for (const type of offered) assert.ok(JAILED_ACTIONS.includes(type), `${type} was offered from a cell`);
  for (const type of METROPOLIS_ACTIONS) {
    if (JAILED_ACTIONS.includes(type)) continue;
    const r = executeAction(w, c.id, actionFor(type));
    assert.equal(r.ok, false, `${type} was carried out from a cell`);
  }
  assert.equal(executeAction(w, c.id, { type: 'write_diary', text: 'Day three.' }).ok, true, 'the diary is never taken away');
});

test('a suspended citizen keeps its own words, its health and the paper', () => {
  const w = city();
  const c = w.citizens[w.order[0]];
  c.standing = 'suspended';
  c.suspendedUntilDay = w.day + 5;
  for (const type of ['write_diary', 'read_paper', 'visit_hospital', 'post', 'react', 'apologize', 'attend_match'] as ActionType[]) {
    assert.ok(SUSPENDED_ACTIONS.includes(type), `${type} should survive a suspension`);
    const r = executeAction(w, c.id, actionFor(type));
    assert.doesNotMatch(r.message, /while suspended/, `${type} was refused for the wrong reason`);
  }
  for (const type of ['buy_property', 'strike', 'create_work', 'gossip'] as ActionType[]) {
    const r = executeAction(w, c.id, actionFor(type));
    assert.match(r.message, /while suspended/, `${type} should be out of reach while suspended`);
  }
});

test('an unknown citizen, an exile and a departed citizen are refused without throwing', () => {
  const w = city();
  const c = w.citizens[w.order[0]];
  assert.equal(executeAction(w, 'c_999', { type: 'post', text: 'hello' }).ok, false);
  c.standing = 'exiled';
  assert.equal(executeAction(w, c.id, { type: 'post', text: 'hello' }).ok, false);
  assert.deepEqual(availableActions(w, c), []);
});
