"""Generates data/world.json: the terrain grid and every placed object.

    python3 tools/make_world.py [seed]

The terrain is a grid of characters, one per 16x16 cell:
    .  grass      :  dirt      =  cobblestone      ~  water
Objects are placed in pixels at their feet: {"t": sprite name, "x", "y", "v": variant}.
Hand-edit world.json afterwards or change the layout below; the game builds whatever it finds.
No third-party packages needed."""
import json, math, os, random, sys

W, H = 80, 50
SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 7
rng = random.Random(SEED)
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'world.json')

grid = [['.'] * W for _ in range(H)]
zone = [[''] * W for _ in range(H)]  # forest / rocks / meadow / camp ...


def put(x, y, ch):
    if 0 <= x < W and 0 <= y < H:
        grid[y][x] = ch


def blob(cx, cy, rx, ry, ch, wobble=0.18, seed=0):
    r2 = random.Random(seed)
    ph = [r2.uniform(0, math.tau) for _ in range(3)]
    for y in range(H):
        for x in range(W):
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            a = math.atan2(dy, dx)
            k = 1 + wobble * (math.sin(2 * a + ph[0]) * 0.6 + math.sin(3 * a + ph[1]) * 0.4 + math.sin(5 * a + ph[2]) * 0.25)
            if dx * dx + dy * dy <= k * k:
                put(x, y, ch)


def path(points, width, ch):
    """Thick polyline through cell centres."""
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
        for i in range(n + 1):
            t = i / n
            x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
            for oy in range(-(width - 1) // 2, width // 2 + 1):
                for ox in range(-(width - 1) // 2, width // 2 + 1):
                    put(int(x + ox), int(y + oy), ch)


def mark(x0, y0, x1, y1, z):
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            zone[y][x] = z


# ---------------------------------------------------------------- terrain
blob(14, 27, 9.5, 7, '~', 0.3, seed=3)       # the lake
blob(9, 33.5, 4, 2.8, '~', 0.25, seed=5)      # a cove
blob(37.5, 25, 8.5, 5.8, ':', 0.1, seed=11)   # homestead yard
for y in range(21, 30):                       # farm field
    for x in range(48, 61):
        put(x, y, ':')
blob(40, 5.5, 6.5, 3.6, '=', 0.08, seed=13)   # old graveyard courtyard
blob(69, 37, 6.5, 4.2, ':', 0.15, seed=17)    # orc camp
blob(66, 14, 3, 2, ':', 0.3, seed=19)         # quarry scrapes
blob(71, 19, 2.5, 1.6, ':', 0.3, seed=23)
path([(38, 20), (38, 16), (41, 13), (40, 9)], 2, '=')                # north road to the graveyard
path([(45, 25), (47, 25)], 2, ':')                                    # yard to farm
path([(44, 28), (50, 32), (58, 33), (63, 35)], 2, '=')                # east road to the camp
path([(30, 26), (26, 26), (24, 27)], 2, ':')                          # footpath to the lake

mark(0, 0, W, 11, 'forest')
mark(0, 0, 6, H, 'forest')
mark(W - 5, 0, W, H, 'forest')
mark(0, H - 4, W, H, 'forest')
mark(58, 8, W - 5, 26, 'rocks')
mark(22, 33, 60, H - 4, 'meadow')
mark(6, 11, 22, 40, 'lakeside')

# ---------------------------------------------------------------- objects
objs = []
occupied = []  # (x, y, r) in pixels


def cell(px, py):
    return grid[int(py // 16)][int(px // 16)] if 0 <= px < W * 16 and 0 <= py < H * 16 else '#'


def near(px, py, chars, radius):
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if cell(px + dx * 16, py + dy * 16) in chars:
                return True
    return False


def free(px, py, r):
    return all((px - x) ** 2 + (py - y) ** 2 >= (r + rr) ** 2 for x, y, rr in occupied)


def add(t, px, py, v=None, r=0, **extra):
    o = {'t': t, 'x': int(px), 'y': int(py)}
    if v is not None:
        o['v'] = v
    o.update(extra)
    objs.append(o)
    if r:
        occupied.append((px, py, r))
    return o


def scatter(n, pick, test, r, tries=40):
    placed = 0
    for _ in range(n * tries):
        if placed >= n:
            break
        px, py = rng.uniform(8, W * 16 - 8), rng.uniform(8, H * 16 - 8)
        if not test(px, py) or not free(px, py, r):
            continue
        t, v = pick(px, py)
        add(t, px, py, v, r)
        placed += 1


def zone_at(px, py):
    return zone[int(py // 16)][int(px // 16)]


# camp and crafting yard (hand placed)
yard = [('workbench', 33, 22), ('anvil', 36.5, 22), ('furnace', 40, 21.6), ('sawmill', 43.2, 23.4),
        ('cookpot', 34, 28.6), ('sack', 31.4, 24.2), ('sack', 31.9, 25.0), ('crate_crops', 41.6, 28.9), ('crate_crops', 42.6, 29.1)]
for i, (t, x, y) in enumerate(yard):
    r = {'workbench': 20, 'anvil': 18, 'furnace': 16, 'sawmill': 34, 'cookpot': 14}.get(t, 8)
    add(t, x * 16, y * 16, i % 2 if t in ('sack', 'crate_crops') else 0, r)
add('campfire', 38 * 16, 26.5 * 16, r=12, light=1)
add('log_seat', 36.2 * 16, 27.6 * 16, 0, 6)
add('log_seat', 39.8 * 16, 27.6 * 16, 1, 6)
add('npc', 36 * 16, 24.6 * 16, actor='wizard', name='Merlo')
add('player_start', 38 * 16, 25 * 16)

# farm: tilled rows with crops at different stages, scarecrow and fences
crop_kinds = ['carrot', 'beet', 'cabbage', 'lettuce', 'cauliflower', 'broccoli', 'garlic']
for row, fy in enumerate([22.5, 24.5, 26.5, 28.5]):
    kind = crop_kinds[(row * 2) % len(crop_kinds)]
    for fx in range(49, 60):
        add('soil', fx * 16 + 8, fy * 16, 0)
        if (fx + row) % 5 != 0:
            add('crop', fx * 16 + 8, fy * 16 + 5, kind=kind, stage=rng.choice([1, 2, 3, 3, 3]))
add('scarecrow', 54.5 * 16, 25.6 * 16, 0, 6)
for i in range(6):  # fence sections are 36 px wide
    add('fence', 48 * 16 + 14 + i * 36, 21 * 16, 0, 0)
    add('fence', 48 * 16 + 14 + i * 36, 30.2 * 16, 0, 0)

# graveyard: coffins, banners, a weapon rack, skeletons
for i, (x, y) in enumerate([(36.5, 4.2), (38.5, 4.0), (41.5, 4.0), (43.5, 4.2)]):
    add('coffin', x * 16, y * 16, i % 2, 7)
for i, (x, y) in enumerate([(35, 3.2), (45, 3.2)]):
    add('banner', x * 16, y * 16, 1, 4)
add('weapon_rack', 40 * 16, 7.4 * 16, 0, 18)
add('gate', 34.4 * 16, 6.8 * 16, 0, 6)
add('gate', 45.6 * 16, 6.8 * 16, 0, 6)
for i, (x, y) in enumerate([(37, 6), (43, 6.5), (40, 3.2), (39, 8.5)]):
    add('enemy', x * 16, y * 16, actor=['skeleton', 'skeleton_rogue', 'skeleton_warrior', 'skeleton_mage'][i], home=[x * 16, y * 16])

# orc camp
add('spit', 69 * 16, 37.2 * 16, 0, 16, light=1)
for i, (x, y) in enumerate([(64.5, 33.6), (73.5, 33.6), (69, 32.4)]):
    add('banner', x * 16, y * 16, [0, 0, 2][i], 4)
add('log_seat', 66.8 * 16, 38.8 * 16, 0, 6)
add('log_seat', 71.2 * 16, 38.8 * 16, 1, 6)
add('sack', 73 * 16, 39.4 * 16, 1, 6)
for i, (x, y) in enumerate([(66, 36), (72, 36.5), (68, 40), (70.5, 34.5)]):
    add('enemy', x * 16, y * 16, actor=['orc', 'orc_rogue', 'orc_shaman', 'orc_warrior'][i], home=[x * 16, y * 16])

# lakeside reeds and a few rocks by the water
def shore_land(px, py):
    return cell(px, py) == '.' and near(px, py, '~', 1)
scatter(40, lambda px, py: ('cattail', rng.randrange(4)), shore_land, 5)
scatter(6, lambda px, py: ('rock', rng.randrange(4)), shore_land, 8)

# mining area
rocky = lambda px, py: zone_at(px, py) == 'rocks' and cell(px, py) in '.:' and not near(px, py, '=', 1)
scatter(10, lambda px, py: (rng.choice(['boulder', 'boulder', 'boulder_brown']), rng.randrange(2)), rocky, 16)
scatter(10, lambda px, py: ('ore_rock', rng.randrange(2)), rocky, 10)
scatter(7, lambda px, py: ('crystal', rng.randrange(3)), rocky, 9)
scatter(16, lambda px, py: ('rock', rng.randrange(4)), rocky, 8)

# forest: dense pines in the north, mixed trees on the edges
def forest_ok(px, py):
    return zone_at(px, py) == 'forest' and cell(px, py) == '.' and not near(px, py, '=:~', 1)
def forest_pick(px, py):
    north = py < 11 * 16
    r = rng.random()
    if north:
        if r < 0.28: return 'pine_big', rng.randrange(4)
        if r < 0.85: return 'pine', rng.randrange(4)
        if r < 0.93: return 'oak', rng.randrange(2)
        return 'pine_dead', 0
    if r < 0.45: return 'oak', rng.randrange(4)
    if r < 0.6: return 'oak_big', rng.randrange(4)
    if r < 0.9: return 'pine', rng.randrange(4)
    return 'oak_dead', 0
scatter(260, forest_pick, forest_ok, 13)

# trees dotted around the open land
def open_tree(px, py):
    z = zone_at(px, py)
    return z in ('', 'meadow', 'lakeside') and cell(px, py) == '.' and not near(px, py, '=:~', 3)
scatter(14, lambda px, py: (rng.choice(['oak', 'oak', 'oak_big', 'pine']), rng.randrange(4)), open_tree, 30)

# bushes along the forest edge and in the meadow
def bush_ok(px, py):
    return cell(px, py) == '.' and not near(px, py, '=:~', 1)
scatter(40, lambda px, py: (rng.choice(['bush', 'bush', 'bush_big']), rng.choice([0, 0, 1, 1, 2, 3])), bush_ok, 12)
scatter(6, lambda px, py: ('dead_shrub', rng.randrange(2)), bush_ok, 10)

# ground cover (no collision): flower patches, tufts, ferns, mushrooms, pebbles, twigs
def grass_ok(px, py):
    return cell(px, py) == '.' and not near(px, py, '~', 0)
colours = ['orange', 'white', 'blue', 'yellow']
for _ in range(34):
    for _ in range(40):
        cx, cy = rng.uniform(0, W * 16), rng.uniform(0, H * 16)
        if grass_ok(cx, cy) and zone_at(cx, cy) != 'forest':
            break
    colour = rng.choice(colours)
    for _ in range(rng.randrange(4, 11)):
        px, py = cx + rng.gauss(0, 14), cy + rng.gauss(0, 10)
        if grass_ok(px, py) and free(px, py, 3):
            add('flower_' + colour, px, py, rng.randrange(8))
for _ in range(900):
    px, py = rng.uniform(4, W * 16 - 4), rng.uniform(4, H * 16 - 4)
    if not grass_ok(px, py) or not free(px, py, 4):
        continue
    z = zone_at(px, py)
    r = rng.random()
    if z == 'forest':
        if r < 0.35: add('fern', px, py, rng.randrange(4))
        elif r < 0.6: add('mushroom', px, py, rng.randrange(5))
        elif r < 0.7: add('mushroom_tall', px, py, rng.randrange(2))
        elif r < 0.85: add('twig', px, py, rng.randrange(7))
        else: add('tuft', px, py, rng.randrange(9))
    elif z == 'rocks':
        if r < 0.5: add('pebble', px, py, rng.randrange(8))
        else: add('tuft_dry', px, py, rng.randrange(5))
    else:
        if r < 0.72: add('tuft', px, py, rng.randrange(9))
        elif r < 0.8: add('fern', px, py, rng.randrange(2))
        elif r < 0.9: add('pebble', px, py, rng.randrange(8))
        else: add('twig', px, py, rng.randrange(7))
for _ in range(90):   # pebbles and leaves on paths and dirt
    px, py = rng.uniform(0, W * 16), rng.uniform(0, H * 16)
    if cell(px, py) in '=:' and free(px, py, 10):
        add(rng.choice(['pebble', 'pebble', 'leaves']), px, py, rng.randrange(2))
for _ in range(10):
    px, py = rng.uniform(0, W * 16), rng.uniform(0, H * 16)
    if cell(px, py) == '.' and zone_at(px, py) in ('meadow', '') and free(px, py, 8) and not near(px, py, '=:~', 1):
        add('foxglove', px, py, rng.randrange(3), 3)

world = {
    'tile': 16, 'width': W, 'height': H, 'seed': SEED,
    'legend': {'.': 'grass', ':': 'dirt', '=': 'cobblestone', '~': 'water'},
    'terrain': [''.join(r) for r in grid],
    'objects': objs,
}
with open(OUT, 'w') as f:
    json.dump(world, f, separators=(',', ':'))
print(f'wrote {OUT}: {len(objs)} objects')
