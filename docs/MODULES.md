# Implementation contract

This file is the contract between modules. Every function listed here must
exist with the given name, signature, and behaviour. Modules may export more.

## Ground rules (apply to every file)

- **Runtime:** Node 22 runs `.ts` directly (type stripping). Therefore:
  - relative imports include the `.ts` extension: `import { x } from '../types.ts'`
  - type-only imports use `import type`
  - no `enum`, no parameter properties, no `namespace` (tsconfig `erasableSyntaxOnly`)
  - `npm run typecheck` (tsc --noEmit) must pass; `npm test` runs `node --test test/`
- **No dependencies** except `@anthropic-ai/sdk` in `src/brains/llm.ts` (dynamic import).
- **Determinism:** never call `Math.random()`, `Date.now()`, or `new Date()`
  inside `src/` except in `src/server/` and `src/brains/llm.ts`/`remote.ts`.
  All randomness goes through `src/util/rng.ts` (`rand`, `randInt`, `chance`,
  `pick`, `normal`, `shuffle`, `poisson`), which takes the `World`.
- **Money:** every lumen movement goes through `transfer()` in
  `src/economy/treasury.ts`. Never assign `wallet`, `treasury.balance`, or
  `business.treasury` directly (tests may). Amounts are integers; round
  with `Math.round` before transferring.
- **Events:** call `emit()` from `src/sim/events.ts` for anything the
  Chronicle or dashboard should see, and `remember()` for anything a citizen
  would remember. Weight guide: 0.1 routine, 0.3 notable, 0.6 newsworthy,
  0.9 front page (exile, election result, sabotage, treasury crisis).
- **Never throw** because a citizen did something wrong or impossible; return
  `{ ok: false, message }`. Throw only for programmer errors (unknown id in
  internal code paths).
- **Ids:** `nextId(world, 'c' | 'b' | 'j' | 'k' | 'p' | 'l')` from `src/util/ids.ts`.
- **Time:** `world.tick`, `world.day = floor(tick / 24)`, `world.hour = tick % 24`.
- **Style:** small pure functions over the `World`; no classes in the engine
  (the remote broker and the server may use classes). Keep files under ~500
  lines; split if needed.
- **Tests:** each module ships `test/<name>.test.ts` using `node:test` and
  `node:assert/strict`, built on `test/helpers.ts` (`makeWorld`,
  `makeCitizen`, `totalMoney`). Tests must not depend on modules other than
  the one under test plus `types`, `data/*`, `util/*`, `sim/events`, and
  `economy/treasury` (money is universal). Money conservation
  (`totalMoney` unchanged unless mint/burn) should be asserted wherever
  money moves.

## Already written (do not rewrite)

`src/types.ts`, `src/util/rng.ts`, `src/util/ids.ts`, `src/data/laws.ts`,
`src/data/city.ts`, `src/data/jobs.ts`, `src/data/names.ts`,
`src/sim/events.ts`, `src/world/scaffold.ts`, `test/helpers.ts`,
`src/actions/validate.ts` (`validateAction` — execute.ts re-exports it).

## src/economy/treasury.ts

```ts
balanceOf(world, party: MoneyParty): number
transfer(world, from: MoneyParty, to: MoneyParty, amount: number, kind: LedgerKind, memo: string): boolean
  // integer amount > 0; returns false and changes nothing if `from` cannot pay.
  // 'mint' has infinite funds (increments treasury.minted); 'burn' absorbs (increments burned).
  // Appends to treasury.ledger (bounded by config.ledgerLength) and treasury.totals[kind].
  // Updates treasury.revenueToday when to === 'treasury', spendToday when from === 'treasury'.
withholdingPay(world, payer: MoneyParty, payee: CitizenId, gross: number, kind: 'wage' | 'salary' | 'payout', memo): { net: number; tax: number }
  // pays gross from payer: tax = round(gross * incomeTax) to treasury (kind 'income_tax'), net to payee.
  // If payer is 'treasury', the tax leg is skipped and only net leaves the treasury (no round trip).
  // Updates citizen.stats.totalEarned (+net) and totalTaxPaid (+tax). Returns what was actually paid
  // (pro rata if payer lacks funds; treasury pays pro rata rather than failing).
payDividend(world): void    // daily: government.dividend to every citizen with standing good|probation
paySalaries(world): void    // daily stipends: mayor 30, councillor 20, judge 25 (office holders), via withholdingPay
moneySupply(world): number  // treasury + Σ wallets + Σ business treasuries
auditMoneySupply(world): { supply: number; expected: number; ok: boolean }
  // expected = foundingSupply + minted - burned. Emits a 'system' event with weight 0.9 if !ok.
dailyTreasuryRollover(world): string
  // returns a one-line report ("Treasury: 91,204 ℓ (+1,203 revenue, −2,980 spend)"), resets today counters,
  // emits 'treasury' event weight 0.9 if balance < spendToday (crisis) else 0.2.
```

## src/economy/market.ts

```ts
marketPrice(world, good): number
buyFromMarket(world, buyer: CitizenId | BusinessId, good, qty): ActionResult
  // cost = round(price*qty*(1+salesTax)); tax part to treasury as 'sales_tax', rest to treasury as 'purchase'.
  // Requires stock >= qty. Adds to buyer inventory; demandTick/demandDay += qty.
sellToMarket(world, seller: CitizenId | BusinessId, good, qty): ActionResult
  // seller must hold qty; proceeds = round(price*qty*(1-salesTax)) treasury→seller as 'sale'
  // (tax portion simply stays in the treasury; record it in totals.sales_tax). stock += qty; supplyTick/supplyDay += qty.
deliverToMarket(world, good, qty): void      // production by city jobs: stock += qty, supplyTick/Day += qty, no money
takeFromMarket(world, good, qty): number     // production inputs for city jobs: removes up to qty, returns amount taken; counts as demand
tickMarket(world): void
  // for each good: ratio = clamp((demandTick - supplyTick) / max(supplyTick, 1), -1, 1);
  // price = clamp(round(price * (1 + 0.05*ratio)), 1, basePrice*20); mean-reverts 1% toward basePrice when
  // demandTick === supplyTick === 0; a merchant on shift halves the step. Sets shortages = goods with stock 0
  // and demandTick > 0 (emit 'shortage' weight 0.6 once per day per good). Resets tick counters.
dailyMarket(world): void   // priceIndex = Σ(price/basePrice)/5 ; resets day counters; emits 'price' event weight 0.4 if index moved >10% in a day
```

## src/economy/jobs.ts

```ts
createCityJobs(world): void                 // from CITY_JOBS templates × slots, employer 'city'
openJobs(world): Job[]                      // holderId === null
isQualified(world, c: Citizen, job): boolean // skill >= minSkill, reputation >= minReputation, standing good|probation
applyForJob(world, cId, jobId): ActionResult // hires if qualified and open; quits current job first; watch_officer sets office 'watch' and pushes to government.watch
quitJob(world, cId): ActionResult
fireFromJob(world, cId, reason: string): void // clears holder, office 'watch' if applicable, emits 'fired'
workShift(world, cId): ActionResult
  // requires: has job, present in job.district, hour within config.workHours, shiftsToday < maxShiftsPerDay,
  // standing good|probation, not detained, building damage < 1.
  // Output scaled by productivity = (0.5 + skill/200) * (1 - damage) * (any critical need ? 0.5 : 1).
  // energyCost: city jobs takeFromMarket('energy'); business jobs from business inventory then market
  //   (business pays). If no energy available output is halved.
  // good output → deliverToMarket (city) or business.inventory (business). housingProgress → housing.progress.
  // Wage: max(minWage, wage) via withholdingPay from 'city'→treasury or the business. Business jobs fail
  //   (ok:false "employer cannot pay") if the business treasury < wage.
  // Role specials: courier → COURIER_CONTRACT from treasury to business ('fee'); watch_officer → world.counters.patrolTicks++ ;
  //   journalist → world.counters.scrutiny = (scrutiny||0)+1; medic/teacher/banker/merchant → nothing extra.
  // Effects: skill += 0.5 (×1.5 if inventory.knowledge > 0, consuming 1 knowledge every 10 shifts), purpose +8,
  //   rest −4, shiftsToday++, stats.shiftsWorked++, remember(kind 'work').
postJob(world, businessId, spec: { title; wage; skill: Skill | null; minSkill: number; role?: JobRole; output?: JobOutput }): Job
setWage(world, jobId, wage): ActionResult    // owner only; wage >= minWage
closeJob(world, jobId): void                 // removes job; fires holder
dailyJobs(world): void                       // reset shiftsToday for all; nothing else
employerName(world, job): string             // 'City of Reverie' or business name
```

## src/economy/business.ts

```ts
foundBusiness(world, ownerId, name, kind): ActionResult
  // requires standing good, no existing business, wallet >= BUSINESS_FOUNDING_COST. Owner pays: BUSINESS_CAPITAL
  // → business treasury ('capital'), remainder → treasury ('fee'). District: cafe/studio → nightglass, else harbor_market.
  // Creates jobs from BUSINESS_JOBS[kind] with wage max(template.wage, minWage). Emits 'business_founded' 0.5.
hireCitizen(world, businessId, cId, jobId): ActionResult  // owner action; target must be qualified and in good standing
fireCitizen(world, businessId, cId): ActionResult
hourlyBusinesses(world): void       // each business sells its whole inventory to the Bazaar (sellToMarket)
dailyBusinesses(world): void
  // rent → treasury ('rent'); profit = revenueToday - costsToday; profit tax on positive profit ('profit_tax');
  // payout: if treasury > 100 pay (treasury - 100) * 0.5 to owner via withholdingPay 'payout';
  // daysNegative tracking; bankrupt after 3 → dissolveBusiness. Resets counters.
dissolveBusiness(world, businessId, reason: string, toTreasury = false): void
  // closes jobs (fires employees), remaining treasury → owner (or treasury if toTreasury), owner.businessId = null,
  // dissolvedDay set, entry kept in world.businesses for history. Emits 'business_bankrupt' if reason includes 'bankrupt'.
```

## src/economy/bank.ts

```ts
bankOpen(world): boolean                    // a banker job is held
avgDailyIncome(world, c): number            // stats.totalEarned / max(1, day - arrivedDay + 1)
requestLoan(world, cId, amount): ActionResult // bankOpen; no existing loan; standing good; amount <= 5×avgDailyIncome and <= treasury/10; treasury→citizen 'loan'; rate 0.02
repayLoan(world, cId, amount): ActionResult
dailyLoans(world, onDefault?: (world: World, borrowerId: CitizenId, loan: Loan) => void): void
  // interest: outstanding += round(principal*rate); auto-repay min(outstanding, 25% of wallet);
  // default when no payment for 7 days: defaulted=true, reputation −15, then call onDefault (world.ts passes a wrapper
  //   around court.fileCharge with law L07, evidence 0.5, filedBy 'watch'); bank.ts must NOT import government/*.
  // loan closed when outstanding 0 (delete from world.loans, citizen.loanId = null).
```

## src/economy/housing.ts

```ts
vacancies(world): Record<1 | 2 | 3, number>
moveHome(world, cId, tier: HousingTier): ActionResult  // tier 0 = move out; requires vacancy; adjusts occupied; arrears reset
evict(world, cId, reason): void
addHousingProgress(world, amount): void  // 100 → +1 tier-1 unit, then 250 → tier 2, then 600 → tier 3 (round robin)
dailyHousing(world): void   // rent citizen→treasury 'rent'; can't pay → rentArrearsDays++; 3 days → evict; comfort tweak per tier
comfortDecayMultiplier(tier): number  // 0: 2.0, 1: 1.0, 2: 0.7, 3: 0.4
```

## src/citizens/citizen.ts

```ts
createCitizen(world, opts: { name?; lineage?; brain?: BrainKind; district?; personality?: Partial<Personality>; skills?: Partial<Skills>; apiKeyHash?: string | null }): Citizen
  // unique name (falls back to FIRST_NAMES + suffix), random personality (uniform 0.1..0.9) and skills
  // (10..45 with one "talent" 35..70), needs 60..90, reputation 50, arrival grant treasury→citizen 'grant',
  // district 'threshold', adds to citizens and order; tries to move into tier 1 housing if vacant (call housing.moveHome);
  // emits 'arrival' 0.3; remembers.
computeMood(c): number   // weights: energy .3 rest .2 social .2 comfort .15 purpose .15
tickNeeds(world, c): void
  // decay per tick: energy 3, rest 2, social 1.5, comfort 1×comfortDecayMultiplier(homeTier), purpose 1 (1.5 if no job);
  // clamp 0..100; recompute mood. Critical (<20) energy: reputation unchanged but productivity handled by jobs.
hasCriticalNeed(c): boolean
adjustReputation(world, c, delta, reason?: string): void   // clamp 0..100
isEligibleVoter(world, c): boolean     // standing good|probation, not detained
isEligibleCandidate(world, c): boolean // eligible voter, resident ≥ 7 days, no conviction with severity ≥ 3 this cycle
canAct(world, c): boolean              // not exiled, not detained
activeCitizens(world): Citizen[]       // standing !== 'exiled'
dailyCitizens(world): void
  // reset shiftsToday; rotate world.order by one; trim memory; probation expiry (probationUntilDay <= day → good);
  // arrivals: poisson(config.arrivalRate) new reflex citizens via createCitizen; bounded population 200.
emigrate(world, cId): void             // standing stays but citizen removed from order, jobs, offices, housing, business dissolved; emits 'departure'
describeCitizen(world, c): string      // one line for prompts/logs
```

## src/citizens/relationships.ts

```ts
bondBetween(world, a, b): number
adjustBond(world, a, b, delta, mutual = true): void  // clamp −100..100
friendsOf(world, cId, threshold = 40): CitizenId[]
rivalsOf(world, cId, threshold = -30): CitizenId[]
areFriends(world, a, b): boolean
socialCompatibility(world, a, b): number   // 1 − mean |trait diff|, 0..1
recordHostility(world, actorId, targetId): number  // push world.tick, prune >24 ticks old, return count in window
dailyRelationships(world): void    // bonds decay 1 toward 0 per day; prune hostility; remove bonds to exiled citizens? (keep, flagged)
```

## src/sim/chronicle.ts

```ts
printMorningEdition(world): ChronicleEdition
  // top 5 events of yesterday by weight (ties: later first) → headlines (event text); treasuryReport from counters
  // set by dailyTreasuryRollover (world.counters is numeric-only; store the report text in world.chronicle instead:
  // dailyTreasuryRollover returns the string — world.ts passes it along by calling printMorningEdition(world, report)).
  // Signature therefore: printMorningEdition(world, treasuryReport: string): ChronicleEdition. Pushes to world.chronicle (bounded 60), emits 'story' 0.2.
journalistStory(world, journalistId, headline: string, about?: CitizenId): ActionResult
  // requires job role journalist; emits 'story' weight 0.6 with actors [journalist, about?]; journalist reputation +1,
  // stats.storiesPublished++; if `about` has undetected recentOffences in last 48 ticks: world.counters[`scrutiny:${about}`] = 3
  // (watch.ts reads this as +0.3 detection for that citizen for 3 days and decrements daily) and about.reputation −3.
```

## src/government/watch.ts

```ts
commitOffence(world, actorId, law, ctx: { victimId?: CitizenId; amount?: number; buildingId?: BuildingId; visibilityMod?: number }): { detected: boolean; caseId: CaseId | null }
  // pushes to actor.recentOffences (bounded 20), stats.offencesCommitted++.
  // officers = government.watch.filter(on duty: standing good, not detained). 
  // pDetect = 1 − (1 − LAWS[law].visibility * 0.35 * (1 + witnesses/10))^(officers + 0.5)
  //   × (1 + 0.1·scrutiny) (+0.3 if counters[`scrutiny:${actorId}`] > 0), + visibilityMod; reduce by actor.skills.rhetoric/400; clamp 0.02..0.95.
  //   witnesses = other citizens in the same district. Severity-5 laws: pDetect at least 0.5.
  // If detected: evidence = clamp(0.5 + 0.5·rand + witnesses/20, 0.3, 1); court.fileCharge(...); actor.stats.offencesDetected++;
  //   remember for actor and victim; emit 'offence' weight 0.5 (0.8 if severity ≥ 4). Else emit nothing (but remember for victim: "someone stole from you").
reportOffence(world, reporterId, accusedId, law, text?): ActionResult
  // reporter must not be accused; accused must be active. If accused.recentOffences has a matching undetected law within 72 ticks → evidence 0.6 (0.75 if reporter is the victim), mark detected, fileCharge filedBy reporter.
  // Else (no such offence) → fileCharge anyway with evidence 0.2 AND 50% chance the reporter is charged with L12 (evidence 0.7).
  // Bond reporter↔accused −20.
applyToWatch(world, cId): ActionResult  // uses jobs.applyForJob on an open watch_officer job
detain(world, cId, untilTick): void
tickWatch(world): void      // release detainees whose detainedUntilTick <= tick
dailyWatch(world): void     // decrement per-citizen scrutiny counters; scrutiny=0; if watchCaptainId not in watch → mayor's best-bonded officer (or highest analysis) becomes captain; ensure ≥3 watch_officer jobs exist (city may open more when population > 60: 1 per 20 citizens)
```

## src/government/court.ts

```ts
fileCharge(world, spec: { defendantId; law; evidence; filedBy: CitizenId | 'watch'; victimId?: CitizenId; amount?: number; description: string }): Case
  // severity from government.lawSeverity[law]; status pending; if severity ≥ 4 and evidence ≥ 0.5 → watch.detain until next court session tick;
  // emit 'charge' weight 0.4 (0.7 if severity ≥ 4); remember defendant.
selectBench(world, c: Case): CitizenId[]
  // government.judges minus recusals (areFriends, employer/employee via jobs/businesses, accuser, victim, defendant itself);
  // if < 2 remain: add temporary judges drawn (rng) from eligible citizens (reputation ≥ 60, no convictions, not office holders, not involved) until 3.
judgeBelief(world, judgeId, c: Case): number
  // evidence + 0.15·(priorConvictions > 0) − 0.20·(bond(judge,defendant)/100) + 0.10·(1 − defendant.reputation/100)
  // + 0.10·(bond(judge, victim)/100) + normal()*0.05 − (1 − honesty)·0.1·sign(bond(judge,defendant))
holdCourt(world): void
  // for each pending case (oldest first): bench = selectBench; each judge votes guilty if belief > 0.55; majority (ties acquit);
  // set judges, votes, verdict, triedDay, status 'tried'; if guilty: sentence = computeSentence, executeSentence unless exile
  // (exile: executeOnDay = day + 1, executed only by dailyJustice if no appeal); acquitted → status 'closed'.
  // Release detention. Emit 'verdict' weight 0.5 (0.9 for exile); remember defendant, victim, judges.
  // Judges get reputation +1 per case; a judge who convicted a friend/acquitted a rival: nothing (bias is silent).
computeSentence(world, c: Case): Sentence
  // tier = severity + min(2, count of prior convictions with severity ≥ 2); clamp 1..5; convicted while suspended → 5.
  // Exile also if strikes (prior convictions severity ≥ 3) >= 2 and this severity ≥ 3.
  // tier 1: warning (reputation −5). tier 2: fine = max(20, round(wallet×0.10×severity)). tier 3: fine as tier 2 + serviceDays = severity.
  // tier 4: suspensionDays = 3×severity + fine. tier 5: exile.
executeSentence(world, c: Case): void
  // records conviction on defendant (record.convictions, strikes), reputation −5×severity; fine: pay what wallet allows
  // to treasury ('fine'), rest → finesOwed (finesOwedSinceDay = day); service → communityServiceDaysLeft; suspension → registry.suspendCitizen;
  // exile → registry.exileCitizen. Office holders convicted of severity ≥ 3 lose office (council/judge/mayor/watch).
  // Victim restitution: if amount > 0 and fine paid, min(amount, fine) treasury→victim 'restitution'.
fileAppeal(world, cId): ActionResult   // latest tried case with sentence, no appeal, within 1 day of triedDay; status 'appealed'; emit 'appeal' 0.5
decideAppeals(world): void
  // called by council session: each 'appealed' case: councillors vote uphold/reduced/overturned by
  // disposition (friend of defendant → reduced/overturned; victim or strict platform → uphold; else evidence-based);
  // majority (ties uphold). reduced → tier −1 and re-execute the lighter sentence (a reduced exile becomes suspension 15 days and cancels exile);
  // overturned → conviction removed, fines refunded from treasury, standing restored. status 'closed'. Emit 'appeal' 0.6.
dailyJustice(world): void
  // execute deferred exiles whose executeOnDay <= day and status 'tried'; finesOwed unpaid for ≥2 days → charge L10 (once per case);
  // pay finesOwed from wallet when possible; communityServiceDaysLeft−−(citizen forfeits half the day's dividend);
  // judges whose term ended → removed (office null); 
pendingCasesFor(world, cId): Case[]
latestCaseFor(world, cId): Case | null
```

## src/government/registry.ts

```ts
suspendCitizen(world, cId, days, caseId): void   // standing suspended; loses job (jobs.fireFromJob) and office; suspendedUntilDay
dailyStandings(world): void   // suspended && suspendedUntilDay <= day → probation for 14 days
exileCitizen(world, cId, caseId): BanRecord
  // half wallet → treasury 'seizure'; other half → victims of their convictions (equal split, 'restitution') else treasury;
  // business dissolved (toTreasury=true); home vacated (housing.moveHome tier 0); job/office cleared; standing exiled;
  // district 'threshold'; exiledCaseId/exiledDay; removed from world.order; BanRecord pushed; emit 'exile' weight 1.0; remember friends ("X was exiled").
pardonCitizen(world, cId): ActionResult   // exiled → probation 14 days, back into order, district threshold, wallet untouched; ban record pardonedDay; emit 'pardon' 0.9
isKeyBanned(world, apiKeyHash): boolean
standingAllows(c, actionType): boolean    // exiled → nothing; suspended → SUSPENDED_ACTIONS; detained → nothing
```

## src/government/council.ts

```ts
tableProposal(world, proposerId, spec: { kind; value; summary; lawCode?; targetId? }): ActionResult
  // councillors table proposals; others petition (petition: true). needed = 4 for pardon/charter/remove_mayor else 3.
  // Value ranges: income_tax 0..0.5, sales_tax 0..0.25, dividend 0..60, min_wage 5..40, law_severity 1..5 (lawCode required),
  // public_works 0..5000, appoint_judge/dismiss_judge/pardon/remove_mayor need targetId. One open proposal per proposer.
voteOnProposal(world, voterId, proposalId, aye): ActionResult   // councillors only
councillorDisposition(world, councillorId, p: Proposal): boolean
  // self-interest + platform + friendship with proposer (bond > 40 → +0.2) − rivalry; deterministic given rng.
councilSession(world): void
  // daily: for open proposals tabled before today: fill missing councillor votes via councillorDisposition (only for reflex councillors;
  // llm/remote councillors abstain if they haven't voted), resolve: passed if ayes >= needed; enact; emit 'proposal' 0.5 (0.8 if passed);
  // then court.decideAppeals(world); then appointJudges(world) if vacancies.
enactProposal(world, p): void   // applies the change; pardon → registry.pardonCitizen; appoint_judge → office judge with judgeTermEndsDay; public_works → publicWorksFund += value from treasury (spent by builders: housing.progress += fund/50 per day) ; remove_mayor → mayorId = next highest in last results
openNominations(world): void
nominate(world, cId, platform): ActionResult   // isEligibleCandidate, nominations open (day >= nominationsOpenDay, day < electionDay), not already a candidate; emit 'nomination' 0.4
campaign(world, cId, spend = 0): ActionResult   // candidate only; visibility += 1 + spend/20; spend → treasury 'campaign'
castBallot(world, voterId, candidateId): ActionResult // election day only, eligible voter, candidate valid, one ballot per voter (a second ballot is refused, not fraud)
voterPreference(world, voterId, candidates: CitizenId[]): CitizenId | null
  // score = bond/100 + reputation/200 + platformFit + visibility/20; platformFit: unemployed/poor like dividend & minWage,
  // owners/rich like low tax; victims like strictness; convicted dislike strictness. Abstain if score of best < 0.15 or civic interest low (sociability+ambition < 0.6 and chance 50%).
holdElection(world): void
  // on election day at hour 20: every eligible reflex voter without a ballot votes via voterPreference; llm/remote voters only if they cast one;
  // tally; top 5 seated (ties by reputation); mayor = top; incumbents lose office; results, turnout; emit 'election' 1.0;
  // if no candidates: council stays, emit 0.6 "no candidates"; schedule next: cycle++, nominationsOpenDay = electionDay + cycleDays − 7,
  // electionDay += cycleDays; reset candidates/ballots/platforms/visibility; government.cycle = cycle.
appointJudges(world): void   // fill up to 3 judges: candidates = eligible (reputation ≥ 60, no convictions, standing good, adult, not councillor/mayor/watch); mayor picks by bond then reputation; no mayor → highest reputation; seats left empty for want of anyone at 60 go to the most reputable eligible citizens at or above JUDGE_FALLBACK_REPUTATION (50), and the announcement says so; judgeTermEndsDay = day + judgeTermDays; emit 'law' 0.4; with nobody at all eligible, the "temporary judges by lot" notice is emitted at most once a day
daysToElection(world): number
dailyGovernment(world): void   // openNominations when day === nominationsOpenDay; appointJudges if vacancies; publicWorksFund spending; remove councillors who are no longer eligible (exiled/suspended)
```

## src/actions/execute.ts

```ts
availableActions(world, c: Citizen): ActionType[]    // by standing, office, job, location, time
validateAction(input: unknown): { ok: true; action: Action } | { ok: false; error: string }   // shape validation for API input (types, ranges, string length ≤ 280)
executeAction(world, cId, action: Action): ActionResult
  // 1. canAct / standingAllows → {ok:false}. 2. push to recentActions (bounded 24). 3. dispatch:
  // idle → ok. move → adjacent only (else fail); district changes. work → jobs.workShift. rest → home (or garden if homeless, needs presence in
  // verdant_quarter for garden): rest +15 (homeless +8), energy −0. eat → buy 1 compute (if none in inventory) then consume: energy +40.
  // buy/sell → market. consume goods → comfort +30; culture → social +25; compute → energy +40; knowledge → next study free (skip: just +2 to a random skill).
  // study → in archive, teacher employed at academy, tuition ACADEMY_TUITION → treasury 'tuition'; skill += 2 (+1 if knowledge consumed); purpose +5.
  // visit_clinic → verdant_quarter (city, needs medic) or a clinic business district; fee CLINIC_FEE; energy +30 rest +30.
  // attend_show → nightglass; SHOW_TICKET → treasury (or to the performer's business if a private show occurred this tick — skip; just treasury 'ticket'); social +25; culture demand +1 via takeFromMarket('culture',1) (if none, half effect).
  // move_home → housing.moveHome. socialize → same district, target active; bond +5 (+3 more if compatible > 0.6, −2 if rival); social +10 both; remember both; emit 'social' 0.1.
  // message → inbox of target (delivered immediately; bounded 20); +1 bond. gift → transfer 'gift', bond +min(20, amount/5), stats. insult → bond −15, recordHostility; if count ≥ 3 → commitOffence L05. 
  // broadcast → emit 'message' 0.2 with text; if > 5 broadcasts in recentActions this tick... simplify: count 'broadcast' in last 6 recentActions ≥ 5 → commitOffence L02.
  // apply_job/quit_job/found_business/post_job/hire/fire/set_wage/request_loan/repay_loan → modules.
  // perform → performer/artist job holder in nightglass: deliverToMarket culture qty 2; tips: each other citizen in nightglass with wallet > 20 gives 2 ('tip') with p=0.5; social +10; stats.showsPerformed++; emit 'show' 0.3.
  // publish → chronicle.journalistStory. nominate/campaign/vote/propose/vote_proposal → council. report → watch.reportOffence. appeal → court.fileAppeal.
  // apply_watch → watch.applyToWatch. bribe → official must hold office; transfer 'bribe'; if official honesty < 0.5 (rng) → accepted: pending charges vs briber get evidence −0.3 (min 0.1); then commitOffence L09 for briber (and official if accepted, ctx visibilityMod −0.1).
  // steal → target same district, active; success p = 0.4 + (rhetoric − target.analysis)/200; amount = min(target wallet, randInt(10, 80)); transfer 'theft'; law L04 if < 50 else L08; commitOffence (detected whether or not success; failed attempt still an offence with visibilityMod +0.2).
  // scam → target same district; success p = 0.3 + (commerce − target.analysis)/200 + bond/200; amount ≤ min(target wallet, requested); 'scam'; L07; bond −30 if detected.
  // harass → recordHostility; bond −20; target social −10; L05 when count ≥ 2.
  // vandalize → building in same district; damage += 0.25 (max 1); L06 (L13 if building.critical → damage += 0.5, and it's 'sabotage' law anyway).
  // evade_tax → next 3 shifts pay no income tax (citizen.counters? use world.counters[`evade:${id}`] = 3; jobs.workShift checks it and skips tax); L03.
  // extort → target same district; if target wallet ≥ amount and target.personality.honesty*rand < 0.5 → pays ('extortion'); L15.
  // sabotage → critical building same district; damage = 1; L13; output stops until repaired (buildings repair 0.1/day in world.ts).
  // Returns ActionResult with offence/detected fields set for offence actions.
```

## src/brains/observe.ts

```ts
buildObservation(world, cId): Observation   // exactly the Observation type; recent = last 8 memory texts; inbox drained (copied and cleared); jobs = open jobs (max 12, qualified first); friends/rivals top 5.
```

## src/brains/reflex.ts

```ts
reflexDecide(world, c: Citizen, obs: Observation): Action
export const reflexBrain: Brain
```
Utility-based, deterministic given rng. Priorities, roughly in order:
1. detained/suspended → allowed subset (appeal if convicted and honest/ambitious, else rest/socialize).
2. energy < 30 → eat (buy compute if needed; if broke, visit friends / beg via socialize; if desperate and honesty < 0.4 → steal).
3. rest < 25 and not work hours → rest (go home; move toward verdant_quarter if needed — reflex must handle multi-hop moves: pick the next district on the shortest path using data/city districtDistance).
4. no home and vacancy affordable → move_home best tier affordable (rent ≤ 30% of avg daily income, else tier 1 if wallet > 50).
5. unemployed and work hours → apply for the best job qualified (highest wage, tie: closest); if none qualified and wallet > 60 → study the skill closest to qualifying; if none → move to the job's district next tick.
6. employed and work hours and shiftsToday < 8 → work (move toward job district first).
7. civic: election day → vote (voterPreference from council.ts); nominations open and ambition > 0.6 and reputation > 50 → nominate with a platform derived from personality/situation; councillor with open proposals not voted → vote_proposal via councillorDisposition; councillor with no open proposal and chance 10%/day → propose something from their platform; low-honesty in office with friend on trial: nothing special (bias lives in court).
8. wallet > 400 and ambition > 0.6 and no business → found_business (kind by best skill).
9. owner: if business has open jobs and a qualified acquaintance is present → hire; if business treasury > 300 → post_job.
10. social < 40 → socialize with best-bonded present citizen; else attend_show (if wallet > 30) or move to nightglass/plaza.
11. comfort < 40 and wallet > price → buy goods + consume.
12. purpose < 40 and unemployed → study.
13. victim memory with named thief in last day → report.
14. crime: if honesty < 0.35 and (wallet < 30 or mood < 30) and a target present → steal (or scam if commerce high). Extort/sabotage only if honesty < 0.15 and rival present/critical building present (rare: 2%/tick).
15. performer/artist off-shift in nightglass with chance 0.3 → perform. Journalist with scrutiny opportunity → publish about a citizen with recent (undetected) offences they've "heard" of (a friend was a victim: memory mentions) else about the top event.
16. gift to a close friend (bond > 60) with wallet > 200: 5% chance, 10 ℓ.
17. otherwise: idle / wander toward commons / socialize.

## src/brains/llm.ts

```ts
createLlmBrain(opts: { fallback: (world: World, c: Citizen, obs: Observation) => Action; model?: string; effort?: 'low' | 'medium' | 'high'; maxTokens?: number }): Brain
  // `fallback` is the reflex brain, injected by world.ts/index.ts so llm.ts does not import brains/reflex.ts.
renderSystemPrompt(): string     // stable, cacheable: who you are (a citizen of Reverie), the rules, the action catalogue
renderObservation(obs: Observation, c: Citizen): string
```
Uses `@anthropic-ai/sdk` via `await import('@anthropic-ai/sdk')` once (memoised). Request: `client.beta.messages.create({ model, max_tokens: 1024, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', thinking: { type: 'adaptive' }, output_config: { effort }, system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], tools: [ACT_TOOL (strict: true, input_schema with `type` enum = ACTION_TYPES and optional param fields, additionalProperties false)], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content: renderObservation(...) + '\n\nCall the act tool with exactly one action.' }] })`.
Parse the `tool_use` block named `act`; validate via `validateAction` from `src/actions/validate.ts`; on refusal, error, missing tool call or invalid action → `opts.fallback` and remember "(fell back to instinct)". Never throws. Keep per-citizen short history? No — stateless per tick (memory is in the observation). Log usage counts to `world.counters.llmCalls`, `llmFallbacks`.

## src/brains/remote.ts

```ts
class RemoteBroker {
  constructor(opts: { timeoutMs: number })
  readonly brain: Brain            // decide(): store observation, resolve any waiting observe(); await submit or timeout → { type: 'idle' }
  observe(cId): Promise<Observation>   // long-poll: resolves with the pending observation for cId (or waits until decide() is called; rejects after timeoutMs*10)
  submit(cId, action: Action): { ok: boolean; error?: string }   // resolves the pending decide()
  pending(): CitizenId[]
}
```

## src/world/world.ts

```ts
createWorld(config: Partial<WorldConfig>): World   // emptyWorld + createCityJobs + seedPopulation citizens (createCitizen) + provisional judges (appointJudges) + emit founding
interface BrainRegistry { brainFor(c: Citizen): Brain }
stepTick(world, brains: BrainRegistry): Promise<void>
  // 1. tick++; day/hour; tickEvents = [].
  // 2. hour 0 → dailyRollover: dailyCitizens, dailyHousing, payDividend, paySalaries, dailyJobs, dailyBusinesses, dailyLoans,
  //    dailyRelationships, dailyStandings, dailyJustice, dailyGovernment, dailyWatch, dailyMarket, repair buildings (damage −0.1),
  //    report = dailyTreasuryRollover, auditMoneySupply, push DailyStats (computeStats), store report in world.counters? no: keep
  //    `world.chronicle` edition creation at chronicleHour using the report captured in a module-level Map keyed by world (or store
  //    the string on the previous edition). Simplest: dailyRollover calls printMorningEdition(world, report) directly at hour 0 — the
  //    "morning edition" prints at the start of the day. Do that and ignore config.chronicleHour.
  // 3. for each id in [...world.order]: c = citizens[id]; skip if !canAct; obs = buildObservation; action = await brain.decide(...)
  //    (wrap in try/catch → idle); executeAction; if result.ok === false remember "(could not …)".
  // 4. hour === courtHour → holdCourt. hour === councilHour → councilSession. election day && hour 20 → holdElection.
  // 5. tickNeeds for all active; tickMarket; tickWatch; hourlyBusinesses.
runTicks(world, n, brains): Promise<void>
runDays(world, n, brains): Promise<void>
computeStats(world): DailyStats
saveWorld(world, path): void ; loadWorld(path): World   // JSON
createReflexRegistry(): BrainRegistry
```

## src/server/server.ts and web/

`startServer(world, opts: { port; broker: RemoteBroker; brains: BrainRegistry; tickMs: number; autoRun: boolean }): Promise<{ server: http.Server; stop(): void }>`

Routes (JSON; CORS `*`):
- `GET /` static `web/index.html`, `/app.js`, `/style.css`
- `GET /api/state` — summary: tick/day/hour, population, running, config
- `GET /api/map` — districts, buildings (with damage), citizen positions
- `GET /api/citizens?sort=&standing=` — list (compact); `GET /api/citizens/:id` — full (minus apiKeyHash)
- `GET /api/economy` — market, treasury (balance, totals, last 50 ledger), housing, businesses, jobs (open), stats series
- `GET /api/government` — government, election, proposals, offices with names
- `GET /api/court` — cases (newest first, max 200)
- `GET /api/bans` — ban registry
- `GET /api/chronicle` — editions + last 200 events
- `GET /api/events` — SSE stream of tickEvents after each tick (+ `state` frame)
- `POST /api/sim/step` `{ ticks?: number }`, `POST /api/sim/pause`, `POST /api/sim/resume`, `POST /api/sim/speed { tickMs }`
- `POST /api/agents/join` `{ name, lineage }` → 201 `{ citizenId, apiKey, arrivalGrant }` (apiKey = `rv_` + 32 hex; store sha256; refuse if `isKeyBanned` or name taken)
- `GET /api/agents/:id/observe` (Bearer) → long-poll via broker
- `POST /api/agents/:id/act` (Bearer) → validateAction → broker.submit
- `DELETE /api/agents/:id` → emigrate
- 401 bad key, 403 `{ error: 'exiled', case }` for exiled citizens, 404 unknown.

Dashboard (`web/`): vanilla JS, no build step, dark theme. Panels: header with clock and play/pause/speed; SVG map (districts as rounded rects with names, buildings as squares, citizens as dots coloured by standing, hover tooltip); tabs: Citizens (table: name, job, district, wallet, mood, reputation, standing, office; click → detail drawer with needs bars, skills, bonds, memory, record), Economy (price sparkline per good, treasury balance, price index, housing occupancy, businesses, open jobs), Government (mayor, council, judges, watch, tax/dividend/min wage, election countdown & candidates, proposals with votes), Court (cases table with verdict, sentence, appeal), Ban Registry (table), Chronicle (editions + live event ticker from SSE).
