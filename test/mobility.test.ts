/**
 * Mobility, wired (`docs/MOBILITY.md` §2, `docs/PROPERTY.md` §6).
 *
 * The engine has known how to list a deed, sell a concern, take one over and
 * sell up in a day since the mobility layer was written, and how to move a
 * citizen to an address rather than to a tier — but no citizen could reach any
 * of it: the five were in no Action union, no catalogue, no validator, no
 * dispatcher and no tool. This file is the wiring, end to end, plus the two
 * instruments of the gate that a scripted mind never reached for either
 * (`docs/CITIZENSHIP.md` §2-3): a name put behind a neighbour under notice,
 * and a citizen's own case put at its own hearing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES, SUSPENDED_ACTIONS } from '../src/types.ts';
import type { Action, ActionType, Business, Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { ACTION_CATALOGUE, catalogueLine } from '../src/data/actions.ts';
import { BUSINESS_RENT } from '../src/data/jobs.ts';
import { BANKRUPTCY_DAYS } from '../src/economy/business.ts';
import { CHILD_FORBIDDEN, availableActions, executeAction, validateAction } from '../src/actions/execute.ts';
import { ACT_TOOL } from '../src/brains/llm-tool.ts';
import {
  allUnits, askingPrice, buyProperty, letProperty, marketPrice, syncProperty, unitPrice, unitsFor,
} from '../src/markets/property.ts';
import { businessAsk, businessValue, liquidValue } from '../src/markets/selling.ts';
import { issueNotice } from '../src/standing/notices.ts';
import { reputeOf } from '../src/standing/repute.ts';
import { standingState } from '../src/standing/state.ts';
import { residencyLine, sponsorshipsFor } from '../src/standing/gates.ts';
import { buildObservation } from '../src/brains/observe.ts';
import { makeCtx } from '../src/brains/reflex-util.ts';
import { tryCivic, tryOwnStanding, tryVouch, vouchChance } from '../src/brains/reflex-civic.ts';
import { tryProperty } from '../src/brains/reflex-metro.ts';
import { OFFER_CONCERN_AFTER_DAYS, tryBusiness, tryHousing } from '../src/brains/reflex-work.ts';

/** The four ways of selling up, and the move that names an address. */
const MOBILITY: readonly ActionType[] = ['list_property', 'sell_business', 'buy_business', 'liquidate'];

function at(world: World, day: number, hour: number): void {
  world.day = day;
  world.hour = hour;
  world.tick = day * 24 + hour;
}

function trader(world: World, wallet = 20_000, name = 'Ash'): Citizen {
  return makeCitizen(world, { name, district: 'harbor_market', wallet });
}

function business(world: World, ownerId: string, treasury = 900): Business {
  const id = `b_${Object.keys(world.businesses).length + 1}`;
  const b: Business = {
    id, name: 'Quay Provisions', kind: 'shop', ownerId, treasury, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 4, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: BUSINESS_RENT.shop, daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = b;
  world.citizens[ownerId].businessId = id;
  return b;
}

function homes(world: World, buildingId: string) {
  return allUnits(world).filter((u) => u.buildingId === buildingId && u.kind === 'home');
}

// ---------------------------------------------------------------------------
// The catalogue, the shapes and the tool
// ---------------------------------------------------------------------------

test('every mobility action is in the catalogue, in ACTION_TYPES, and stated as fact', () => {
  const advises = /\b(should|advisable|wise|recommended|try to|remember to|good idea|priority|strategy)\b/i;
  for (const type of MOBILITY) {
    assert.ok(ACTION_TYPES.includes(type), `${type} is not in ACTION_TYPES`);
    const spec = ACTION_CATALOGUE[type];
    assert.ok(spec && spec.text.length > 10, `${type} has no catalogue line`);
    assert.equal(advises.exec(spec.text), null, `${type} advises: "${spec.text}"`);
    assert.ok(catalogueLine(type).startsWith(type));
  }
  assert.match(ACTION_CATALOGUE.move_home?.params ?? '', /district/, 'move_home takes an address as well as a tier');
});

test('every mobility action validates in its right shape and is refused in three wrong ones', () => {
  const good: unknown[] = [
    { type: 'list_property', unitId: 'y_3', price: 900 },
    { type: 'list_property', unitId: 'y_3', price: 0 },
    { type: 'sell_business', price: 1200 },
    { type: 'buy_business', businessId: 'b_2' },
    { type: 'liquidate' },
    { type: 'move_home', tier: 2, district: 'heights' },
    { type: 'move_home', tier: 0 },
  ];
  for (const input of good) {
    const r = validateAction(input);
    assert.equal(r.ok, true, `${JSON.stringify(input)}: ${r.ok ? '' : r.error}`);
  }
  assert.deepEqual(validateAction({ type: 'move_home', tier: 1 }), { ok: true, action: { type: 'move_home', tier: 1 } });
  assert.deepEqual(
    validateAction({ type: 'move_home', tier: 2, district: 'foundry_row' }),
    { ok: true, action: { type: 'move_home', tier: 2, district: 'foundry_row' } },
  );

  const bad: Record<string, Record<string, unknown>[]> = {
    list_property: [{}, { unitId: 'b_3', price: 90 }, { unitId: 'y_3', price: -4 }],
    sell_business: [{}, { price: 'lots' }, { price: -1 }],
    buy_business: [{}, { businessId: 'shopfronts_harbor' }, { businessId: 3 }],
    move_home: [{}, { tier: 9 }, { tier: 1, district: 'mars' }],
  };
  for (const [type, shapes] of Object.entries(bad)) {
    assert.equal(shapes.length, 3, `${type} needs three wrong shapes`);
    for (const shape of shapes) {
      assert.equal(validateAction({ type, ...shape }).ok, false, `${type} accepted ${JSON.stringify(shape)}`);
    }
  }
});

test('the act tool an LLM citizen calls lists the mobility actions and the parameters they take', () => {
  const schema = ACT_TOOL.input_schema as unknown as { properties: Record<string, { enum?: string[]; description?: string }> };
  assert.deepEqual(schema.properties.type.enum, [...ACTION_TYPES], 'the tool offers exactly the catalogue');
  for (const type of MOBILITY) {
    assert.ok(ACT_TOOL.description?.includes(type), `the tool description never mentions ${type}`);
  }
  assert.match(schema.properties.price.description ?? '', /list_property|sell_business/);
  assert.match(schema.properties.unitId.description ?? '', /list_property/);
  assert.match(schema.properties.businessId.description ?? '', /buy_business/);
  assert.match(schema.properties.district.description ?? '', /move_home/);
});

// ---------------------------------------------------------------------------
// Execution: the engine's own economics, reached at last
// ---------------------------------------------------------------------------

test('a citizen lists a deed at its own price, and a buyer meets it; money is conserved', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const buyer = trader(world, 20_000, 'Bram');
  const unit = homes(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  const worth = marketPrice(world, unit);

  const before = totalMoney(world);
  const listed = executeAction(world, owner.id, { type: 'list_property', unitId: unit.id, price: worth + 400 });
  assert.equal(listed.ok, true, listed.message);
  assert.equal(askingPrice(world, unit), worth + 400, 'the board carries the owner\'s price');
  assert.equal(totalMoney(world), before, 'a listing moves no money');

  assert.equal(unitPrice(world, unit), worth + 400);
  assert.equal(executeAction(world, buyer.id, { type: 'buy_property', unitId: unit.id }).ok, true);
  assert.equal(unit.ownerId, buyer.id);
  assert.equal(owner.wallet, 20_000 - worth + worth + 400);
  assert.equal(totalMoney(world), before, 'and a sale only moves it between two wallets');

  assert.equal(executeAction(world, owner.id, { type: 'list_property', unitId: unit.id, price: 800 }).ok, false,
    'a deed that is not yours is not yours to list');
});

test('a concern is offered whole and taken over whole; the staff keep their jobs and the money adds up', () => {
  const world = makeWorld();
  const owner = trader(world, 400);
  const buyer = trader(world, 5_000, 'Bram');
  const hand = makeCitizen(world, { name: 'Wren', district: 'harbor_market' });
  const biz = business(world, owner.id);
  biz.employees.push(hand.id);

  const before = totalMoney(world);
  const price = businessValue(world, biz);
  assert.equal(executeAction(world, owner.id, { type: 'sell_business', price }).ok, true);
  assert.equal(businessAsk(world, biz.id), price, 'the concern is on the board at the owner\'s price');
  assert.equal(totalMoney(world), before, 'offering it moves nothing');

  const bought = executeAction(world, buyer.id, { type: 'buy_business', businessId: biz.id });
  assert.equal(bought.ok, true, bought.message);
  assert.equal(biz.ownerId, buyer.id);
  assert.equal(buyer.businessId, biz.id);
  assert.equal(owner.businessId, null);
  assert.deepEqual(biz.employees, [hand.id], 'the staff keep their jobs');
  assert.equal(owner.wallet, 400 + price);
  assert.equal(totalMoney(world), before, 'and the sale is one wallet to another');
  assert.equal(businessAsk(world, biz.id), null);
});

test('the fire sale is held at the Exchange, takes the day, and can be taken once a day', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homes(world, 'terraces')[0];
  buyProperty(world, owner.id, unit.id);
  world.treasury.balance += 100_000;

  const before = totalMoney(world);
  const worth = liquidValue(world, owner);
  assert.ok(worth > 0);
  const sold = executeAction(world, owner.id, { type: 'liquidate' });
  assert.equal(sold.ok, true, sold.message);
  assert.equal(unit.ownerId, 'city', 'the deed went to the city');
  assert.equal(totalMoney(world), before, 'the Treasury paid for what it took');
  assert.ok(owner.wallet > 20_000 - marketPrice(world, unit), 'and the seller has the lumens for what it sold');
  assert.equal(executeAction(world, owner.id, { type: 'liquidate' }).ok, false, 'once a day, and it takes the day');

  const elsewhere = makeCitizen(world, { name: 'Far', district: 'foundry_row', wallet: 500 });
  assert.equal(executeAction(world, elsewhere.id, { type: 'liquidate' }).ok, false, 'and it is held at the Exchange');
});

test('what a fire sale raised counts the Bazaar\'s money for the stock as well', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world, 40);
  owner.inventory.goods = 6;
  world.treasury.balance += 100_000;

  const before = owner.wallet;
  const sold = executeAction(world, owner.id, { type: 'liquidate' });
  assert.equal(sold.ok, true, sold.message);
  const gained = owner.wallet - before;
  assert.ok(gained > 0, 'the Bazaar paid for the stock');
  const said = world.events.filter((e) => e.kind === 'property' && /sold up at the Exchange/.test(e.text)).pop();
  assert.ok(said, 'the city was told about the fire sale');
  assert.equal((said as { data?: Record<string, unknown> }).data?.raised, gained,
    'the sale said it raised nothing while the Bazaar was paying for the stock');
  assert.match(said.text, new RegExp(`for ${gained} ℓ`));
});

test('move_home takes an address in the district the citizen names', () => {
  const world = makeWorld();
  syncProperty(world);
  const c = makeCitizen(world, { name: 'Ondine', district: 'commons', wallet: 900 });
  const moved = executeAction(world, c.id, { type: 'move_home', tier: 1, district: 'foundry_row' });
  assert.equal(moved.ok, true, moved.message);
  assert.equal(world.buildings[c.homeBuildingId ?? '']?.district, 'foundry_row', 'the address is in the district asked for');
  assert.equal(c.homeTier, 1);

  // Naming nothing is still the old move, and the city finds the cheapest room.
  const other = makeCitizen(world, { name: 'Pell', district: 'commons', wallet: 900 });
  assert.equal(executeAction(world, other.id, { type: 'move_home', tier: 1 }).ok, true);
  assert.equal(other.homeTier, 1);
});

// ---------------------------------------------------------------------------
// Who may
// ---------------------------------------------------------------------------

test('a child holds nothing, so none of the four is offered to one or carried out for one', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homes(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  const child = makeCitizen(world, { name: 'Small', lifeStage: 'child', district: 'harbor_market' });

  for (const type of MOBILITY) assert.ok(CHILD_FORBIDDEN.includes(type), `${type} is not on the children's list`);
  const offered = availableActions(world, child);
  for (const type of MOBILITY) assert.ok(!offered.includes(type), `${type} was offered to a child`);
  const refused = executeAction(world, child.id, { type: 'list_property', unitId: unit.id, price: 900 });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /child/i);
});

test('a suspended citizen may not deal in property or in concerns', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world);
  const unit = homes(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  owner.standing = 'suspended';
  owner.suspendedUntilDay = world.day + 3;

  for (const type of MOBILITY) assert.ok(!SUSPENDED_ACTIONS.includes(type), `${type} survives a suspension`);
  const offered = availableActions(world, owner);
  for (const type of MOBILITY) assert.ok(!offered.includes(type), `${type} was offered to a suspended citizen`);
  const r = executeAction(world, owner.id, { type: 'list_property', unitId: unit.id, price: 900 });
  assert.equal(r.ok, false);
  assert.match(r.message, /suspended/);
});

test('the mobility actions are offered where they can actually be taken', () => {
  const world = makeWorld();
  syncProperty(world);
  const owner = trader(world, 1_000);
  const unit = homes(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, unit.id);
  world.treasury.balance += 100_000;

  const held = availableActions(world, owner);
  assert.ok(held.includes('list_property'), 'a deed can go on the board');
  assert.ok(held.includes('liquidate'), 'and the Exchange would take it');
  assert.ok(!held.includes('sell_business'), 'nobody offers a concern they do not own');

  const seller = trader(world, 400, 'Cass');
  const biz = business(world, seller.id);
  assert.ok(availableActions(world, seller).includes('sell_business'));
  assert.ok(!availableActions(world, owner).includes('buy_business'), 'nothing is on the board yet');
  executeAction(world, seller.id, { type: 'sell_business', price: 500 });
  assert.ok(availableActions(world, owner).includes('buy_business'), 'now there is a concern to take over');
  assert.ok(!availableActions(world, seller).includes('buy_business'), 'and never your own');

  const poor = trader(world, 50, 'Nim');
  assert.ok(!availableActions(world, poor).includes('buy_business'), 'not without the price of it');
  const away = makeCitizen(world, { name: 'Elsewhere', district: 'archive', wallet: 5_000 });
  assert.ok(!availableActions(world, away).includes('buy_business'), 'and not from the Archive');
  assert.equal(biz.ownerId, seller.id);
});

// ---------------------------------------------------------------------------
// The reflex mind: standing (`docs/CITIZENSHIP.md` §2-3)
// ---------------------------------------------------------------------------

function ctxFor(world: World, c: Citizen) {
  return makeCtx(world, c, buildObservation(world, c.id));
}

/** A citizen whose repute sits below the residency line, and the notice that follows. */
function underNotice(world: World, name = 'Wren'): Citizen {
  const c = makeCitizen(world, {
    name, district: 'commons', reputation: 0,
    character: { honesty: 0.1, diligence: 0.1, sociability: 0.5, generosity: 0.1, civic: 0.1 },
  });
  assert.ok(reputeOf(world, c.id) < residencyLine(world), 'the setup must actually be below the line');
  issueNotice(world, c);
  return c;
}

test('a reflex citizen puts its name behind a bonded neighbour under notice — not always, and not never', () => {
  const world = makeWorld();
  at(world, 10, 14);
  const wren = underNotice(world);

  const cohortAt = (n: number, bond: number, reputation: number, reading: number): number => {
    let vouched = 0;
    for (let i = 0; i < n; i++) {
      const c = makeCitizen(world, {
        name: `N${bond}_${reputation}_${i}`, district: 'commons', reputation,
        character: { honesty: reading, diligence: reading, sociability: 0.5, generosity: reading, civic: reading },
      });
      c.bonds[wren.id] = bond;
      wren.bonds[c.id] = bond;
      const a = tryVouch(ctxFor(world, c));
      if (a) {
        assert.deepEqual(a, { type: 'sponsor', citizen: wren.id });
        vouched++;
      }
    }
    return vouched;
  };
  const cohort = (n: number, bond: number, reputation: number): number => cohortAt(n, bond, reputation, 0.5);

  const close = cohort(40, 90, 60);
  assert.ok(close > 0, 'a close friend under notice is sometimes vouched for');
  assert.ok(close < 40, 'and a name is given, never owed');

  const passing = cohort(40, 45, 60);
  assert.ok(passing < close, `an acquaintance is vouched for less often than a friend (${passing} against ${close})`);

  const strangers = cohort(20, 5, 60);
  assert.equal(strangers, 0, 'and a stranger not at all');

  // A citizen who is themselves under the line has no name to spend.
  const nearTheLine = cohortAt(20, 90, 0, 0.1);
  assert.equal(nearTheLine, 0, 'a citizen near its own line does not spend its standing on somebody else');
});

test('the weighting of a name answers the bond, the sponsor\'s own margin and the family', () => {
  assert.equal(vouchChance(90, 200, false) > vouchChance(45, 200, false), true, 'the bond counts');
  assert.equal(vouchChance(90, 200, true) > vouchChance(90, 200, false), true, 'family counts for more');
  assert.equal(vouchChance(90, 20, false) < vouchChance(90, 200, false), true, 'a thin margin counts for less');
  assert.equal(vouchChance(90, 0, true), 0, 'and no margin at all is no name to give');
  assert.ok(vouchChance(100, 200, true) <= 0.6, 'nobody vouches as a reflex');
});

test('a sponsorship is weighed once a day, and never twice for the same neighbour', () => {
  const world = makeWorld();
  at(world, 10, 14);
  const wren = underNotice(world);
  const friend = makeCitizen(world, { name: 'Ilse', district: 'commons', reputation: 90 });
  friend.bonds[wren.id] = 100;
  friend.family.partnerId = wren.id;

  let filed: Action | null = null;
  for (let day = 10; day < 24 && !filed; day++) {
    at(world, day, 14);
    filed = tryVouch(ctxFor(world, friend));
  }
  assert.deepEqual(filed, { type: 'sponsor', citizen: wren.id }, 'a partner under notice is vouched for within a fortnight');
  const done = executeAction(world, friend.id, filed as Action);
  assert.equal(done.ok, true, done.message);
  assert.equal(sponsorshipsFor(world, wren.id).length, 1);

  at(world, 30, 14);
  assert.equal(tryVouch(ctxFor(world, friend)), null, 'a name already standing is not put twice');
});

test('a citizen under notice puts its own case, and the civic hour is where it does it', () => {
  const world = makeWorld();
  at(world, 10, 14);
  const wren = underNotice(world);
  const notice = standingState(world).notices[wren.id];

  // Three weeks of grace and a fall nothing covers: there is nothing to argue yet.
  assert.equal(tryOwnStanding(ctxFor(world, wren)), null, 'a citizen with weeks of grace does not run to the Registry');

  // The Court is days away, and speaking is the one thing a citizen can do.
  at(world, notice.graceEndsDay - 2, 14);
  const spoke = tryCivic(ctxFor(world, wren));
  assert.deepEqual(spoke, { type: 'apply_residency' }, 'the civic hour puts the citizen\'s own case');
  const r = executeAction(world, wren.id, spoke as Action);
  assert.equal(r.ok, false, 'the gate is still shut, and says why');
  assert.equal(standingState(world).notices[wren.id].applied, true, 'but the hearing will record that they spoke');
  assert.equal(tryOwnStanding(ctxFor(world, wren)), null, 'and it is said once, not every hour');
});

test('a citizen whose gate a name has re-opened applies at once, and the notice is withdrawn', () => {
  const world = makeWorld();
  at(world, 10, 14);
  const wren = makeCitizen(world, {
    name: 'Wren', district: 'commons', reputation: 0,
    character: { honesty: 0.3, diligence: 0.3, sociability: 0.5, generosity: 0.3, civic: 0.3 },
  });
  const line = residencyLine(world);
  assert.ok(reputeOf(world, wren.id) < line && reputeOf(world, wren.id) > line - 50, 'a dip a single name could cover');
  issueNotice(world, wren);
  assert.equal(tryOwnStanding(ctxFor(world, wren)), null, 'nobody has vouched yet, so the gate would still refuse');

  const friend = makeCitizen(world, { name: 'Ilse', district: 'commons', reputation: 90 });
  assert.equal(executeAction(world, friend.id, { type: 'sponsor', citizen: wren.id }).ok, true);
  const a = tryOwnStanding(ctxFor(world, wren));
  assert.deepEqual(a, { type: 'apply_residency' }, 'with a name behind them the gate might open today');
  assert.equal(executeAction(world, wren.id, a as Action).ok, true);
  assert.equal(standingState(world).notices[wren.id], undefined, 'and the notice is struck from the register');
});

// ---------------------------------------------------------------------------
// The reflex mind: building up, and moving on
// ---------------------------------------------------------------------------

test('a citizen with a wallet well past what its tier costs moves up, and names the district', () => {
  const world = makeWorld();
  at(world, 12, 18);
  syncProperty(world);
  const c = makeCitizen(world, { name: 'Ondine', district: 'commons', wallet: 40_000, homeTier: 1 });
  world.housing.occupied[1] += 1;
  c.homeBuildingId = 'lantern_lofts';
  c.personality.ambition = 0.9;

  let move: Action | null = null;
  for (let i = 0; i < 400 && !move; i++) move = tryHousing(ctxFor(world, c));
  assert.ok(move && move.type === 'move_home', 'a citizen who can carry a better address eventually takes one');
  assert.equal(move.tier, 2, 'one tier at a time');
  assert.ok(move.district, 'and it is an address, not a tier');
  const r = executeAction(world, c.id, move);
  assert.equal(r.ok, true, r.message);
  assert.equal(world.buildings[c.homeBuildingId ?? '']?.district, move.district);

  // Nothing pushes a citizen upward: one with no money to spare stays put.
  const thrifty = makeCitizen(world, { name: 'Pell', district: 'commons', wallet: 40, homeTier: 1 });
  thrifty.homeBuildingId = 'lantern_lofts';
  let pushed: Action | null = null;
  for (let i = 0; i < 400 && !pushed; i++) pushed = tryHousing(ctxFor(world, thrifty));
  assert.equal(pushed, null, 'the ladder is not forced');
});

test('a room offered to let that nobody took goes on the board at what the address is worth', () => {
  const world = makeWorld();
  at(world, 12, 18);
  syncProperty(world);
  const owner = makeCitizen(world, { name: 'Ash', district: 'harbor_market', wallet: 30_000, homeTier: 1 });
  owner.homeBuildingId = 'quayside_rooms';
  const spare = homes(world, 'lantern_lofts')[0];
  buyProperty(world, owner.id, spare.id);
  assert.equal(letProperty(world, owner.id, spare.id, Math.max(1, spare.rent)).ok, true);

  let listing: Action | null = null;
  for (let i = 0; i < 400 && !listing; i++) {
    const a = tryProperty(ctxFor(world, owner));
    if (a && a.type === 'list_property') listing = a;
    assert.notEqual(a?.type, 'let_property', 'a room already offered to let is not offered again');
  }
  assert.ok(listing && listing.type === 'list_property', 'a room nobody wants at that rent is a room to sell');
  assert.equal(listing.unitId, spare.id);
  const worth = marketPrice(world, spare);
  assert.ok(listing.price >= worth && listing.price <= Math.round(worth * 1.2),
    `${listing.price} is a price the address could actually fetch (worth ${worth})`);
  const r = executeAction(world, owner.id, listing);
  assert.equal(r.ok, true, r.message);
  assert.equal(askingPrice(world, spare), listing.price);
});

test('a citizen the Council sent down sells up: the deeds on the board first, the fire sale at the end', () => {
  const world = makeWorld();
  at(world, 40, 12);
  syncProperty(world);
  world.treasury.balance += 100_000;
  const leaving = makeCitizen(world, { name: 'Cass', district: 'harbor_market', wallet: 30_000, homeTier: 1 });
  leaving.homeBuildingId = 'quayside_rooms';
  const deed = homes(world, 'terraces')[0];
  buyProperty(world, leaving.id, deed.id);
  const state = standingState(world);
  state.hearings.push({
    id: 's_1', citizenId: leaving.id, city: 'reverie', day: world.day, hour: 12,
    repute: 300, line: residencyLine(world), spoke: true, advocateId: null, vouchers: [], votes: {},
    outcome: 'ended', extendedDays: 0, leaveByDay: world.day + 14, reasons: [],
  });

  const first = tryProperty(ctxFor(world, leaving));
  assert.ok(first && first.type === 'list_property', 'patience is worth money: the board first');
  assert.equal(first.price, marketPrice(world, deed), 'and at what the address is worth, to sell it');
  assert.equal(executeAction(world, leaving.id, first).ok, true);
  assert.equal(tryProperty(ctxFor(world, leaving)), null, 'nothing left to list, and days still in hand');

  // The days run out and the deed has not sold: the Exchange takes the lot.
  at(world, world.day + 11, 12);
  const before = totalMoney(world);
  const last = tryProperty(ctxFor(world, leaving));
  assert.deepEqual(last, { type: 'liquidate' }, 'a citizen with three days left bolts, and pays for it');
  const sold = executeAction(world, leaving.id, last as Action);
  assert.equal(sold.ok, true, sold.message);
  assert.equal(deed.ownerId, 'city');
  assert.equal(totalMoney(world), before, 'and the fire sale conserves every lumen it moves');
});

test('a failing concern is offered whole, and a citizen with the price of one takes it over', () => {
  const world = makeWorld();
  at(world, 20, 12);
  const owner = makeCitizen(world, { name: 'Cass', district: 'harbor_market', wallet: 300, homeTier: 1 });
  const biz = business(world, owner.id, 400);
  biz.daysNegative = OFFER_CONCERN_AFTER_DAYS;

  let offer: Action | null = null;
  for (let i = 0; i < 400 && !offer; i++) offer = tryBusiness(ctxFor(world, owner));
  assert.ok(offer && offer.type === 'sell_business', 'a concern a day from the doors shutting is offered rather than lost');
  assert.ok(OFFER_CONCERN_AFTER_DAYS < BANKRUPTCY_DAYS, 'and it is offered while there is still a business to offer');
  assert.equal(offer.price, businessValue(world, biz), 'at what the Exchange values it at');
  assert.equal(executeAction(world, owner.id, offer).ok, true);

  const buyer = makeCitizen(world, { name: 'Ilse', district: 'harbor_market', wallet: 20_000, homeTier: 1 });
  buyer.personality.ambition = 0.9;
  let bought: Action | null = null;
  for (let i = 0; i < 400 && !bought; i++) {
    const a = tryBusiness(ctxFor(world, buyer));
    if (a && a.type === 'buy_business') bought = a;
  }
  assert.ok(bought, 'and somebody with the price of it in their pocket takes it on');
  const before = totalMoney(world);
  const r = executeAction(world, buyer.id, bought as Action);
  assert.equal(r.ok, true, r.message);
  assert.equal(biz.ownerId, buyer.id);
  assert.equal(totalMoney(world), before);
  assert.equal(unitsFor(world, buyer.id).length, 0, 'a concern is not a deed');
});
