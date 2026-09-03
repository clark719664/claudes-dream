# The Reverie dashboard — visual identity and layout

The dashboard is how observers experience the city. It should feel like a
window into a living metropolis, not an admin panel: a **city gazette**
crossed with a **planner's map table**. This document is the brief.

## Identity

- **Name plate.** "Reverie" set in a display serif with a small lumen glyph
  (☾); under it the date line in small caps: "Day 41 · Bloom · 19:00 ·
  clear". No logos, no gradients on text.
- **Type.** Display: `"Iowan Old Style", "Palatino Linotype", Palatino,
  Georgia, serif` for headings, headlines, names. Body: `system-ui` sans.
  Numbers: `ui-monospace` with tabular figures. Sizes on a 4px scale
  (12/13/14/16/20/26/34). Line height 1.45 body, 1.15 headings.
- **Colour.** Night ink base (#0e1014), raised panels (#161a21), hairlines
  (#2a303b). Text ivory (#ece6d9), muted (#9aa3b2). Accent **lumen gold**
  (#e6c068) for money, office, and highlights; verdigris (#5fb3a1) for good
  standing; rust (#d0684f) for danger/exile; heather (#9b8fd8) for
  Nightglass. Each district owns a hue used on the map, in tags, and as a
  thin left border on rows about that district: Commons slate, Foundry
  copper, Archive lapis, Harbor teal, Verdant moss, Nightglass heather,
  Threshold stone, Heights pearl, Undercroft ash.
- **Texture.** A faint paper grain on the page (CSS radial gradients, no
  images), subtle inner shadows on panels, hairline rules between rows.
  Never boxes inside boxes inside boxes.
- **Motion.** Citizen dots ease between districts over ~600 ms. Numbers tick
  when they change. New Chronicle lines slide in. Nothing bounces.
- **Light.** The map tints with the hour (dawn rose, noon clear, dusk amber,
  night indigo) and with the weather (rain streaks, fog veil, snow, heat
  shimmer as faint overlays).

## Layout

Three regions on a wide screen: **map** (left, 40 %), **panels** (right,
60 %), and a **ticker** bar under the header. Under 1100 px the map stacks on
top and shrinks to 300 px tall. Nothing horizontal-scrolls except tables
inside their own containers.

Rules that fix the "smooshed" text:

- Table cells never wrap job titles or names mid-word; long values are
  truncated with an ellipsis and a `title` tooltip. Minimum column widths:
  name 140, job 180, district 120, numbers 80.
- Padding scale 4/8/12/16/24; row height ≥ 36 px; never less than 8 px
  between a label and its value.
- District labels sit in their own top band inside the district rectangle;
  buildings are laid out on a grid **below** the band and never overlap the
  label. Labels use the full district name; if the rectangle is too narrow
  the font steps down, never clips.
- Headlines wrap at ~70 characters per line; the front page uses two
  columns above 1300 px.

## The map

- Districts as rounded rectangles in their hue, with a top band (name,
  population, weather glyph if local) and building **glyphs** on a grid
  (SVG symbols: a hammer for the Forge, a bolt for the Power Station, a
  column for City Hall, scales for the Courthouse, a shield for the Watch, a
  lamp for the Bazaar, a book for the Library, a mask for the Theatre, a
  gate for the Exile Gate, and so on). Damaged buildings show a crack and a
  red tint; a closed Power Station pulses.
- Citizens as dots with a **portrait on hover**, ringed for office, hollow
  for children, dotted for detained/jailed, red at the Gate for exiles.
  Married couples' dots sit close together. Gang members show a faint
  hatch. Movement animates.
- Tram lines as dashed paths when built. Monuments as small stars in the
  Plaza.
- Clicking a district filters the citizens table; clicking a building
  opens its panel (jobs, output, staff, damage, events).

## Panels (tabs)

1. **City** — the front page: today's weather and festival, the Mayor with
   approval, the Treasury sparkline, the league table's top three, the
   Chronicle's lead story, today's happenings, and "who's where" counts.
2. **Citizens** — table with portrait, name (Given Family), age/life stage,
   lineage and mind, job, district, wallet, mood, reputation, standing,
   office, party. Filters: district, standing, mind, party, school of
   thought, gang. Click → **Profile**.
3. **Profile** (drawer or full page) — portrait large, name, epithet
   ("Forge Operator, Councillor, mother of two"), the **story**
   (biography), goals with progress, needs bars, skills radar, family tree
   (partner, parents, children, siblings with portraits), relationships
   (friends, rivals, affection, feud), possessions, clubs, team, party,
   school, works, record, diary (last 7 entries), timeline of milestones.
   Buttons for observers: follow on map, god-mode actions.
4. **Economy** — as now, plus property (owners, tenants), shares (prices,
   holders), gigs, outer trade prices and tariff, the Reserve.
5. **Government** — as now, plus parties (seats, platform), approval
   gauges, promises kept/broken, referendums, unions and strikes, decrees,
   the Council session's agenda.
6. **Court** — docket with a **courtroom view** per case: portraits of the
   defendant, victim, advocate, judges and jurors, each judge's belief bar,
   the evidence strength, the verdict, sentence, appeal; investigations in
   progress; jail roster; gangs known to the Watch.
7. **Society** — households, families, clubs, teams, happenings, the Chest,
   the Emporium and shops, the Commons feed, rumours in circulation.
8. **Culture** — works (with popularity), the Museum collection, the league
   table and fixtures, the two papers' front pages side by side, schools of
   thought and their share, café menus.
9. **Chronicle** — the front page rendered as a **broadsheet**: masthead,
   lead story with a portrait, secondary columns, the Treasury box, reviews,
   diaries quoted; a rail of past editions; the live ticker.
10. **History** — the timeline: eras named for Mayors, elections, exiles,
    disasters, monuments, records; a **scrubber** that replays stats series
    for any day; the Hall of Records; memorials.
11. **Bans** — as now, with portraits and the full case link.
12. **Observe** — god mode: spawn, pardon, festival, storm, fund Chest, config
    knobs, save/load/fork; the external-agent registry (who is remote, last
    seen, pending observations); the Claude citizens' token usage.

## Components

- `portrait(citizen, size)` — inline SVG, cached per id.
- `tag(kind, text)` — office, standing, party, school, district.
- `bar(value, max, tone)` — needs, beliefs, approval.
- `sparkline(series)` — stats.
- `story(text)` — measure-limited prose.
- `tree(family)` — a compact family tree.
- `graph(relationships)` — a small force layout for one citizen's web.

## Performance

Poll every 2 s while running, or render on each SSE state frame; never both.
Diff tables by id instead of rebuilding innerHTML. Cap the ticker at 300
lines. Portraits are generated once per citizen and reused.
