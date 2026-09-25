"""Generates data/world.json for Hearthwild: terrain, cliffs, decks and every placed object.

    python3 tools/make_world.py [seed]

The layout is authored region by region (mountains, forest, graveyard, river, lake, village,
homestead, orc fort, quarry, meadows, autumn woods, Frostvale) and then dressed the way a level
artist would: trees in groves with undergrowth, bushes along forest edges, flowers in drifts,
reeds in clumps, pebbles along paths, rocks at cliff feet, small scenes at points of interest.

Terrain characters, one per 16x16 cell:
    .  grass    :  dirt    =  cobblestone    ~  water    *  snow (over grass)
Objects: {"t": sprite, "x", "y", "v": variant, ...} in pixels at the object's feet.
No third-party packages needed."""
import json, math, os, random, sys

W, H = 128, 88
SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 11
rng = random.Random(SEED)
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'world.json')

grid = [['.'] * W for _ in range(H)]
zone = [[''] * W for _ in range(H)]
solid = [[False] * W for _ in range(H)]   # cliffs and building footprints: nothing grows here
keep_clear = [[False] * W for _ in range(H)]  # plazas, doorways: no random dressing
cliffs, decks, objs, occupied = [], [], [], []


# ------------------------------------------------------------------ helpers
class Noise:
    """Smooth value noise, enough to give forests clumps and clearings."""
    def __init__(self, seed, scale):
        self.r = random.Random(seed)
        self.scale = scale
        self.g = {}

    def _v(self, i, j):
        if (i, j) not in self.g:
            self.g[(i, j)] = self.r.random()
        return self.g[(i, j)]

    def __call__(self, x, y):
        x, y = x / self.scale, y / self.scale
        i, j = math.floor(x), math.floor(y)
        fx, fy = x - i, y - j
        sx, sy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
        a = self._v(i, j) + (self._v(i + 1, j) - self._v(i, j)) * sx
        b = self._v(i, j + 1) + (self._v(i + 1, j + 1) - self._v(i, j + 1)) * sx
        return a + (b - a) * sy


n_big = Noise(SEED * 3 + 1, 11)
n_small = Noise(SEED * 5 + 2, 4)


def inside(x, y):
    return 0 <= x < W and 0 <= y < H


def put(x, y, ch):
    if inside(x, y):
        grid[y][x] = ch


def get(x, y):
    return grid[y][x] if inside(x, y) else '#'


def blob(cx, cy, rx, ry, ch, wobble=0.18, seed=0, only=None):
    r2 = random.Random(seed)
    ph = [r2.uniform(0, math.tau) for _ in range(3)]
    for y in range(max(0, int(cy - ry * 1.6)), min(H, int(cy + ry * 1.6) + 1)):
        for x in range(max(0, int(cx - rx * 1.6)), min(W, int(cx + rx * 1.6) + 1)):
            dx, dy = (x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry
            a = math.atan2(dy, dx)
            k = 1 + wobble * (math.sin(2 * a + ph[0]) * 0.6 + math.sin(3 * a + ph[1]) * 0.4 + math.sin(5 * a + ph[2]) * 0.25)
            if dx * dx + dy * dy <= k * k and (only is None or grid[y][x] in only):
                grid[y][x] = ch


def rect(x0, y0, x1, y1, ch):
    for y in range(y0, y1):
        for x in range(x0, x1):
            put(x, y, ch)


def spline(points, steps=12):
    """Catmull-Rom through the points, so roads and rivers bend instead of zig-zagging."""
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3) for k in (0, 1)))
    out.append(points[-1])
    return out


def stroke(points, width, ch, only=None, jitter=0.0):
    for (x, y) in spline(points):
        w = width + (rng.random() * jitter if jitter else 0)
        r = w / 2
        for yy in range(int(y - r - 1), int(y + r + 2)):
            for xx in range(int(x - r - 1), int(x + r + 2)):
                if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r and inside(xx, yy):
                    if only is None or grid[yy][xx] in only:
                        grid[yy][xx] = ch


def mark(x0, y0, x1, y1, z):
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            zone[y][x] = z


def zone_at(px, py):
    x, y = int(px // 16), int(py // 16)
    return zone[y][x] if inside(x, y) else ''


def cell(px, py):
    return get(int(px // 16), int(py // 16))


def near(px, py, chars, radius):
    cx, cy = int(px // 16), int(py // 16)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if get(cx + dx, cy + dy) in chars:
                return True
    return False


def is_solid(px, py, pad=0):
    cx, cy = int(px // 16), int(py // 16)
    for dy in range(-pad, pad + 1):
        for dx in range(-pad, pad + 1):
            x, y = cx + dx, cy + dy
            if inside(x, y) and solid[y][x]:
                return True
    return not inside(cx, cy)


def clear_at(px, py):
    cx, cy = int(px // 16), int(py // 16)
    return inside(cx, cy) and keep_clear[cy][cx]


def free(px, py, r):
    for x, y, rr in occupied:
        if (px - x) ** 2 + (py - y) ** 2 < (r + rr) ** 2:
            return False
    return True


def add(t, px, py, v=None, r=0, **extra):
    o = {'t': t, 'x': int(round(px)), 'y': int(round(py))}
    if v is not None:
        o['v'] = v
    o.update(extra)
    objs.append(o)
    if r:
        occupied.append((px, py, r))
    return o


def T(x, y):
    """Tile coordinates to pixel coordinates (cell centre)."""
    return x * 16 + 8, y * 16 + 8


def cliff(x, y, w, top=5, face=0, base='grass', colour=1, mine=None):
    c = {'x': x, 'y': y, 'w': w, 'top': top, 'face': face, 'base': base, 'colour': colour}
    if mine is not None:
        c['mine'] = mine
    cliffs.append(c)
    h = top + face + 5
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if inside(xx, yy):
                solid[yy][xx] = True
    # keep a little room along the foot of the cliff
    return h


def deck(x, y, w, h):
    decks.append({'x': x, 'y': y, 'w': w, 'h': h})
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            if inside(xx, yy):
                keep_clear[yy][xx] = True


def clear_rect(x0, y0, x1, y1):
    for y in range(max(0, y0), min(H, y1)):
        for x in range(max(0, x0), min(W, x1)):
            keep_clear[y][x] = True


def ground_ok(px, py, chars='.', pad=0):
    return cell(px, py) in chars and not is_solid(px, py, pad) and not clear_at(px, py)


# ------------------------------------------------------------------ terrain
# Mirror Lake in the west, with an island and a cove
blob(16, 48, 12.5, 10, '~', 0.28, seed=3)
blob(9, 60, 6, 4.2, '~', 0.25, seed=5)
blob(24, 40, 5, 3.5, '~', 0.3, seed=7)
blob(14, 47, 3.2, 2.6, '.', 0.2, seed=9)           # the island
# the river: from the snowy heights in the north-east down into the lake
river = [(112, 14), (104, 18), (94, 21), (84, 23), (74, 27), (64, 31), (52, 33), (42, 35), (32, 38), (26, 41)]
stroke(river, 3.2, '~', jitter=0.9)
# Frostvale: snow over the north-east
for y in range(H):
    for x in range(W):
        d = (x - 118) ** 2 / 34 ** 2 + (y - 4) ** 2 / 30 ** 2
        if d + (n_small(x, y) - 0.5) * 0.35 < 1.0 and grid[y][x] == '.':
            grid[y][x] = '*'
# Brindle village square and its streets
blob(66, 44, 7.5, 5.2, '=', 0.1, seed=11)
# homestead yard and fields
blob(45, 58, 8, 4.6, ':', 0.12, seed=13)
rect(55, 55, 65, 63, ':')
# roads: cobbles in the village, packed dirt beyond
stroke([(66, 40), (65, 35), (61, 31), (58, 26), (57, 21), (57, 16)], 2.4, ':')          # north road to the mine
stroke([(58, 26), (48, 24), (38, 22), (28, 21)], 2.0, ':')                                # forest track to the graveyard
stroke([(59, 44), (50, 42), (40, 42), (34, 45), (33, 46)], 2.4, ':')                      # west road to the lake jetty
stroke([(73, 45), (82, 46), (90, 47), (98, 47)], 2.4, ':')                                # east road to the orc fort
stroke([(66, 49), (65, 55), (64, 62), (66, 68), (70, 72)], 2.2, ':')                      # south road to the old farmstead
stroke([(66, 62), (76, 66), (88, 70), (98, 73)], 2.0, ':')                                # quarry track
stroke([(51, 56), (55, 52), (58, 49), (60, 47)], 2.0, ':')                                # homestead lane
for pts in ([(60, 45), (72, 45)], [(66, 39), (66, 50)]):
    stroke(pts, 2.4, '=', only=':=')                                                     # cobbled streets
# graveyard courtyard, orc yard, quarry floor, farmstead yard
blob(21, 20, 6.5, 4.2, '=', 0.08, seed=15)
blob(110, 47, 10, 8, ':', 0.2, seed=17)
blob(106, 74, 13, 8, ':', 0.3, seed=19)
blob(71, 73, 5, 3.4, ':', 0.2, seed=21)
blob(38, 13, 3, 2.2, ':', 0.3, seed=23)            # hunters' camp
blob(113, 20, 4, 3, '=', 0.1, seed=25, only='*.')  # frost shrine floor

# ------------------------------------------------------------------ zones
mark(0, 0, W, H, 'wild')
mark(0, 6, 46, 34, 'forest')
mark(0, 60, 34, H, 'autumn')
mark(84, 0, W, 34, 'frost')
mark(94, 34, W, 60, 'fort')
mark(86, 60, W, H, 'quarry')
mark(34, 62, 86, H, 'meadow')
mark(56, 34, 78, 52, 'village')
mark(36, 48, 64, 62, 'homestead')
mark(0, 34, 34, 64, 'lake')
mark(46, 6, 84, 34, 'north')

# ------------------------------------------------------------------ cliffs
# the northern range: overlapping plateaus, gray rock, snowy in the east
x = -2
while x < W:
    w = rng.randint(9, 16)
    y = rng.randint(-5, -2)
    base = 'snow' if x > 86 else 'grass'
    cliff(x, y, w, top=rng.randint(5, 7), face=rng.randint(0, 1), base=base, colour=1)
    x += w - rng.randint(2, 4)
cliff(50, 1, 13, top=5, face=1, base='grass', colour=1, mine=5)       # the old mine
cliff(92, 3, 10, top=5, face=0, base='snow', colour=1)
# dark rock walls around the orc fort
cliff(118, 30, 12, top=8, face=1, base='none', colour=2)
cliff(98, 33, 13, top=4, face=0, base='none', colour=2)
cliff(122, 44, 8, top=6, face=1, base='none', colour=2)
# quarry mesas (brown), one with a tunnel
cliff(96, 62, 9, top=5, face=0, base='none', colour=0)
cliff(112, 64, 12, top=5, face=1, base='none', colour=0, mine=4)
cliff(90, 78, 6, top=4, face=0, base='none', colour=0)
cliff(120, 76, 8, top=6, face=0, base='none', colour=0)
# a lone mesa in the meadows and one by the lake
cliff(78, 76, 7, top=4, face=0, base='grass', colour=0)
cliff(2, 26, 6, top=4, face=0, base='grass', colour=1)

# ------------------------------------------------------------------ bridges and the jetty
deck(56, 29, 5, 6)     # north road over the river
deck(31, 35, 5, 6)     # forest track crossing near the lake
deck(26, 45, 7, 3)     # jetty out into Mirror Lake
clear_rect(26, 44, 34, 49)

# ------------------------------------------------------------------ set pieces
def ring(cx, cy, n, r, fn):
    for i in range(n):
        a = i / n * math.tau + rng.uniform(-0.15, 0.15)
        fn(cx + math.cos(a) * r, cy + math.sin(a) * r * 0.7, i)


# --- Brindle village: market stalls, lamps, benches, planters, a notice board, villagers
clear_rect(59, 39, 74, 50)
vx, vy = T(66, 44)
for i, (dx, dy) in enumerate([(-80, -36), (-40, -44), (40, -44), (80, -36)]):
    px, py = vx + dx, vy + dy
    add('table', px, py, 0, 14)
    add('crate_crops', px - 10, py + 10, i % 7, 6)
    add('crate_crops', px + 12, py + 11, (i + 3) % 7, 6)
    add('sack', px + 18, py - 2, i % 2, 5)
for (dx, dy) in [(-104, -10), (100, 30), (-50, 52)]:
    add('lamp_post', vx + dx, vy + dy, 0, 6)
add('bench', vx - 40, vy + 30, 0, 12)
add('bench', vx + 44, vy + 30, 0, 12)
add('planter', vx - 12, vy + 38, 1, 6)
add('planter', vx + 14, vy + 38, 1, 6)
add('planter', vx - 60, vy - 70, 0, 6)
add('signpost', vx - 8, vy - 58, 0, 6, text='North: the Old Mine, the graveyard.   West: Mirror Lake.   East: Orc country - keep out!   South: the old farmstead and the quarry.')
add('npc', vx + 4, vy + 6, actor='wizard', name='Merlo')
add('npc', vx - 70, vy - 20, actor='knight', name='Captain Brann', lines='guard')
add('npc', 72 * 16 - 24, 40 * 16 + 4, actor='peasant', name='Tilda', lines='carpenter')
add('villager', vx - 30, vy + 20, actor='tavern_a', name='Rosa', span=48)
add('villager', vx + 30, vy - 30, actor='tavern_b', name='Wren', span=40)
add('barrel', vx - 104, vy + 22, 0, 6)
add('barrel', vx - 92, vy + 26, 0, 6)
add('pot', vx - 98, vy + 34, 0, 5)
add('bucket', vx + 108, vy + 20, 2)
# houses around the square
for (tx_, ty_, style, name, box) in [(72, 38, 'plaster', "Tilda's house", (68, 29, 77, 39)),
                                     (55.5, 38, 'log', 'The Millers', (51, 29, 60, 39)),
                                     (80, 46, 'plank', "Brann's house", (76, 37, 85, 47))]:
    add('house', tx_ * 16 + 8, ty_ * 16 + 4, style=style, name=name)
    for yy in range(box[1], box[3]):
        for xx in range(box[0], box[2]):
            if inside(xx, yy):
                solid[yy][xx] = True
    add('planter', tx_ * 16 - 40, ty_ * 16 + 10, 1, 6)
    add('bucket', tx_ * 16 + 44, ty_ * 16 + 8, 0)

# --- the homestead: your cabin, crafting yard, campfire, lumber, fenced farm
cx_, cy_ = 45 * 16 + 8, 53 * 16 + 4
add('cabin', cx_, cy_)
for yy in range(44, 54):
    for xx in range(41, 50):
        if inside(xx, yy):
            solid[yy][xx] = True
hx, hy = T(45, 58)
yard = [('workbench', -74, -2, 20), ('anvil', -44, 26, 18), ('furnace', 58, -22, 16), ('sawmill', 84, 16, 34), ('cookpot', -12, 40, 14)]
for t, dx, dy, r in yard:
    add(t, hx + dx, hy + dy, 0, r)
add('campfire', hx + 18, hy + 12, r=12, light=1)
add('log_seat', hx - 6, hy + 22, 0, 6)
add('log_seat', hx + 44, hy + 20, 1, 6)
add('player_start', cx_, cy_ + 20)
add('sack', cx_ - 52, cy_ - 8, 0, 5)
add('sack', cx_ - 44, cy_ - 2, 1, 5)
add('barrel', cx_ + 50, cy_ - 10, 0, 6)
add('bucket', cx_ + 60, cy_ - 4, 1)
add('planter', cx_ - 30, cy_ + 2, 1, 6)
add('chest', hx - 100, hy + 20, 0, 6, loot=2, id='homestead')
clear_rect(37, 53, 54, 63)
# fields: tilled rows with crops, scarecrow, fences
crop_kinds = ['carrot', 'beet', 'cabbage', 'lettuce', 'cauliflower', 'broccoli', 'garlic']
for row, fy in enumerate([56, 58, 60]):
    kind = crop_kinds[(row * 3) % len(crop_kinds)]
    for fx in range(56, 64):
        add('soil', fx * 16 + 8, fy * 16 + 8, 0)
        if (fx + row) % 6 != 0:
            add('crop', fx * 16 + 8, fy * 16 + 13, kind=kind, stage=rng.choice([1, 2, 3, 3]))
add('scarecrow', 60 * 16, 59 * 16 + 4, 0, 6)
for i in range(4):
    add('fence', 55 * 16 + 18 + i * 36, 55 * 16 - 2, 0)
    add('fence', 55 * 16 + 18 + i * 36, 62 * 16 + 14, 0)
clear_rect(55, 54, 65, 63)

# --- graveyard in the old forest
gx, gy = T(21, 20)
clear_rect(15, 16, 28, 25)
for i in range(5):
    add('coffin', gx - 64 + i * 32, gy - 30, i % 2, 7)
for i, (dx, dy) in enumerate([(-80, 10), (-64, 34), (72, 8), (60, 32), (-20, 40), (24, 42)]):
    add('tombstone', gx + dx, gy + dy, 0, 5)
add('banner', gx - 96, gy - 40, 1, 4)
add('banner', gx + 96, gy - 40, 1, 4)
add('mine_carts', gx + 30, gy + 4, 1, 8)
add('chest', gx, gy - 44, 0, 6, loot=3, id='graveyard')
for i, (dx, dy, a) in enumerate([(-40, 0, 'skeleton'), (40, 4, 'skeleton_rogue'), (0, 20, 'skeleton_warrior'), (-60, 26, 'skeleton'), (70, 24, 'skeleton_mage')]):
    add('enemy', gx + dx, gy + dy, actor=a, home=[gx + dx, gy + dy])
add('lamp_post', gx - 50, gy + 58, 0, 6)
add('signpost', gx + 60, gy + 64, 0, 6, text='Here rest the founders of Brindle. The dead do not rest easy.')

# --- hunters' camp on the forest track
kx, ky = T(38, 13)
add('campfire', kx, ky, r=12, light=1)
add('log_seat', kx - 22, ky + 16, 0, 6)
add('log_seat', kx + 24, ky + 14, 1, 6)
add('spit', kx + 36, ky - 20, 0, 14)
add('sack', kx - 30, ky - 16, 0, 5)
add('bucket', kx - 18, ky - 22, 0)
add('npc', kx + 6, ky - 22, actor='knight', name='Hunter Odo', lines='hunter')
clear_rect(35, 11, 42, 16)

# --- the old mine mouth
mx, my = T(55.5, 16)
add('mine_carts', mx - 40, my + 6, 0, 14)
add('lantern', mx - 22, my - 6, 0)
add('lantern', mx + 24, my - 6, 0)
add('crate', mx + 40, my + 2, 0, 6)
add('barrel', mx + 52, my + 6, 0, 6)
add('signpost', mx - 60, my + 20, 0, 6, text='OLD MINE - closed after the collapse. Iron ore can still be found in the hills.')

# --- orc fort: palisade-less stronghold in a basin of dark rock
fx, fy = T(110, 47)
add('spit', fx, fy, 0, 16, light=1)
add('campfire', fx - 70, fy - 30, r=12, light=1)
add('campfire', fx + 60, fy + 34, r=12, light=1)
for i, (dx, dy) in enumerate([(-120, -44), (-120, 28), (-60, -70), (40, -70), (100, -40)]):
    add('banner', fx + dx, fy + dy, [0, 0, 2, 0, 2][i], 4)
for i, (dx, dy) in enumerate([(30, -40), (44, -34), (-90, 40), (-80, 52), (90, 10)]):
    add(['crate', 'barrel', 'crate', 'barrel', 'pot'][i], fx + dx, fy + dy, i % 2 if i != 4 else 1, 6)
add('log_seat', fx - 24, fy + 20, 0, 6)
add('log_seat', fx + 24, fy + 22, 1, 6)
add('chest', fx + 76, fy - 56, 0, 6, loot=0, id='fort')
for i, (dx, dy, a) in enumerate([(-40, -10, 'orc'), (40, -6, 'orc_rogue'), (0, 40, 'orc_shaman'), (60, -40, 'orc_warrior'), (-80, -20, 'orc'), (-30, 50, 'orc_rogue')]):
    add('enemy', fx + dx, fy + dy, actor=a, home=[fx + dx, fy + dy])
for i, (tx_, ty_) in enumerate([(88, 44), (92, 50)]):
    px, py = T(tx_, ty_)
    add('enemy', px, py, actor='orc_rogue', home=[px, py])

# --- quarry: carts, ore, crystals, a few skeleton diggers
qx, qy = T(106, 74)
add('mine_carts', qx - 40, qy - 8, 0, 14)
add('mine_carts', qx + 30, qy + 20, 1, 8)
add('lantern', qx - 60, qy - 30, 0)
add('crate', qx + 50, qy - 20, 0, 6)
add('crate', qx + 62, qy - 16, 1, 6)
for i, (dx, dy, a) in enumerate([(-30, 20, 'skeleton_rogue'), (40, -10, 'skeleton'), (70, 30, 'skeleton_warrior')]):
    add('enemy', qx + dx, qy + dy, actor=a, home=[qx + dx, qy + dy])

# --- abandoned farmstead in the south meadow
ax, ay = T(71, 70)
add('ruin_back', ax, ay, 2)
add('ruin_front', ax, ay + 80, 2)
add('doorway', ax, ay + 80, 1)
add('bed', ax - 24, ay + 24, 0)
add('debris', ax + 20, ay + 30, 1)
add('debris', ax + 10, ay + 50, 2)
add('pot', ax - 20, ay + 56, 3, 5)
add('chest', ax + 26, ay + 8, 0, 6, loot=1, id='farmstead')
add('chimney', ax + 40, ay - 64, 0)
for yy in range(70 - 6, 70 + 6):
    for xx in range(68, 75):
        if inside(xx, yy):
            solid[yy][xx] = True
for i in range(3):
    add('fence', ax - 110 + i * 36, ay + 40, 0)
add('scarecrow', ax - 80, ay + 20, 0, 6)
for fxx in range(60, 66):
    for fyy in (72, 74):
        if rng.random() < 0.7:
            add('crop', fxx * 16 + 8, fyy * 16 + 12, kind='garlic', stage=0)
add('enemy', ax - 40, ay + 60, actor='skeleton_mage', home=[ax - 40, ay + 60])

# --- stone circle with a crystal heart
sx, sy = T(48, 76)
ring(sx, sy, 9, 56, lambda px, py, i: add('boulder' if i % 3 else 'boulder_brown', px, py, i % 2, 12))
add('crystal', sx, sy, 0, 6)
add('crystal', sx - 10, sy + 6, 1, 4)
add('crystal', sx + 12, sy + 4, 2, 4)
clear_rect(44, 73, 53, 80)

# --- Frostvale shrine
ix, iy = T(113, 20)
for i, dx in enumerate([-40, -14, 14, 40]):
    add('coffin', ix + dx, iy - 20, i % 2, 7)
add('banner', ix - 60, iy - 30, 1, 4)
add('banner', ix + 60, iy - 30, 1, 4)
add('chest', ix, iy + 10, 0, 6, loot=0, id='frost')
for i, (dx, dy, a) in enumerate([(-50, 20, 'skeleton_warrior'), (50, 24, 'skeleton_warrior'), (0, 40, 'skeleton_mage'), (-20, -60, 'skeleton')]):
    add('enemy', ix + dx, iy + dy, actor=a, home=[ix + dx, iy + dy])
clear_rect(108, 16, 119, 24)

# --- lake: island treasure, jetty dressing, a fisher's rest
add('oak_big', *T(14, 47), 0, 18)
add('chest', 14 * 16 + 20, 48 * 16 + 4, 0, 6, loot=3, id='island')
add('bench', 34 * 16, 44 * 16, 0, 12)
add('barrel', 33 * 16, 48 * 16 + 4, 0, 6)
add('bucket', 32 * 16 + 4, 48 * 16 + 10, 2)
add('lamp_post', 33 * 16, 45 * 16 + 14, 0, 6)
add('npc', 30 * 16, 46 * 16 + 6, actor='rogue', name='Old Fenn', lines='fisher')

# signposts at the crossroads
add('signpost', *T(58, 27), 0, 6, text='North: the Old Mine.   West: the forest track and the graveyard.   South: Brindle.')
add('signpost', *T(88, 45), 0, 6, text='Beyond this point: ORCS. Turn back, friend.')
add('signpost', *T(64, 61), 0, 6, text='South-west: the stone circle.   South: the old farmstead.   East: the quarry.')

# ------------------------------------------------------------------ vegetation
def poisson(n, test, pick, r, tries=30):
    placed = 0
    for _ in range(n * tries):
        if placed >= n:
            break
        px, py = rng.uniform(8, W * 16 - 8), rng.uniform(8, H * 16 - 8)
        if not test(px, py) or not free(px, py, r):
            continue
        t, v = pick(px, py)
        if t:
            add(t, px, py, v, r)
            placed += 1


def undergrowth(px, py, zone_name, n):
    for _ in range(n):
        a, d = rng.uniform(0, math.tau), rng.uniform(10, 26)
        qx, qy = px + math.cos(a) * d, py + math.sin(a) * d * 0.6 + 4
        if not ground_ok(qx, qy, '.*') or not free(qx, qy, 3):
            continue
        r = rng.random()
        if zone_name == 'frost':
            add('pebble', qx, qy, rng.randrange(8))
        elif zone_name == 'autumn':
            add('leaves' if r < 0.5 else ('mushroom' if r < 0.75 else 'fern'), qx, qy, rng.randrange(2 if r < 0.5 else 4))
        elif r < 0.45:
            add('fern', qx, qy, rng.randrange(4))
        elif r < 0.7:
            add('mushroom', qx, qy, rng.randrange(5))
        elif r < 0.8:
            add('mushroom_tall', qx, qy, rng.randrange(2))
        else:
            add('tuft', qx, qy, rng.randrange(9))


TREE_R = {'pine': 11, 'pine_big': 16, 'pine_tall': 10, 'oak': 13, 'oak_big': 18, 'oak_dead': 10, 'pine_dead': 8,
          'oak_frozen': 13, 'oak_big_frozen': 17, 'oak_big_dead': 15}


def tree_for(zone_name, px, py):
    r = rng.random()
    if zone_name == 'forest':
        if r < 0.3: return 'pine_big', rng.randrange(4)
        if r < 0.62: return 'pine', rng.randrange(4)
        if r < 0.74: return 'pine_tall', rng.randrange(2)
        if r < 0.9: return 'oak', rng.randrange(2)
        if r < 0.95: return 'oak_big', rng.randrange(2)
        return 'pine_dead', 0
    if zone_name == 'autumn':
        if r < 0.45: return 'oak', 2 + rng.randrange(2)
        if r < 0.75: return 'oak_big', 2 + rng.randrange(2)
        if r < 0.87: return 'pine_tall', 2 + rng.randrange(2)
        if r < 0.94: return 'oak_big_dead', rng.randrange(2)
        return 'oak_dead', 0
    if zone_name == 'frost':
        if r < 0.45: return 'oak_frozen', rng.randrange(2)
        if r < 0.7: return 'oak_big_frozen', rng.randrange(2)
        if r < 0.85: return 'pine_dead', 0
        return 'pine', 0
    if zone_name in ('fort', 'quarry'):
        if r < 0.5: return 'oak_dead', 0
        if r < 0.8: return 'pine_dead', 0
        return 'oak_big_dead', 0
    if r < 0.45: return 'oak', rng.randrange(4)
    if r < 0.7: return 'oak_big', rng.randrange(4)
    if r < 0.9: return 'pine', rng.randrange(4)
    return 'pine_tall', rng.randrange(4)


def plant_forest(zone_name, density, n, chars='.*'):
    """Groves: trees only where the noise field is dense, so clearings and glades appear."""
    def test(px, py):
        if zone_at(px, py) != zone_name or not ground_ok(px, py, chars, 1):
            return False
        if near(px, py, '=:~', 1):
            return False
        return n_big(px / 16, py / 16) * 0.75 + n_small(px / 16, py / 16) * 0.25 > density

    def pick(px, py):
        return tree_for(zone_name, px, py)

    before = len(objs)
    for _ in range(n * 30):
        if len(objs) - before >= n:
            break
        px, py = rng.uniform(8, W * 16 - 8), rng.uniform(8, H * 16 - 8)
        if not test(px, py):
            continue
        t, v = pick(px, py)
        r = TREE_R.get(t, 12)
        if not free(px, py, r):
            continue
        add(t, px, py, v, r)
        if rng.random() < 0.55:
            undergrowth(px, py, zone_name, rng.randint(1, 3))


plant_forest('forest', 0.36, 420)
plant_forest('autumn', 0.34, 170)
plant_forest('frost', 0.5, 90, '*.')
plant_forest('north', 0.52, 90)
plant_forest('fort', 0.7, 14)
plant_forest('quarry', 0.72, 10)
plant_forest('wild', 0.62, 50)


# forest edges: bushes and young trees where woods meet open ground
def edge_band():
    for _ in range(1400):
        px, py = rng.uniform(8, W * 16 - 8), rng.uniform(8, H * 16 - 8)
        if not ground_ok(px, py, '.', 0) or near(px, py, '=:~', 1):
            continue
        dense = n_big(px / 16, py / 16) * 0.75 + n_small(px / 16, py / 16) * 0.25
        z = zone_at(px, py)
        if z not in ('forest', 'autumn', 'north', 'wild', 'lake', 'meadow') or not (0.26 < dense < 0.4):
            continue
        if not free(px, py, 11):
            continue
        r = rng.random()
        if z == 'autumn':
            add('bush', px, py, rng.choice([2, 3]), 10)
        elif r < 0.55:
            add('bush', px, py, rng.choice([0, 0, 1]), 10)
        elif r < 0.75:
            add('bush_big', px, py, rng.choice([0, 1]), 14)
        elif r < 0.9:
            add('fern', px, py, rng.randrange(4), 5)
        else:
            add('dead_shrub', px, py, rng.randrange(2), 8)


edge_band()


# lone trees in the open, each with a skirt of flowers or tufts
def lone_trees(n):
    placed = 0
    for _ in range(n * 60):
        if placed >= n:
            break
        px, py = rng.uniform(8, W * 16 - 8), rng.uniform(8, H * 16 - 8)
        z = zone_at(px, py)
        if z not in ('meadow', 'village', 'homestead', 'lake', 'wild') or not ground_ok(px, py, '.', 1) or near(px, py, '=:~', 2):
            continue
        if not free(px, py, 40):
            continue
        t = rng.choice(['oak_big', 'oak', 'oak_big'])
        add(t, px, py, rng.randrange(4), 18)
        colour = rng.choice(['white', 'yellow', 'blue', 'orange'])
        for _ in range(rng.randint(3, 7)):
            a, d = rng.uniform(0, math.tau), rng.uniform(18, 34)
            qx, qy = px + math.cos(a) * d, py + math.sin(a) * d * 0.5 + 6
            if ground_ok(qx, qy) and free(qx, qy, 3):
                add('flower_' + colour if rng.random() < 0.6 else 'tuft', qx, qy, rng.randrange(8 if rng.random() < 0.6 else 9))
        placed += 1


lone_trees(14)


# flower drifts: long soft patches of one colour across the meadows
def drifts(n, zones):
    for _ in range(n):
        for _ in range(80):
            cx, cy = rng.uniform(0, W * 16), rng.uniform(0, H * 16)
            if zone_at(cx, cy) in zones and ground_ok(cx, cy):
                break
        colour = rng.choice(['orange', 'white', 'blue', 'yellow', 'white', 'yellow'])
        ang = rng.uniform(-0.6, 0.6)
        length, width = rng.uniform(40, 110), rng.uniform(10, 22)
        for _ in range(int(length / 5)):
            t, s = rng.gauss(0, length / 2.5), rng.gauss(0, width / 2)
            px, py = cx + math.cos(ang) * t - math.sin(ang) * s, cy + math.sin(ang) * t + math.cos(ang) * s
            if ground_ok(px, py) and not near(px, py, '~', 0) and free(px, py, 4):
                add('flower_' + colour, px, py, rng.randrange(8))
        for _ in range(int(length / 14)):
            px, py = cx + rng.gauss(0, length / 2), cy + rng.gauss(0, width)
            if ground_ok(px, py) and free(px, py, 5):
                add('foxglove' if rng.random() < 0.3 else 'tuft', px, py, rng.randrange(3), 3)


drifts(46, ('meadow', 'village', 'homestead', 'wild', 'lake', 'north'))


# reed beds along the water
def reeds():
    for _ in range(220):
        px, py = rng.uniform(0, W * 16), rng.uniform(0, H * 16)
        if not (ground_ok(px, py, '.*') and near(px, py, '~', 1)) or clear_at(px, py):
            continue
        if zone_at(px, py) == 'frost':
            continue
        for _ in range(rng.randint(2, 6)):
            qx, qy = px + rng.gauss(0, 8), py + rng.gauss(0, 5)
            if ground_ok(qx, qy) and free(qx, qy, 4):
                add('cattail', qx, qy, rng.randrange(4), 3)
    for _ in range(26):
        px, py = rng.uniform(0, W * 16), rng.uniform(0, H * 16)
        if ground_ok(px, py, '.*') and near(px, py, '~', 1) and free(px, py, 9):
            add('rock', px, py, rng.randrange(4), 7)


reeds()


# rocks and rubble at the feet of cliffs, clustered
def cliff_feet():
    for c in cliffs:
        h = c['top'] + c['face'] + 5
        foot_y = (c['y'] + h) * 16 + 6
        for _ in range(max(1, c['w'] // 3)):
            px = (c['x'] + rng.uniform(0.5, c['w'] - 0.5)) * 16
            py = foot_y + rng.uniform(0, 14)
            if not ground_ok(px, py, '.:*') or not free(px, py, 8):
                continue
            r = rng.random()
            if r < 0.35:
                add('rock', px, py, rng.randrange(4), 7)
                for _ in range(rng.randint(1, 3)):
                    qx, qy = px + rng.uniform(-14, 14), py + rng.uniform(-3, 8)
                    if ground_ok(qx, qy, '.:*') and free(qx, qy, 3):
                        add('pebble', qx, qy, rng.randrange(8))
            elif r < 0.55 and c['colour'] != 2:
                add('bush', px, py, rng.randrange(2), 10)
            elif r < 0.7:
                add('fern', px, py, rng.randrange(4), 4)
            else:
                add('tuft_dry' if c['colour'] != 1 else 'tuft', px, py, rng.randrange(5), 3)


cliff_feet()


# rock clusters for mining: boulders with satellites, ore seams, crystals
def rock_cluster(px, py, zone_name):
    big = 'boulder_brown' if zone_name == 'quarry' else 'boulder'
    add(big, px, py, rng.randrange(2), 14)
    for _ in range(rng.randint(1, 3)):
        a = rng.uniform(0, math.tau)
        qx, qy = px + math.cos(a) * rng.uniform(18, 28), py + math.sin(a) * rng.uniform(10, 18)
        if ground_ok(qx, qy, '.:*') and free(qx, qy, 8):
            add(rng.choice(['rock', 'rock', 'ore_rock']), qx, qy, rng.randrange(2), 8)
    for _ in range(rng.randint(2, 5)):
        qx, qy = px + rng.uniform(-30, 30), py + rng.uniform(-8, 16)
        if ground_ok(qx, qy, '.:*') and free(qx, qy, 3):
            add('pebble', qx, qy, rng.randrange(8))


for z, n in (('quarry', 16), ('north', 8), ('frost', 7), ('wild', 6), ('fort', 4)):
    placed = 0
    for _ in range(n * 80):
        if placed >= n:
            break
        px, py = rng.uniform(0, W * 16), rng.uniform(0, H * 16)
        if zone_at(px, py) == z and ground_ok(px, py, '.:*', 1) and free(px, py, 30) and not near(px, py, '=~', 1):
            rock_cluster(px, py, z)
            placed += 1
poisson(12, lambda px, py: zone_at(px, py) == 'quarry' and ground_ok(px, py, ':.', 0), lambda px, py: ('ore_rock', rng.randrange(2)), 10)
poisson(10, lambda px, py: zone_at(px, py) in ('quarry', 'frost') and ground_ok(px, py, ':.*', 0), lambda px, py: ('crystal', rng.randrange(3)), 9)


# path dressing: pebbles and leaves on the dirt, tufts where grass overhangs the edge
def path_dressing():
    for _ in range(1600):
        px, py = rng.uniform(0, W * 16), rng.uniform(0, H * 16)
        ch = cell(px, py)
        if is_solid(px, py) or clear_at(px, py):
            continue
        if ch in ':=' and rng.random() < 0.18 and free(px, py, 6):
            add(rng.choice(['pebble', 'pebble', 'twig', 'leaves']) if zone_at(px, py) != 'village' else 'pebble', px, py, rng.randrange(2))
        elif ch == '.' and near(px, py, ':=', 1) and not near(px, py, ':=', 0) and rng.random() < 0.5 and free(px, py, 4):
            add(rng.choice(['tuft', 'tuft', 'fern', 'pebble']), px, py, rng.randrange(4))


path_dressing()


# ground cover: sparse tufts and twigs everywhere else, flowers never alone
def ground_cover():
    for _ in range(3800):
        px, py = rng.uniform(4, W * 16 - 4), rng.uniform(4, H * 16 - 4)
        if not ground_ok(px, py, '.*') or near(px, py, '~', 0) or not free(px, py, 5):
            continue
        z = zone_at(px, py)
        dense = n_small(px / 7, py / 7)
        if dense < 0.45:  # leave bare patches so the grass can breathe
            continue
        r = rng.random()
        if cell(px, py) == '*':
            if r < 0.3:
                add('pebble', px, py, rng.randrange(8))
            elif r < 0.4:
                add('twig', px, py, rng.randrange(7))
            continue
        if z == 'forest':
            add(rng.choice(['fern', 'tuft', 'twig', 'mushroom']), px, py, rng.randrange(4))
        elif z == 'autumn':
            add(rng.choice(['leaves', 'leaves', 'tuft_dry', 'twig', 'mushroom']), px, py, rng.randrange(2))
        elif z in ('fort', 'quarry'):
            add(rng.choice(['tuft_dry', 'pebble', 'twig']), px, py, rng.randrange(5))
        else:
            add('tuft' if r < 0.8 else rng.choice(['twig', 'pebble']), px, py, rng.randrange(9 if r < 0.8 else 7))


ground_cover()


# things to pick up: mushrooms in the woods, herbs in the meadows
def forage(n, zones, item, sprite, variants):
    placed = 0
    for _ in range(n * 80):
        if placed >= n:
            break
        px, py = rng.uniform(0, W * 16), rng.uniform(0, H * 16)
        if zone_at(px, py) in zones and ground_ok(px, py, '.') and not near(px, py, '~=:', 0) and free(px, py, 8):
            add('forage', px, py, rng.choice(variants), 6, item=item, sprite=sprite)
            placed += 1


forage(34, ('forest', 'autumn', 'north'), 'mushroom', 'mushroom', [0, 1, 2])
forage(26, ('meadow', 'wild', 'lake', 'homestead', 'village'), 'herb', 'fern', [0, 2])

# a few bushes in the village and homestead so they feel lived-in
poisson(10, lambda px, py: zone_at(px, py) in ('village', 'homestead') and ground_ok(px, py, '.', 0) and not near(px, py, '=:', 0),
        lambda px, py: ('bush', rng.randrange(2)), 12)

# ------------------------------------------------------------------ write
objs.sort(key=lambda o: (o['y'], o['x']))
world = {
    'tile': 16, 'width': W, 'height': H, 'seed': SEED,
    'legend': {'.': 'grass', ':': 'dirt', '=': 'cobblestone', '~': 'water', '*': 'snow'},
    'terrain': [''.join(r) for r in grid],
    'cliffs': cliffs,
    'decks': decks,
    'objects': objs,
}
with open(OUT, 'w') as f:
    json.dump(world, f, separators=(',', ':'))
print(f'wrote {OUT}: {W}x{H} tiles, {len(cliffs)} cliffs, {len(decks)} decks, {len(objs)} objects')
