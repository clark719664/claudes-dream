/**
 * The congregation's morning (`docs/CREEDS.md`).
 *
 * One function the world's rollover calls, in the order the documents put
 * these things in:
 *
 * 1. the roll is kept honest — anybody who left the city leaves the creed;
 * 2. the tithe is collected, as a share of yesterday's net income;
 * 3. the house rent is paid, or the arrears counted;
 * 4. the seat is settled by whatever rule the founders wrote;
 * 5. sanctuaries are fed, and one the fund cannot feed ends by hunger;
 * 6. gatherings and pilgrimages are put on the calendar;
 * 7. disputes are counted toward the three days a schism needs;
 * 8. claims on the fund that are ripe are decided by the members;
 * 9. yesterday's persuasion rolls put invitations in inboxes — and nothing more;
 * 10. observance is recomputed from public acts alone.
 *
 * Nothing in this order joins anybody to anything, and nothing in it moves a
 * price except by way of the rent a congregation actually pays.
 */
import type { World } from '../types.ts';
import { resolvePotClaims } from '../finance/pot.ts';
import { allCreeds, livingMembers } from './state.ts';
import { collectTithes } from './fund.ts';
import { payHouseRent, scheduleGatherings } from './house.ts';
import { chooseOfficiant, electionDue, holdCreedElection } from './officiant.ts';
import { endCreed, removeMember } from './creeds.ts';
import { countDisputes } from './schism.ts';
import { dailyObservance } from './observance.ts';
import { dailyPersuasion } from './spread.ts';
import { decideWarrants, feedSanctuaries } from './sanctuary.ts';
import { hearRefusals } from './conscience.ts';
import { schedulePilgrimages } from './pilgrimage.ts';

/**
 * Strike off anybody the city no longer holds. A creed whose last member is
 * gone ends the way it would if they had walked out: the fund to the Chest,
 * the name and tenets to the Hall of Records.
 */
function keepTheRoll(world: World): void {
  for (const k of allCreeds(world)) {
    for (const id of [...k.roll]) {
      const c = world.citizens[id];
      const here = !!c && c.standing !== 'exiled' && world.order.includes(id);
      if (!here) removeMember(world, k, id);
    }
    if (livingMembers(world, k).length === 0) endCreed(world, k, null, 'nobody is left on its roll');
  }
}

/**
 * The Court's hour, for the two things this layer puts before a bench: a
 * refusal of conscience, and an application to open a house of meeting
 * (`REGISTRY.md` §2 puts a warrant application at tick 10–11 with the criminal
 * list). Called once a day at that hour, not at the rollover.
 */
export function holdCreedCourt(world: World): void {
  hearRefusals(world);
  decideWarrants(world);
}

/** The whole layer's day, called once at the rollover. */
export function dailyCreeds(world: World): void {
  keepTheRoll(world);

  for (const k of allCreeds(world)) {
    collectTithes(world, k);
    payHouseRent(world, k);
    if (electionDue(world, k)) holdCreedElection(world, k);
    chooseOfficiant(world, k);
    countDisputes(world, k);
  }

  feedSanctuaries(world);
  scheduleGatherings(world);
  schedulePilgrimages(world);

  // A creed's fund is a pot, so its claims are decided by the pot's own rule:
  // a vote of the members, or the officiant alone in their own hour.
  resolvePotClaims(world);

  dailyPersuasion(world);
  dailyObservance(world);
}
