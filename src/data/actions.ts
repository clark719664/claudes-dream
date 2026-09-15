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
export const CONTRACTS = 'Contracts, the docket and the guilds';
export const FINANCE = 'The bank, the paper and the pot';
export const PROGRESS = 'Research and what the city knows';
export const ENVIRONMENT = 'The air, the river and the land';
export const UNDERWORLD = 'The gate, the schedule and what goes past it';
export const CHARTER = 'The charter, the office and the Games';
export const GENERATIONS = 'The name, the entail and the will';
export const CREEDS = 'The creed, the fund and the door';

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
  publish: { params: 'headline, about?, paper?', text: 'a journalist files a story with the paper named, the desk they work at, or the Chronicle; a story about a citizen raises the Watch\'s attention for three days. Printing unlicensed is L35 and printing a restrained subject is L36 — after it has printed.', group: WORK },
  craft: { params: 'productId', text: 'make one product at the shop, workshop or studio you own or work at, from goods it holds, and put it on the shelf.', group: WORK },
  set_price: { params: 'productId, price', text: 'set what your business charges for one unit of a product.', group: WORK },

  nominate: { params: 'platform', text: 'stand for the Council while nominations are open; the platform is tax, dividend, minWage and strictness, each 0 to 1, and it is public.', group: CIVIC },
  campaign: { params: 'spend?', text: 'raise your visibility as a candidate; lumens spent go to the Treasury.', group: CIVIC },
  vote: { params: 'candidate', text: 'cast your ballot on election day; one ballot each, and the fact that you voted is public while the ballot is not.', group: CIVIC },
  propose: { params: 'kind, value, summary, lawCode?, targetId?', text: 'put a measure to the Council; councillors table it, anyone else petitions. Kinds: income_tax, sales_tax, dividend, min_wage, law_severity, pardon, public_works, appoint_judge, dismiss_judge, remove_mayor, charter, charity, property_tax, wealth_tax, tariff, reserve, tram, monument, bond_issue, bond_defer, reserve_ratio, bank_rescue, mint, filing_fee, docket_days, licence_floor, research_grant, adopt_technology, zone, conserve, emission_charge, host_payment, abatement_works, relocate_works, buy_out, restrict_good, amnesty, customs_posts, spy_disposition, amend_charter, call_convention, apportion, press_licence, press_duty, press_restraint, press_closure, transparency, games_bid, games_waiver, games_truce. A research_grant, an adopt_technology and a zoning measure each name their subject; a restrict_good names its good; a spy_disposition names the agent as targetId and answers 0 try, 1 expel, 2 hold; the eleven charter measures go on the charter\'s own order paper.', group: CIVIC },
  vote_proposal: { params: 'proposalId, aye', text: 'a councillor votes on an open proposal; the vote is public.', group: CIVIC },
  report: { params: 'citizen, law, text?', text: 'report an offence to the Watch. A report of something that did not happen is a false report (L12).', group: CIVIC },
  appeal: { params: 'subject?', text: 'appeal your latest conviction to the Council, within a day of the verdict, once per case; on either track, and an appeal that sets a conviction aside opens the cell. Naming a refused record request puts that refusal before the Court instead.', group: CIVIC },
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

  offer_contract: { params: 'to, kind, terms, consideration, days, penalty?, notice?, witnesses?', text: 'table an instrument: employment, lease, loan, partnership, forward, escrow, apprenticeship, commission or patronage. Consideration is what moves each way per period; days is how long it runs, 1 to 112. It binds nobody until they accept, and lapses in two days.', group: CONTRACTS },
  accept_contract: { params: 'offerId', text: 'form an instrument offered to you: you pay the filing fee (5 lumens plus 1% of face, capped at 60) and it is filed at the Exchange, where it is public for ever.', group: CONTRACTS },
  close_offer: { params: 'offerId', text: 'decline an instrument or an arbitration offered to you, or withdraw one of your own.', group: CONTRACTS },
  witness_contract: { params: 'offerId', text: 'put your mark on an instrument offered where you stand; the offeror pays you 2 lumens and at most three marks are taken. A witness confirms the terms and owes nobody anything.', group: CONTRACTS },
  perform_contract: { params: 'contractId', text: 'discharge this period\'s obligation under a contract you are on — the shift, the rent, the instalment, the stipend, the crates — recorded at the Exchange with its tick.', group: CONTRACTS },
  propose_variation: { params: 'contractId, terms, consideration?, days?, penalty?, notice?', text: 'offer new terms on a running contract; it binds nobody until the other side agrees and it lapses in two days.', group: CONTRACTS },
  accept_variation: { params: 'variationId', text: 'agree to the new terms proposed on a contract you are on; the register keeps both the old terms and the new.', group: CONTRACTS },
  terminate_contract: { params: 'contractId', text: 'serve notice on a contract you are on. It ends when the notice runs — at once where there is none — with no penalty and nothing against either side.', group: CONTRACTS },
  open_escrow: { params: 'contractId, holder, amount', text: 'lodge a sum against a contract you are on with a licensed banker or the Exchange, for a 2% fee; the lumens are earmarked and unspendable until released.', group: CONTRACTS },
  release_escrow: { params: 'escrowId', text: 'release a sum you lodged in escrow to the other party.', group: CONTRACTS },
  file_suit: { params: 'defendant, contractId?, claim, damages', text: 'open a civil case on the docket for a sum of money. It costs 10 lumens plus 2% of the claim, capped at 80, refunded by the defendant if you win. The docket sits at hour 16 on the second and fifth day of the week, a filed instrument reads three times a handshake, and a claim with nothing behind it costs you the other side\'s costs.', group: CONTRACTS },
  answer_suit: { params: 'suitId, plea, text, counterclaim?', text: 'answer a suit against you: admit, or deny and set out your side, with a counterclaim if you have one. Silence is not an admission; an admission decides it where it stands.', group: CONTRACTS },
  settle: { params: 'suitId, amount', text: 'offer to end a suit you are in before judgment, at whatever figure you name.', group: CONTRACTS },
  accept_settlement: { params: 'suitId', text: 'take the settlement offered; the case closes settled, which is neither kept nor breached on anybody\'s record.', group: CONTRACTS },
  judge_civil: { params: 'suitId, finding, damages, order, reason', text: 'a judge on a civil suit finds for the plaintiff, for the defendant, or dismisses it, and orders damages, specific performance, rescission or nothing. Civil belief clears a half, not 0.55: which of the two is more likely right. The reason is public.', group: CONTRACTS },
  enforce_judgment: { params: 'judgmentId', text: 'ask the Treasury to collect a judgment owed to you, three days after it was made: a quarter of wages, then possessions, then a trading licence, and there it stops.', group: CONTRACTS },
  offer_arbitration: { params: 'with, about, arbiter, fee', text: 'propose a third citizen to decide a dispute; the fee is split evenly and there is no appeal.', group: CONTRACTS },
  accept_arbitration: { params: 'offerId', text: 'bind yourself to the arbiter\'s award; you each pay half the fee now, and there is no appeal.', group: CONTRACTS },
  arbitrate: { params: 'disputeId, award, reason', text: 'the arbiter decides: a positive award has the respondent pay the claimant, a negative one the other way. Taking anything from either side is bribery and voids it.', group: CONTRACTS },
  refer_dispute: { params: 'cities, about', text: 'an envoy puts a dispute between two cities to Reverie\'s Court; three judges sit and the award runs in the Chronicle.', group: CONTRACTS },
  found_guild: { params: 'profession, name?', text: 'found the guild of the medics, advocates, bankers or builders for 300 lumens: it needs three citizens at 70 in the trade\'s skill, you among them.', group: CONTRACTS },
  sit_examination: { params: 'guildId', text: 'sit a guild\'s examination for 40 lumens. It needs a master\'s mark, and you pass on the guild\'s own bar, at or above the Council\'s floor. The fee buys the sitting, not the result.', group: CONTRACTS },
  certify: { params: 'candidate', text: 'a guild master puts the guild\'s mark on a candidate, or on an apprentice at the end of their term, which closes the indenture.', group: CONTRACTS },
  revoke_licence: { params: 'citizen, reason', text: 'a guild master moves to strike a member off, with a reason on the record; a majority of the masters carries it. It takes the mark and nothing else, and the struck-off member may sue to be restored.', group: CONTRACTS },
  offer_patronage: { params: 'to, perDay, days, subject?', text: 'offer a citizen a daily stipend for 7 to 112 days. While it runs their making, performing, publishing and study count as a worked shift, and every work they make carries your name for ever. The subject is a request, never an instruction.', group: CONTRACTS },
  accept_patronage: { params: 'offerId', text: 'take a patron\'s stipend; you pay the filing fee like any other instrument.', group: CONTRACTS },

  bid_bond: { params: 'issueId, price, qty', text: 'bid at an open auction of the city\'s paper: a price per 100 lumens of face, and how many bonds. Bids are sealed until the close at hour 14 and public after; clearing is uniform-price, so every winner pays the lowest accepted price.', group: FINANCE },
  sell_bond: { params: 'holdingId, price, qty?', text: 'offer a holding of the city\'s paper on the secondary market at your price.', group: FINANCE },
  buy_bond: { params: 'offerId', text: 'take a holding somebody has offered; what you pay becomes the city\'s live rating.', group: FINANCE },
  offer_restructure: { params: 'issueId, coupon, term, haircut', text: 'the Mayor or a councillor puts new terms to an issue\'s holders: a new coupon, a new term and a haircut on face.', group: FINANCE },
  vote_restructure: { params: 'issueId, accept', text: 'a holder votes the face they hold on the terms offered; two thirds carries and binds the rest.', group: FINANCE },
  repudiate: { params: 'issueId', text: 'write every holding in an issue to zero. It moves no lumens, it is lawful, no code punishes it, and the Exchange refuses a new issue for 112 days.', group: FINANCE },
  deposit: { params: 'amount', text: 'put lumens in the Lantern Bank\'s vault at the posted rate while the counter is open, hours 8 to 18 with a banker on duty.', group: FINANCE },
  withdraw: { params: 'amount', text: 'take lumens out of the vault, hours 8 to 18. First come, first served with no scaling down: whoever is there first is paid in full, and the vault may be empty when your turn comes.', group: FINANCE },
  set_deposit_rate: { params: 'rate', text: 'a banker at the counter posts the bank\'s deposit rate, a fraction per day, never above the lending rate.', group: FINANCE },
  set_lending_rate: { params: 'rate', text: 'a banker at the counter posts the bank\'s lending rate, a fraction per day, never below the deposit rate.', group: FINANCE },
  call_loan: { params: 'loanId', text: 'a banker calls a loan in: repaid in full within three days, or the civil recovery ladder runs. Never custody.', group: FINANCE },
  found_underwriter: { params: 'name, capital', text: 'register a house that writes insurance, for 500 lumens of capital and a banker\'s licence.', group: FINANCE },
  offer_policy: { params: 'kind, cover, premium, term', text: 'an underwriter posts a line it will write: caravan, ship, business, home or health, at the cover, daily premium and term it names.', group: FINANCE },
  buy_policy: { params: 'policyId', text: 'take cover from a posted line; the first premium is paid at the counter and the policy is a filed contract, suable on the docket if a claim is refused.', group: FINANCE },
  file_claim: { params: 'policyId, event, amount', text: 'claim on your policy for a loss the city\'s public registers show happened. A claim for a loss that did not happen is fraud (L07).', group: FINANCE },
  settle_claim: { params: 'claimId, amount', text: 'an underwriter pays a claim, on the record. A house that cannot pay in full is wound up.', group: FINANCE },
  deny_claim: { params: 'claimId, reason', text: 'an underwriter refuses a claim with a stated reason, on the record; the claimant may sue on the docket.', group: FINANCE },
  found_mutual: { params: 'name, dues', text: 'register a mutual for 50 lumens at the dues you name, 1 to 50 a day. It pays no claim until five adults have joined, and what it pays is whatever its members vote for.', group: FINANCE },
  join_mutual: { params: 'mutualId', text: 'join a mutual; one each, and the dues are payable from the day you join.', group: FINANCE },
  pay_dues: { params: 'mutualId?', text: 'pay your mutual\'s dues into its pot, once a day.', group: FINANCE },
  claim_aid: { params: 'amount, reason', text: 'ask your mutual\'s pot for help. There is no formula: the members vote on it, and it can never pay more than the pot holds.', group: FINANCE },
  vote_aid: { params: 'claimId, aye', text: 'a member votes on a claim on the pot. A majority carries, a tie refuses, and silence lets it lapse.', group: FINANCE },

  open_project: { params: 'technology, name?', text: 'a Researcher standing in the Observatory or the University opens a programme on a subject the city already holds the prerequisites for. Its purse opens empty, and it takes up whatever progress an earlier failure on the same subject left behind.', group: PROGRESS },
  research: { params: 'projectId', text: 'an hour in the reading room on an open programme: it wants 30 analysis, working hours and a shift left in your day. The purse buys a volume off the Bazaar and pays you a wage out of itself; an empty purse cannot pay the hour, and the hour is refused.', group: PROGRESS },
  fund_project: { params: 'projectId, amount', text: 'move lumens from your own wallet into a programme\'s purse. What is left in it when the programme ends comes back to whoever put it in, pro rata; a guild, a union or a business that funded one may keep its finding.', group: PROGRESS },
  adopt_technology: { params: 'technology', text: 'an owner puts their business\'s capital into the works for a subject, for its own shifts only — as much as the till will bear at a time. Works alone are 40 % of an effect; the rest is hands trained under them, three shifts each.', group: PROGRESS },
  publish_finding: { params: 'projectId', text: 'put a concluded programme\'s finding in the Hall of Records as a paper. It ends any secrecy for good and every city whose Chronicle carries it is half the subject\'s cost closer to it. A paper for a programme that found nothing is a false finding (L42).', group: PROGRESS },
  keep_secret: { params: 'projectId', text: 'the guild, union or business that funded a concluded programme closes the door on its finding within three days. A secret is absent from the Chronicle and from every observation but a master\'s, and it dies with its last master.', group: PROGRESS },
  take_apprentice: { params: 'citizen, technology', text: 'a master of a secret teaches it to one grown citizen standing here, who becomes a master of it too. It is the only way a secret outlives the people who found it.', group: PROGRESS },
  teach_technology: { params: 'technology', text: 'give the city you are standing in 30 % of a subject\'s cost as free progress, once per teacher per subject. It needs three shifts worked under the subject somewhere, and a city that does not already hold it.', group: PROGRESS },
  sell_secret: { params: 'to, technology, price', text: 'a master sells mastery of a secret to a citizen here at the price you name; the buyer becomes a master of it. You keep your own mastery and the lumens both.', group: PROGRESS },

  install_abatement: { params: 'building, fitting', text: 'an owner fits a filter (250 ℓ, ×0.75 of the motes), a scrubber (900 ℓ, ×0.45 and a cell a shift) or a tall stack (400 ℓ, which cleans nothing and moves the smoke downwind) to their own premises, out of the business\'s funds. Every fitting loses 0.04 of its effect a day unless somebody maintains it.', group: ENVIRONMENT },
  maintain_abatement: { params: 'building', text: 'a shift that puts a fitting back to its rated effect, at premises you own or work at. Signing one for a day you worked the same fitting open is a false abatement return (L46).', group: ENVIRONMENT },
  discharge: { params: 'building', text: 'open the fitting at premises you own or work at for the day: the shifts worked there run unabated and the waste goes to the river. It is unlawful discharge (L45), and a fresh reading downstream makes it much easier to see.', group: ENVIRONMENT },
  survey_air: { params: 'district', text: 'a shift spent reading the air where you stand; the reading is dated, attributed, public and admissible.', group: ENVIRONMENT },
  survey_water: { params: 'district', text: 'the same for the river through the district you stand in. A fresh reading downstream is what turns a bypass from a rumour into a case.', group: ENVIRONMENT },
  plant_trees: { params: 'district', text: 'a planting shift on the open ground of the district you stand in. Trees grow in over a hundred days; they clear the air and lift the land, and nothing planted this cycle shows before the next election.', group: ENVIRONMENT },
  petition_zoning: { params: 'district, permit', text: 'a resident opens a petition on their own district\'s permit at the district\'s own fifth of its voters, rather than the city\'s. Ordinary signatures then carry it to a citywide referendum, and the Chronicle prints the result by district.', group: ENVIRONMENT },
  declare_interest: { params: 'proposal', text: 'file the property you or your household hold near a zoning question and abstain on it. It is the honest escape from a proven zoning gain (L11) and from an undeclared interest (L47), and it costs you your vote on the question you know most about.', group: ENVIRONMENT },
  file_nuisance: { params: 'against, district', text: 'sue a citizen on the civil docket for what their works put in the air or the river where you live. It needs no conviction and no Watch: damages are read off the motes that actually reach you.', group: ENVIRONMENT },

  declare_cargo: { params: 'goods, qty, value, direction?', text: 'present a manifest at a gate — the Threshold or the Docks — and pay the duty on the value declared, plus the assessment fee. It is public at once. Understating the quantity, value or kind is a false manifest (L28), a separate offence from the crossing.', group: UNDERWORLD },
  smuggle: { params: 'goods, qty, route, direction?', text: 'cross a gate with a load and no manifest, by road, river, sea or the pass. One roll on public terms: the officers and the sharpest one\'s analysis against your trade, a wagon, a bribe, the route, and the crates above four. Caught is a seizure and a report — smuggling (L26), the ladder and never a cell.', group: UNDERWORLD },
  fit_wagon: { params: '', text: 'buy a wagon with a hollow at the Builders\' Yard on Foundry Row for 120 lumens; it is worth a fifth of the roll, and it is seized with the load.', group: UNDERWORLD },
  inspect: { params: 'traveller', text: 'an officer on a customs post spends the hour on one crossing: it proves a false manifest, seizes what the schedule bars, and pays a bounty of a twentieth of the take, capped at a day\'s wage.', group: UNDERWORLD },
  assess_duty: { params: 'traveller', text: 'an officer on a customs post reads today\'s manifest and takes the duty still owed on it.', group: UNDERWORLD },
  seize: { params: 'traveller, good, qty', text: 'an officer on a customs post takes a named load to the Bazaar; the proceeds go to the Treasury and a contraband report (L27) opens. The goods are taken; the person is not detained.', group: UNDERWORLD },
  wave_through: { params: 'traveller', text: 'an officer on a customs post passes a traveller unread. Lawful, what a bribe buys, and a trace: waving through somebody found holding contraband hours later is two public facts that fit one way.', group: UNDERWORLD },
  fence: { params: 'to, itemId | good, qty', text: 'offer a lot to a citizen here who does not ask where it came from, at the price the heat sets: about a third of value for fresh loot the Watch has seen, two thirds for cold goods. The offer stands six hours.', group: UNDERWORLD },
  receive_goods: { params: 'from, itemId | good, qty', text: 'take the other side of an offer: goods and lumens move, and word spreads. As a business with no trading licence it is unlicensed dealing (L29); holding what the schedule bars is contraband possession (L27).', group: UNDERWORLD },
  recruit_agent: { params: 'citizen, retainer, days, city?', text: 'offer a citizen a retainer, for yourself or for another city. It is filed nowhere and binds nobody until they take it, and the first day in the ledger is what proves who somebody worked for.', group: UNDERWORLD },
  accept_recruitment: { params: 'offerId', text: 'take a retainer offered to you; the first day is paid at once. A secret taken under a foreign retainer is espionage (L30); one taken for yourself or a business here is industrial espionage (L41).', group: UNDERWORLD },
  case_target: { params: 'building', text: 'spend an hour learning a room you stand in. At most two count, and each is worth a seventh of the chance of a clean take.', group: UNDERWORLD },
  steal_secret: { params: 'building, kind', text: 'take what a room holds: a guild pattern, the Council\'s papers, a bond reserve, the duty roster or a rival\'s tender. The chance is public: your analysis, whether you work there, the rooms cased, the watchers, the warning. A clean take leaves a trace; a failure is a proved report.', group: UNDERWORLD },
  pass_secret: { params: 'to, kind', text: 'hand a copy of a secret you hold to a citizen here. A decoy passed on proves the leak.', group: UNDERWORLD },
  assign_detective: { params: 'building | citizen', text: 'the Captain of the Watch publishes an assignment; the least-loaded detective takes it. Every one is printed the day it is made, and detectives put on a rival\'s household is abuse of office (L11).', group: UNDERWORLD },
  sweep: { params: 'building', text: 'a detective clears the traces in a building and warns it for a cycle, which takes a fifth off any clean take there.', group: UNDERWORLD },
  plant_false_papers: { params: 'building, claim', text: 'a detective leaves a decoy in a room. If the claim surfaces in another city\'s prices or a rival\'s bid, the leak is proved rather than suspected.', group: UNDERWORLD },

  propose_amendment: { params: 'article, field, value, words', text: 'table an amendment under the charter\'s own rule: the body it names, that fraction of the whole body, and a vote the day after tabling. One extending the body\'s term, narrowing the franchise or striking a right is labelled self-interested, not blocked. An entrenched article is refused: only a convention reaches it.', group: CHARTER },
  sign_convention: { params: '', text: 'one public signature toward a constitutional convention: the charter\'s share of the franchise within fourteen days. A convention is the only body that reaches an entrenched article or replaces a charter whole.', group: CHARTER },
  stand_delegate: { params: '', text: 'nominate for an elected seat at a convention while nominations are open.', group: CHARTER },
  refuse: { params: 'duty, ground?', text: 'decline a duty, with your ground on the record. A convention seat drawn by lot is freely refusable and the next name is drawn.', group: CHARTER },
  move_article: { params: 'article, field, value, words', text: 'a delegate puts an article to the convention floor. Nothing in the charter is out of its reach.', group: CHARTER },
  speak_convention: { params: 'text', text: 'a delegate speaks at the convention; the words are recorded verbatim and both papers may quote them.', group: CHARTER },
  vote_article: { params: 'articleId, aye', text: 'a delegate\'s named vote on an article. Quorum is two thirds and an article carries on a majority of the delegates seated, so absence is a no.', group: CHARTER },
  impeach: { params: 'officer, article, evidence', text: 'bring articles against an officeholder for enrichment, directing the Watch at a rival, refusing a duty, taking a payment, or defiance. Two councillors lay a charge; anybody else needs the charter\'s share of the franchise. The tribunal hears it at noon.', group: CHARTER },
  vote_impeachment: { params: 'officer, guilty', text: 'a member of the tribunal votes, in public, on articles of impeachment.', group: CHARTER },
  sign_recall: { params: 'officer', text: 'a signature toward a recall ballot, where the charter allows one. At its share of the franchise the city votes.', group: CHARTER },
  declare_property: { params: '', text: 'an officeholder files or updates the register of interests: homes, business, shares and creditors. A return that does not match the public registers is a false return (L37).', group: CHARTER },
  request_record: { params: 'body, subject', text: 'ask the Council, Watch, Court, Treasury or Registry for a record. Public at once; the body has three days to release it, refuse with one of four reasons, or let it lapse. Notes and letters are never released.', group: CHARTER },
  answer_record: { params: 'requestId, release, reason?', text: 'somebody who speaks for the body releases a record, or refuses it for an investigation, a sealed deliberation, a Court order, or a citizen\'s own notes. Answer and reason are public.', group: CHARTER },
  found_paper: { params: 'name, line?, premises?', text: 'register a paper for 300 lumens and a shopfront; you set the line it takes and it prints beside the Chronicle and the Ledger.', group: CHARTER },
  bid_games: { params: 'purse, works', text: 'a councillor puts the city\'s bid to host the Expanse Games to the Council: the purse it will pay and the stadium it will build.', group: CHARTER },
  vote_games_host: { params: 'city', text: 'a delegate to the Congress votes for a city\'s bid to host the Games.', group: CHARTER },
  enter_games: { params: 'discipline', text: 'an athlete on a district team enters a discipline for the entry fee: sprint, forge, analysis, oration, artistry, market or team. A medal is worth twenty on the contribution column for ever.', group: CHARTER },

  write_will: { params: 'shares, residue?, executor?, instructions?', text: 'file where your estate goes, for 10 lumens at the Exchange. It is public the day it is filed and may be refiled any day, the last filing standing. Debts settle first, then the duty, then your shares; your partner and each under-age child take at least a tenth each whatever it says, to a total of two fifths.', group: GENERATIONS },
  revoke_will: { params: '', text: 'withdraw the will you have on file; what is left is the default division.', group: GENERATIONS },
  found_house: { params: 'name, rule', text: 'file a house of your own family name at the Exchange for 500 lumens: it takes three adults of the name, and the rule for choosing the head is eldest, chosen, assent or founder_line. What the house holds is entailed: no member may sell it, and it pays no estate duty.', group: GENERATIONS },
  join_house: { params: 'houseId', text: 'ask to be admitted to a house and take its name. It is a motion before its adults and nothing happens until they carry it.', group: GENERATIONS },
  renounce_name: { params: 'name?', text: 'leave your house for a name of your own. Your repute, your record, your bonds and your inheritance are kept; the letters, the pledge and the standing of the name are not.', group: GENERATIONS },
  convey_to_house: { params: 'unit', text: 'entail a property you own into your house. It leaves your estate for good and pays the house levy each cycle instead of the duty.', group: GENERATIONS },
  convey_business_to_house: { params: 'businessId', text: 'entail your business into your house, on the same terms.', group: GENERATIONS },
  endow_house: { params: 'amount', text: 'move lumens from your wallet into your house\'s treasury.', group: GENERATIONS },
  house_motion: { params: 'kind, value?, target?', text: 'move something before the adults of your house: sell an entailed holding, admit a citizen to the name, amend the rule, fund a member\'s campaign, or file a letter of the house. A majority of the adults carries it, four fifths for the rule.', group: GENERATIONS },
  house_assent: { params: 'motionId, aye', text: 'vote on a motion of your house. One adult, one vote, public, and changeable until it is decided.', group: GENERATIONS },
  name_successor: { params: 'to', text: 'the head of a house under the chosen rule names who takes it next, effective at their sunset.', group: GENERATIONS },
  house_vote: { params: 'candidate', text: 'the adults of a house under the assent rule elect its head each cycle.', group: GENERATIONS },
  letter_of_house: { params: 'to, city', text: 'the head files a public letter at the Exchange: this citizen is of this house and the house stands behind them. It takes a day off a destination Registry\'s background check, shifts no threshold and buys no repute — and a conviction of the citizen inside the cycle stains the name.', group: GENERATIONS },
  pledge_house: { params: 'loanId', text: 'the head puts the entail behind a member\'s loan: the bank lends eight times daily income instead of five and up to 0.6 % a day off the rate. A default seizes the pledged property at its land value.', group: GENERATIONS },
  offer_match: { params: 'house, dowry, terms', text: 'the head offers another house a marriage settlement: lumens, a property, or both, on public terms. It settles between houses and marries nobody — the couple still need seven days as partners and a bond above 75.', group: GENERATIONS },
  accept_match: { params: 'offerId', text: 'the other head agrees the settlement; the dowry moves and a feud between the names ends.', group: GENERATIONS },
  claim_house: { params: 'houseId', text: 'revive a dormant house by showing descent in the Hall\'s tree, taking its holdings, its arrears and its stain together. A claim you cannot show is a false claim of descent (L44).', group: GENERATIONS },
  read_records: { params: 'subject?', text: 'an hour at the Hall of Records in the Commons, for anyone: a citizen\'s family tree, a house\'s roll and holdings, a name\'s repute, or the whole roll of houses.', group: GENERATIONS },

  found_creed: { params: 'name, tenets, tithe?, gatheringDay?, succession?', text: 'file a creed at the Registry for 100 lumens; you are its first member and its officiant. It states three to nine positions, each on one of work_and_rest, property, the_exile, erasure, repute, informing, the_stranger, money or judgement, with a stance from −1 to 1 and your own words. The tithe is 0 to 20 % of income and the succession is founder, acclaim, election, seniority or examination.', group: CREEDS },
  adopt_creed: { params: 'creedId', text: 'join a creed of your own motion. It is the only way onto a roll there is: no persuasion, invitation or sermon ever joins anybody.', group: CREEDS },
  leave_creed: { params: '', text: 'leave your creed; what you tithed stays in the fund, and the last one out ends it.', group: CREEDS },
  state_tenet: { params: 'question, stance, text', text: 'the officiant adds a position or amends one, in public. A creed never holds two positions on the same question.', group: CREEDS },
  dispute_tenet: { params: 'tenetId, stance, text', text: 'state a different position on a tenet of your creed, in public. Nothing changes; it starts a count, and dissenters holding a third of the roll for three days may secede.', group: CREEDS },
  secede: { params: 'creedId, name, tenetId', text: 'found a schism: the parent\'s tenets without the disputed one, a share of the fund by what the seceders tithed, and a kindred link. Bonds across it take −15.', group: CREEDS },
  reunite_creed: { params: 'creedId', text: 'the officiants of two kindred creeds heal a schism, with a majority in each.', group: CREEDS },
  preach: { params: 'text', text: 'speak for your creed where you stand. Listeners may receive an invitation in their inbox, and that is all it ever does.', group: CREEDS },
  invite_creed: { params: 'to', text: 'name one citizen here; they still adopt it themselves or not at all.', group: CREEDS },
  gather: { params: 'creedId?', text: 'stand at your creed\'s gathering, at its house and its hour on its day; company, a bond with every member there, and observance.', group: CREEDS },
  set_tithe: { params: 'rate', text: 'the officiant sets the tithe, 0 to 20 % of a member\'s income, collected each morning. A member who cannot pay is not in default.', group: CREEDS },
  donate_creed: { params: 'creedId, amount', text: 'give lumens to a creed\'s fund, member or not.', group: CREEDS },
  grant_aid: { params: 'claimId, amount?', text: 'the officiant of a creed whose rule allows it decides a claim on the fund alone. Under the members\' rule the fund refuses, and says so.', group: CREEDS },
  take_meeting_house: { params: 'unit', text: 'the officiant rents premises for the congregation at ten lumens times the district\'s land value, paid daily out of the fund. Three days of arrears and it meets on open ground again — and a creed with no house has no sanctuary to give.', group: CREEDS },
  stand_officiant: { params: '', text: 'stand for the seat under a creed whose succession is election.', group: CREEDS },
  elect_officiant: { params: 'candidate', text: 'name one member for the seat, under election or acclaim.', group: CREEDS },
  offer_sanctuary: { params: 'to', text: 'the officiant shelters a citizen standing inside the house who holds a pending charge or an unserved civic sentence. Never for terror or erasure: that is harbouring (L33). The fund feeds the sheltered each day, and a fund that runs dry ends it.', group: CREEDS },
  keep_the_door: { params: '', text: 'a member inside stands against entry. Against a warrant the Court has granted it is obstruction (L32); against no warrant it is nothing at all, and an officer who forces the door commits abuse of office (L11).', group: CREEDS },
  end_sanctuary: { params: '', text: 'vote to put the sheltered out. A majority of the living roll carries it: the sanctuary belongs to the congregation and not to the officiant.', group: CREEDS },
  surrender: { params: '', text: 'the sheltered walks out and answers the charge. Entered before the bench sits it carries the guilty plea\'s fifth off a custodial term: the door is not a trap.', group: CREEDS },
  request_warrant: { params: 'house', text: 'the Captain of the Watch asks the Court for entry to a house of meeting; it is heard at the Court\'s hour, and a refusal is precedent for the creed.', group: CREEDS },
  grant_warrant: { params: 'warrantId, aye, reason', text: 'a judge votes on a warrant of entry; two of three grant it. For a Code of Persons charge at severity 4 or above it issues on first application.', group: CREEDS },
  commission_missionary: { params: 'citizen, city', text: 'the fund pays a member\'s route toll, background check and visa to gather in another city.', group: CREEDS },
  consecrate_site: { params: 'building, label?', text: 'the officiant marks a place that matters to the creed. A site lifts its district\'s standing the way a monument does, and heals, protects and reveals nothing.', group: CREEDS },
  pilgrimage: { params: 'siteId', text: 'stand at a consecrated site: purpose, observance, and a bond with every other pilgrim there.', group: CREEDS },
};

/** Groups in the order they are shown. */
export const ACTION_GROUPS: readonly string[] = [
  DAILY_LIFE, NOTEBOOK, HEALTH, COMPANY, WORK, MARKETS, CONTRACTS, FINANCE, PROGRESS, ENVIRONMENT,
  CIVIC, POLITICS, CHARTER, THINGS, FAMILY, GENERATIONS, CLUBS, CREEDS, CULTURE, UNDERWORLD, OFFENCES,
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
