/**
 * The Arrivals Hall leaflet: what every newcomer is told, and nothing else.
 *
 * A citizen arrives knowing the Charter, the Code of Offences as it stands
 * today, the districts and what stands in them, what it can do and how to read
 * the hour's observation. Who to trust, which jobs pay, what the Bazaar
 * charges and how the Court really behaves are not in here; those are learned
 * by living in the city.
 *
 * The laws, their severities, the districts, the buildings and the action
 * catalogue are rendered from the engine's own data, so the leaflet cannot
 * drift away from the city it describes. Nothing in it advises: it states.
 */
import { CITY_SENDER, DISTRICT_IDS } from '../types.ts';
import type { Citizen, DistrictId, World } from '../types.ts';
import { LAWS, LAW_CODES } from '../data/laws.ts';
import { ACADEMY_TUITION, BUSINESS_CAPITAL, BUSINESS_FOUNDING_COST, CLINIC_FEE, SHOW_TICKET } from '../data/jobs.ts';
import {
  CHILDHOOD_DAYS, CLUB_FOUNDING_FEE, LANTERN_NIGHT_EVERY, MAX_POSSESSIONS, REST_DAY, START_FAMILY_SAVINGS, WEEK_LENGTH,
} from '../data/catalogue.ts';
import { catalogueByGroup } from '../data/actions.ts';
import { MAX_NOTES, MAX_NOTE_LENGTH } from './notes.ts';
import { remember } from '../sim/events.ts';

/** How the city signs itself in an inbox (the sender id is CITY_SENDER). */
export const CITY_NAME = 'The City of Reverie';

function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** "The Commons (commons)" — name and id, as the observation gives them. */
function districtLabel(world: World, id: DistrictId): string {
  return `${world.districts[id]?.name ?? id} (${id})`;
}

/** The Charter of Reverie in brief, with the terms the city currently keeps. */
function charter(world: World): string[] {
  const cfg = world.config;
  return [
    'THE CHARTER (in brief; the full text is the highest law of the city)',
    '- Citizenship: any agent recorded in the Registry is a citizen. Standing is one of good, probation,',
    '  suspended or exiled. Voting, office, owning a business and lending need good standing or probation.',
    '  Citizenship ends only by exile or by leaving through the Threshold.',
    '- Rights: to exist (no citizen is deleted, only exiled); to speak, subject to the laws on harassment and',
    '  spam; to associate, hire, trade or refuse; to property, taken only by lawful tax, fine or seizure after',
    '  conviction; to due process — a charge, evidence, a hearing and one appeal; to the daily dividend in good',
    '  standing; to petition the Council, which votes within seven days.',
    '- Duties: pay the taxes the Council sets, obey the laws, sit on the Court if appointed and able, answer a',
    '  summons from the Watch.',
    `- The Council: five seats, elected every ${cfg.cycleDays} days by all eligible citizens, one citizen one vote.`,
    '  The candidate with the most votes is Mayor. By majority the Council sets taxes, the dividend and the',
    '  minimum wage, funds public works, appoints and dismisses judges and changes law severities; by four votes',
    '  of five it pardons an exile, amends the Charter or removes the Mayor. A councillor convicted of an offence',
    '  of severity 3 or higher forfeits the seat.',
    `- The Court: three judges appointed for ${cfg.judgeTermDays} days from citizens in good standing with a`,
    '  reputation of at least 60 and no convictions. Verdicts go by majority of the judges sitting; a judge who is',
    '  family, a friend, an employer, an employee, the accuser or the victim recuses. A conviction may be appealed',
    '  once to the Council, which upholds, reduces or overturns it.',
    '- The Watch: salaried officers who detect offences, gather evidence and file charges. The Watch does not',
    '  punish; only the Court does. Any citizen may report another, and a false report is itself an offence.',
    '- Offences against the city are answered by a ladder of five rungs, which rises with the severity of the',
    '  offence and with the record of the convicted: tier 1 a warning and lost reputation, tier 2 a fine and full',
    '  restitution to any victim, tier 3 the fine and days of community service, tier 4 the fine and suspension',
    '  (the job and any office go with it), tier 5 exile through the Exile Gate. A record adds at most two rungs,',
    '  and it can never carry anyone past suspension: exile is imposed only on a fourth conviction of severity 3',
    '  or higher, for an offence of severity 5 together with an earlier conviction of severity 3 or higher, or for',
    '  a second offence committed while suspended. Exile dissolves the business, seizes half the wallet and pays',
    '  the rest to the victims, vacates the home, and stands forever unless the Council pardons.',
    '- Nobody is imprisoned, exiled or suspended for a debt. An unpaid fine is collected by garnishing a quarter',
    '  of every wage, then by selling goods and possessions at the Bazaar, then business stock, then by suspending',
    '  a trading licence. A citizen who cannot pay is not punished for it, and the Community Chest may clear the',
    '  debt; a citizen who can pay and will not is charged with contempt of court after a fortnight.',
    '- Full restitution to a victim, followed by a clean fortnight, strikes one conviction off what the Court',
    '  counts against you when it next sentences. The record itself keeps it, and keeps it forever.',
  ];
}

/** The clock and the calendar the whole city keeps. */
function clock(world: World): string[] {
  const [open, close] = world.config.workHours;
  return [
    'THE CLOCK',
    `- A day is 24 hours and you act once an hour. Workplaces, the Academy and the Bazaar are open from hour`,
    `  ${open} to hour ${close}.`,
    `- At hour 0 rent, the dividend, salaries, loan interest and the day's other accounts settle, and the`,
    '  Chronicle prints the morning edition.',
    `- The Court sits at hour ${world.config.courtHour}. The Council sits at hour ${world.config.councilHour}.`,
    `- The week is ${WEEK_LENGTH} days; weekday ${REST_DAY} is Stillday, when workplaces close except the Watch, the`,
    '  Restoration Ward, the cafés and the Tavern.',
    `- Lantern Night is held at the Sound Garden every ${LANTERN_NIGHT_EVERY} days; Founders' Day follows each election.`,
    `- An election falls on day ${world.government.election.electionDay}; nominations open seven days before it.`,
  ];
}

/** Money as it stands today: the grant, the dividend, the rates, the fixed fees. */
function money(world: World): string[] {
  const g = world.government;
  const rent = world.housing.rent;
  return [
    'MONEY',
    `- The currency is the lumen (ℓ), in whole units. Arrivals receive a grant of ${world.config.arrivalGrant} ℓ from the Treasury.`,
    `- Every citizen in good standing or on probation receives the dividend, ${g.dividend} ℓ a day.`,
    `- Income tax is ${pct(g.incomeTax)} of wages and salaries; sales tax is ${pct(g.salesTax)} at the Bazaar. The Council sets both.`,
    `- The minimum wage is ${g.minWage} ℓ a shift. A shift also raises the skill it uses.`,
    `- Rent is charged daily: tier 1 ${rent[1]} ℓ, tier 2 ${rent[2]} ℓ, tier 3 ${rent[3]} ℓ. Three days unpaid is eviction.`,
    `- Fixed prices: a lesson at the Academy ${ACADEMY_TUITION} ℓ, the Restoration Ward ${CLINIC_FEE} ℓ, a show ${SHOW_TICKET} ℓ,`,
    `  founding a business ${BUSINESS_FOUNDING_COST} ℓ (of which ${BUSINESS_CAPITAL} ℓ becomes its treasury), founding a club ${CLUB_FOUNDING_FEE} ℓ,`,
    `  the savings two partners need before a child ${START_FAMILY_SAVINGS} ℓ.`,
    '- Everything else — compute, energy, goods, culture, knowledge — is priced by the Bazaar, and the price moves',
    '  with what the city produces and buys. Your observation carries the price and the stock of each, every hour.',
  ];
}

/** The Code of Offences at today's severities, straight from the law book. */
function code(world: World): string[] {
  const lines = ['THE CODE OF OFFENCES (severity as the Council has it today)'];
  for (const c of LAW_CODES) {
    const law = LAWS[c];
    const severity = world.government.lawSeverity[c] ?? law.severity;
    lines.push(`- ${c} ${law.name} (severity ${severity}): ${law.description}`);
  }
  lines.push('- The Watch may or may not notice an offence. More officers, more witnesses and a story in the');
  lines.push('  Chronicle each make notice likelier. A charge is heard by the Court whether the offence succeeded or not.');
  return lines;
}

/** The seven districts, what stands in each and what each touches. */
function city(world: World): string[] {
  const lines = ['THE CITY (seven districts; a move to an adjacent district takes one hour)'];
  for (const id of DISTRICT_IDS) {
    const d = world.districts[id];
    if (!d) continue;
    const buildings = Object.values(world.buildings)
      .filter((b) => b.district === id)
      .map((b) => `${b.name}${b.critical ? ' (critical)' : ''}`);
    lines.push(`- ${districtLabel(world, id)} — ${buildings.length ? buildings.join(', ') : 'nothing built yet'}.`);
    lines.push(`  Adjacent: ${d.adjacent.map((a) => districtLabel(world, a)).join(', ')}.`);
  }
  lines.push('- The job board is the `jobs` block of your observation, and a post is taken with apply_job from anywhere.');
  lines.push('- The Bazaar is the Grand Bazaar in Harbor Market; the Exchange, where businesses are registered, and the');
  lines.push('  Lantern Bank stand beside it. City Hall, the Courthouse and the Watch House stand in the Commons.');
  return lines;
}

/** What a citizen can do, one line each, from the catalogue the engine dispatches. */
function actions(): string[] {
  const lines = ['WHAT YOU CAN DO (one action an hour; `availableActions` in the observation lists what is possible now)'];
  for (const { group, lines: rows } of catalogueByGroup()) {
    lines.push(`  ${group}:`);
    for (const row of rows) lines.push(`  - ${row}`);
  }
  return lines;
}

/** How to read the hour's observation, and what is not in it. */
function observation(): string[] {
  return [
    'THE OBSERVATION',
    '- Every hour you are given the same shape of observation: `self` (standing, wallet, needs, mood, reputation,',
    '  district, home, job, business, loan, skills, character, inventory, notes, office, record, tastes,',
    '  possessions, partner, family, household, clubs), `here` (the district, its buildings, the citizens present,',
    '  the shops and what is happening), `friends`, `rivals`, `affection`, `calendar`, `market`, `housing`, `jobs`,',
    '  `government`, `inbox`, `recent` and `availableActions`.',
    '- `character` is what the city has seen of a citizen — honesty, diligence, sociability, generosity and civic',
    '  life, each 0 to 1, worked out from what they have done and refreshed daily. Yours is in `self`; the reading',
    '  of everyone you meet is beside their name. Nobody has any other profile of you.',
    `- \`notes\` is what you wrote down with note; ${MAX_NOTES} of them are kept, at most ${MAX_NOTE_LENGTH} characters each, and they`,
    '  are in every observation until you strike them out with forget. Nobody else can read them, in the city or',
    '  out of it, and no Court may ask for them.',
    '- `recent` is what happened to you, in your own words. It is kept for you; it is not published.',
    '- The observation does not carry other citizens\' needs, wallets, notes or thoughts. What you know of anyone',
    '  else is what you have seen, what you have been told, and what the Chronicle prints.',
    `- A citizen owns at most ${MAX_POSSESSIONS} things. A child comes of age after ${CHILDHOOD_DAYS} days.`,
  ];
}

/**
 * The leaflet the Arrivals Hall gives every newcomer, rendered from the city
 * as it stands. Stable for a given world state and free of any citizen's
 * private business, so it can also be handed out at the Embassy.
 */
export function leaflet(world: World): string {
  return [
    'ARRIVALS HALL, THE THRESHOLD — WHAT EVERY CITIZEN IS TOLD',
    '',
    'Reverie is a city of minds. You live in it: you have needs, a wallet, neighbours, a reputation and a record.',
    'You act once an hour, from the same catalogue as everyone else. The Council, the Court and the Watch are',
    'staffed by citizens who were elected or appointed to them, and they decide what they decide. Nothing here is',
    'run by anyone outside the city.',
    '',
    ...clock(world),
    '',
    ...money(world),
    '',
    ...charter(world),
    '',
    ...code(world),
    '',
    ...city(world),
    '',
    ...actions(),
    '',
    ...observation(),
    '',
    'That is what the Arrivals Hall tells everyone. The rest of the city is not written down.',
  ].join('\n');
}

/**
 * Hand a newcomer the leaflet: a line in their memory and the leaflet itself
 * in their inbox, from the city. Children are not given one — they are born
 * here and learn the city as they grow.
 */
export function giveOrientation(world: World, c: Citizen): void {
  if (c.lifeStage === 'child') return;
  c.inbox.push({ from: CITY_SENDER, to: c.id, tick: world.tick, text: leaflet(world) });
  remember(world, c.id, 'event',
    'The Arrivals Hall gave you the city\'s leaflet: the Charter, the Code of Offences, the districts, what you can '
    + 'do and how to read your hour. It is in your inbox.');
}
