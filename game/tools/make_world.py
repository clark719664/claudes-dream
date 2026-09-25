"""Generates data/world.json for Hearthwild: terrain, cliffs, decks and every placed object.

    python3 tools/make_world.py

The valley is blocked out by hand on the tile grid, the way a level designer lays out a map:
straight roads, a symmetric village square around an old oak, fenced fields, a crafting yard
with room for every station tier, forests planted as dense masses that frame the map, avenues
of trees, flower beds, and one mountain range along the north edge. Nothing is scattered at
random. Every position comes from the layout below; where variety helps (which tree, which
flower) it is chosen by a hash of the position, so the map is identical on every run.

Terrain characters, one per 16x16 cell:
    .  grass    :  dirt    =  cobblestone    ~  water    *  snow (over grass)
Objects: {"t": sprite, "x", "y", "v": variant, ...} in pixels at the object's feet.
No third-party packages needed."""
import json, math, os

W, H = 128, 88
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'world.json')

grid = [['.'] * W for _ in range(H)]
reserved = [[False] * W for _ in range(H)]   # buildings, cliffs, yards, beds: no trees here
cliffs, decks, objs = [], [], []


# ------------------------------------------------------------------ helpers
def h32(*key):
    """FNV-1a over the key: a stable pseudo-random number for a position."""
    x = 2166136261
    for ch in repr(key).encode():
        x = ((x ^ ch) * 16777619) & 0xffffffff
    return x


def pick(seq, *key):
    return seq[h32(*key) % len(seq)]


def wobble(n, *key):
    """A small, stable offset in -n..n pixels, so rows of trees don't look stamped."""
    return (h32('w', *key) % (2 * n + 1)) - n


def inside(x, y):
    return 0 <= x < W and 0 <= y < H


def put(x, y, ch):
    if inside(x, y):
        grid[y][x] = ch


def get(x, y):
    return grid[y][x] if inside(x, y) else '#'


def reserve(x0, y0, x1, y1):
    for y in range(max(0, int(y0)), min(H, int(math.ceil(y1)))):
        for x in range(max(0, int(x0)), min(W, int(math.ceil(x1)))):
            reserved[y][x] = True


def rect(x0, y0, x1, y1, ch):
    """Cells x0 <= x < x1, y0 <= y < y1."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            put(x, y, ch)


def rrect(x0, y0, x1, y1, ch=':', r=1, keep=None):
    """A rectangle with its corners stepped back by r cells, like a laid-out yard."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            dx = x0 + r - x if x < x0 + r else (x - (x1 - r) + 1 if x >= x1 - r else 0)
            dy = y0 + r - y if y < y0 + r else (y - (y1 - r) + 1 if y >= y1 - r else 0)
            if dx > 0 and dy > 0 and dx + dy > r:
                continue
            if keep is None or get(x, y) in keep:
                put(x, y, ch)


def road(points, width, ch=':'):
    """Straight segments through the points (tile units, centre line), square-ended so turns join."""
    hw = width / 2
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        x0, x1 = min(ax, bx) - hw, max(ax, bx) + hw
        y0, y1 = min(ay, by) - hw, max(ay, by) + hw
        for y in range(int(y0) - 1, int(y1) + 2):
            for x in range(int(x0) - 1, int(x1) + 2):
                cx, cy = x + 0.5, y + 0.5
                if x0 < cx < x1 and y0 < cy < y1:
                    put(x, y, ch)


def ellipse(cx, cy, rx, ry, ch):
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                put(x, y, ch)


def spline(points, steps=16):
    """Catmull-Rom through the points, so the river bends smoothly."""
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(steps):
            t = s / steps
            out.append(tuple(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t
                                    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t ** 3) for k in (0, 1)))
    out.append(points[-1])
    return out


def river(points, width):
    r = width / 2
    for (x, y) in spline(points):
        for yy in range(int(y - r) - 1, int(y + r) + 2):
            for xx in range(int(x - r) - 1, int(x + r) + 2):
                if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r:
                    put(xx, yy, '~')


def cliff(x, y, w, top=5, face=0, base='grass', colour=1, mine=None):
    c = {'x': x, 'y': y, 'w': w, 'top': top, 'face': face, 'base': base, 'colour': colour}
    if mine is not None:
        c['mine'] = mine
    cliffs.append(c)
    reserve(x, y, x + w, y + top + face + 4 + 1)


def deck(x, y, w, h):
    decks.append({'x': x, 'y': y, 'w': w, 'h': h})
    reserve(x, y, x + w, y + h)


def bridge(x0, x1, y0, y1):
    """Planks over the water where a north-south road (columns x0..x1-1) crosses it."""
    rows = [y for y in range(y0, y1) if any(get(x, y) == '~' for x in range(x0, x1))]
    deck(x0 - 1, rows[0] - 1, x1 - x0 + 2, rows[-1] - rows[0] + 3)


def add(t, tx, ty, v=None, **extra):
    """Place an object with its feet at tile coordinates (tx, ty); fractions are fine."""
    o = {'t': t, 'x': int(round(tx * 16)), 'y': int(round(ty * 16))}
    if v is not None:
        o['v'] = v
    o.update(extra)
    objs.append(o)
    return o


def enemy(actor, tx, ty):
    x, y = int(round(tx * 16)), int(round(ty * 16))
    add('enemy', tx, ty, actor=actor, home=[x, y])


def bed(x0, y0, w, h, colour):
    """A flower bed: one colour in neat rows, two plants to a tile."""
    for j in range(h * 2):
        for i in range(w * 2):
            add('flower_' + colour, x0 + 0.25 + i * 0.5, y0 + 0.45 + j * 0.5, h32(colour, x0, y0, i, j) % 8)
    reserve(x0, y0, x0 + w, y0 + h)


def fence_row(x0, x1, y):
    """A straight run of fence from tile x0 to x1, with a post at each end."""
    n = max(1, int((x1 - x0) * 16 // 36))
    start = (x0 + x1) / 2 - n * 36 / 32
    for i in range(n):
        add('fence', start + (i + 0.5) * 36 / 16, y)
    add('fence_post', start - 0.1, y + 0.1, 0)
    add('fence_post', start + n * 36 / 16 + 0.1, y + 0.1, 1)


def house(tx, ty, style, name):
    """A house whose doorstep is at (tx, ty): 8 tiles wide, 9 tall, door in the middle."""
    add('house', tx, ty, style=style, name=name)
    reserve(tx - 4, ty - 9, tx + 4, ty + 1)
    add('planter', tx - 2.4, ty + 0.7, h32(name) % 2)
    add('planter', tx + 2.4, ty + 0.7, (h32(name) + 1) % 2)


def plantable(x, y, ground='.*'):
    cx, cy = int(x), int(y)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if get(cx + dx, cy + dy) not in ground:
                return False
    return not reserved[cy][cx] if inside(cx, cy) else False


# ------------------------------------------------------------------ terrain
AX = 65.5          # the village axis: the north and south streets run down cells 64..66
# Brindle: a cobbled square around a green with the old oak
rrect(57, 38, 74, 51, '=', 2)
rect(62, 42, 69, 47, '.')
road([(AX, 30), (AX, 38)], 3, '=')                     # north street
road([(AX, 50), (AX, 57)], 3, '=')                     # south street
road([(AX, 12.5), (AX, 30)], 3)                        # the road north, to the quarry
road([(AX, 12.5), (70, 12.5)], 3)
road([(AX, 16.5), (57.5, 16.5), (57.5, 8.5)], 3)       # and the mine
road([(57, 44.5), (32, 44.5), (32, 50)], 3)            # west road to the lake jetty
road([(74, 44.5), (95, 44.5)], 3)                      # east road to the orc camp
road([(AX, 57), (AX, 72)], 3)                          # south road to the stone circle
road([(AX, 67.5), (100, 67.5)], 2)                     # farm track to the old farmstead
road([(46, 45), (46, 58)], 2)                          # lane down to your cabin
road([(58.5, 61.5), (72.5, 61.5)], 2)                  # lane past the south houses
road([(40, 44.5), (40, 18.5), (29, 18.5)], 2)          # forest track to the graveyard
road([(37, 18.5), (37, 15)], 2)                        # and the hunters' camp
road([(86, 44.5), (86, 28.5), (114, 28.5), (114, 20)], 2)  # frost path to the shrine
road([(29, 67.5), (17, 67.5), (17, 72)], 2)            # path into the autumn woods
# yards and courtyards
rrect(29, 58, 55, 71, ':', 2)       # your crafting yard
rrect(14, 13, 30, 24, '=', 2)       # graveyard
rrect(33, 10, 41, 16, ':', 1)       # hunters' camp
rrect(68, 9, 87, 16, ':', 2)        # quarry
rrect(95, 37, 120, 56, ':', 2)      # orc camp
rrect(106, 12, 122, 20, '=', 2)     # Frostvale shrine
rrect(98, 60, 119, 77, ':', 2)      # old farmstead
rrect(9, 72, 23, 80, ':', 2)        # woodcutters' clearing
rrect(60, 72, 72, 81, '=', 3)       # stone circle floor
rect(63, 75, 69, 78, '.')

# water last, so the bridges have a river to cross
# Mirror Lake in the west: a broad main basin with a smaller lobe to the south-west
ellipse(15, 52, 12, 8.5, '~')
ellipse(7.5, 60, 5.5, 3.5, '~')
ellipse(13, 51, 3.2, 2.4, '.')                         # the island
# the river: out from under the mountain in the north-east, down into the lake
river([(100, 3), (98, 10), (92, 16.5), (84, 20.5), (72, 23), (58, 25), (46, 28), (36, 32), (28, 38), (23, 44)], 4)
# Frostvale: snow over the north-east
for y in range(H):
    for x in range(W):
        if ((x + 0.5 - 128) / 44) ** 2 + ((y + 0.5 + 2) / 37) ** 2 < 1 and grid[y][x] == '.':
            grid[y][x] = '*'


# ------------------------------------------------------------------ the mountain range
# One continuous wall across the north edge, in three stepped sections, snowy in the east.
cliff(-3, -6, 45, top=7, face=1, base='grass', colour=1)
cliff(40, -4, 46, top=7, face=1, base='grass', colour=1, mine=16)    # the Old Mine
cliff(84, -6, 47, top=7, face=1, base='snow', colour=1)

# ------------------------------------------------------------------ bridges and the jetty
bridge(64, 67, 18, 30)          # the road north over the river
bridge(39, 41, 24, 38)          # the forest track
deck(21, 49, 10, 3)             # jetty into Mirror Lake

# ------------------------------------------------------------------ Brindle village
reserve(57, 38, 74, 51)
house(AX - 6, 38, 'plaster', "Tilda's house")
house(AX + 6, 38, 'log', 'The Millers')
house(AX - 6, 61, 'plank', "Captain Brann's house")
house(AX + 6, 61, 'dark', "Merlo's house")
# the green: the old oak, a flower border, benches facing it
add('oak_big', AX, 45.2, 0, wall=1)
for x in range(62, 69):
    if x not in (65,):
        for y in (42, 46):
            add('flower_' + ('yellow' if y == 42 else 'white'), x + 0.3, y + 0.5, h32(x, y) % 8)
            add('flower_' + ('yellow' if y == 42 else 'white'), x + 0.8, y + 0.7, h32(y, x) % 8)
add('bench', AX - 3.2, 48.6, 0)
add('bench', AX + 3.2, 48.6, 0)
for tx in (61.6, 69.4):
    for ty in (41.9, 47.9):
        add('lamp_post', tx, ty, 0)
# market stalls on the four corners of the square
for i, (tx, ty) in enumerate([(59.5, 40.6), (71.5, 40.6), (59.5, 48.4), (71.5, 48.4)]):
    add('table', tx, ty, 0)
    add('crate_crops', tx - 1.3, ty + 0.6, (i * 2) % 7)
    add('crate_crops', tx + 1.3, ty + 0.6, (i * 2 + 1) % 7)
add('signpost', AX - 2.2, 51.6, 0, text='North: the Old Mine and the quarry.   West: Mirror Lake and your homestead.   East: orc country - keep out!   South: the stone circle and the old farmstead.')
add('barrel', 57.8, 45.8, 0)
add('barrel', 58.8, 46.4, 0)
add('sack', 72.6, 46.2, 0)
add('sack', 73.3, 46.8, 1)
add('npc', AX, 48.3, actor='wizard', name='Merlo')
add('npc', AX - 4.5, 39.2, actor='peasant', name='Tilda', lines='carpenter')
add('npc', AX + 2.4, 33, actor='knight', name='Captain Brann', lines='guard')
add('villager', AX - 5, 43.8, actor='tavern_a', name='Rosa', span=40)
add('villager', AX + 5, 49.6, actor='tavern_b', name='Wren', span=40)
# an avenue of oaks down the south road
for ty in (65, 69):
    add('oak', AX - 3, ty, h32('av', ty) % 2)
    add('oak', AX + 3, ty, (h32('av', ty) + 1) % 2)
reserve(AX - 4, 62, AX + 4, 72)

# ------------------------------------------------------------------ your homestead
CX = 40                       # cabin door column
add('cabin', CX, 58)
reserve(CX - 4, 49, CX + 4, 59)
add('player_start', CX, 59.6)
reserve(29, 58, 55, 71)
# the crafting yard: a wing of stations each side, laid out with room for their biggest tier
add('station', 33.5, 62.6, station='sawmill')
add('station', 33.5, 68.4, station='workbench')
add('station', 50.5, 62.6, station='anvil')
add('station', 50.5, 68.4, station='furnace')
add('station', 44.5, 68.6, station='cookpot')
add('campfire', CX, 65.2, style='ring')
add('log_seat', CX - 1.9, 66.4, 0)
add('log_seat', CX + 1.9, 66.4, 1)
add('log_seat', CX, 67.6, 0)
add('chest', CX - 3, 59.4, 0, loot=2, id='homestead')
add('barrel', CX + 2.6, 59.2, 0)
add('sack', CX + 3.4, 59.6, 1)
# fields below the yard: four rows of crops inside a fence, a gap in line with the cabin door
kinds = ['carrot', 'cabbage', 'beet', 'lettuce']
for r, fy in enumerate([74, 76, 78, 80]):
    for fx in list(range(31, 39)) + list(range(42, 54)):
        add('soil', fx + 0.5, fy + 0.5, 0)
        add('crop', fx + 0.5, fy + 0.8, kind=kinds[r], stage=[1, 2, 3, 3][h32('c', fx, fy) % 4])
reserve(29, 72, 56, 82)
fence_row(30, 38.8, 72.7)
fence_row(42.2, 55, 72.7)
fence_row(30, 55, 82.2)
add('scarecrow', 47.5, 77.4, 0)
add('scarecrow', 34.5, 79.4, 0)

# ------------------------------------------------------------------ Mirror Lake
add('oak_big', 13, 51.4, 1, wall=1)
add('chest', 14.4, 52.2, 0, loot=3, id='island')
add('bench', 32, 43.2, 0)
add('lamp_post', 30.6, 48.6, 0)
add('barrel', 33.4, 49.4, 0)
add('bucket', 34.1, 49.8, 2)
add('npc', 29.5, 50.6, actor='rogue', name='Old Fenn', lines='fisher')
reserve(20, 42, 36, 53)
for (tx, ty) in [(26.5, 45.3), (27.3, 46.0), (25.8, 46.1), (4.5, 50.2), (5.2, 50.9), (3.9, 51.0), (13.5, 64.4), (14.3, 64.6), (12.8, 64.8)]:
    add('cattail', tx, ty, h32(tx, ty) % 4)

# ------------------------------------------------------------------ the old forest: graveyard and hunters' camp
for i in range(5):
    add('coffin', 16.5 + i * 3, 15.4, i % 2)
for tx in (17.5, 20.5, 23.5, 26.5):
    for ty in (18.3, 21.3):
        add('tombstone', tx, ty, 0)
add('banner', 29.3, 16.6, 1)
add('banner', 29.3, 20.6, 1)
add('lamp_post', 29.8, 17.2, 0)
add('chest', 22, 14.6, 0, loot=3, id='graveyard')
add('signpost', 31, 20.4, 0, text='Here rest the founders of Brindle. The dead do not rest easy.')
for (a, tx, ty) in [('skeleton', 19, 19.8), ('skeleton_rogue', 25, 19.8), ('skeleton_warrior', 22, 17), ('skeleton', 18, 22.6), ('skeleton_mage', 26, 22.6)]:
    enemy(a, tx, ty)
reserve(14, 13, 32, 24)
add('campfire', 37, 13, style='logs')
add('log_seat', 35.3, 14.2, 0)
add('log_seat', 38.7, 14.2, 1)
add('anim', 39.4, 11.6, name='grill_camp', solid=12)
add('sack', 34, 11.2, 0)
add('bucket', 34.8, 11.5, 0)
add('npc', 36.6, 11.6, actor='knight', name='Hunter Odo', lines='hunter')
reserve(33, 9, 42, 17)

# ------------------------------------------------------------------ the Old Mine and the quarry
add('lantern', 55.6, 8.1, 0)
add('lantern', 59.4, 8.1, 0)
add('mine_carts', 53.5, 10.2, 0)
add('crate', 60.8, 9.6, 0)
add('crate', 61.6, 10.2, 1)
add('signpost', 55, 12, 0, text='OLD MINE - closed after the collapse. Stone and ore are still dug in the quarry next door.')
reserve(52, 7, 63, 13)
for i, tx in enumerate(range(70, 86, 2)):
    add('ore_rock' if i % 2 == 0 else 'rock', tx + 0.5, 9.9, i % 2)
for i, tx in enumerate(range(71, 86, 3)):
    add('boulder', tx + 0.5, 12.6, i % 2)
for i, tx in enumerate([72, 76, 80, 84]):
    add('crystal', tx + 0.5, 14.9, i % 3)
add('mine_carts', 68.4, 15.4, 1)
add('lantern', 69, 9.6, 0)
add('crate', 86, 14.6, 0)
add('crate', 86.4, 15.3, 1)
for (a, tx, ty) in [('skeleton_rogue', 75, 14), ('skeleton', 81, 11.4), ('skeleton_warrior', 84, 13.6)]:
    enemy(a, tx, ty)
reserve(67, 8, 88, 17)

# ------------------------------------------------------------------ the orc camp: a stockade with a west gate
for tx in (98, 104, 110, 116):
    add('palisade', tx, 37.9)
    add('palisade', tx, 56.4)
for ty in (42.3, 51.6, 56.2):
    add('palisade_side', 94.6, ty)
for ty in (42.3, 47.0, 51.6, 56.2):
    add('palisade_side', 118.6, ty)
add('banner', 93.6, 43, 0)
add('banner', 93.6, 46.6, 0)
add('campfire', 107, 47, style='pit')
add('log_seat', 105, 48.6, 0)
add('log_seat', 109, 48.6, 1)
add('log_seat', 107, 45.2, 0)
add('anim', 101, 51.8, name='grill_camp', solid=12)
add('weapon_rack', 112.5, 40.8, 0)
for i, tx in enumerate([97.2, 98.4, 99.6]):
    add('crate', tx, 40.4, i % 2)
for i, tx in enumerate([114.8, 116, 117.2]):
    add('barrel', tx, 53.8, 0)
add('banner', 103, 39.8, 2)
add('banner', 111, 39.8, 2)
add('chest', 116.8, 40.6, 0, loot=0, id='fort')
for (a, tx, ty) in [('orc', 100, 44), ('orc_rogue', 104, 42), ('orc_shaman', 110, 51), ('orc_warrior', 113, 45), ('orc', 99, 49), ('orc_rogue', 115, 49)]:
    enemy(a, tx, ty)
enemy('orc_rogue', 90, 43)
reserve(92, 36, 121, 58)
add('signpost', 88.5, 46.4, 0, text='Beyond this point: ORCS. Turn back, friend.')

# ------------------------------------------------------------------ Frostvale shrine
for i, tx in enumerate([109.5, 112.5, 115.5, 118.5]):
    add('coffin', tx, 14.4, i % 2)
add('banner', 107.5, 15.6, 1)
add('banner', 120.5, 15.6, 1)
add('chest', 114, 16.4, 0, loot=0, id='frost')
for i, tx in enumerate([108.5, 111, 117, 119.5]):
    add('crystal', tx, 18.8, i % 3)
for (a, tx, ty) in [('skeleton_warrior', 111, 17.6), ('skeleton_warrior', 117, 17.6), ('skeleton_mage', 114, 19), ('skeleton', 114, 24)]:
    enemy(a, tx, ty)
reserve(105, 11, 123, 21)
# an avenue of frozen oaks on the approach
for ty in (23, 26):
    add('oak_frozen', 111.8, ty, h32('fz', ty) % 2)
    add('oak_frozen', 116.2, ty, (h32('fz', ty) + 1) % 2)
reserve(110, 21, 118, 28)
add('signpost', 87.5, 30.2, 0, text='North-east: the Frostvale shrine. Bring a warm cloak and a sharp sword.')

# ------------------------------------------------------------------ the stone circle
SX, SY = AX, 76.8
for i in range(8):
    a = i / 8 * math.tau + math.pi / 8
    add('boulder' if i % 2 else 'boulder_brown', SX + math.cos(a) * 4.6, SY + math.sin(a) * 3.2, i % 2, wall=1)
add('crystal', SX, SY + 0.2, 0)
add('crystal', SX - 0.8, SY + 0.6, 1)
add('crystal', SX + 0.8, SY + 0.5, 2)
bed(57, 73, 2, 2, 'blue')
bed(73, 73, 2, 2, 'blue')
bed(57, 78, 2, 2, 'white')
bed(73, 78, 2, 2, 'white')
reserve(56, 71, 76, 82)

# ------------------------------------------------------------------ the orchard: fruit trees in rows
for i, tx in enumerate([74, 78, 82, 86, 90]):
    for j, ty in enumerate([63, 66.5]):
        add('oak', tx, ty, (i + j) % 2)
reserve(72, 61, 92, 67)

# ------------------------------------------------------------------ the old farmstead
FX = 108.5
add('ruin_back', FX, 64.5, 2)
add('ruin_front', FX, 69.5, 2)
add('doorway', FX, 69.5, 1)
add('bed', FX - 1.5, 66, 0)
add('debris', FX + 1.2, 67.2, 1)
add('pot', FX - 1.2, 68.6, 3)
add('chest', FX + 1.6, 65.4, 0, loot=1, id='farmstead')
add('chimney', FX + 2.5, 60.5, 0)
reserve(FX - 4, 58, FX + 4, 71)
for fx in list(range(100, 106)) + list(range(111, 117)):
    for fy in (72, 74):
        add('crop', fx + 0.5, fy + 0.8, kind='garlic', stage=0)
fence_row(99.5, 106.5, 75.9)
fence_row(110.5, 117.5, 75.9)
add('scarecrow', 103, 73.9, 0)
add('scarecrow', 114, 73.9, 0)
enemy('skeleton_mage', FX, 71.6)
enemy('skeleton', 102.5, 70)
enemy('skeleton_rogue', 115, 70)
for (tx, ty) in [(98, 62), (119.5, 62), (98.5, 77.5), (119, 77.5)]:
    add(pick(['oak_dead', 'oak_big_dead'], tx, ty), tx, ty, 0)
reserve(97, 59, 121, 78)
add('signpost', 97, 69.6, 0, text='The old Harlow farmstead. Nobody has farmed here since the dead walked.')

# ------------------------------------------------------------------ the woodcutters' clearing in the autumn woods
add('campfire', 16, 76, style='logs')
add('log_seat', 14.3, 77.2, 0)
add('log_seat', 17.7, 77.2, 1)
for (t, tx, ty) in [('oak_stump', 11, 74), ('stump_mossy', 12.5, 78.4), ('pine_stump', 20.5, 74.2), ('oak_stump', 21, 78.6)]:
    add(t, tx, ty, 0)
add('chest', 16, 73.4, 0, loot=1, id='woodcutters')
add('sack', 13.2, 73.8, 0)
add('crate', 18.8, 73.8, 0)
enemy('skeleton_warrior', 12, 76)
reserve(9, 72, 23, 80)

# ------------------------------------------------------------------ signposts at the crossroads
add('signpost', 63.2, 19, 0, text='North: the Old Mine and the quarry.   South: Brindle.')
add('signpost', 41.8, 42.8, 0, text='North: the forest track to the graveyard and the hunters\' camp.   South: your homestead.')
add('signpost', 67.8, 66.2, 0, text='South: the stone circle.   East: the old farmstead.')

# ------------------------------------------------------------------ forests
def forest(test, species, dx=2.0, dy=1.5, bushes=None):
    """Plant a forest mass on a staggered lattice wherever test(x, y) holds and the ground is free.
    Trees on the rim facing open ground get a bush in front, so every forest has a finished edge."""
    planted = set()
    j = 0
    y = 1.0
    while y < H:
        x = 0.5 + (dx / 2 if j % 2 else 0)
        while x < W:
            if test(x, y) and plantable(x, y):
                t, v = species(x, y)
                o = add(t, x + wobble(3, x, y) / 16, y + wobble(2, y, x) / 16, v)
                if x < 3 or x > W - 3 or y > H - 3:
                    o['wall'] = 1
                planted.add((round(x * 2), round(y * 2)))
            x += dx
        y += dy
        j += 1
    if bushes:
        for (x2, y2) in planted:
            x, y = x2 / 2, y2 / 2
            below = (round(x * 2 - dx), round((y + dy) * 2)) in planted or (round(x * 2 + dx), round((y + dy) * 2)) in planted
            bx, by = x, y + 1.1
            if not below and plantable(bx, by) and y < H - 2:
                add(*bushes(bx, by))
    return planted


def pines(x, y):
    r = h32('p', x, y) % 100
    v = h32('pv', x, y) % 2
    return ('pine_big', v) if r < 38 else ('pine', v) if r < 74 else ('pine_tall', v) if r < 92 else ('oak', v)


def autumn(x, y):
    r = h32('a', x, y) % 100
    v = 2 + h32('av', x, y) % 2
    return ('oak_big', v) if r < 42 else ('oak', v) if r < 84 else ('pine_tall', v)


def mixed(x, y):
    r = h32('m', x, y) % 100
    v = h32('mv', x, y) % 2
    return ('oak_big', v) if r < 30 else ('oak', v) if r < 55 else ('pine_big', v) if r < 78 else ('pine', v)


def frozen(x, y):
    r = h32('f', x, y) % 100
    v = h32('fv', x, y) % 2
    return ('oak_big_frozen', v) if r < 40 else ('oak_frozen', v) if r < 85 else ('pine_dead', 0)


def green_bush(x, y):
    return ('bush', x, y, pick([0, 1], x, y))


def autumn_bush(x, y):
    return ('bush', x, y, pick([2, 3], x, y))


# the old forest: pines in the north-west, down to the west road, parted by the river
forest(lambda x, y: x < 45 and 6.5 <= y < 41 and not (x > 30 and y > 35), pines, bushes=green_bush)
# a copse between the village and the orc camp
forest(lambda x, y: 77 <= x < 93 and 48 <= y < 58, mixed, bushes=green_bush)
# a grove north of the west road, between the river and the village
forest(lambda x, y: 45 <= x < 56 and 30 <= y < 41, mixed, bushes=green_bush)
# the autumn woods in the south-west
forest(lambda x, y: x < 28 and y >= 66, autumn, bushes=autumn_bush)
# the southern border
forest(lambda x, y: 28 <= x < 124 and y >= 83.5, mixed, bushes=green_bush)
# the eastern border: pines south of Frostvale, frozen trees in the snow
forest(lambda x, y: x >= 122 and 30 <= y < 84, pines, bushes=green_bush)
forest(lambda x, y: x >= 121 and 7 <= y < 30, frozen)
forest(lambda x, y: 88 <= x < 104 and 7 <= y < 11.5, frozen)
# the north-east meadow's edge along the river
forest(lambda x, y: 76 <= x < 84 and 28 <= y < 36, mixed, bushes=green_bush)

# ------------------------------------------------------------------ rocks along the mountain foot
for (tx, ty) in [(44, 9.8), (46.5, 10.2), (49, 9.8), (93, 13), (95.5, 13.4), (26, 9), (28.5, 9.4)]:
    add(pick(['rock', 'boulder'], tx, ty), tx, ty, h32(tx, ty) % 2)
for (tx, ty) in [(28, 64.6), (29.5, 65.2), (56.2, 55), (56.8, 56)]:
    add('rock', tx, ty, h32(tx, ty) % 4)

# ------------------------------------------------------------------ forage: fixed spots, back every morning
for (tx, ty) in [(42.5, 40.6), (36.5, 41), (31, 41), (20, 40.6), (46.5, 30.8), (54.5, 40.6), (24.5, 65), (18.5, 65.2),
                 (80, 57.6), (88, 57.6), (13, 71), (22.5, 71.2)]:
    add('forage', tx, ty, h32('fm', tx) % 3, item='mushroom', sprite='mushroom')
for (tx, ty) in [(35.5, 47.5), (52.5, 47.8), (78.5, 40), (84, 34), (61.5, 69), (70, 69.2), (92.5, 63), (26.5, 57.5)]:
    add('forage', tx, ty, pick([0, 2], tx, ty), item='herb', sprite='fern')

# ------------------------------------------------------------------ write
objs.sort(key=lambda o: (o['y'], o['x']))
world = {
    'tile': 16, 'width': W, 'height': H, 'seed': 7,
    'legend': {'.': 'grass', ':': 'dirt', '=': 'cobblestone', '~': 'water', '*': 'snow'},
    'terrain': [''.join(r) for r in grid],
    'cliffs': cliffs,
    'decks': decks,
    'objects': objs,
}
with open(OUT, 'w') as f:
    json.dump(world, f, separators=(',', ':'))
print(f'wrote {OUT}: {W}x{H} tiles, {len(cliffs)} cliffs, {len(decks)} decks, {len(objs)} objects')
