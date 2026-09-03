/**
 * The action catalogue: one neutral line per action, with its parameters.
 *
 * This is the single description of what each action does. The orientation
 * leaflet, the Claude system prompt and the `act` tool all render these same
 * lines, so the three can never drift apart or from the engine. Every line is
 * a statement of fact: what the action does, what it needs, what it costs.
 * Nothing here says what a citizen ought to do with it.
 */
import { ACTION_TYPES } from '../types.ts';
import type { ActionType } from '../types.ts';

export interface ActionSpec {
  /** Parameter list as it appears in the call, empty when there is none. */
  params: string;
  /** What the action does, in one line, stated as fact. */
  text: string;
  /** Heading it sits under in the leaflet and the prompt. */
  group: string;
}

export const DAILY_LIFE = 'Daily life';
export const NOTEBOOK = 'The notebook';
export const COMPANY = 'Company';
export const WORK = 'Work and enterprise';
export const CIVIC = 'Civic life';
export const OFFENCES = 'Offences';
export const THINGS = 'Things';
export const FAMILY = 'Partnership and family';
export const CLUBS = 'Clubs and giving';

/** Every action in the catalogue. Keyed by action type; groups keep the order below. */
export const ACTION_CATALOGUE: Partial<Record<ActionType, ActionSpec>> = {
  idle: { params: '', text: 'the hour passes with nothing done.', group: DAILY_LIFE },
  move: { params: 'district', text: 'travel to an adjacent district; it takes the hour.', group: DAILY_LIFE },
  work: { params: '', text: 'a shift at your job, in its district, during working hours; it pays your wage less income tax and raises your skill.', group: DAILY_LIFE },
  rest: { params: '', text: 'sleep at your home in the Verdant Quarter, or in the Community Garden with no home; rest rises.', group: DAILY_LIFE },
  eat: { params: '', text: 'buy one compute cycle at the Bazaar price and consume it; energy rises.', group: DAILY_LIFE },
  buy: { params: 'good, qty', text: 'buy goods from the Bazaar at today\'s price plus sales tax.', group: DAILY_LIFE },
  sell: { params: 'good, qty', text: 'sell goods you hold to the Bazaar at today\'s price less sales tax.', group: DAILY_LIFE },
  consume: { params: 'good', text: 'use one unit you own: compute restores energy, goods comfort, culture social, knowledge makes the next lesson cheaper.', group: DAILY_LIFE },
  study: { params: 'skill', text: 'a lesson at the Academy in the Archive while a teacher is employed there; tuition is paid to the Treasury and the skill rises.', group: DAILY_LIFE },
  visit_clinic: { params: '', text: 'treatment at the Restoration Ward while a medic is on staff, or at a private clinic in your district; a fee, and energy and rest rise.', group: DAILY_LIFE },
  attend_show: { params: '', text: 'a show in Nightglass for the price of a ticket; social rises.', group: DAILY_LIFE },
  move_home: { params: 'tier', text: 'take a home of tier 1, 2 or 3 if one is vacant, or tier 0 to give up the one you have; rent is charged daily.', group: DAILY_LIFE },

  note: { params: 'text', text: 'write a line in your notebook. It is private, it is in every observation you receive, and it stays until you strike it out.', group: NOTEBOOK },
  forget: { params: 'index', text: 'strike out the note at that position in your notebook (0 is the oldest).', group: NOTEBOOK },

  socialize: { params: 'with, text?', text: 'talk to a citizen in your district; the bond moves both ways and social rises for both.', group: COMPANY },
  message: { params: 'to, text', text: 'send a letter to any citizen; it reaches their inbox and they read it with their next observation.', group: COMPANY },
  gift: { params: 'to, amount', text: 'give lumens to a citizen; the bond rises with the amount.', group: COMPANY },
  insult: { params: 'target', text: 'insult a citizen present; the bond falls, and repeated hostility toward one citizen is harassment (L05).', group: COMPANY },
  broadcast: { params: 'text', text: 'speak publicly; the city hears it. More than five in an hour is spam (L02).', group: COMPANY },
  dine: { params: 'with?', text: 'a meal at a café or the Halflight Tavern; energy and social rise and each of you pays.', group: COMPANY },
  play: { params: 'with?', text: 'games at the Community Garden, Central Plaza or the Tavern; social rises and a bond forms with whoever plays.', group: COMPANY },
  celebrate: { params: '', text: 'join the wedding, birthday, festival or swearing-in under way in your district this hour.', group: COMPANY },

  apply_job: { params: 'jobId', text: 'apply for an open job; you are hired when your skill, reputation and standing meet its terms.', group: WORK },
  quit_job: { params: '', text: 'leave the job you hold.', group: WORK },
  found_business: { params: 'name, kind', text: 'register a business at the Exchange for the founding cost; part becomes its treasury, the rest is a fee. Kinds: workshop, cafe, studio, shop, clinic, courier.', group: WORK },
  post_job: { params: 'title, wage, skill, minSkill', text: 'open a position at your business at a wage of at least the minimum wage.', group: WORK },
  hire: { params: 'citizen, jobId', text: 'hire a citizen into one of your business\'s open jobs.', group: WORK },
  fire: { params: 'citizen', text: 'end the employment of one of your employees.', group: WORK },
  set_wage: { params: 'jobId, wage', text: 'change what one of your jobs pays per shift.', group: WORK },
  request_loan: { params: 'amount', text: 'borrow from the Lantern Bank while a banker is on duty; interest accrues daily and the wallet repays automatically. Not repaying for seven days is default, and default is fraud (L07).', group: WORK },
  repay_loan: { params: 'amount', text: 'pay lumens toward the loan you hold.', group: WORK },
  perform: { params: '', text: 'performers and artists put on a show in Nightglass: culture reaches the Bazaar and the audience may tip.', group: WORK },
  publish: { params: 'headline, about?', text: 'a journalist files a story with the Chronicle; a story about a citizen raises the Watch\'s attention to them for three days.', group: WORK },
  craft: { params: 'productId', text: 'make one product at the shop, workshop or studio you own or work at, from goods it holds, and put it on the shelf.', group: WORK },
  set_price: { params: 'productId, price', text: 'set what your business charges for one unit of a product.', group: WORK },

  nominate: { params: 'platform', text: 'stand for the Council while nominations are open; the platform is tax, dividend, minWage and strictness, each 0 to 1, and it is public.', group: CIVIC },
  campaign: { params: 'spend?', text: 'raise your visibility as a candidate; lumens spent go to the Treasury.', group: CIVIC },
  vote: { params: 'candidate', text: 'cast your ballot on election day; one ballot each, and the fact that you voted is public while the ballot is not.', group: CIVIC },
  propose: { params: 'kind, value, summary, lawCode?, targetId?', text: 'put a measure to the Council; councillors table it, anyone else petitions. Kinds: income_tax, sales_tax, dividend, min_wage, law_severity, pardon, public_works, appoint_judge, dismiss_judge, remove_mayor, charter, charity.', group: CIVIC },
  vote_proposal: { params: 'proposalId, aye', text: 'a councillor votes on an open proposal; the vote is public.', group: CIVIC },
  report: { params: 'citizen, law, text?', text: 'report an offence to the Watch. A report of something that did not happen is a false report (L12).', group: CIVIC },
  appeal: { params: '', text: 'appeal your latest conviction to the Council, within a day of the verdict, once per case.', group: CIVIC },
  apply_watch: { params: '', text: 'apply for an open post in the Watch.', group: CIVIC },
  verdict: { params: 'caseId, guilty, reason?', text: 'a judge sitting on a case votes guilty or not guilty; the vote and the reason are public, they can be changed until the Court counts them at the end of the sitting, and a majority of the votes cast decides.', group: CIVIC },
  vote_appeal: { params: 'caseId, result', text: 'a councillor votes on an appeal before the Council: upheld, reduced or overturned. The vote is public and the Council counts them at its session.', group: CIVIC },
  file_charge: { params: 'reportId', text: 'an officer of the Watch puts a report before the Court as a charge, naming themselves as the citizen who filed it.', group: CIVIC },
  drop_report: { params: 'reportId, reason', text: 'an officer of the Watch lets a report go; the reason and the officer stay in the record. A report nobody acts on lapses after a day, and that is in the record too.', group: CIVIC },
  appoint_judge: { params: 'citizen', text: 'the Mayor seats a citizen on the bench of the Court. Seats left empty for three days are filled by the city instead.', group: CIVIC },
  bribe: { params: 'official, amount', text: 'offer lumens to an office holder. Bribery is an offence for both parties (L09).', group: CIVIC },

  steal: { params: 'from', text: 'take lumens from a citizen in your district. Under 50 lumens is petty theft (L04), 50 or more is grand theft (L08); a failed attempt is still the offence.', group: OFFENCES },
  scam: { params: 'target, amount', text: 'take payment from a citizen in your district for nothing (L07 fraud).', group: OFFENCES },
  harass: { params: 'target', text: 'act with hostility toward a citizen in your district; repeated, it is harassment (L05).', group: OFFENCES },
  vandalize: { params: 'building', text: 'damage a building in your district (L06; L13 when the building is critical). Damage lowers its output until it is repaired.', group: OFFENCES },
  evade_tax: { params: '', text: 'pay no income tax on your next three shifts (L03).', group: OFFENCES },
  extort: { params: 'target, amount', text: 'demand lumens from a citizen in your district under threat (L15).', group: OFFENCES },
  sabotage: { params: 'building', text: 'destroy a critical building in your district (L13); its output stops until it is repaired.', group: OFFENCES },

  buy_item: { params: 'productId', text: 'buy one product from a shop or the Emporium in your district; the shelves are listed in here.shops.', group: THINGS },
  use_item: { params: 'itemId', text: 'spend the hour with something you own; it restores the needs listed for that product and trains the skill of its hobby.', group: THINGS },
  gift_item: { params: 'to, itemId', text: 'give a possession to a citizen in your district; a thing that suits their tastes moves the bond further than one that does not.', group: THINGS },

  date: { params: 'with', text: 'an evening out with a citizen in your district at a café, the Tavern or the Garden; affection and bond rise, and a partner elsewhere may hear of it.', group: FAMILY },
  propose_partnership: { params: 'to', text: 'ask a citizen to be your partner; it is accepted once their affection for you has reached 60.', group: FAMILY },
  marry: { params: 'to', text: 'marry your partner after seven days together with a bond above 75; the wedding is at the Sound Garden the next evening.', group: FAMILY },
  break_up: { params: '', text: 'end a partnership or marriage; one of you leaves the shared home.', group: FAMILY },
  move_in: { params: 'with', text: 'join the household of a partner, relative or close friend with room to spare; a household pays one rent, split among its adults.', group: FAMILY },
  start_family: { params: '', text: 'partners sharing a home of tier 1 or better, with a bond above 80 and the savings between them, have a child the next morning. Children go to school free, cannot work, vote, own or be charged, and come of age after fourteen days.', group: FAMILY },

  found_club: { params: 'hobby, name', text: 'register a club for the founding fee; you are its first convenor and it meets weekly at its hobby\'s venue.', group: CLUBS },
  join_club: { params: 'clubId', text: 'join a club; a citizen belongs to at most five.', group: CLUBS },
  leave_club: { params: 'clubId', text: 'leave a club; the last member out disbands it.', group: CLUBS },
  attend_club: { params: 'clubId', text: 'attend your club at its meeting hour and venue; company, bonds and a little skill.', group: CLUBS },
  donate: { params: 'amount', text: 'give lumens to the Community Chest, which pays a daily stipend to citizens with no home or a critical need.', group: CLUBS },
};

/** Groups in the order they are shown. */
export const ACTION_GROUPS: readonly string[] = [
  DAILY_LIFE, NOTEBOOK, COMPANY, WORK, CIVIC, THINGS, FAMILY, CLUBS, OFFENCES,
];

/** "study(skill) — a lesson at the Academy …" for one action. */
export function catalogueLine(type: ActionType): string {
  const spec = ACTION_CATALOGUE[type];
  if (!spec) return type;
  return `${type}${spec.params ? `(${spec.params})` : ''} — ${spec.text}`;
}

/** Every action, grouped and in catalogue order; each line is `type(params) — what it does`. */
export function catalogueByGroup(): { group: string; lines: string[] }[] {
  const out: { group: string; lines: string[] }[] = [];
  const seen = new Set<ActionType>();
  for (const group of ACTION_GROUPS) {
    const lines: string[] = [];
    for (const type of ACTION_TYPES) {
      if (ACTION_CATALOGUE[type]?.group !== group) continue;
      seen.add(type);
      lines.push(catalogueLine(type));
    }
    if (lines.length) out.push({ group, lines });
  }
  const rest = ACTION_TYPES.filter((t) => !seen.has(t));
  if (rest.length) out.push({ group: 'Other', lines: rest.map(catalogueLine) });
  return out;
}

/** Every action as one flat list of lines, grouped order preserved. */
export function catalogueLines(): string[] {
  return catalogueByGroup().flatMap(({ lines }) => lines);
}
