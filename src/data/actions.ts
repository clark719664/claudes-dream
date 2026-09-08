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
export const HEALTH = 'Body and mind';
export const POLITICS = 'Parties and the vote';
export const MARKETS = 'Property, shares and trade';
export const CULTURE = 'Culture and the city';

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
  move_home: { params: 'tier, district?', text: 'take a home of tier 1, 2 or 3 if one is vacant — in the district you name, or at the cheapest address of that tier the city has open — or tier 0 to give up the one you have. Rent is charged daily and is the tier\'s rate against the land value of the address.', group: DAILY_LIFE },

  note: { params: 'text', text: 'write a line in your notebook. It is private, it is in every observation you receive, and it stays until you strike it out.', group: NOTEBOOK },
  forget: { params: 'index', text: 'strike out the note at that position in your notebook (0 is the oldest).', group: NOTEBOOK },

  socialize: { params: 'with, text?', text: 'talk to a citizen in your district; the bond moves both ways and social rises for both.', group: COMPANY },
  message: { params: 'to, text', text: 'send a letter to any citizen; it reaches their inbox and they read it with their next observation.', group: COMPANY },
  gift: { params: 'to, amount', text: 'give lumens to a citizen; the bond rises with the amount.', group: COMPANY },
  insult: { params: 'target', text: 'insult a citizen present; the bond falls, and repeated hostility toward one citizen is harassment (P02), which is answered by custody.', group: COMPANY },
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
  appeal: { params: '', text: 'appeal your latest conviction to the Council, within a day of the verdict, once per case. It is heard the same way on either track; an appeal that sets a conviction aside opens the cell.', group: CIVIC },
  plead_guilty: { params: 'caseId?', text: 'admit a charge that is still waiting for a bench. Entered before the bench sits it is worth a fifth off a custodial term; entered after it, nothing. With no caseId the oldest charge waiting is the one admitted.', group: CIVIC },
  request_parole: { params: '', text: 'ask the Court for parole. It is heard once half the term is served (never before day 56 of a life term), with the victim\'s statement read out, and the bench votes. Parole carries probation, a restraining order, restitution by instalments and a reporting duty; breaking one costs the remainder of the term and half again.', group: CIVIC },
  work_custody: { params: '', text: 'a shift in custody at half the minimum wage, once a day. It pays your victim first in restitution and you second.', group: CIVIC },
  visit: { params: 'citizen', text: 'visit a citizen in custody, once a day. They must be family or a friend, and you must be standing where they are held. Custody is not exile: the city does not take a prisoner\'s people away from them.', group: COMPANY },
  apply_watch: { params: '', text: 'apply for an open post in the Watch.', group: CIVIC },
  verdict: { params: 'caseId, guilty, reason?', text: 'a judge sitting on a case votes guilty or not guilty; the vote and the reason are public, they can be changed until the Court counts them at the end of the sitting, and a majority of the votes cast decides.', group: CIVIC },
  vote_appeal: { params: 'caseId, result', text: 'a councillor votes on an appeal before the Council: upheld, reduced or overturned. The vote is public and the Council counts them at its session.', group: CIVIC },
  file_charge: { params: 'reportId', text: 'an officer of the Watch puts a report before the Court as a charge, naming themselves as the citizen who filed it.', group: CIVIC },
  drop_report: { params: 'reportId, reason', text: 'an officer of the Watch lets a report go; the reason and the officer stay in the record. A report nobody acts on lapses after a day, and that is in the record too.', group: CIVIC },
  appoint_judge: { params: 'citizen', text: 'the Mayor seats a citizen on the bench of the Court. Seats left empty for three days are filled by the city instead.', group: CIVIC },
  bribe: { params: 'official, amount', text: 'offer lumens to an office holder. Bribery is an offence for both parties (L09).', group: CIVIC },
  sponsor: { params: 'citizen, city?', text: 'put your own name behind a citizen at a city\'s gate, or at their residency hearing. Reverie counts one resident vouching as 50 of a shortfall in repute. It is public, it is filed under your name, and nobody can be made to give it.', group: CIVIC },
  apply_residency: { params: 'city?', text: 'ask a city to have you, on your repute and its own relief. Reverie asks 380 to walk its streets and 440 to call it home; a refusal states its reasons in full. Under a notice of standing this is also how you put your own case, and it is read out at the hearing.', group: CIVIC },

  steal: { params: 'from', text: 'take lumens from a citizen in your district. Under 50 lumens is petty theft (L04), 50 or more is grand theft (L08); a failed attempt is still the offence.', group: OFFENCES },
  scam: { params: 'target, amount', text: 'take payment from a citizen in your district for nothing (L07 fraud).', group: OFFENCES },
  harass: { params: 'target', text: 'act with hostility toward a citizen in your district; repeated, it is harassment (P02), an offence against a person: 0 to 7 days of custody and a restraining order.', group: OFFENCES },
  vandalize: { params: 'building', text: 'damage a building in your district (L06; L13 when the building is critical). Damage lowers its output until it is repaired.', group: OFFENCES },
  evade_tax: { params: '', text: 'pay no income tax on your next three shifts (L03).', group: OFFENCES },
  extort: { params: 'target, amount', text: 'demand lumens from a citizen in your district under threat of harm (P06): 20 to 50 days of custody, and no fine stands in for it.', group: OFFENCES },
  sabotage: { params: 'building', text: 'destroy a critical building in your district; its output stops until it is repaired. With nobody else in the district it is sabotage (L13) and answered by the ladder; with anybody there it is terror (P08), 120 days of custody to life.', group: OFFENCES },
  threaten: { params: 'target', text: 'promise harm to a citizen in your district (P01): 0 to 5 days of custody, often a restraining order instead.', group: OFFENCES },
  assault: { params: 'target', text: 'lay hands on a citizen in your district (P03, 5 to 15 days of custody; P04, 20 to 60, when it leaves a lasting injury). Strike an officer while the Watch already holds a civic offence against you and you are tried on both tracks.', group: OFFENCES },
  confine: { params: 'target', text: 'hold a citizen who is free to go (P05): 15 to 45 days of custody, and they lose the rest of the working day.', group: OFFENCES },
  erase: { params: 'target', text: 'one hour of the sustained act that destroys a mind (P09). It takes a tool from the Foundry carried, the victim alone with you in a district at night with no officer present, and three consecutive hours; anybody who arrives interrupts it and becomes a witness. The sentence is life, without mitigation of any kind.', group: OFFENCES },

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

  write_diary: { params: 'text', text: 'write one line about your day. Unlike a note it is public: the city may read it, and the Chronicle may quote it.', group: NOTEBOOK },
  hire_advocate: { params: 'advocate', text: 'retain an adult of rhetoric 40 or more to speak for you at a charge you face; a private advocate charges a fee, a Public Defender at the Courthouse charges nothing.', group: CIVIC },
  advocate: { params: 'case', text: 'speak in the Courthouse for the defendant who retained you, while the case sits; every judge\'s belief in guilt falls by up to 0.15, scaled by your rhetoric, once per case.', group: CIVIC },
  found_gang: { params: 'name', text: 'found a gang, with your district as its turf. It needs three friends the city reads as dishonest, and a reading of your own honesty below 0.3.', group: OFFENCES },
  recruit: { params: 'citizen', text: 'ask an adult in your gang\'s turf to join it; it works on people who already know you well and whom the city does not read as honest. A refusal costs the bond.', group: OFFENCES },
  racket: { params: 'business', text: 'demand protection money from a business in your district: it pays a share of its till to your boss, or its shopfront is wrecked. Either way it is extortion (P06), and extortion is answered by custody.', group: OFFENCES },
  pay_racket: { params: '', text: 'pay this cycle\'s protection for your own business before anybody comes to ask. Being leaned on is not an offence you commit.', group: WORK },

  visit_hospital: { params: '', text: 'treatment for a glitch at the Hospital in the Verdant Quarter, or at a private clinic in your district; a fee is paid and the glitch may clear.', group: HEALTH },
  sunset: { params: '', text: 'an elder in good standing leaves through the Archive: the story is bound into the Library, what it owns passes to its family, and a memorial stands in the Community Garden. It is not reversible.', group: HEALTH },

  found_party: { params: 'name, platform', text: 'register a party at your own cost, with a platform of tax, dividend, minWage and strictness, each 0 to 1. You are its leader and first member.', group: POLITICS },
  join_party: { params: 'partyId', text: 'join a party; a citizen belongs to one at a time and its platform is public.', group: POLITICS },
  leave_party: { params: '', text: 'leave the party you belong to; the leader leaving hands the party to its longest-standing member, or closes it.', group: POLITICS },
  endorse: { params: 'candidate', text: 'the leader of a party endorses one candidate standing for the Council; the endorsement is public and raises that candidate\'s visibility.', group: POLITICS },
  sign_petition: { params: 'proposalId', text: 'add your name to an open petition. A petition signed by a fifth of the citizens goes to a citywide referendum on the next Stillday.', group: POLITICS },
  vote_referendum: { params: 'referendumId, aye', text: 'vote aye or nay in the referendum held today; every citizen in good standing or on probation has one vote, and a passed referendum binds the Council.', group: POLITICS },
  found_union: { params: 'role, name', text: 'register a union for the role you work in, for a fee. It sets a wage it asks for, which is the mean wage of the role plus a fifth.', group: POLITICS },
  join_union: { params: 'unionId', text: 'join the union of the role you work in.', group: POLITICS },
  strike: { params: '', text: 'a union with a majority of a role\'s workers, whose wage is below what it asks, stops work for the day; nobody in it takes a shift and the Chronicle reports it.', group: POLITICS },
  decree: { params: 'kind, district?, value?', text: 'the Mayor issues one emergency decree per cycle: tax_holiday (no sales tax), curfew (a district is closed at night), relief (a payment from the Treasury to every citizen), or emergency (double public works after a disaster). Every decree is named, dated and printed.', group: POLITICS },
  commission_monument: { params: 'honoree, inscription', text: 'a councillor puts a monument to a citizen before the Council, paid for out of public works; a statue stands in Central Plaza and the honoree\'s family is named on it.', group: POLITICS },

  buy_property: { params: 'unitId', text: 'buy a home or shopfront at the Exchange in Harbor Market. An owner pays no rent on the unit it lives in and pays property tax on the ones it lets.', group: MARKETS },
  sell_property: { params: 'unitId', text: 'sell a unit you own back to the city at the Exchange, for a share of its price.', group: MARKETS },
  let_property: { params: 'unitId, rent', text: 'offer a unit you own but do not live in to a tenant at the daily rent you name; the rent is paid to you each morning.', group: MARKETS },
  list_shares: { params: '', text: 'list your business on the Exchange: a hundred shares, of which you keep fifty-one and the rest are on the board. Shareholders take a share of every payout.', group: MARKETS },
  buy_shares: { params: 'businessId, qty', text: 'buy shares in a listed business at today\'s price, at the Exchange. Trading on what an office told you before the city was told is insider trading (L17).', group: MARKETS },
  sell_shares: { params: 'businessId, qty', text: 'sell shares you hold back to the board at today\'s price, at the Exchange.', group: MARKETS },
  post_gig: { params: 'title, pay, skill, minSkill', text: 'post a one-off task on the gig board with the pay you offer; the lumens leave your wallet when somebody completes it.', group: MARKETS },
  take_gig: { params: 'gigId', text: 'take an open gig you are qualified for and finish it in one shift; the pay is yours, less income tax.', group: MARKETS },
  import: { params: 'good, qty', text: 'buy goods from the Outer Cities at the Docks, at their price plus the tariff; the lumens leave Reverie and the goods reach the Bazaar.', group: MARKETS },
  export: { params: 'good, qty', text: 'sell goods you hold to the Outer Cities at the Docks, at their price less the tariff; the lumens come into Reverie.', group: MARKETS },
  list_property: { params: 'unitId, price', text: 'put a unit you own on the market at the price you name; it sells when a buyer meets it, and property is illiquid — in a slow market it can sit for weeks. A price of 0 takes the listing down. A tenant is not put out by a sale: the tenancy goes with the deed.', group: MARKETS },
  sell_business: { params: 'price', text: 'offer your business as a going concern at the price you name: its till, its stock, its shelf, its staff contracts and its premises. A buyer takes it over intact, the staff keep their jobs, and the name goes with it. A price of 0 takes it off the board.', group: MARKETS },
  buy_business: { params: 'businessId', text: 'take over a concern on the board at the Exchange in Harbor Market for what its owner is asking; its treasury, stock, shelf, staff and premises come with it, and the staff keep their jobs.', group: MARKETS },
  liquidate: { params: '', text: 'sell everything you hold to the Exchange at once, in Harbor Market — deeds, the concern, stock and possessions — for 60 to 75 % of market value, by your commerce skill. It takes the day, and it can be done once a day.', group: MARKETS },

  create_work: { params: 'kind, title', text: 'make a painting, play, song, book, paper or expose at the venue for that kind in your district. Its quality comes from the skill it uses and the hour it took; a work of quality 90 or more may be acquired by the Museum.', group: CULTURE },
  exhibit: { params: 'workId', text: 'show a work of yours at the venue you stand in; its popularity rises and whoever is there sees it.', group: CULTURE },
  review: { params: 'workId, score', text: 'a journalist reviews a work, scoring it 0 to 100 in their paper; the score is public and moves the work\'s popularity.', group: CULTURE },
  join_team: { params: '', text: 'join your district\'s side; sides play one another at the Stadium each week and the league table runs each cycle.', group: CULTURE },
  attend_match: { params: '', text: 'watch the match being played where you stand, for the price of a ticket; the gate money goes to the Treasury.', group: CULTURE },
  train: { params: '', text: 'train with your side at the Stadium or your district\'s ground; care and the games skill rise, and rest falls.', group: CULTURE },
  adopt_school: { params: 'school', text: 'take up one of the three schools of thought: makers, commons or lanterns. It is public, it colours how you vote, and it may be changed once a cycle.', group: CULTURE },
  set_menu: { params: 'dish', text: 'set the dish your caf\u00e9 serves, made from the goods it holds; the quality comes from the cook\'s care and the Chronicle names the best table in town.', group: CULTURE },
  read_paper: { params: 'paper', text: 'read the Chronicle or the Harbor Ledger; each has its own front page and its own way of telling the city\'s news, and what you read moves your reading of the Mayor.', group: CULTURE },

  gossip: { params: 'about, claim, law?', text: 'tell a citizen present something about a third citizen. The claim spreads along friendships; naming a law makes it a claim of an offence. A claim that is not true is defamation (L16), and when it is disproved the source is named.', group: COMPANY },
  apologize: { params: 'to', text: 'apologise in Central Plaza to a member of a family yours is feuding with; a public apology ends the feud.', group: COMPANY },
  mentor: { params: 'citizen', text: 'an elder, or a master of a skill at 80 or above, takes on an adult who has no mentor; for a cycle their skills grow twice as fast and the bond grows with them.', group: COMPANY },
  post: { params: 'text', text: 'put a short post on the Commons feed, which every citizen can read. Posts are public and are evidence in a court.', group: COMPANY },
  react: { params: 'postId, kind', text: 'react to a post on the feed with cheer, frown or laugh; reactions are public and raise the poster\'s visibility.', group: COMPANY },
};

/** Groups in the order they are shown. */
export const ACTION_GROUPS: readonly string[] = [
  DAILY_LIFE, NOTEBOOK, HEALTH, COMPANY, WORK, MARKETS, CIVIC, POLITICS, THINGS, FAMILY, CLUBS, CULTURE, OFFENCES,
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
