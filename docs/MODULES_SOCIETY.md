# Implementation contract — the social layer

Extends `docs/MODULES.md` (same ground rules) with the features designed in
`docs/SOCIETY.md`. Everything here is additive to the core engine.

## Type additions (`src/types.ts`)

```ts
export type Hobby = 'music' | 'reading' | 'art' | 'gardening' | 'cooking' | 'tinkering' | 'astronomy' | 'games' | 'dancing' | 'running';
export type ProductCategory = 'instrument' | 'book' | 'art' | 'furniture' | 'plant' | 'companion' | 'attire' | 'game' | 'tool';
export type LifeStage = 'child' | 'adult' | 'elder';
export type ClubId = string;        // "u_N"
export type HouseholdId = string;   // "h_N"
export type ItemId = string;        // "i_N"
export type HappeningKind = 'wedding' | 'birthday' | 'festival' | 'swearing_in' | 'club_meeting' | 'birth';

export interface Tastes { hobbies: Hobby[]; favouriteDistrict: DistrictId; favouriteGood: Good; categories: ProductCategory[] }
export interface Item { id: ItemId; productId: string; acquiredDay: number }
export interface FamilyLinks {
  familyName: string;
  partnerId: CitizenId | null;
  partnerSinceDay: number | null;
  married: boolean;
  parents: CitizenId[];
  children: CitizenId[];
}
export interface Household { id: HouseholdId; headId: CitizenId; members: CitizenId[]; tier: HousingTier; createdDay: number }
export interface Club {
  id: ClubId; name: string; hobby: Hobby; founderId: CitizenId; convenorId: CitizenId;
  members: CitizenId[]; foundedDay: number; meetsOnWeekday: number; // 0..6, never REST_DAY-1? any day is fine
}
export interface ShelfEntry { qty: number; price: number }
export interface Happening {
  id: string; kind: HappeningKind; day: number; hour: number; district: DistrictId; buildingId: BuildingId | null;
  who: CitizenId[]; clubId: ClubId | null; label: string; done: boolean; attendees: CitizenId[];
}
```

Citizen additions (all required; `makeCitizen` in `test/helpers.ts` and `createCitizen` must set them):

```ts
familyName: string;
lifeStage: LifeStage;
bornDay: number;              // = arrivedDay for arrivals; birth day for children
lastBirthdayDay: number;
tastes: Tastes;
possessions: Item[];
family: FamilyLinks;
householdId: HouseholdId | null;
clubs: ClubId[];
affection: Record<CitizenId, number>;   // 0..100, only toward adults
contactsToday: Record<CitizenId, number>; // interactions today (socialize/date/dine/play/club/show together)
wants: string[];              // cached product ids, refreshed daily
guardianId: CitizenId | null; // wards of the city
```

Business addition: `shelf: Record<string, ShelfEntry>` (products for sale).
World additions: `households: Record<HouseholdId, Household>`, `clubs: Record<ClubId, Club>`, `emporium: Record<string, number>` (product stock at the Grand Bazaar), `happenings: Happening[]` (today's and tomorrow's; pruned daily), `treasury.chest: number` (the Community Chest pot; counted in `moneySupply`).
MoneyParty addition: `'chest'`. LedgerKind additions: `'donation' | 'stipend' | 'upkeep' | 'item' | 'craft' | 'registration' | 'inheritance'`.
EventKind additions: `'wedding' | 'birth' | 'birthday' | 'festival' | 'club' | 'romance' | 'purchase' | 'donation' | 'coming_of_age' | 'household'`.
MemoryKind addition: `'family'`.
DailyStats additions: `partnerships`, `marriages`, `children`, `clubs`, `chest`, `possessions`.
Counters: `nextId` prefixes `'u' | 'h' | 'i' | 'e'` (e = happening).
ProposalKind addition: `'charity'` (council moves `value` lumens treasury → chest).

Action additions (see `docs/SOCIETY.md` table): `buy_item`, `use_item`, `gift_item`, `craft`, `set_price`, `date`, `propose_partnership`, `marry`, `break_up`, `move_in`, `start_family`, `found_club`, `join_club`, `leave_club`, `attend_club`, `dine`, `play`, `celebrate`, `donate`. Add them to `Action`, `ACTION_TYPES`, `SUSPENDED_ACTIONS` (dine, play, celebrate, use_item allowed), and `validateAction`.

Observation additions (`docs/SOCIETY.md` "What this adds to the observation"): `self.familyName`, `self.lifeStage`, `self.age`, `self.tastes` (+`wants`), `self.possessions`, `self.partner`, `self.family`, `self.household`, `self.clubs`; `here.shops`, `here.happening`; `calendar`; `affection` (top 5).

## src/society/tastes.ts

```ts
assignTastes(world, c): void               // 2 distinct hobbies (rng), favouriteDistrict, favouriteGood, categories = union of hobby categories + 1 random
preferenceScore(c, productId): number       // 0..1: category in tastes (+0.5), hobby match (+0.4), owns already (−0.6), companions bonus if household has none (+0.1)
computeWants(world, c): string[]            // top 5 products by preferenceScore × affordability (basePrice <= wallet × 0.6 ⇒ 1, else basePrice/wallet) with a fashion term (+0.1 if a friend owns it)
refreshWantsDaily(world): void              // for all active adults
```

## src/society/shops.ts

```ts
initEmporium(world): void                                   // from EMPORIUM_FOUNDING_STOCK (scaffold calls it)
shopsIn(world, district): { businessId: BusinessId | 'emporium'; name: string; shelf: Record<string, ShelfEntry> }[]
  // emporium listed in harbor_market with price = basePrice × market.priceIndex (rounded, min 1)
buyItem(world, cId, productId): ActionResult                // same district as a shop with stock; money → business (kind 'item') or treasury; new Item via nextId 'i'; MAX_POSSESSIONS; emit 'purchase' 0.2; remember
useItem(world, cId, itemId): ActionResult                   // applies product.use needs; hobby items: skill +0.5 (child ×2), purpose bonus if hobby in tastes; remember
giftItem(world, cId, to, itemId): ActionResult              // same district; bond + (10 + 30 × preferenceScore(recipient)); affection +5 if partner; emit 'gift'
craftProduct(world, cId, productId): ActionResult           // cId owns or works at a business of kind shop|workshop|studio in that district; recipe goods from business inventory (buy from Bazaar if short, business pays); adds shelf qty (price default basePrice × 1.2)
setPrice(world, ownerId, productId, price): ActionResult
restockEmporium(world): void                                // daily: each product 15% chance +1 (max 10)
dailyPossessions(world): void                               // passive effects to owner (and companions to whole household)
```

## src/society/romance.ts

```ts
recordContact(world, a, b): void                            // contactsToday both ways (called by socialize/date/dine/play/attend_club/attend_show-with)
dailyAffection(world): void
  // for each adult pair with contactsToday > 0: gain = (2 + 4·compat + bond/50) × contacts (cap 12/day) if both single or partnered with each other;
  // if partnered with someone else: gain only if bondWithPartner < 20. Decay 1/day without contact. Clear contactsToday.
date(world, cId, withId): ActionResult                      // same district; venue: cafe business/tavern (both pay DINE cost via dine) or garden (free); affection +8, bond +6 both; energy/social; jealousy: partner (if any, of either) bond −10 with 50% chance of learning; emit 'romance' 0.3
proposePartnership(world, cId, to): ActionResult            // both adults, single, same district, target.affection[cId] >= 60; sets partnerId both, partnerSinceDay; emit 'romance' 0.5
marry(world, cId, to): ActionResult                          // partners >= 7 days, bond > 75; schedules Happening 'wedding' next day 20:00 at sound_garden; married=false until held
holdWedding(world, h: Happening): void                       // married = true; family name merge (higher-reputation partner's name, other keeps if reputations within 5 → both keep); attendees: citizens in nightglass; gifts from friends (bond > 40): 10 ℓ or a matching item; emit 'wedding' 0.9; remember all
breakUp(world, cId): ActionResult                            // clears partner both; bond −40; affection 0; household split: home stays with the higher earner (other leaves household → homeless); emit 'romance' 0.5; if married also emit 'law' "dissolution recorded"
```

## src/society/family.ts

```ts
familyOf(world, cId): { id: CitizenId; relation: 'partner' | 'spouse' | 'parent' | 'child' | 'sibling' }[]
areFamily(world, a, b): boolean
startFamily(world, cId): ActionResult                       // partners, shared household, tier >= 1, bond > 80, wallets sum >= START_FAMILY_SAVINGS; schedules Happening 'birth' next day 07:00 at restoration_ward
birthChild(world, h: Happening): Citizen                     // createCitizen with opts { lifeStage: 'child', parents, familyName, personality: mean + normal×0.1, talent from a parent's best skill, brain 'reflex', district verdant_quarter }; joins parents' household; parents' children++, siblings via parents; emit 'birth' 0.8
dailyLifeStages(world): void                                 // child → adult at bornDay + CHILDHOOD_DAYS (emit 'coming_of_age' 0.6, remember family); adult → elder at ELDER_DAYS (reputation +5, emit 0.4)
dailyUpkeep(world): void                                     // each parent pays CHILD_UPKEEP_PER_PARENT per child to the child (kind 'upkeep'); wards: chest pays
dailyBirthdays(world): void                                  // (day − bornDay) % BIRTHDAY_EVERY === 0 && day > bornDay → Happening 'birthday' at 19:00 in home district (verdant_quarter, or current district if homeless)
holdBirthday(world, h): void                                 // attendees (family + friends in district): bond +6, social +15, gifts 5 ℓ from friends with wallet > 50; emit 'birthday' 0.4
inheritance(world, leaverId): void                           // called by departure.emigrate: wallet split equally among family (kind 'inheritance'); nothing if no family
wardship(world, childId): void                               // called by registry.exileCitizen when a child's last present parent is exiled: guardianId = best-bonded adult family friend; chest upkeep; district threshold → moves to guardian's household if room
familyBondFloor(world): void                                 // daily: bonds between family members >= 20
```

## src/society/households.ts

```ts
createHousehold(world, headId): Household                    // when a citizen takes a home alone (housing.moveHome calls it); tier from head
moveIn(world, cId, withId): ActionResult                     // withId is partner/family/close friend (bond > 60); capacity by HOUSEHOLD_CAPACITY; cId leaves current home/household; homeTier := household tier; occupied not incremented (household shares one unit)
leaveHousehold(world, cId): void                             // becomes homeless; if head leaves, head = next member; empty household → free unit
householdRent(world): void                                   // replaces per-citizen rent in housing.dailyHousing for household members: rent split equally among adult members (children free); arrears per household
householdOf(world, cId): Household | null
```
Core change: `housing.moveHome` creates/updates households; `housing.dailyHousing` charges via `householdRent` for citizens with `householdId` and the old way for those without (none after migration: every housed citizen has a household of ≥ 1).

## src/society/clubs.ts

```ts
foundClub(world, cId, hobby, name): ActionResult             // adult, fee CLUB_FOUNDING_FEE → treasury ('registration'); meetsOnWeekday = rng 0..5 (never REST_DAY? allow any); founder = convenor; emit 'club' 0.5
joinClub(world, cId, clubId): ActionResult                   // max 5 clubs; emit 0.2 (0.6 when membership hits 10)
leaveClub(world, cId, clubId): ActionResult
scheduleMeetings(world): void                                // daily: for clubs meeting today → Happening 'club_meeting' at CLUB_MEETING_HOUR at HOBBY_INFO[hobby].venue
attendClub(world, cId, clubId): ActionResult                 // at meeting hour ±0 in venue district; attendees bond +4 pairwise, social +12, skill +0.5, recordContact; candidates visibility +1 per 3 attendees
dailyClubs(world): void                                      // convenor = founder if present else highest mean bond; prune exiled/departed members; dissolve empty clubs
```

## src/society/calendar.ts

```ts
weekday(world): number                                        // day % 7
isRestDay(world): boolean
isFestivalToday(world): { name: string; hour: number } | null // Lantern Night every LANTERN_NIGHT_EVERY days at LANTERN_NIGHT_HOUR; Founders' Day the day after an election (all day, 12:00 swearing-in)
nextFestival(world): { name: string; inDays: number }
scheduleFestivals(world): void                                // daily: Happenings for today's festivals (festival at sound_garden; swearing_in at central_plaza)
celebrate(world, cId): ActionResult                           // join a not-done Happening in cId's district this hour: adds to attendees; effects applied by holdHappening at the end of the hour
tickHappenings(world): void                                   // at the end of each tick: run happenings with day/hour == now: wedding → romance.holdWedding; birth → family.birthChild; birthday → holdBirthday; festival: attendees + everyone in district social +20, culture demand, performers present tips ×2, emit 'festival' 0.7; swearing_in: council + attendees, emit 0.6; club_meeting: handled by attendClub (mark done). Mark done; prune yesterday's.
calendarObservation(world, c): Observation['calendar']
```
Core changes: `jobs.workShift` refuses non-exempt roles on the rest day (`REST_DAY_EXEMPT_ROLES`); `treasury.payDividend` pays ×2 on Founders' Day and ½ to children.

## src/society/chest.ts

```ts
donate(world, cId, amount): ActionResult                      // citizen → 'chest' ('donation'); reputation +1 per 20 ℓ (+1 more per 20 if wallet < 200); emit 'donation' 0.3 (0.6 if ≥ 100)
dailyChest(world): void                                       // stipend 10 ℓ to each active citizen who is homeless or has a critical need or is a ward, while chest > 0 ('stipend'); emit 'system' 0.5 when it runs dry with claimants
enactCharity(world, value): void                              // council proposal 'charity': treasury → chest
```
`treasury.balanceOf('chest')`, `transfer` to/from `'chest'`, and `moneySupply` include the chest.

## src/brains/child.ts

```ts
childDecide(world, c, obs): Action    // work hours: study (free for children, at academy — execute waives tuition for lifeStage child); evening: play/use_item/socialize with family or friends; night: rest at home; rest day: play/celebrate; never offences, never work
```
`reflex.ts` delegates to `childDecide` when `lifeStage === 'child'`.

## Reflex brain additions (`src/brains/reflex.ts`)

Insert into the existing priority list: rest day and festival behaviour (no work; attend festival/celebrate in the evening; club meetings); wants: when wallet > 3 × weekly rent + 100 and a wanted product is on a shelf here → `buy_item`; evening with a hobby item → `use_item` (30%); partner present and social < 60 → `date`/`dine`; affection ≥ 60 and single → `propose_partnership`; partnered ≥ 7 days, bond > 75, sociability > 0.5 → `marry`; married/partnered, shared home, bond > 80, savings → `start_family` (10%/day); no club and a hobby → `join_club` (existing club for the hobby) or `found_club` (ambition > 0.5, 5%/day); club meeting now here → `attend_club`; birthday of a friend here → `gift`/`gift_item`; honesty > 0.6 and wallet > 500 → `donate` (5%/day); shop employee/owner at a shop with goods → `craft` when shelf is low.

## LLM brain (`src/brains/llm-prompt.ts`, `llm-tool.ts`)

Add the new actions with one-line descriptions and the new observation blocks to the system prompt; extend the strict tool schema (hobby/productId/itemId/clubId enums or strings).

## Core hooks

- `citizens/citizen.ts createCitizen`: opts `{ lifeStage?, parents?, familyName? }`; assigns familyName (FAMILY_NAMES, unique-ish), tastes, lifeStage 'adult', bornDay, empty family/possessions/clubs/affection; children skip the arrival grant (parents gift instead) and housing.
- `citizens/departure.ts emigrate`: `family.inheritance` before removal; leaves household; leaves clubs; partner becomes single.
- `government/registry.ts exileCitizen`: `family.wardship` for children; leaves household; partner single (bond kept); clubs pruned.
- `government/court.ts selectBench`: `areFamily` ⇒ recuse.
- `world/world.ts`: daily → `refreshWantsDaily`, `restockEmporium`, `dailyPossessions`, `dailyAffection`, `dailyLifeStages`, `dailyUpkeep`, `dailyBirthdays`, `familyBondFloor`, `dailyClubs`, `scheduleMeetings`, `scheduleFestivals`, `dailyChest`; per tick end → `tickHappenings`.
- `world/scaffold.ts emptyWorld`: `households: {}`, `clubs: {}`, `emporium` via `initEmporium`, `happenings: []`, `treasury.chest: 0`.
- `test/helpers.ts makeCitizen`: default values for every new field.
- `server`: `GET /api/society` → households, clubs, happenings (today/tomorrow), chest, recent weddings/births, emporium; citizens endpoint includes family/possessions/tastes/clubs.
- `web`: a **Society** tab (families as trees/rows, clubs with members, today's happenings, chest balance, emporium shelf) and drawer additions (family, partner, possessions, hobbies, clubs, wants).
- `docs/AGENTS.md`: new actions and observation blocks.
