# The planet

The Expanse is not a map. It is a world — a whole planet, generated once from
the world seed, that an observer can look at from orbit and then fall into,
all the way down until they can read the name over a shop door and watch a
citizen walk through it.

## 1. The globe

```
circumference   4096 leagues east–west     (1 league ≈ 1 km)
height          2048 leagues pole to pole
wrap            east–west wraps; north and south are ice and nothing crosses
day             the sun crosses in 24 ticks; longitude sets local dawn
year            4 cycles of 28 days — Bloom, Blaze, Fall, Frost
```

The canonical store is an equirectangular field. Everything the engine does
— distance, routes, weather, daylight — is computed on the sphere, so a
journey near the pole is genuinely shorter in leagues than the flat picture
suggests, and the aerial view projects it back honestly.

## 2. How the world is made

Terrain is generated deterministically from `world.seed` at creation and
never changes except where citizens change it. No noise library: the engine
carries its own seeded value-noise with fractal octaves, which keeps the
build dependency-free and the planet reproducible from the seed alone.

1. **Plates.** 14–20 seed points scattered on the sphere, grown by weighted
   Voronoi into plates, each given a drift vector. Plate boundaries that push
   together raise mountains; boundaries that pull apart open rifts and seas.
2. **Elevation.** Fractal noise (6 octaves) added to the plate field, then
   sea level set so that **31 %** of the surface is land. Result: 3–5 major
   continents and a scatter of islands, different every seed.
3. **Temperature.** Latitude, minus elevation lapse, plus a warm-current term
   along west-facing coasts.
4. **Moisture.** Prevailing winds carried inland from oceans and dropped by
   mountains, so ranges cast real **rain shadows** — the dry side of a range
   is where the deserts are.
5. **Rivers.** Rainfall routed downhill by steepest descent, accumulating
   into streams and rivers; where a river meets the sea it builds a delta.
   Reverie sits on one.
6. **Biomes** from temperature × moisture × elevation: ice, tundra, taiga,
   temperate forest, grassland, steppe, desert, savanna, jungle, wetland,
   highland, alpine, and the coasts and shelves between them.

## 3. Why terrain matters

Biome is not scenery. A city's **hinterland** — the land within 40 leagues —
determines what it can produce cheaply, and that is the root of every trade
route in the world:

| Hinterland | Cheap | Dear |
| --- | --- | --- |
| Grassland, delta, wetland | compute (the staple), culture | energy, tools |
| Highland, alpine, ore-bearing | energy, goods, tools | compute |
| Forest, taiga | goods, housing timber | knowledge |
| Coast, shelf | freight, trade goods | anything grown |
| Desert, steppe | little — but the passes through it are worth holding | everything |
| Ruinfields | **salvage** found nowhere else | food, safety |

Solene is on a floodplain because it is the granary. Cinderhold is in the
ore-mountains because it is the forge. The Verge is on a ruinfield because
that is where salvage is. Site the cities and the economy follows.

## 4. Scale and travel

```
on foot          4 leagues/tick        a day's walk ≈ 96 leagues
road             8 leagues/tick        maintained; condition matters
river barge     14 leagues/tick        downstream faster than up
sea             22 leagues/tick        deepwater; storms in Frost
mountain pass    2 leagues/tick        closed in Frost unless cleared
```

The founding cities sit 300–900 leagues apart: two to five days by road,
under two by sea. Far enough that a journey is a decision, close enough that
a merchant can make a living going back and forth.

Between cities is the **Waylands** — not simulated at citizen resolution.
A traveller there is a marker on the road with an arrival time, a hazard
roll, and whatever they are carrying.

## 5. Zoom — the aerial view

Eight levels, each a genuine change of what the world *is*, not just a
scale factor. The observer pans and zooms freely and continuously; the client
crossfades between levels rather than snapping.

| L | Span across | What you see |
| --- | --- | --- |
| **0** Orbit | whole planet | The globe on an orthographic projection, rotatable by dragging. Oceans, continents, ice caps, the day/night terminator sweeping across, storm systems, and cities as points of light — brighter with population. |
| **1** Continent | ~2000 leagues | Biome colour, mountain relief, river systems, coastlines. Cities as named markers sized by population and tinted by government form. Trade routes drawn as arcs whose thickness is this week's traffic. |
| **2** Region | ~500 leagues | Terrain relief with hillshading, forests and marshes as texture, roads and rivers as drawn lines with their condition, caravans and travellers as moving marks with a heading, weather fronts overlaid. |
| **3** Hinterland | ~120 leagues | The land a city lives off: farms, mines, quarries, salvage fields, waystations, bandit country. The city itself resolves into a shape with walls, gates and its harbour. |
| **4** City | ~30 leagues | Districts in their own colours with names, the road grid, the river, every public building drawn as a footprint. Citizen density as a soft heat. |
| **5** District | ~8 leagues | Individual buildings with names and their state — damaged, closed, under construction. Citizens appear as dots, moving. Land value as an optional overlay. |
| **6** Street | ~2 leagues | Every citizen is a **portrait** with their name and what they are doing this hour: *Ondine Ashgrove — working at the Compute Forge*. Doors, shopfronts with their shelves, the market's stalls, the Court in session, the cells. |
| **7** Person | one building | Inside: who is in this room, what they are saying to each other, the shop's prices, the case being heard, the shift being worked. |

**Following.** Click a citizen at any level and the view locks to them. Zoom
out and it keeps them centred; zoom in and you are over their shoulder. A
follow persists across ticks, so you can watch one agent's whole day — walk
to work, a shift, a drink at the Halflight, home.

**Overlays**, toggled at any level: land value, crime in the last fortnight,
wealth, repute, government form, trade volume, disease, pollution, weather,
who is where from a given city, and the diplomatic web.

## 6. How it is served

Static terrain is generated once and cut into a **tile pyramid** — 256×256
tiles, levels 0–5, each a compact typed payload of biome, elevation and
hydrology rather than an image, so the client can restyle without refetching
and overlays cost nothing extra. Tiles are generated on demand, cached on
disk, and never regenerate: the planet does not change.

Live entities come from a viewport query:

```
GET /api/view?level=5&x=…&y=…&w=…&h=…&overlays=land,crime
   → { citizens: [...], vehicles: [...], happenings: [...], buildings: [...],
       weather: {...}, at: tick }
```

Only what is in frame, only at the resolution that level needs: at L1 the
answer is six city markers; at L6 it is forty citizens with portraits and
current actions. The server never sends a hundred thousand entities to draw
six dots.

Movement is **interpolated client-side** between ticks, so citizens glide
rather than teleport, and the world looks alive at a pace of one city hour
every twenty seconds.

## 7. Drawn without a single dependency

Canvas 2D, one full-screen element, no libraries, no images, no tile server.

- Terrain painted from tile data with a hypsometric palette and analytical
  hillshading computed from the elevation field.
- Rivers, roads and coastlines as paths, simplified per level.
- Buildings as generated footprints — deterministic from the building id, so
  the Courthouse has the same shape every time you look at it.
- Portraits as the inline SVG the identity layer already generates, cached.
- The whole thing is one render loop on `requestAnimationFrame`, with the
  entity query on its own interval, and it degrades to a static frame if the
  tab is hidden.

Budget: 60 fps at L6 with 300 visible citizens on a laptop, and a first
paint under a second at any level.

## 8. What a citizen knows

The aerial view is for **observers**, who see everything (`PRINCIPLES.md` §5).
Citizens do not have it. A citizen knows:

- the district they are in, in full;
- their own city, as anyone living in it would;
- other cities only as far as they have travelled there, read of them in a
  Chronicle, or been told by someone who has;
- the Waylands only along roads they have walked.

So a Reverie native may genuinely not know what Cinderhold charges for
energy, and a merchant who does know has something worth selling. Maps are a
tradeable good: `buy_map { region }` at any Exchange.

## 9. Room to grow

The planet is generated with **60 viable city sites** — river mouths,
sheltered bays, mountain passes, ore fields, ruinfields — of which six are
founded at the start. The rest are empty, named, and waiting.

A party of twelve or more citizens with a wagon, 5 000 in coin and a charter
they have written between them can leave through any Gate, travel to an empty
site, and found a city of their own. It appears on the planet, on the trade
routes, and in every other city's diplomacy panel the day it is declared.

Nobody has to found it. But the room is there, and it is real.
