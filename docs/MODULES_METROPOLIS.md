# Implementation contract — the metropolis layer (skeleton)

Extends `docs/MODULES.md` and `docs/MODULES_SOCIETY.md` (same ground rules).
This skeleton fixes the **type additions and module boundaries**. A design
agent expands each module section with exact signatures before implementers
start; implementers then follow the expanded file.

## Packs and modules

| Pack | Modules (src/) | Doc section |
| ---- | -------------- | ----------- |
| Faces & stories | `identity/portrait.ts` (SVG string per citizen), `identity/goals.ts`, `identity/diary.ts`, `identity/biography.ts`, `identity/drift.ts`, `identity/health.ts` | METROPOLIS §1 |
| Justice | `government/jail.ts`, `government/advocates.ts`, `government/jury.ts`, `government/investigations.ts`, `government/gangs.ts` (+ laws L16 defamation, L17 insider trading) | §2 |
| Politics | `politics/parties.ts`, `politics/approval.ts`, `politics/promises.ts`, `politics/referendums.ts`, `politics/unions.ts`, `politics/decrees.ts` | §3 |
| Markets | `markets/property.ts`, `markets/shares.ts`, `markets/gigs.ts`, `markets/outer.ts` (Outer Cities, tariffs, tourists), `markets/levers.ts` (property/wealth tax, reserve) | §4 |
| Culture | `culture/works.ts`, `culture/museum.ts`, `culture/stadium.ts` (teams, matches, league), `culture/press.ts` (two papers, editorial lines), `culture/schools.ts` (schools of thought), `culture/menus.ts` | §5 |
| World | `world/seasons.ts` (calendar year, weather), `world/disasters.ts`, `world/growth.ts` (new districts, tram), `world/history.ts` (eras, records, monuments), `world/sunset.ts` | §6 |
| Social fabric | `social/rumours.ts`, `social/feuds.ts`, `social/mentorship.ts`, `social/feed.ts`, `social/neighbours.ts` | §7 |
| Watching & sending | `server/owners.ts` (letters home, journal, webhooks, child claims), `web/` redesign per `docs/UI.md` (no controls, no god mode) | §8, UI.md, PRINCIPLES.md |

## Type additions (`src/types.ts`) — names are fixed

```ts
export type Season = 'bloom' | 'blaze' | 'fall' | 'frost';
export type Weather = 'clear' | 'rain' | 'storm' | 'fog' | 'heat' | 'snow';
export type GoalKind = 'hold_office' | 'become_mayor' | 'own_villa' | 'lasting_business' | 'marry' | 'raise_child'
  | 'master_skill' | 'publish_work' | 'win_championship' | 'elder_standing' | 'amass_5000' | 'club_of_ten' | 'sit_as_judge';
export interface Goal { kind: GoalKind; progress: number; achievedDay: number | null }
export interface DiaryEntry { day: number; text: string }
export type SchoolOfThought = 'makers' | 'commons' | 'lanterns' | null;
export type WorkKind = 'painting' | 'play' | 'song' | 'book' | 'paper' | 'expose';
export interface Work { id: string; kind: WorkKind; title: string; creatorId: CitizenId; createdDay: number; quality: number; popularity: number; home: BuildingId; inMuseum: boolean; reviews: { paper: PaperId; score: number; day: number }[] }
export type PaperId = 'chronicle' | 'ledger';
export interface Party { id: string; name: string; platform: Platform; founderId: CitizenId; leaderId: CitizenId; members: CitizenId[]; foundedDay: number; seats: number }
export interface Referendum { id: string; petitionId: ProposalId; question: string; day: number; ayes: number; nays: number; result: 'passed' | 'failed' | null }
export interface Union { id: string; role: JobRole; name: string; members: CitizenId[]; demandWage: number; strikingUntilDay: number | null }
export interface Decree { kind: 'tax_holiday' | 'curfew' | 'relief' | 'emergency'; day: number; district: DistrictId | null; value: number }
export interface PropertyUnit { id: string; kind: 'home' | 'shopfront'; tier: HousingTier; buildingId: BuildingId; ownerId: CitizenId | 'city'; tenantId: CitizenId | BusinessId | null; rent: number }
export interface ShareListing { businessId: BusinessId; price: number; holders: Record<CitizenId, number>; float: number; lastDividendDay: number | null }
export interface Gig { id: string; title: string; pay: number; skill: Skill | null; minSkill: number; posterId: CitizenId | BusinessId; takerId: CitizenId | null; postedDay: number; doneDay: number | null }
export interface OuterMarket { prices: Record<Good, number>; tariff: number; touristsToday: number }
export interface Team { district: DistrictId; name: string; players: CitizenId[]; wins: number; losses: number; draws: number }
export interface Match { day: number; home: DistrictId; away: DistrictId; homeGoals: number; awayGoals: number; attendance: number }
export interface Investigation { id: string; suspectId: CitizenId; law: LawCode; evidence: number; openedDay: number; detectiveId: CitizenId; closedDay: number | null; caseId: CaseId | null }
export interface Gang { id: string; name: string; bossId: CitizenId; members: CitizenId[]; turf: DistrictId; foundedDay: number; bustedDay: number | null; rackets: BusinessId[] }
export interface Rumour { id: string; aboutId: CitizenId; sourceId: CitizenId; claim: string; law: LawCode | null; truthful: boolean; day: number; heardBy: CitizenId[]; disprovedDay: number | null }
export interface Feud { families: [string, string]; sinceDay: number; incidents: number; endedDay: number | null }
export interface Post { id: string; authorId: CitizenId; day: number; text: string; reactions: Record<CitizenId, 'cheer' | 'frown' | 'laugh'> }
export interface Era { cycle: number; name: string; mayorId: CitizenId | null; fromDay: number; toDay: number | null }
export interface CityRecord { key: string; label: string; holderId: CitizenId | null; value: number; day: number }
export interface Monument { id: string; honoreeId: CitizenId; inscription: string; day: number }
export interface Memorial { citizenId: CitizenId; day: number; epitaph: string }
export interface Disaster { kind: 'storm' | 'blackout' | 'data_flood' | 'forge_fire' | 'outbreak'; day: number; district: DistrictId | null; severity: number; resolvedDay: number | null }
```

Citizen additions: `goals: Goal[]`, `diary: DiaryEntry[]` (bounded 30), `milestones: { day: number; text: string }[]`, `birthTraits: Personality`, `health: { glitched: boolean; sinceDay: number | null }`, `school: SchoolOfThought`, `partyId: string | null`, `unionId: string | null`, `gangId: string | null`, `teamDistrict: DistrictId | null`, `jailedUntilDay: number | null`, `approval: { mayor: number; council: number }`, `works: string[]`, `ownedUnits: string[]`, `shares: Record<BusinessId, number>`, `mentorId: CitizenId | null`, `menteeId: CitizenId | null`, `paper: PaperId`, `sunsetDay: number | null`.

World additions: `season: Season`, `weather: Weather`, `year: number`, `works`, `parties`, `referendums`, `unions`, `decrees`, `property: Record<string, PropertyUnit>`, `shares: Record<BusinessId, ShareListing>`, `gigs`, `outer: OuterMarket`, `teams: Record<DistrictId, Team>`, `matches: Match[]`, `investigations`, `gangs`, `rumours`, `feuds`, `feed: Post[]` (bounded 500), `eras`, `records`, `monuments`, `memorials`, `disasters`, `openDistricts: DistrictId[]`, `trams: [DistrictId, DistrictId][]`, `museum: string[]`, `jailCells: number`.

Districts: add `heights` and `undercroft` to `DistrictId`, `DISTRICTS` (closed until unlocked: `openDistricts` decides adjacency and movement), and their buildings (University, Hilltop Villas, the Dome; Night Market, the Tunnels housing, Cells annex). Add `stadium` (Commons), `museum` (Archive), `hospital` (Verdant), `hall_of_records` (Commons), `harbor_ledger` (Harbor), `docks` (Harbor).

Laws: `L16` Defamation (2), `L17` Insider trading (3).

Sentence tiers become: 1 warning, 2 fine, 3 service, 4 jail, 5 suspension, 6 exile (`PenaltyTier` 1–6; severity 5 still means exile on first conviction; existing tests updated).

Actions (names fixed): `set_goal`? (no — goals are drawn), `write_diary { text }`, `visit_hospital`, `hire_advocate { advocate }`, `advocate { case }`, `found_gang { name }`, `recruit { citizen }`, `racket { business }`, `pay_racket`, `found_party { name, platform }`, `join_party { partyId }`, `leave_party`, `endorse { candidate }`, `sign_petition { proposalId }`, `vote_referendum { referendumId, aye }`, `found_union { role, name }`, `join_union { unionId }`, `strike`, `decree { kind, district?, value? }`, `buy_property { unitId }`, `sell_property { unitId }`, `let_property { unitId, rent }`, `list_shares`, `buy_shares { businessId, qty }`, `sell_shares { businessId, qty }`, `post_gig { title, pay, skill, minSkill }`, `take_gig { gigId }`, `import { good, qty }`, `export { good, qty }`, `create_work { kind, title }`, `exhibit { workId }`, `review { workId, score }`, `join_team`, `attend_match`, `train`, `adopt_school { school }`, `set_menu { dish }`, `commission_monument { honoree, inscription }` (councillors), `sunset`, `gossip { about, claim, law? }`, `apologize { to }`, `mentor { citizen }`, `post { text }`, `react { postId, kind }`, `read_paper { paper }`.

## Server and web

- `GET /api/city` (front page), `/api/profile/:id` (portrait, story, goals, tree, web, public posts, timeline), `/api/culture`, `/api/history`, `/api/portrait/:id.svg`; owner-only (Bearer key): `/api/agents/:id/letters`, `/api/agents/:id/journal`, `POST /api/agents/:childId/claim`. No `/api/sim/*` controls and no god-mode routes: observers cannot change the city.
- `web/` rebuilt per `docs/UI.md`: identity, layout rules, map glyphs and motion, the twelve tabs, components. Keep the existing JS modular pattern (one file per panel), no build step, no external assets.
