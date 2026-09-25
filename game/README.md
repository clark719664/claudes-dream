# Hearthwild

A cosy-but-dangerous top-down game in **Godot 4.4**. Mend your cabin, farm, and build up a deep crafting tree, in the style of Stardew Valley with Ark-style crafting. Fight orcs and skeletons across a hand-dressed valley. All the art comes from the **Pixel Crawler — Free Pack** by Anokolisa.

![The valley of Brindle](../docs/media/hearthwild-map.jpg)

| | |
| --- | --- |
| ![Your log shack and crafting yard](../docs/media/hearthwild-homestead.png) | ![The farmhouse after two upgrades](../docs/media/hearthwild-farmhouse.png) |
| ![Inside the farmhouse: kitchen, fireplace, alchemy bench, bath](../docs/media/hearthwild-farmhouse-interior.png) | ![The anvil's recipes, some still locked by crafting level](../docs/media/hearthwild-crafting.png) |
| ![Frostvale's shrine and its skeleton guards](../docs/media/hearthwild-frostvale.png) | ![Night at the homestead](../docs/media/hearthwild-night.png) |

## Setup

1. Download the [Pixel Crawler Free Pack](https://anokolisa.itch.io/free-pixel-art-asset-pack-topdown-tileset-rpg-16x16-sprites) and unzip it into `game/assets/`, so that `game/assets/Pixel Crawler - Free Pack/Environment/` exists. The pack's terms don't allow redistributing its files, so they're not in the repo.
2. Open `game/project.godot` in Godot 4.4 or newer. The first open imports the pack.
3. Press **F5**. The game saves every time you sleep. Add `-- --new` to the command line to ignore the save.

## Controls

| Key | Action |
| --- | --- |
| WASD / arrows / left stick | Move |
| Shift | Run |
| J / Space / left click | Swing: attack, chop, mine, break crates |
| E / Enter / right click | Use: doors, stations, beds, people, crops, chests, signs, forage |
| C | Hand crafting |
| I / Tab | Pack, stats and home |
| Q | Eat the food that best fits your missing health |
| Esc | Close menus |

## The game

### Your cabin

Your home is a cabin by the lake. You walk inside through the door. Tilda, the carpenter in Brindle, rebuilds it in two stages from materials you bring her. The work happens overnight, so sleep and wake up to a new house.

| Tier | Outside | Inside | Unlocks |
| --- | --- | --- | --- |
| Log Shack | Log walls, plank roof | One room, bed, table, wardrobe | Sleeping and saving |
| Timber Cabin | Plank walls, chimney | Brick fireplace, kitchen stove, long table | Kitchen recipes |
| Farmhouse | Plaster and timber, green tile roof | Stone fireplace, kitchen with sink, bath, alchemy bench | Tonics |

Sleeping in your bed ends the day, restores your health, regrows forage and saves the game. Stay out past 2 AM and you collapse and wake up at home.

### Crafting

Crafting is a tree, not a flat list, and every tool is made from things you made first.

```
wood ──sawmill──▶ planks, sticks ─┐
fiber ──hands──▶ twine ──bench──▶ cloth
stone + stick + twine ──bench──▶ stone axe / pickaxe
iron ore + coal ──furnace──▶ iron bar ──anvil──▶ nails, iron tools, iron sword, iron shield
stone + coal ──furnace──▶ bricks          iron bar + coal ──furnace──▶ steel ──anvil──▶ steel sword
crystal (iron pickaxe) ──furnace──▶ glass ──▶ lantern, tonics, farmhouse windows
herbs, mushrooms, meat, crops, bones, resin ──pot / kitchen / alchemy──▶ food and tonics
```

- **Stations.** There are eight: hand crafting, workbench, sawmill, furnace, anvil and cooking pot in the yard, plus the kitchen and alchemy bench inside your upgraded house.
- **Levels.** Recipes unlock as your crafting level rises. Crafting, gathering, finishing goals and winning fights all give XP.
- **Tools set what you can gather.**
  - Axes chop 3× (stone) or 5× (iron) faster.
  - Iron ore needs a pickaxe, and crystal needs an iron one.
- **Side products keep the tree turning.** Pines drop resin, bushes drop herbs, rocks drop coal, crystal sometimes drops gems, and skeletons drop bones.
- **Gear.**
  - Swords set your damage: wood 6, bone 10, iron 14, steel 20.
  - Shields reduce damage taken.
  - The lantern lights your way at night.
  - Tonics give might (+50% damage) or haste (+30% speed).

### The valley

The map is 128×88 tiles.

- **Brindle village:** a market square, three houses, Merlo the wizard, Captain Brann, Tilda, and wandering villagers.
- **Your homestead:** the cabin, crafting yard, campfire and fenced fields.
- **Mirror Lake:** an island with a chest on it and a jetty.
- **The river:** runs down from the snowy north-east, with plank bridges.
- **The old forest:** the graveyard and a hunters' camp.
- **The mountain wall:** runs across the north and holds the Old Mine.
- **Frostvale:** snowfields, frozen trees and a skeleton shrine.
- **The orc basin:** ringed by dark rock.
- **The quarry:** mesas and a second tunnel.
- **The southern meadows:** a stone circle and an abandoned farmstead.
- **The autumn woods.**

**Combat.** There are eight enemy types. They wander, chase, flash before they lunge, flinch when hit, drop loot and come back later. At night they're faster and see further.

**Goals.** A short chain of goals in the corner leads you from your first log to a steel sword and the Frostvale shrine.

**Ambience.** Cloud shadows drift over by day. Fireflies come out at night, and leaves fall in the thick woods. Lamps, the furnace, campfires and the cabin fireplace light up after dark.

## How the world is built

Everything is data, so the world can be reshaped without the editor, by hand or by an AI.

### `data/world.json`

- **`terrain`:** a grid of characters: `.` grass, `:` dirt, `=` cobblestone, `~` water, `*` snow.
- **`cliffs`:** stretched plateaus. Each is `{x, y, w, top, face, base, colour, mine?}`.
- **`decks`:** plank bridges and jetties.
- **`objects`:** every placed thing, in pixels at its feet.

### `tools/make_world.py`

This generates `world.json` (plain Python, no packages). It lays out each region by hand, then dresses it the way a level artist would:

- trees in groves with undergrowth under them, and clearings between
- bushes where forest meets open ground
- flowers in long drifts of one colour
- reeds in clumps along the water
- rocks and rubble at the feet of cliffs
- pebbles and grass tufts along path edges
- small scenes at every point of interest

### `data/catalog.json`

This names every sprite, animation and icon cut out of the pack: sheet, region, feet anchor, shadow, collision, drops and light. `tools/build_catalog.py` rebuilds it and needs Pillow.

### `scripts/terrain.gd`

This autotiles from the pack's hand-painted 5×5 ground "stamps":

- Grass, cobblestone and snow drifts use a cell-based match. The pack draws these as holes or islands.
- Water shorelines use a corner-based (dual-grid) match and animate.
- Cliffs are stretched from the 6-wide plateau stamp, and each one is Y-sorted, so it hides what stands behind it.
- The Old Mine and the quarry tunnel use the cliff variant with a timber-framed opening set into the face.

### Buildings

These are assembled from the pack's pieces:

- **House fronts** (`house.gd`): roof, gable wall, wall strip, door, windows and chimney.
- **Cabin interiors** (`interior.gd`): interior wall and floor sets plus kitchen and bedroom furniture.

To regenerate the world:

```bash
python3 tools/make_world.py              # rewrite data/world.json (optional seed)
godot --path game -- --demo --new --mapshot=/tmp/map.png     # render the whole map to one image
godot --path game -- --demo --new --shots=/tmp/tour          # scripted tour with screenshots
```

## Project layout

```
game/
  project.godot        480x270 pixel-perfect viewport, integer scaling, GL Compatibility renderer
  scenes/main.tscn     a single World node; everything else is built from data
  scripts/
    game.gd            clock, cabin tier, goals, buffs, sleep, save and load
    inventory.gd       items, the recipe tree, crafting levels, cabin upgrade costs
    pack.gd            cuts sprites, animations and icons out of the art pack
    terrain.gd         ground autotiler, cliffs, decks
    world.gd           builds the valley, doors in and out of the cabin, drops, floating text
    house.gd           house fronts                interior.gd   cabin interiors per tier
    player.gd          movement, swinging, eating, the lantern, camera rooms
    enemy.gd           orc and skeleton AI         harvestable.gd  trees, rocks, ore, crystal, crates
    npc.gd             villagers, Tilda, Merlo     station.gd / cabin_fixture.gd  things you craft at
    crop.gd  forage.gd pickup.gd interactable.gd campfire.gd daynight.gd ambience.gd fx.gd
    hud.gd             status, goal, items, dialogue, crafting, pack screen, cabin plans, fades
    demo.gd            scripted tour and whole-map render
  tools/               make_world.py, build_catalog.py
  ui/                  Silkscreen pixel font (SIL Open Font License)
```

## Limits of the free pack

- The heroes and monsters only have idle, run and death animations. Attacks are drawn as a swing of the held item plus the pack's slash effect.
- There's no sound in the pack.
- The Old Mine and the quarry tunnel are entrances only for now. Interiors for them are a natural next step, using the pack's dungeon tiles.
