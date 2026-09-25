"""Generates the world of Hearthwild: data/world.dat (objects, cliffs, fences, points of interest),
data/world_tiles.bin (the ground, baked tile by tile) and data/world_map.png (the in-game map).

    python3 tools/make_world.py

The valley is 600 x 500 tiles, about five times the combined outdoor maps of Stardew Valley. It is
laid out the way a level designer blocks out a map: a mountain wall along the north, two rivers,
two lakes and a mere, and a road network joining seven settlements. Every settlement is planned
on a street grid. Houses stand on fenced lots that face their street, each with a gate in line
with the door, a path, flower beds and a dressed yard; the planned pieces (lots, plazas, farms,
fields, orchards, market squares, camps) are built by the functions below. Forests are planted as
dense masses on a staggered lattice: the rows you can reach are choppable, the deep ones form
the forest wall. Nothing is scattered at random: variety (which tree, which flower bed, which
yard dressing) comes from a hash of the position, so the map is the same on every run.

Needs data/catalog.json (tools/build_catalog.py) for the floor tile edges. No other packages.

Terrain characters, one per 16x16 cell:
    .  grass    :  dirt    =  cobblestone    ~  water    *  snow (over grass)
Objects are {"t": sprite or kind, "x", "y" (pixels at the feet), "v": variant, ...}."""
import json, math, os, sys, zlib

sys.path.insert(0, os.path.dirname(__file__))
from terrain_bake import Baker, write_tiles, merge_rects, write_png

W, H = 600, 500
CHUNK = 32
HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, '..', 'data')

grid = [['.'] * W for _ in range(H)]
reserved = bytearray(W * H)        # 1 = built on / laid out: no trees or dressing here
forest_id = bytearray(W * H)       # which forest a tree was planted by (for the map colours)
cliffs, decks, objs, pois = [], [], [], []
fences = {'picket': set(), 'dark': set()}
CAT = json.load(open(os.path.join(DATA, 'catalog.json')))
PERSISTENT = {'player_start', 'cabin', 'npc', 'villager', 'station', 'minecart_stop', 'deck'}


# ================================================================== helpers
def h32(*key):
    """FNV-1a over the key: a stable pseudo-random number for a position."""
    x = 2166136261
    for ch in repr(key).encode():
        x = ((x ^ ch) * 16777619) & 0xffffffff
    return x


def pick(seq, *key):
    return seq[h32(*key) % len(seq)]


def chance(p, *key):
    return (h32('c', *key) % 10000) < p * 10000


def wobble(n, *key):
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
            reserved[y * W + x] = 1


def is_reserved(x, y):
    return not inside(x, y) or reserved[y * W + x]


def rect(x0, y0, x1, y1, ch, keep=None):
    """Cells x0 <= x < x1, y0 <= y < y1."""
    for y in range(y0, y1):
        for x in range(x0, x1):
            if keep is None or get(x, y) in keep:
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


def road(points, width=3, ch=':', keep=None):
    """Straight segments through the points (tile units, centre line), square-ended so turns join.
    Roads never pave over water; bridges are laid separately."""
    hw = width / 2
    for (ax, ay), (bx, by) in zip(points, points[1:]):
        x0, x1 = min(ax, bx) - hw, max(ax, bx) + hw
        y0, y1 = min(ay, by) - hw, max(ay, by) + hw
        for y in range(int(y0) - 1, int(y1) + 2):
            for x in range(int(x0) - 1, int(x1) + 2):
                if x0 < x + 0.5 < x1 and y0 < y + 0.5 < y1 and get(x, y) != '~' and (keep is None or get(x, y) in keep):
                    put(x, y, ch)


def ellipse(cx, cy, rx, ry, ch):
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                put(x, y, ch)


def spline(points, steps=24):
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


def lake(cx, cy, rx, ry, ch='~', n=3.2):
    """A rounded, squarish lake (a superellipse): long straight shores that the pack's shore tiles
    draw cleanly, with round corners, instead of an ellipse's long staircase of diagonal steps."""
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if abs((x + 0.5 - cx) / rx) ** n + abs((y + 0.5 - cy) / ry) ** n <= 1.0:
                put(x, y, ch)


def meander(corners, width, radius=6.0, wave=1.0):
    """A river through corners joined by straight north-south or east-west reaches, each bend a
    quarter circle. Straight reaches give clean banks; the width swells and narrows slowly along
    the course so the banks aren't ruled lines. `width` may be a (start, end) pair."""
    pts = []
    n = len(corners)
    for i in range(n - 1):
        (ax, ay), (bx, by) = corners[i], corners[i + 1]
        L = abs(bx - ax) + abs(by - ay)
        dx, dy = ((bx > ax) - (bx < ax), (by > ay) - (by < ay))
        r0 = radius if i > 0 else 0.0
        r1 = radius if i < n - 2 else 0.0
        r0, r1 = min(r0, L / 2), min(r1, L / 2)
        t = r0
        while t <= L - r1:
            pts.append((ax + dx * t, ay + dy * t))
            t += 0.5
        if i < n - 2:
            (cx2, cy2) = corners[i + 2]
            ex, ey = ((cx2 > bx) - (cx2 < bx), (cy2 > by) - (cy2 < by))
            # arc from B - r1*d to B + r1*e around the centre B - r1*d + r1*e
            ox, oy = bx - dx * r1 + ex * r1, by - dy * r1 + ey * r1
            a0 = math.atan2((by - dy * r1) - oy, (bx - dx * r1) - ox)
            a1 = math.atan2((by + ey * r1) - oy, (bx + ex * r1) - ox)
            da = (a1 - a0 + math.pi) % math.tau - math.pi
            steps = max(4, int(abs(da) * r1 * 2))
            for k in range(steps + 1):
                a = a0 + da * k / steps
                pts.append((ox + math.cos(a) * r1, oy + math.sin(a) * r1))
    for i, (x, y) in enumerate(pts):
        f = i / max(1, len(pts) - 1)
        w = width if not isinstance(width, tuple) else width[0] + (width[1] - width[0]) * f
        w += wave * (0.6 * math.sin(i * 0.045) + 0.4 * math.sin(i * 0.11 + 1.3))
        r = w / 2
        for yy in range(int(y - r) - 1, int(y + r) + 2):
            for xx in range(int(x - r) - 1, int(x + r) + 2):
                if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r:
                    put(xx, yy, '~')


def river(points, width):
    """A river along a smooth curve; `width` may be a number or a (start, end) pair."""
    pts = spline(points)
    for i, (x, y) in enumerate(pts):
        w = width if not isinstance(width, tuple) else width[0] + (width[1] - width[0]) * i / len(pts)
        r = w / 2
        for yy in range(int(y - r) - 1, int(y + r) + 2):
            for xx in range(int(x - r) - 1, int(x + r) + 2):
                if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r:
                    put(xx, yy, '~')


def cliff(x, y, w, top=7, face=1, base='grass', colour=1, mine=None):
    c = {'x': x, 'y': y, 'w': w, 'top': top, 'face': face, 'base': base, 'colour': colour}
    if mine is not None:
        c['mine'] = mine
    cliffs.append(c)
    reserve(x, y, x + w, y + top + face + 4 + 1)


def deck(x, y, w, h, kind='pier'):
    """A plank deck over water or bank (drawn by scripts/deck.gd; the water under it is walkable)."""
    decks.append({'x': x, 'y': y, 'w': w, 'h': h})
    add('deck', x, y, kind=kind, w=w, h=h)
    reserve(x, y, x + w, y + h)


def bridge_ew(y0, y1, x0, x1, ch=':'):
    """A plank bridge where an east-west road (rows y0..y1-1) crosses water between columns x0
    and x1: it reaches two tiles onto each bank, so it meets the road past the shore strip, and
    has rope railings along both sides."""
    cols = [x for x in range(x0, x1) if any(get(x, y) == '~' for y in range(y0, y1))]
    if not cols:
        return
    a, b = cols[0] - 2, cols[-1] + 3
    deck(a, y0 - 1, b - a, y1 - y0 + 2, 'bridge_ew')
    rect(a - 2, y0, b + 2, y1, ch, keep='.:=*')
    # rope railings: each segment spans three posts 50 px apart, so segments share their end posts
    n = max(1, round((b - a) * 16 - 12) // 50)
    x0 = (a + b) * 8 - n * 25
    for i in range(n):
        x = x0 + 25 + i * 50
        add('rope_line', x / 16, y0 - 0.35)
        add('rope_line', x / 16, y1 + 0.9)


def bridge_ns(x0, x1, y0, y1, ch=':'):
    """A plank bridge where a north-south road (columns x0..x1-1) crosses water between rows y0
    and y1, reaching two tiles onto each bank, with posts at its corners."""
    rows = [y for y in range(y0, y1) if any(get(x, y) == '~' for x in range(x0, x1))]
    if not rows:
        return
    a, b = rows[0] - 2, rows[-1] + 3
    deck(x0 - 1, a, x1 - x0 + 2, b - a, 'bridge_ns')
    rect(x0, a - 2, x1, b + 2, ch, keep='.:=*')
    for y in (a, b):
        add('rope_post', x0 - 0.7, y + 0.3)
        add('rope_post', x1 + 0.7, y + 0.3)


def pier(x, y0, length, end=True):
    """A two-plank-wide pier running south from the bank at row y0, with a landing at the end,
    mooring posts and a lamp."""
    deck(x - 1, y0, 2, length, 'pier')
    if end:
        deck(x - 2, y0 + length, 4, 3, 'pier')
        add('rope_post', x - 1.7, y0 + length + 2.6)
        add('rope_post', x + 1.7, y0 + length + 2.6)
        add('pole', x + 1.6, y0 + length + 0.6)
        add('barrel', x - 1.2, y0 + length + 0.9, 0)


def add(t, tx, ty, v=None, **extra):
    """Place an object with its feet at tile coordinates (tx, ty); fractions are fine."""
    o = {'t': t, 'x': int(round(tx * 16)), 'y': int(round(ty * 16))}
    if v is not None:
        o['v'] = v
    o.update(extra)
    objs.append(o)
    return o


def enemy(actor, tx, ty):
    add('enemy', tx, ty, actor=actor)


def poi(name, tx, ty, kind='place'):
    pois.append({'name': name, 'x': tx, 'y': ty, 'kind': kind})


def sign(tx, ty, text):
    add('signpost', tx, ty, 0, text=text)


def lamp(tx, ty):
    add('lamp_post', tx, ty, 0)


def bed(x0, y0, w, h, colour):
    """A flower bed: one colour in neat rows, two plants to a tile."""
    for j in range(h * 2):
        for i in range(w * 2):
            add('flower_' + colour, x0 + 0.25 + i * 0.5, y0 + 0.45 + j * 0.5, h32(colour, x0, y0, i, j) % 8)
    reserve(x0, y0, x0 + w, y0 + h)


def patch(x0, y0, w, h, kind, stages=(1, 2, 3, 3)):
    """A vegetable patch: tilled soil with a crop on every tile."""
    for j in range(h):
        for i in range(w):
            add('soil', x0 + i + 0.5, y0 + j + 0.5, 0)
            add('crop', x0 + i + 0.5, y0 + j + 0.8, kind=kind, stage=stages[h32('st', x0 + i, y0 + j) % len(stages)])
    reserve(x0, y0, x0 + w, y0 + h)


def fence_line(style, x0, y0, x1, y1):
    """Fence cells from (x0, y0) to (x1, y1) inclusive, along a row or a column."""
    if y0 == y1:
        for x in range(min(x0, x1), max(x0, x1) + 1):
            fences[style].add((x, y0))
            reserve(x, y0, x + 1, y0 + 1)
    else:
        for y in range(min(y0, y1), max(y0, y1) + 1):
            fences[style].add((x0, y))
            reserve(x0, y, x0 + 1, y + 1)


def fence_box(style, x0, y0, x1, y1, gates=()):
    """A fenced rectangle whose corners are cells (x0, y0) and (x1, y1). `gates` are (side, cell)
    pairs: side 'S' or 'N' with the left column of a two-tile gap, or 'W'/'E' with a row."""
    fence_line(style, x0, y0, x1, y0)
    fence_line(style, x0, y1, x1, y1)
    fence_line(style, x0, y0, x0, y1)
    fence_line(style, x1, y0, x1, y1)
    for side, at in gates:
        if side in 'NS':
            # the fence's own post at the gap's left edge frames the gate; the gate fills two tiles
            row = y1 if side == 'S' else y0
            fences[style].discard((at + 1, row))
            add('gate', at, row + 1, style=style)
        else:
            col = x0 if side == 'W' else x1
            for y in (at, at + 1):
                fences[style].discard((col, y))


def fence_row_open(style, x0, x1, y, gap):
    """A straight fence from x0 to x1 on row y with a two-tile gate at column `gap`."""
    fence_line(style, x0, y, x1, y)
    fences[style].discard((gap + 1, y))
    add('gate', gap, y + 1, style=style)


def minecart(tx, ty, sid, name):
    add('minecart_stop', tx, ty, id=sid, name=name)
    reserve(tx - 3, ty - 2, tx + 4, ty + 2)


# ================================================================== buildings and yards
HOUSE_STYLES = ['log', 'plank', 'dark', 'plaster', 'brick']


def house(door_x, feet_y, style, name, gables=1):
    """A house whose doorstep is at (door_x, feet_y) in tiles (door_x is the gap between the two
    door columns). 8 tiles wide per gable, 10 tall."""
    add('house', door_x, feet_y, style=style, name=name, gables=gables)
    reserve(door_x - 4 * gables, feet_y - 10, door_x + 4 * gables, feet_y)


YARD_KINDS = ['flowers', 'veg', 'laundry', 'woodpile', 'herbs', 'orchard']


def lot(left, street_y, width, style, name, kind=None, gables=1, fence='picket', dress=True, back=True):
    """A fenced house lot on the north side of a street whose top row is `street_y`. The lot spans
    columns left..left+width (fence columns) and rows street_y-15..street_y-1; the house stands at
    the back with its door on the lot's middle column, and the front yard runs down to the street
    fence, which has a gate in line with the door."""
    door = left + width // 2
    feet = street_y - 4
    fy1 = street_y - 1
    fy0 = street_y - 15
    house(door, feet, style, name, gables)
    fence_line(fence, left, fy1, left + width, fy1)
    fence_line(fence, left, fy0 if back else feet - 1, left, fy1)
    fence_line(fence, left + width, fy0 if back else feet - 1, left + width, fy1)
    if back:
        fence_line(fence, left, fy0, left + width, fy0)
    fences[fence].discard((door, fy1))
    add('gate', door - 1, fy1 + 1, style=fence)
    # the path from the door to the gate
    rect(door - 1, feet, door + 1, fy1 + 1, ':')
    reserve(left, fy0, left + width + 1, street_y)
    if dress:
        yard(left, street_y, width, door, kind or pick(YARD_KINDS, left, street_y), gables)
    return door


SNOWY = set()   # streets (by top row and range) whose yards lie in snow


def yard(left, street_y, width, door, kind, gables=1):
    """Dress a front yard. The yard rows are street_y-4 .. street_y-2; the strips beside the house
    are the columns between the lot fence and the house walls."""
    y0 = street_y - 4
    # the path takes the two door columns; a bed of up to 3 tiles each side, a step from the path
    bw = max(0, min(3, door - left - 3))
    lx0, lx1 = door - 2 - bw, door - 2
    rx0, rx1 = door + 2, door + 2 + bw
    lw, rw = bw, bw
    colours = ['white', 'yellow', 'blue', 'orange']
    c1 = pick(colours, left, street_y)
    c2 = pick(colours, street_y, left, 7)
    if get(door, y0 + 1) == '*' or get(left + 1, y0 + 1) == '*':
        # winter yards: firewood, a sled of crates and a fire barrel instead of beds
        if lw >= 2: add('log_pile', lx0 + 1.0, y0 + 2.2)
        add('chopping_block', lx1 - 0.3, y0 + 2.6)
        if rw >= 2:
            add('crate', rx0 + 0.6, y0 + 2.4, 0)
            add('crate', rx0 + 1.6, y0 + 2.6, 1)
            add('anim', rx1 - 0.6, y0 + 2.4, name='fire_barrel', solid=5)
        kind = ''
    if kind == 'flowers':
        if lw >= 1: bed(lx0, y0 + 1, lw, 2, c1)
        if rw >= 1: bed(rx0, y0 + 1, rw, 2, c2)
    elif kind == 'veg':
        if lw >= 1: patch(lx0, y0 + 1, lw, 2, pick(['carrot', 'cabbage', 'lettuce', 'beet'], left))
        if rw >= 1: bed(rx0, y0 + 2, rw, 1, c2)
        add('water_bucket', rx1 - 0.6, y0 + 1.2, 0)
    elif kind == 'laundry':
        if lw >= 2:
            add('pole', lx0 + 0.3, y0 + 1.9)
            add('rope_line', lx0 + 0.3 + 1.8, y0 + 1.9)
        if rw >= 1: bed(rx0, y0 + 1, rw, 2, c2)
        add('bucket', lx1 - 0.4, y0 + 2.6, 1)
    elif kind == 'woodpile':
        if lw >= 2: add('log_pile', lx0 + 1.0, y0 + 2.2)
        add('chopping_block', lx1 - 0.3, y0 + 2.6)
        if rw >= 1: bed(rx0, y0 + 1, rw, 2, c2)
    elif kind == 'herbs':
        if lw >= 1: bed(lx0, y0 + 1, lw, 1, c1)
        if lw >= 1: patch(lx0, y0 + 2, lw, 1, 'garlic', (2, 3))
        if rw >= 1: bed(rx0, y0 + 1, rw, 2, c2)
    elif kind == 'orchard':
        if lw >= 2: add('sapling', lx0 + lw / 2, y0 + 2.6, h32('sap', left) % 4)
        if rw >= 2: add('sapling', rx0 + rw / 2, y0 + 2.6, (h32('sap', left) + 1) % 4)
    # beside the house: a barrel and a trough on one side, a bench or crates on the other
    hl = door - 4 * gables                  # house wall columns
    hr = door + 4 * gables
    if hl - left >= 2:
        add(pick(['barrel', 'hedge_box', 'water_bucket', 'bin'], left, 'l'), left + 1.2, street_y - 5.2, 0)
    if left + width - hr >= 2:
        add(pick(['barrel', 'jar', 'trough', 'bin', 'hay'], left, 'r'), left + width - 0.9, street_y - 5.2, 0)


def lots(specs, fence='picket'):
    for spec in specs:
        street_y, left, style, name, kind = spec[:5]
        g = spec[5] if len(spec) > 5 else 1
        lot(left, street_y, 12 if g == 1 else 20, style, name, kind, gables=g, fence=fence)


def street(y, x0, x1, ch='='):
    """An east-west street, three rows (y..y+2) from column x0 to x1. Water is left for a bridge."""
    rect(x0, y, x1 + 1, y + 3, ch, keep='.:=*')
    reserve(x0, y, x1 + 1, y + 3)


def avenue(x, y0, y1, ch='='):
    """A north-south street, columns x-1..x+1."""
    rect(x - 1, y0, x + 2, y1 + 1, ch, keep='.:=*')
    reserve(x - 1, y0, x + 2, y1 + 1)


def lamps_along(y, x0, x1, step=12):
    for x in range(x0 + 2, x1 - 1, step):
        lamp(x + 0.5, y + 0.2)


def villager(tx, ty, actor, name, span=40, say=None, lines=None):
    o = {'actor': actor, 'name': name, 'span': span}
    if say:
        o['say'] = say
    if lines:
        o['lines'] = lines
    add('villager', tx, ty, **o)


def plaza(x0, y0, x1, y1, centre='oak', ch='='):
    """A cobbled square with a green in the middle: the old tree, a flower border, benches facing
    it and lamps on the corners of the green."""
    rrect(x0, y0, x1, y1, ch, 2)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    gx0, gx1 = int(cx) - 3, int(cx) + 4
    gy0, gy1 = int(cy) - 2, int(cy) + 3
    rect(gx0, gy0, gx1, gy1, '.')
    if centre == 'oak':
        add('oak_big', cx, gy1 - 0.8, h32('pl', x0) % 2, wall=1)
    else:
        add('pine_grand', cx, gy1 - 0.8, 0, wall=1)
    for x in range(gx0, gx1):
        add('flower_yellow', x + 0.3, gy0 + 0.5, h32(x, 1) % 8)
        add('flower_white', x + 0.8, gy0 + 0.7, h32(x, 2) % 8)
    add('bench', cx - 2.2, gy1 + 1.6, 0)
    add('bench', cx + 2.2, gy1 + 1.6, 0)
    for tx in (gx0 - 0.4, gx1 + 0.4):
        for ty in (gy0 - 0.1, gy1 + 0.9):
            lamp(tx, ty)
    reserve(x0, y0, x1, y1)
    return cx, cy


def stall(tx, ty, goods):
    """A market stall: the covered counter, produce crates and sacks, and a keeper."""
    add('stall', tx, ty, h32('stall', tx, ty) % 2)
    for i, g in enumerate(goods):
        add('crate_crops', tx - 1.6 + i * 1.1, ty + 1.0, g % 7)
    add('sack', tx + 1.8, ty + 0.4, h32(tx) % 2)


# ================================================================== the land
# ---- the mountain wall along the north edge: stepped sections, snowy in the east
RANGE = [(-4, -8, 50), (44, -6, 40), (82, -9, 46), (126, -6, 54), (178, -8, 44), (220, -5, 52),
         (270, -7, 48), (316, -9, 42), (356, -6, 50), (404, -8, 46), (448, -5, 52), (498, -7, 50), (546, -9, 58)]
for i, (x, y, w) in enumerate(RANGE):
    mine = None
    if x == 270:
        mine = 19          # the Old Mine, above Ironridge
    elif x == 448:
        mine = 20          # the Frost Mine
    cliff(x, y, w, top=7, face=1, base='snow' if x >= 400 else 'grass', colour=1, mine=mine)

# ---- roads first; water and snow are painted over them afterwards, then bridges laid
TOWN = {}   # name -> centre (tiles)
TOWN['Brindle'] = (205, 250)
TOWN['Homestead'] = (148, 250)
TOWN['Reedwater'] = (42, 192)
TOWN['Ironridge'] = (290, 78)
TOWN['Frosthold'] = (505, 98)
TOWN['Millbrook'] = (318, 392)
TOWN['Stonegate'] = (512, 388)

road([(178.5, 234), (178.5, 226.5), (121.5, 226.5), (121.5, 197.5), (72, 197.5)])   # west road to Reedwater
road([(205.5, 216), (205.5, 141.5), (290.5, 141.5), (290.5, 104)])            # north road to Ironridge
road([(290.5, 52), (290.5, 5.5)])                                             # up to the Old Mine
road([(291, 56.5), (332.5, 56.5), (332.5, 41)])                               # the quarry
road([(319, 97.5), (330.5, 97.5), (330.5, 82.5), (505.5, 82.5)])               # the Frost Road
road([(520.5, 82), (520.5, 38.5), (556, 38.5)], 2)                            # up to the shrine
road([(469.5, 7), (469.5, 82)], 2)                                            # the Frost Mine track
road([(233, 250.5), (431.5, 250.5), (431.5, 391.5), (474, 391.5)])            # the East Road
road([(205.5, 286), (205.5, 345.5), (309.5, 345.5), (309.5, 368)])            # the South Road
road([(357, 403.5), (431.5, 403.5), (431.5, 391.5)])                          # Millbrook to Stonegate
road([(121.5, 228), (121.5, 280.5), (147.5, 280.5), (147.5, 362.5), (163, 362.5)], 2)   # to the woodcutters
road([(147.5, 362.5), (147.5, 421.5), (98, 421.5)], 2)                        # to the witch's hut
road([(100.5, 196), (100.5, 111.5), (72, 111.5)], 2)                          # the graveyard track
road([(205.5, 141.5), (152.5, 141.5), (152.5, 128)], 2)                       # the hunters' lodge
road([(245.5, 141.5), (245.5, 168)], 2)                                       # the stone circle
road([(431.5, 250.5), (455.5, 250.5)], 3)                                     # Grimtusk's gate
road([(560.5, 300), (560.5, 283)], 2)                                         # the warlord's camp
road([(431.5, 300.5), (560.5, 300.5)], 2)
road([(66, 350.5), (147.5, 350.5)], 2)                                        # the old farmstead
road([(207, 296.5), (282, 296.5)], 2)                                         # farm lane
road([(390.5, 404), (390.5, 463)], 2)                                         # down to the mere

# ---- water
lake(62, 234, 44, 30)                    # Mirror Lake
lake(36, 262, 24, 16)
lake(96, 252, 18, 13)
lake(60, 236, 7, 5, '.')                 # the island
lake(250, 46, 12, 7)                     # the tarn under the peaks
lake(400, 494, 94, 22)                   # the Long Mere
lake(322, 488, 40, 16)
# the Great River: out from under the Frostvale peaks, down through the valley to the Long Mere
meander([(455, -2), (455, 40), (430, 40), (430, 110), (400, 110), (400, 170), (372, 170), (372, 230),
         (350, 230), (350, 330), (322, 330), (322, 420), (312, 420), (312, 482)], (5, 7.5), radius=7)
# the West River, down from the pinewood peaks into Mirror Lake
meander([(122, -2), (122, 60), (110, 60), (110, 130), (90, 130), (90, 175), (70, 175), (70, 212)], (3.5, 5), radius=5)
# ---- snow over the north-east
for y in range(H):
    for x in range(W):
        if ((x + 0.5 - 560) / 200) ** 2 + ((y + 0.5 + 20) / 225) ** 2 + 0.03 * math.sin(x * 0.13) < 1 and grid[y][x] == '.':
            grid[y][x] = '*'

# ---- bridges where roads cross water
bridge_ew(196, 199, 60, 80, '=')  # the west road into Reedwater, over the West River
bridge_ew(81, 84, 415, 445)      # the Frost Road over the Great River
bridge_ew(249, 252, 340, 365)    # the East Road
bridge_ns(99, 101, 111, 196)     # the graveyard track over the West River

# ================================================================== settlements
# ---------------------------------------------------------------- Brindle, the starting village
BX = 205
street(232, 178, 232)
street(250, 178, 232)
street(268, 178, 232)
avenue(BX, 216, 290)
poi('Brindle', BX, 244, 'town')
# the square in the middle block
pcx, pcy = plaza(193, 235, 218, 250)
villager(pcx, pcy + 3.6, 'wizard', 'Merlo', 0, lines='merlo')
add('board', pcx - 6.5, 247.6, 0)
add('pole', pcx - 7.3, 247.8)
for i, (tx, ty) in enumerate([(197.5, 238.2), (213.5, 238.2)]):
    stall(tx, ty, [i * 2, i * 2 + 1, i + 4])
minecart(pcx + 6.5, 247.6, 'brindle', 'Brindle')
sign(BX - 2.5, 217, 'Brindle.   North: the highlands, Ironridge and the Old Mine.   West: your homestead and Reedwater.   East: the East Road, orc country and Stonegate.   South: the farms and Millbrook.')
# lots: two either side of the avenue on each street, the square in the middle
brindle_houses = [
    (232, 179, 'plaster', "Tilda's workshop", 'woodpile'), (232, 191, 'log', 'The Millers', 'flowers'),
    (232, 207, 'plank', 'Captain Brann', 'veg'), (232, 219, 'dark', 'Old Nan', 'herbs'),
    (250, 179, 'brick', 'General Store', 'flowers'), (250, 219, 'log', 'The Fletchers', 'laundry'),
    (268, 179, 'plank', 'Rosa and Wren', 'flowers'), (268, 191, 'dark', "Merlo's house", 'herbs'),
    (268, 207, 'plaster', 'The Brass Kettle', 'flowers', 2),
]
lots(brindle_houses)
lamps_along(234.8, 178, 232, 13)
lamps_along(270.8, 178, 232, 13)
villager(186.5, 233.6, 'peasant', 'Tilda', 0, lines='carpenter')
villager(BX + 7, 234, 'knight', 'Captain Brann', 30, lines='guard')
villager(BX - 10, 252, 'tavern_a', 'Rosa', 60)
villager(BX + 12, 270, 'tavern_b', 'Wren', 50)
villager(BX - 14, 270, 'peasant', 'Old Nan', 30, say=["Mind the geese. We don't have geese. Mind them anyway.", "In my day the East Road was safe as a pantry. Orcs didn't come west of the river.", "Merlo's older than he looks. And he looks older than the mountains."])
# the edge of the village: an avenue of oaks down the south road, hedges along the back lanes
for ty in range(292, 336, 6):
    add('oak', BX - 3, ty, h32('ba', ty) % 2)
    add('oak', BX + 3, ty + 3, (h32('ba', ty) + 1) % 2)
reserve(BX - 4, 286, BX + 5, 340)

# ---------------------------------------------------------------- your homestead
CX, CY = 150, 244           # cabin door
add('cabin', CX, CY)
reserve(CX - 4, CY - 10, CX + 4, CY)
add('player_start', CX, CY + 1.6)
poi('Your homestead', CX, CY + 4, 'home')
rrect(130, CY, 171, CY + 13, ':', 2)       # the crafting yard
reserve(130, CY, 171, CY + 13)
add('station', 136, CY + 4.6, station='sawmill')
add('station', 136, CY + 10.4, station='workbench')
add('station', 163.5, CY + 4.6, station='anvil')
add('station', 163.5, CY + 10.4, station='furnace')
add('station', 156, CY + 10.6, station='cookpot')
add('campfire', CX, CY + 7.2, style='ring')
add('log_seat', CX - 1.9, CY + 8.4, 0)
add('log_seat', CX + 1.9, CY + 8.4, 1)
add('log_seat', CX, CY + 9.6, 0)
add('chest', CX - 3, CY + 1.4, 0, loot=2, id='homestead')
add('barrel', CX + 2.6, CY + 1.2, 0)
add('sack', CX + 3.4, CY + 1.6, 1)
add('log_pile', 142, CY + 1.6)
add('chopping_block', 144.6, CY + 2.4)
minecart(125, CY + 6, 'homestead', 'Your homestead')
road([(CX + 5.5, 227), (CX + 5.5, CY)], 2)              # lane down from the west road
# fields below the yard, fenced, with a gate in line with the cabin door
fence_box('picket', 128, CY + 15, 172, CY + 32, gates=[('N', CX - 1)])
kinds = ['carrot', 'cabbage', 'beet', 'lettuce', 'cauliflower', 'broccoli', 'garlic']
for r in range(7):
    fy = CY + 17 + r * 2
    for fx in list(range(130, CX - 2)) + list(range(CX + 2, 171)):
        add('soil', fx + 0.5, fy + 0.5, 0)
        add('crop', fx + 0.5, fy + 0.8, kind=kinds[r], stage=[1, 2, 3, 3][h32('c', fx, fy) % 4])
rect(CX - 1, CY + 16, CX + 1, CY + 32, ':')
reserve(127, CY + 14, 174, CY + 33)
add('scarecrow', 139.5, CY + 24.4, 0)
add('scarecrow', 161.5, CY + 26.4, 0)
# an orchard east of the cabin and a hay barn corner
for i in range(3):
    for j in range(2):
        add('oak_young', 160 + i * 4, CY - 13 + j * 5, (i + j) % 2)
reserve(158, CY - 16, 174, CY - 2)
add('hay', 133, CY - 2, 0)
add('hay', 134.4, CY - 1.4, 1)
add('feed_trough', 137, CY - 1.6, 1)
reserve(130, CY - 4, 141, CY)

# ---------------------------------------------------------------- Reedwater, the fishing hamlet
RX = 42
street(196, 14, 64)
poi('Reedwater', RX, 188, 'town')
lots([(196, 16, 'log', 'Old Fenn', 'woodpile'), (196, 28, 'plank', 'The Netters', 'laundry'),
      (196, 40, 'log', 'Bram the boatwright', 'flowers'), (196, 52, 'dark', 'The smokehouse', 'herbs')])
# piers out into the lake from the waterfront, with drying racks for the catch between them
for jx in (22, 34, 46):
    top = 199
    bottom = top
    while get(jx, bottom) != '~' and bottom < 230:
        bottom += 1
    pier(jx, top, bottom - top + 4)
for rx in (28, 40):
    add('drying_rack', rx, 200.8, h32('dr', rx) % 2)
lamps_along(198.8, 14, 64, 16)
minecart(56, 201.6, 'reedwater', 'Reedwater')
villager(30, 199.6, 'rogue', 'Old Fenn', 0, lines='fisher')
villager(46, 198, 'tavern_a', 'Nessa', 40, say=["Reedwater's small, but nobody here's ever gone hungry. Lake's full of fish.", "The river brings meltwater down from the peaks. Cold enough to stop your heart.", "If you go up the track to the old graveyard, go in daylight."])
sign(74, 194.5, 'Reedwater.   East: Brindle and the homestead.   North: the graveyard track.')
add('oak_big', 60, 236.4, 1, wall=1)       # the island
add('chest', 61.4, 237.2, 0, loot=3, id='island')

# ---------------------------------------------------------------- Ironridge, the mining town
IX = 290
street(96, 262, 318)
street(114, 262, 318)
avenue(IX, 52, 120)
poi('Ironridge', IX, 104, 'town')
lots([(96, 263, 'dark', 'The Deepwells', 'woodpile'), (96, 275, 'plank', 'Mine office', 'herbs'),
      (96, 292, 'dark', 'The Hammersmiths', 'veg'), (96, 304, 'log', 'Grit and Tally', 'woodpile'),
      (114, 263, 'plank', 'The Pick and Shovel', 'flowers', 2), (114, 292, 'dark', 'Assayer', 'herbs'),
      (114, 304, 'brick', 'The Stonecutters', 'flowers')], fence='dark')
# the forge yard north of the town: a working smithy in the open
rrect(296, 60, 318, 76, ':', 2)
reserve(296, 60, 318, 76)
add('station_deco', 302, 68, station='anvil', tier=3)
add('station_deco', 309, 67, station='furnace', tier=3)
add('trough', 312.5, 66.4, 0)
add('water_bucket', 314.4, 66.6, 1)
add('anim', 314, 72, name='fire_trough', solid=10)
for i in range(4):
    add('ore_crate', 299 + i * 1.2, 73.6, i % 2)
add('minecart', 309, 73.4, 0)
for x in range(297, 318):
    add('rail_h', x + 0.5, 75.5, 0)
minecart(280, 120.6, 'ironridge', 'Ironridge')
lamps_along(98.8, 262, 318, 14)
lamps_along(116.8, 262, 318, 14)
villager(IX + 5, 99, 'knight', 'Foreman Dask', 40, say=["The Old Mine's been shut since the collapse. We dig the quarry now, east of town.", "Iron ore wants a pickaxe. Crystal wants an iron one. Don't ask me why, ask the rock.", "Skeletons in the quarry again. They never tire, and they never get paid."])
villager(IX - 12, 117, 'tavern_b', 'Mira', 50, say=["The Pick and Shovel does a stew that'll put hair on your pickaxe.", "My da says the tarn up the hill has no bottom."])
sign(IX + 2.5, 121.5, 'Ironridge.   North: the Old Mine.   East: the quarry and the Frost Road to Frosthold.   South: the highlands and Brindle.')
# the quarry east of town, under the cliffs
poi('The quarry', 332, 38)
rrect(318, 22, 348, 42, ':', 3)
reserve(318, 22, 348, 42)
for i, x in enumerate(range(320, 347, 2)):
    add('ore_rock' if i % 3 == 0 else 'rock', x + 0.5, 24.2, i % 2)
for i, x in enumerate(range(321, 347, 4)):
    add('boulder' if i % 2 else 'boulder_brown', x + 0.5, 29, i % 2)
for i, x in enumerate(range(322, 347, 5)):
    add('crystal', x + 0.5, 34, i % 3)
for x in range(320, 346):
    add('rail_h', x + 0.5, 38.5, 0)
add('minecart', 326, 38.6, 0)
add('cart_tipped', 340, 38.8, 0)
add('lantern', 319.5, 23.5, 0)
add('lantern', 346.5, 23.5, 0)
for (a, tx, ty) in [('skeleton_rogue', 328, 31), ('skeleton', 336, 27), ('skeleton_warrior', 342, 36), ('skeleton', 324, 36)]:
    enemy(a, tx, ty)
# the Old Mine's mouth
add('lantern', 288.6, 11.2, 0)
add('lantern', 292.4, 11.2, 0)
add('minecart', 286, 13.2, 0)
add('ore_crate', 294.5, 12.8, 0)
sign(287, 16, 'OLD MINE - closed after the collapse.')

# ---------------------------------------------------------------- Frosthold, the town in the snow
FX = 505
street(102, 478, 536)
street(120, 478, 536)
avenue(FX, 81, 126)
poi('Frosthold', FX, 110, 'town')
lots([(102, 479, 'log', 'The Furriers', 'woodpile'), (102, 491, 'dark', 'Jarl Halvard', 'woodpile'),
      (102, 507, 'log', 'Ice-cutters', 'woodpile'), (102, 519, 'dark', 'The Rimewatch', 'herbs'),
      (120, 479, 'dark', 'The Hearth and Horn', 'woodpile', 2), (120, 507, 'log', 'Sigrun the healer', 'herbs'),
      (120, 519, 'plank', 'Trapper Ulf', 'woodpile')], fence='dark')
for (tx, ty) in [(483, 104.6), (497, 104.6), (513, 104.6), (527, 104.6), (483, 122.6), (513, 122.6), (527, 122.6)]:
    add('anim', tx, ty, name='fire_barrel', solid=5)
minecart(530, 128.6, 'frosthold', 'Frosthold')
villager(FX + 4, 105, 'knight', 'Jarl Halvard', 30, say=["Frosthold keeps the pass. Nothing comes down from the peaks without us seeing it.", "The shrine in the north-east is full of the old dead. They guard something. Or someone.", "Fire barrels on every corner. Out here, a cold night is a hungry one."])
villager(FX - 14, 123, 'tavern_a', 'Sigrun', 30, say=["Poultices keep you walking. Tonics keep you fighting. I sell neither - I teach both.", "Frozen oaks still give wood. Hard as iron, and it burns twice as long."])
sign(FX - 2.5, 83.5, 'Frosthold.   North-east: the shrine.   North: the Frost Mine.   West: the Frost Road to Ironridge.')
# the Frost Mine track and the shrine
add('lantern', 467.6, 8.2, 0)
add('lantern', 471.4, 8.2, 0)
sign(472, 14, 'FROST MINE - the ice has swallowed the lower tunnels.')
poi('The Frost Shrine', 562, 36)
rrect(548, 26, 578, 44, '=', 3)
reserve(548, 26, 578, 44)
for i, tx in enumerate([552.5, 556.5, 560.5, 564.5, 568.5, 572.5]):
    add('coffin', tx, 29.4, i % 2)
for tx in (550, 576):
    add('banner', tx, 31, 1)
add('chest', 563, 32.4, 0, loot=0, id='frost')
for i, tx in enumerate([551, 555, 571, 575]):
    add('crystal', tx, 41, i % 3)
for (a, tx, ty) in [('skeleton_warrior', 556, 35), ('skeleton_warrior', 570, 35), ('skeleton_mage', 563, 38), ('skeleton', 552, 40), ('skeleton', 574, 40)]:
    enemy(a, tx, ty)
for ty in (46, 50, 54, 58):
    add('oak_frozen', 557.6, ty, h32('fz', ty) % 2)
    add('oak_frozen', 566.4, ty, (h32('fz', ty) + 1) % 2)
reserve(556, 44, 568, 60)

# ---------------------------------------------------------------- Millbrook, the river town
MX = 318     # the river runs down the middle of town
street(384, 282, 316)
street(402, 282, 316)
street(384, 328, 356)
street(402, 328, 356)
avenue(309, 366, 404)
bridge_ew(384, 387, 310, 336, '=')
bridge_ew(402, 405, 310, 336, '=')
poi('Millbrook', MX, 378, 'town')
lots([(384, 283, 'plank', 'The Millwrights', 'woodpile'), (384, 295, 'plaster', 'Widow Hale', 'flowers'),
      (402, 283, 'plank', 'The Otter and Oar', 'flowers', 2),
      (384, 330, 'plaster', 'The Reeves', 'veg'), (384, 342, 'plank', 'Tanner Joss', 'laundry'),
      (402, 330, 'log', 'The Ferrymen', 'flowers'), (402, 342, 'plaster', 'Granary', 'veg')])
# the lumber mill yard on the east bank, north of town
rrect(338, 350, 362, 364, ':', 2)
reserve(338, 350, 362, 364)
add('station_deco', 345, 358, station='sawmill', tier=3)
for i in range(3):
    add('log_pile', 353 + i * 3, 355.4)
    add('log_pile', 353 + i * 3, 359.4)
add('drying_rack', 341, 362.4, 1)
add('stump_seat', 349, 362.6, 0)
road([(357, 385.5), (360.5, 385.5), (360.5, 364)], 2)
minecart(292, 408.6, 'millbrook', 'Millbrook')
lamps_along(386.8, 282, 312, 12)
lamps_along(386.8, 326, 356, 12)
lamps_along(404.8, 282, 312, 12)
lamps_along(404.8, 328, 356, 12)
villager(300, 387, 'peasant', 'Widow Hale', 40, say=["The mill's been turning since my grandmother's day. River never stops, so neither do we.", "Planks from Millbrook built half of Brindle. The other half's still waiting."])
villager(340, 405, 'rogue', 'Ferryman Coll', 30, say=["No ferry since they built the bridges. I still like to stand here, though.", "The river runs all the way from the Frostvale peaks to the Long Mere."])
sign(300.5, 371, 'Millbrook.   North: the farms and Brindle.   East: the road to Stonegate.   South: the Long Mere.')

# ---------------------------------------------------------------- Stonegate, the walled market town
SX = 512
street(372, 474, 550)
street(390, 474, 550)
street(408, 474, 550)
avenue(SX, 372, 412)
poi('Stonegate', SX, 382, 'town')
# the market square fills the middle of the middle block
rrect(496, 375, 529, 390, '=', 2)
reserve(496, 375, 529, 390)
for i, tx in enumerate([499.5, 505.5, 519.5, 525.5]):
    stall(tx, 378.4, [i, i + 2, i + 4])
add('butcher_stall', 500, 386.6, 0)
add('anim', 506, 386.4, name='meat_rack', solid=12)
add('counter', 519, 386.4, 0)
add('counter', 524, 386.4, 1)
for tx in (497.5, 527.5):
    lamp(tx, 376)
    lamp(tx, 388.8)
lots([(372, 475, 'brick', 'The Guildhall', 'flowers', 2), (372, 495, 'plaster', 'Cartwright', 'flowers'),
      (372, 515, 'brick', 'The Chandlery', 'herbs'), (372, 527, 'plaster', 'Mayor Ostrom', 'flowers'), (372, 539, 'brick', 'The Tollhouse', 'veg'),
      (390, 475, 'brick', 'The Crown and Candle', 'flowers', 2), (390, 530, 'plaster', 'Seamstress', 'laundry'), (390, 542, 'brick', 'The Moneylender', 'flowers'),
      (408, 475, 'plaster', 'The Chapel', 'flowers', 2), (408, 495, 'brick', 'Weavers', 'laundry'),
      (408, 515, 'plaster', 'The Bakers', 'veg'), (408, 527, 'brick', 'Spice merchant', 'herbs'), (408, 539, 'plaster', 'The Coopers', 'woodpile')])
# the town wall: a log palisade all round with gates on the roads in
for x in range(470, 556, 6):
    add('palisade', x + 3, 354.4)
    if not (x <= SX <= x + 6):
        add('palisade', x + 3, 417.6)
for ty in range(359, 419, 4):
    if not (389 <= ty <= 396):
        add('palisade_side', 469.6, ty)
    add('palisade_side', 555.6, ty)
reserve(468, 352, 558, 419)
for tx in (SX - 2.6, SX + 3.6):
    add('banner', tx, 418.4, 0)
add('banner', 468.6, 388, 0)
add('banner', 468.6, 395.4, 0)
road([(SX + 0.5, 412), (SX + 0.5, 419.5), (491, 419.5)], 2)
minecart(462, 396.6, 'stonegate', 'Stonegate')
lamps_along(374.8, 474, 550, 13)
lamps_along(410.8, 474, 550, 13)
villager(SX + 2, 391, 'wizard', 'Mayor Ostrom', 40, say=["Welcome to Stonegate, the richest town east of the river. Mind your purse.", "The orcs of Grimtusk raid the East Road. There's a bounty on the warlord's head, if you're brave.", "The market sells everything but silence."])
villager(505, 381, 'tavern_b', 'Hild', 40, say=["Fresh cabbages! Carrots! Beets that'll make you weep!", "Butcher's on the corner. Don't ask where the meat came from."])
villager(520, 381, 'tavern_a', 'Petra', 40, say=["Glass counters, all the way from Ironridge. Don't lean on them."])
villager(488, 411, 'knight', 'Sergeant Voss', 30, lines='guard')
sign(466, 389, 'Stonegate.   West: the East Road to Brindle and the road to Millbrook.   South-east: the chapel yard.')
# the chapel graveyard outside the south wall
poi('Chapel yard', 490, 430)
fence_box('dark', 478, 421, 506, 438, gates=[('N', 490)])
for i, tx in enumerate(range(481, 505, 3)):
    for ty in (425.3, 429.3, 433.3):
        add('tombstone', tx + 0.5, ty, 0)
for tx in (480.5, 504.5):
    add('oak_young_dead', tx, 437, 0)
reserve(477, 420, 508, 439)

# ---------------------------------------------------------------- farms between the towns
def farm(left, top, style, name, crops, gate_col=None, barn=True):
    """A farmstead: the farmhouse (and a barn), a yard with hay and troughs, and a fenced field
    below with rows of crops and a scarecrow."""
    door = left + 6
    house(door, top + 10, style, name)
    if barn:
        house(door + 12, top + 10, 'dark', name + "'s barn", 2)
    rrect(left, top + 10, left + 30, top + 15, ':', 1)
    reserve(left - 1, top, left + 31, top + 15)
    add('hay', door + 3.5, top + 11.8, 0)
    add('hay', door + 5, top + 12.4, 1)
    add('feed_trough', door + 9, top + 12.6, 1)
    add('water_bucket', door + 11, top + 12.2, 0)
    add('bin', door - 3.5, top + 11.6, 0)
    add('bin', door - 2.3, top + 11.6, 1)
    fy0, fy1 = top + 16, top + 30
    g = gate_col if gate_col is not None else door - 1
    fence_box('picket', left, fy0, left + 30, fy1, gates=[('N', g)])
    for r in range(6):
        y = fy0 + 2 + r * 2
        for x in range(left + 2, left + 29):
            if x in (g, g + 1):
                continue
            add('soil', x + 0.5, y + 0.5, 0)
            add('crop', x + 0.5, y + 0.8, kind=crops[r % len(crops)], stage=[1, 2, 3, 3][h32('fc', x, y) % 4])
    rect(g, fy0 + 1, g + 2, fy1, ':')
    add('scarecrow', left + 8.5, fy0 + 7.4, 0)
    add('scarecrow', left + 22.5, fy0 + 9.4, 0)
    reserve(left - 1, fy0, left + 31, fy1 + 1)


farm(214, 298, 'log', 'Harrow farm', ['carrot', 'cabbage', 'beet'])
farm(130, 150, 'log', 'Thistle farm', ['beet', 'garlic', 'cabbage'])
road([(121.5, 196), (121.5, 162.5), (129, 162.5)], 2)
poi('Thistle farm', 145, 156)
farm(250, 300, 'plank', 'Oakley farm', ['lettuce', 'cauliflower', 'broccoli'])
farm(162, 300, 'plank', 'Tansy farm', ['garlic', 'beet', 'carrot'], barn=False)
farm(352, 410, 'plaster', 'Greenmere farm', ['cabbage', 'lettuce', 'carrot'])
villager(222, 310, 'peasant', 'Goodwife Harrow', 40, say=["Harrow farm feeds half of Brindle. The other half eats at the Brass Kettle.", "Crows are bad this year. The scarecrows just stand there looking thoughtful."])
villager(260, 312, 'rogue', 'Old Oakley', 30, say=["Plant in rows, keep the gate shut, and never trust a sky that's too blue."])
poi('Harrow farm', 229, 306)
poi('Oakley farm', 265, 308)

# ---------------------------------------------------------------- wild places and dungeons
# the old graveyard in the pinewood
poi('The old graveyard', 58, 108)
rrect(44, 98, 72, 120, '=', 3)
fence_box('dark', 45, 99, 71, 119, gates=[('E', 110)])
for i in range(6):
    add('coffin', 49.5 + i * 3.6, 102.4, i % 2)
for tx in range(50, 68, 4):
    for ty in (107.3, 111.3, 115.3):
        add('tombstone', tx + 0.5, ty, 0)
add('chest', 58, 101.6, 0, loot=3, id='graveyard')
add('banner', 70, 108.6, 1)
add('banner', 70, 112.6, 1)
for (a, tx, ty) in [('skeleton', 52, 109), ('skeleton_rogue', 64, 109), ('skeleton_warrior', 58, 113), ('skeleton', 53, 117), ('skeleton_mage', 64, 117)]:
    enemy(a, tx, ty)
reserve(43, 97, 74, 121)
sign(75, 114, 'Here rest the founders of Brindle. The dead do not rest easy.')
# the hunters' lodge
poi("Hunters' lodge", 152, 120)
rrect(140, 110, 166, 128, ':', 2)
house(152, 118, 'log', "Hunters' lodge")
add('campfire', 152, 123.2, style='logs')
add('log_seat', 150, 124.4, 0)
add('log_seat', 154, 124.4, 1)
add('anim', 160, 122, name='grill_camp', solid=12)
add('anim', 145, 122.4, name='meat_rack', solid=12)
add('drying_rack', 163, 126.4, 2)
villager(157, 125, 'knight', 'Hunter Odo', 0, lines='hunter')
reserve(139, 106, 167, 129)
# the stone circle in the highland meadow
poi('The stone circle', 246, 176)
rrect(238, 169, 254, 183, '=', 3)
rect(242, 173, 250, 179, '.')
for i in range(10):
    a = i / 10 * math.tau + math.pi / 10
    add('boulder' if i % 2 else 'boulder_brown', 246 + math.cos(a) * 6.2, 176.4 + math.sin(a) * 4.6, i % 2, wall=1)
add('crystal', 246, 176.6, 0)
add('crystal', 245.2, 177, 1)
add('crystal', 246.8, 176.9, 2)
for (x0, c) in ((232, 'blue'), (256, 'white')):
    bed(x0, 172, 3, 3, c)
reserve(230, 166, 262, 186)
# orc country: Grimtusk's stockade by the East Road and the warlord's camp beyond
def stockade(x0, y0, x1, y1, gate_y, name, orcs, boss=None):
    rrect(x0, y0, x1, y1, ':', 2)
    for x in range(x0, x1, 6):
        add('palisade', x + 3, y0 + 0.9)
        add('palisade', x + 3, y1 + 0.4)
    for ty in range(y0 + 5, y1 + 2, 4):
        if not (gate_y - 2 <= ty <= gate_y + 4):
            add('palisade_side', x0 - 0.4, ty)
        add('palisade_side', x1 + 0.6, ty)
    add('banner', x0 - 1.4, gate_y - 1, 0)
    add('banner', x0 - 1.4, gate_y + 3, 0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    add('campfire', cx, cy + 1, style='pit')
    add('log_seat', cx - 2.5, cy + 2.6, 0)
    add('log_seat', cx + 2.5, cy + 2.6, 1)
    add('anim', x0 + 5, y1 - 2, name='grill_camp', solid=12)
    add('anim', x1 - 5, y1 - 2, name='meat_rack', solid=12)
    add('stone_slab', x1 - 5, y0 + 4, 0)
    add('butcher_table', x0 + 5, y0 + 4.4, 0)
    for i in range(3):
        add('crate', x0 + 3 + i * 1.2, y1 - 5, i % 2)
        add('barrel', x1 - 3 - i * 1.2, y0 + 7, 0)
    add('chest', x1 - 3, cy, 0, loot=0, id=name)
    for i, a in enumerate(orcs):
        enemy(a, x0 + 5 + (i % 3) * ((x1 - x0 - 10) / 2), y0 + 8 + (i // 3) * 6)
    if boss:
        enemy(boss, cx, cy - 3)
    reserve(x0 - 2, y0 - 1, x1 + 2, y1 + 2)


poi('Grimtusk stockade', 470, 250)
stockade(456, 236, 484, 262, 250, 'grimtusk', ['orc', 'orc_rogue', 'orc', 'orc_shaman', 'orc_rogue', 'orc'])
sign(448, 247, 'Beyond this point: ORCS. Turn back, friend.')
poi("The warlord's camp", 560, 272)
stockade(544, 258, 578, 284, 272, 'warcamp', ['orc', 'orc_rogue', 'orc_shaman', 'orc', 'orc_rogue', 'orc'], boss='orc_warrior')
for (tx, ty) in [(440, 236), (446, 268), (500, 244), (510, 262), (520, 290), (536, 236), (590, 250), (596, 290)]:
    enemy(pick(['orc', 'orc_rogue'], tx, ty), tx, ty)
# the old farmstead ruins in the autumn woods
poi('The old farmstead', 60, 346)
rrect(46, 336, 76, 358, ':', 2)
add('ruin_back', 60, 344, 2)
add('ruin_front', 60, 349, 2)
add('doorway', 60, 349, 1)
add('bed', 58.5, 345.5, 0)
add('debris', 61.2, 346.6, 1)
add('chest', 61.6, 344.8, 0, loot=1, id='farmstead')
add('chimney', 62.5, 340, 0)
fence_box('dark', 48, 351, 58, 357, gates=[])
fence_box('dark', 63, 351, 73, 357, gates=[])
for x in list(range(49, 57)) + list(range(64, 72)):
    for y in (353, 355):
        add('crop', x + 0.5, y + 0.8, kind='garlic', stage=0)
enemy('skeleton_mage', 60, 350.6)
enemy('skeleton', 52, 346)
enemy('skeleton_rogue', 68, 346)
reserve(44, 334, 78, 360)
# the woodcutters' camp
poi("Woodcutters' camp", 168, 364)
rrect(160, 356, 178, 372, ':', 2)
add('campfire', 168, 365, style='logs')
add('log_seat', 166.2, 366.2, 0)
add('log_seat', 169.8, 366.2, 1)
for (t, tx, ty) in [('oak_stump', 162, 359), ('stump_mossy', 163, 369), ('pine_stump', 175, 359), ('oak_stump', 175.5, 369)]:
    add(t, tx, ty, 0)
for i in range(3):
    add('log_pile', 170 + i * 2.6, 359.4)
add('chopping_block', 164.6, 362.6)
add('chest', 168, 358.4, 0, loot=1, id='woodcutters')
villager(172, 368, 'peasant', 'Woodcutter Bess', 0, say=["Chop from the edge of the wood, never the heart. The deep trees hold the forest up.", "Young trees grow back fastest. Old giants take their time."])
reserve(159, 355, 179, 373)
# the witch's hut in the deep autumn wood
poi("The witch's hut", 92, 420)
rrect(80, 410, 104, 430, ':', 2)
house(90, 419, 'dark', "The witch's hut")
add('anim', 98, 425, name='alchemy_lab', solid=18, light=False)
add('tripod', 84, 425, 0)
add('anim', 84, 425.4, name='fire_embers', solid=0)
add('jar', 86, 426.4, 0)
add('jar', 87, 426.8, 1)
add('urn', 101.5, 428.4, 0)
villager(94, 427, 'wizard', 'Morwen', 0, say=["Tonics are simple. Herbs, crystal, patience. Mostly patience.", "The skeletons at the old farmstead were farmers once. Don't hate them for it.", "Mushrooms grow where the forest is oldest. Bring me some and I'll teach you a thing or two."])
reserve(79, 409, 105, 431)
# the lookout over the Long Mere
poi('The Long Mere', 400, 470)
pier(390, 463, 12)

# the ruined watchtower by the river crossing
poi('The old watchtower', 392, 228)
rrect(382, 218, 402, 236, ':', 3)
add('ruin_back', 392, 226, 0)
add('ruin_front', 392, 231, 0)
add('doorway', 392, 231, 0)
add('debris', 389.5, 229, 0)
add('debris', 395, 228.4, 2)
add('chest', 393.6, 226.8, 0, loot=3, id='watchtower')
enemy('skeleton_warrior', 392, 233.6)
enemy('skeleton_rogue', 386, 234)
reserve(380, 216, 404, 238)
# travellers' rests on the long roads: a fire, logs to sit on, a bench and a lamp
def rest(x, y, name):
    rrect(x - 4, y - 2, x + 5, y + 4, ':', 1)
    add('campfire', x + 0.5, y + 1.4, style='logs')
    add('log_seat', x - 1.4, y + 2.6, 0)
    add('log_seat', x + 2.4, y + 2.6, 1)
    add('bench', x + 0.5, y - 0.6, 0)
    add('sack', x - 2.6, y + 0.4, 0)
    lamp(x + 4, y + 0.2)
    reserve(x - 5, y - 3, x + 6, y + 5)
    poi(name, x, y)


rest(300, 254, "Drover's rest")
rest(386, 76, 'Frost Road camp')
rest(255, 349, "Carter's rest")
rest(112, 190, "Fisher's rest")
# ponds in the highland meadow, each with reeds and a bench
for (cx, cy, rx, ry) in [(234, 214, 6, 4), (322, 234, 7, 4.5), (166, 212, 4.5, 3)]:
    ellipse(cx, cy, rx, ry, '~')
    add('bench', cx, cy - ry - 1.2, 0)
    reserve(cx - rx - 1, cy - ry - 2, cx + rx + 2, cy + ry + 2)

# ---- signposts at the crossroads
sign(123.5, 223.5, 'North: Reedwater and the graveyard track.   East: Brindle.   South: your homestead.')
sign(207.5, 143.5, 'North: Ironridge and the Old Mine.   West: the hunters\' lodge.   East: the stone circle.   South: Brindle.')
sign(312, 84.5, 'East: the Frost Road to Frosthold.   North: the quarry.')
sign(433.5, 253, 'East: Grimtusk stockade - DANGER.   South: Stonegate.   West: Brindle.')
sign(207.5, 343.5, 'East: Millbrook.   North: Brindle.')
sign(149.5, 360.5, 'East: the woodcutters.   South: the witch\'s hut.   North: your homestead.')
sign(433.5, 396.5, 'East: Stonegate.   West: Millbrook.   North: the East Road.')

# ================================================================== forests
TREE_R = {}


def plantable(x, y, ground='.*', margin=1):
    """Open ground all round, clear of anything laid out (lots, fields, fences, yards)."""
    cx, cy = int(x), int(y)
    for dy in range(-margin, margin + 1):
        for dx in range(-margin, margin + 1):
            if get(cx + dx, cy + dy) not in ground or is_reserved(cx + dx, cy + dy):
                return False
    return True


def crown_clear(x, y, t='oak', v=0):
    """Don't let a tree's crown hide anything laid out behind it (graves, yards, stalls): the
    crown rises as far as the sprite is tall. Roads and water may be overhung."""
    r = CAT['sprites'][t][v]['region']
    rise = int((r[3] - r[1]) / 16) + 1
    cx, cy = int(x), int(y)
    for dy in range(2, rise):
        for dx in (-2, -1, 0, 1, 2):
            gx, gy = cx + dx, cy - dy
            if inside(gx, gy) and reserved[gy * W + gx] and grid[gy][gx] not in ':~':
                return False
    return True


def forest(test, species, dx=2.0, dy=1.5, bushes=None, fid=1, edge_rows=2):
    """Plant a forest mass on a staggered lattice wherever test(x, y) holds and the ground is free.
    Trees within `edge_rows` lattice steps of open ground can be chopped; the rest are the forest
    wall. Trees on the rim facing open ground get a bush in front."""
    pts = {}
    j = 0
    y = 1.0
    while y < H:
        x = 0.5 + (dx / 2 if j % 2 else 0)
        i = 0
        while x < W:
            if test(x, y) and plantable(x, y) and crown_clear(x, y, *species(x, y)):
                pts[(i * 2 + (j % 2), j)] = (x, y)
            x += dx
            i += 1
        y += dy
        j += 1
    def rim_of(a, b, most):
        for k in range(1, most + 1):
            if any((a + da * k, b + db * k) not in pts for da, db in ((-2, 0), (2, 0), (-1, -1), (1, -1), (-1, 1), (1, 1))):
                return k
        return 99
    # carve long, gentle bays into the rim so the edge of the wood doesn't run ruler-straight
    drop = []
    for (a, b), (x, y) in pts.items():
        r = rim_of(a, b, 3)
        if r <= 3:
            wave = math.sin(x * 0.19 + y * 0.05) + 0.8 * math.sin(y * 0.23 - x * 0.07)
            if wave > 0.4 + r * 0.45:
                drop.append((a, b))
    for k in drop:
        del pts[k]
    for (a, b), (x, y) in pts.items():
        rim = rim_of(a, b, edge_rows)
        t, v = species(x, y)
        o = add(t, x + wobble(3, x, y) / 16, y + wobble(2, y, x) / 16, v)
        if rim > edge_rows:
            o['wall'] = 1
            o['solid'] = 12
        forest_id[int(y) * W + int(x)] = fid
        if bushes and rim == 1 and (a - 1, b + 1) not in pts and (a + 1, b + 1) not in pts:
            bx, by = x, y + 1.1
            if plantable(bx, by, margin=0):
                add(*bushes(bx, by))
    return pts


def pines(x, y):
    """The pine hills: the pack's dark pines only, big and small."""
    r = h32('p', x, y) % 100
    v = h32('pv', x, y) % 2
    return ('pine_big', v) if r < 40 else ('pine', v) if r < 82 else ('pine_young', v) if r < 94 else ('pine_dead', 0) if r < 97 else ('pine_big', 1 - v)


def old_pines(x, y):
    """The old pinewood: tall, open-crowned pines, with a giant here and there."""
    r = h32('op', x, y) % 100
    v = h32('opv', x, y) % 2
    return ('pine_giant', v) if r < 8 else ('pine_grand', v) if r < 30 else ('pine_tall', v) if r < 88 else ('pine_giant_dead', 0) if r < 91 else ('pine_tall', 1 - v)


def autumn(x, y):
    r = h32('a', x, y) % 100
    v = 2 + h32('av', x, y) % 2
    return ('oak_big', v) if r < 40 else ('oak', v) if r < 78 else ('oak_young', v) if r < 88 else ('pine_tall', v)


def mixed(x, y):
    r = h32('m', x, y) % 100
    v = h32('mv', x, y) % 2
    return ('oak_big', v) if r < 30 else ('oak', v) if r < 58 else ('pine_big', v) if r < 80 else ('pine', v) if r < 92 else ('oak_young', v)


def frozen(x, y):
    r = h32('f', x, y) % 100
    v = h32('fv', x, y) % 2
    return ('oak_big_frozen', v) if r < 36 else ('oak_frozen', v) if r < 76 else ('oak_young_frozen', v) if r < 92 else ('pine_dead', 0)


def dead(x, y):
    r = h32('d', x, y) % 100
    return ('oak_dead', 0) if r < 35 else ('oak_big_dead', h32('dv', x) % 2) if r < 55 else ('pine_dead', 0) if r < 80 else ('oak_young_dead', h32('dy', x) % 2)


def green_bush(x, y):
    return ('bush', x, y, pick([0, 1], x, y))


def autumn_bush(x, y):
    return ('bush', x, y, pick([2, 3], x, y))


def frost_rim(x, y):
    return ('rock', x, y, pick([0, 1, 2, 3], x, y))


def in_rect(x, y, x0, y0, x1, y1):
    return x0 <= x < x1 and y0 <= y < y1


def soft(x0, y0, x1, y1, amp=5.0, k=0, sides='NESW'):
    """A rectangle whose sides wander in and out by up to `amp` tiles along smooth curves, so a
    wood's edge has bays and headlands instead of ruler-straight lines. Sides not listed (the map
    edges) stay straight."""
    def e(t, ph):
        return amp * (0.5 + 0.3 * math.sin(t * 0.13 + ph) + 0.2 * math.sin(t * 0.37 + ph * 2.3))
    def test(x, y):
        return ((x > x0 + (e(y, k + 1) if 'W' in sides else 0)) and (x < x1 - (e(y, k + 2) if 'E' in sides else 0))
                and (y > y0 + (e(x, k + 3) if 'N' in sides else 0)) and (y < y1 - (e(x, k + 4) if 'S' in sides else 0)))
    return test


def all_of(*tests):
    return lambda x, y: all(t(x, y) for t in tests)


def not_in(test):
    return lambda x, y: not test(x, y)


snowy = lambda x, y: get(int(x), int(y)) == '*'
unsnowy = lambda x, y: get(int(x), int(y)) != '*'
dry = lambda x, y: get(int(x), int(y)) != '~'

# the old pinewood in the north-west, down to Reedwater and the lake
forest(soft(0, 12, 118, 184, 9, 1, 'ES'), old_pines, bushes=green_bush, fid=1)
# the pine hills between the pinewood and Ironridge, with a clearing round the tarn
forest(all_of(soft(126, 12, 262, 130, 9, 2, 'WES'), not_in(soft(232, 30, 270, 64, 4, 3))), pines, bushes=green_bush, fid=1)
forest(all_of(soft(262, 12, 322, 52, 5, 4, 'WES'), not_in(soft(276, 0, 306, 64, 3, 5))), pines, bushes=green_bush, fid=1)
# groves in the highland meadow, laid out as copses
for i, (x0, y0, x1, y1) in enumerate([(214, 152, 230, 166), (262, 150, 282, 164), (300, 160, 318, 178), (220, 190, 238, 204), (272, 186, 292, 200), (178, 160, 196, 176)]):
    forest(soft(x0, y0, x1, y1, 2.5, 10 + i), mixed, bushes=green_bush, fid=1)
# east of Ironridge to the river: pines, then frozen woods into Frostvale
forest(all_of(soft(350, 12, 420, 78, 5, 20, 'WES'), unsnowy), pines, bushes=green_bush, fid=1)
forest(all_of(soft(348, 94, 440, 150, 9, 21), unsnowy), pines, bushes=green_bush, fid=1)
forest(all_of(soft(350, 12, 600, 200, 0, 22), snowy, not_in(soft(468, 76, 548, 136, 3, 23)), not_in(soft(538, 18, 588, 66, 3, 24))), frozen, bushes=frost_rim, fid=3)
# the eastern border and orc country's dead woods
forest(soft(586, 200, 600, 470, 3, 30, 'W'), pines, fid=1)
for i, (x0, y0, x1, y1) in enumerate([(490, 220, 506, 232), (520, 244, 536, 256), (492, 272, 510, 286), (452, 272, 470, 290), (536, 296, 556, 310), (560, 214, 584, 232)]):
    forest(soft(x0, y0, x1, y1, 2.5, 40 + i), dead, fid=4)
# woods along the river between the East Road and the South Road
forest(soft(356, 262, 425, 372, 9, 50), mixed, bushes=green_bush, fid=1)
forest(soft(240, 262, 334, 294, 5, 51), mixed, bushes=green_bush, fid=1)
# the autumn woods in the south-west
forest(soft(0, 302, 196, 488, 10, 60, 'NE'), autumn, bushes=autumn_bush, fid=2)
# the southern border, around the Long Mere
forest(all_of(soft(196, 440, 600, 500, 8, 70, 'NW'), dry), mixed, bushes=green_bush, fid=1)
forest(soft(440, 320, 586, 350, 7, 71), mixed, bushes=green_bush, fid=1)
forest(soft(556, 350, 586, 440, 4, 72, 'W'), mixed, fid=1)
forest(soft(436, 404, 470, 440, 4, 73), mixed, bushes=green_bush, fid=1)
# belts of trees between Brindle, the homestead fields and the lake
forest(soft(104, 262, 126, 300, 3, 80), mixed, bushes=green_bush, fid=1)
forest(soft(176, 280, 200, 300, 3, 81), mixed, bushes=green_bush, fid=1)

# ---- avenues along the roads out of the towns
def avenue_trees(x, y0, y1, step=6, t='oak'):
    for ty in range(y0, y1, step):
        for dxs in (-3, 3):
            if plantable(x + dxs, ty, margin=0):
                add(t, x + dxs, ty, (h32('av', x, ty, dxs) % 2))


avenue_trees(205.5, 146, 214)
avenue_trees(300.5, 350, 366)
avenue_trees(290.5, 124, 140)

# ---- reeds along the lake shores, in clumps at regular steps
def shore_reeds(x0, y0, x1, y1, step=5):
    for y in range(y0, y1):
        for x in range(x0, x1):
            if get(x, y) == '.' and not is_reserved(x, y) and (x * 7 + y * 3) % step == 0 and any(get(x + dx, y + dy) == '~' for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1))):
                for k in range(3):
                    add('cattail', x + 0.3 + k * 0.25, y + 0.5 + (k % 2) * 0.2, (h32(x, y, k) % 4))
                add('reeds', x + 0.7, y + 0.9, h32('r', x, y) % 6)


shore_reeds(0, 190, 125, 285)
shore_reeds(230, 36, 270, 60)
shore_reeds(280, 450, 500, 500, 7)

# ---- meadow dressing: wildflower patches as planted drifts, rock outcrops in the highlands
for (x0, y0, w, h, c) in [(222, 208, 4, 2, 'yellow'), (262, 206, 5, 2, 'white'), (310, 190, 3, 3, 'blue'), (230, 128, 4, 2, 'orange'),
                          (330, 220, 4, 2, 'yellow'), (190, 196, 3, 2, 'white'), (282, 226, 4, 2, 'blue'), (260, 236, 3, 2, 'orange'),
                          (160, 196, 4, 2, 'yellow'), (176, 210, 3, 2, 'blue'), (330, 140, 4, 2, 'white')]:
    if all(get(x, y) == '.' and not is_reserved(x, y) for x in range(x0, x0 + w) for y in range(y0, y0 + h)):
        bed(x0, y0, w, h, c)


def outcrop(x, y, big='boulder'):
    add(big, x, y, h32('oc', x, y) % 2)
    add('rock', x - 1.6, y + 0.4, h32('ocr', x) % 4)
    add('rock', x + 1.5, y + 0.6, h32('ocl', y) % 4)
    add('pebble', x - 0.6, y + 1.1, h32('p1', x) % 8)
    add('pebble', x + 0.8, y + 1.2, h32('p2', y) % 8)
    reserve(x - 2, y - 1, x + 3, y + 2)


for (x, y) in [(232, 150), (322, 170), (344, 196), (180, 186), (270, 214), (314, 124), (440, 212), (476, 300), (524, 318)]:
    if plantable(x, y):
        outcrop(x, y, 'boulder_brown' if x > 420 else 'boulder')
for (x, y) in [(210, 20), (250, 22), (330, 60), (370, 88), (460, 60), (536, 70)]:
    if plantable(x, y):
        outcrop(x, y)

# ---- the open country: small planned scenes on a loose grid wherever there's room for one
def clear_around(x, y, r):
    for yy in range(int(y) - r, int(y) + r + 1):
        for xx in range(int(x) - r, int(x) + r + 1):
            if not inside(xx, yy) or grid[yy][xx] not in '.*' or reserved[yy * W + xx]:
                return False
    # tree crowns rise well above the scene: keep them off anything laid out to the north
    for yy in range(int(y) - r - 8, int(y) - r):
        for xx in range(int(x) - r, int(x) + r + 1):
            if inside(xx, yy) and reserved[yy * W + xx] and grid[yy][xx] not in ':~':
                return False
    for yy in range(int(y) - r - 3, int(y) + r + 9):
        for xx in range(int(x) - r - 3, int(x) + r + 4):
            if inside(xx, yy) and forest_id[yy * W + xx]:
                return False
    return True


def tree_kind(x, y, big=True):
    if get(int(x), int(y)) == '*':
        return ('oak_big_frozen' if big else 'oak_frozen'), h32('tk', x) % 2
    if 430 < x and 200 < y < 330:
        return ('oak_big_dead' if big else 'oak_dead'), 0
    if x < 200 and y > 290:
        return ('oak_big' if big else 'oak'), 2 + h32('tk', y) % 2
    return ('oak_big' if big else 'oak'), h32('tk', x, y) % 2


def scene(kind, x, y):
    snow = get(int(x), int(y)) == '*'
    if kind == 'grove':
        for i, (dx, dy) in enumerate([(-2.6, 1.2), (2.4, 1.6), (0.0, -1.6)]):
            t, v = tree_kind(x + dx, y + dy, i == 2)
            add(t, x + dx, y + dy, v)
        if not snow:
            bed(int(x) - 1, int(y) + 3, 2, 1, pick(['white', 'yellow', 'blue', 'orange'], x, y))
            add('forage', x + 1.8, y + 3.4, h32('gf', x) % 3, item='mushroom', sprite='mushroom')
    elif kind == 'hedge':
        for i in range(7):
            add('bush' if not snow else 'rock', x - 4.8 + i * 1.6, y, pick([0, 1], x, i) if not snow else i % 4)
        add('sapling' if not snow else 'oak_young_frozen', x - 6.4, y + 0.2, h32('hs', x) % (4 if not snow else 2))
        add('sapling' if not snow else 'oak_young_frozen', x + 6.4, y + 0.2, h32('hs', y) % (4 if not snow else 2))
    elif kind == 'outcrop':
        outcrop(x, y, 'boulder_brown' if x > 420 or y > 300 else 'boulder')
    elif kind == 'stumps':
        add('oak_stump', x - 2, y, 0)
        add('pine_stump', x + 1.6, y + 1, 0)
        add('stump_mossy' if not snow else 'stump_frozen', x, y - 1.8, 0)
        add('log', x + 2.6, y - 1.2, 0)
        add('mushroom', x - 0.8, y + 0.6, 1)
        add('mushroom', x + 0.4, y - 0.4, 3)
        if not snow:
            add('forage', x - 2.6, y + 1.6, h32('sf', x) % 3, item='mushroom', sprite='mushroom')
    elif kind == 'flowers':
        c = pick(['white', 'yellow', 'blue', 'orange'], x, y, 'fl')
        bed(int(x) - 1, int(y) - 1, 3, 2, c)
        for i in range(3):
            add('foxglove', x - 1.2 + i * 1.3, y + 1.6, i % 3)
        add('forage', x + 2.6, y + 0.4, pick([0, 2], x), item='herb', sprite='fern')
    elif kind == 'landmark':
        t, v = tree_kind(x, y, True)
        add(t, x, y, v, wall=1)
        if not snow:
            for i in range(10):
                a = i / 10 * math.tau
                add('flower_' + pick(['white', 'yellow'], x, y), x + math.cos(a) * 2.6, y + 0.6 + math.sin(a) * 1.4, h32('lm', i, x) % 8)
    elif kind == 'pond':
        ellipse(x, y, 4.5, 3, '~')
        for i, (dx, dy) in enumerate([(-5.4, 0.4), (5.2, 0.8), (-2.2, 3.8), (2.6, 3.9)]):
            add('cattail', x + dx, y + dy, i % 4)
            add('reeds', x + dx + 0.5, y + dy + 0.3, h32('pr', i, x) % 6)
        add('bench', x, y - 4.2, 0)


KINDS = ['grove'] * 5 + ['hedge'] * 3 + ['outcrop'] * 3 + ['stumps'] * 2 + ['flowers'] * 4 + ['landmark'] * 2 + ['pond']
for gy in range(14, H - 12, 18):
    for gx in range(12 + (gy // 18 % 2) * 9, W - 12, 18):
        x = gx + wobble(4, gx, gy)
        y = gy + wobble(3, gy, gx)
        kind = pick(KINDS, gx, gy, 'scene')
        r = 7 if kind in ('hedge', 'pond') else 5
        if not clear_around(x, y, r):
            continue
        if get(int(x), int(y)) == '*' and kind in ('flowers', 'pond'):
            kind = 'outcrop'
        scene(kind, x + 0.5, y + 0.5)
        reserve(x - r, y - r, x + r + 1, y + r + 1)

# ---- forage at fixed spots along the forest edges and meadows
for i, (x, y) in enumerate([(116, 150), (130, 134), (170, 134), (240, 134), (320, 96), (420, 178), (180, 300), (150, 330), (120, 400), (60, 300), (200, 420), (360, 300), (400, 360), (540, 318)]):
    if plantable(x, y, margin=0):
        add('forage', x, y, h32('fm', x) % 3, item='mushroom', sprite='mushroom')
for i, (x, y) in enumerate([(176, 220), (236, 214), (286, 232), (330, 204), (262, 180), (190, 150), (300, 150), (228, 290), (110, 196), (174, 240)]):
    if plantable(x, y, margin=0):
        add('forage', x, y, pick([0, 2], x, y), item='herb', sprite='fern')

# ================================================================== checks
def validate():
    fence_cells = set().union(*fences.values())
    deck_cells = set((d['x'] + i, d['y'] + j) for d in decks for i in range(d['w']) for j in range(d['h']))
    homes = []
    for o in objs:
        if o['t'] in ('house', 'cabin'):
            g = o.get('gables', 1)
            homes.append((o['x'] / 16 - 4 * g, o['y'] / 16 - 7, o['x'] / 16 + 4 * g, o['y'] / 16 - 0.2))
    FLAT = ('soil', 'crop', 'deck', 'gate', 'house', 'cabin', 'rope_line', 'rope_post', 'forage', 'pebble', 'rail_h')
    issues = []
    for o in objs:
        if o['t'] in FLAT or o['t'].startswith('flower_'):
            continue
        x, y = o['x'] / 16, o['y'] / 16
        c = (int(x), int(y - 0.2))
        why = None
        if c in fence_cells:
            why = 'on a fence'
        elif get(*c) == '~' and c not in deck_cells:
            why = 'in water'
        else:
            for (x0, y0, x1, y1) in homes:
                if x0 < x < x1 and y0 < y < y1:
                    why = 'inside a house'
                    break
        if why:
            issues.append(f"{o['t']} at {x:.1f},{y:.1f} {why}")
    print(f'{len(issues)} placement issues')
    for i in issues[:60]:
        print('  ', i)


validate()

# ================================================================== write
# the objects, split into chunks for streaming
chunks = {}
persistent = []
for o in objs:
    if o['t'] in PERSISTENT:
        persistent.append(o)
        continue
    key = f"{o['x'] // (CHUNK * 16)},{o['y'] // (CHUNK * 16)}"
    chunks.setdefault(key, []).append(o)
for k in chunks:
    chunks[k].sort(key=lambda o: (o['y'], o['x']))

rows = [''.join(r) for r in grid]
edges = {tuple(int(v) for v in k.split(',')): e for k, e in CAT['floor_edges'].items()}
baker = Baker(rows, edges, seed=7)
layers, blocked = baker.bake(decks)
raw = write_tiles(os.path.join(DATA, 'world_tiles.bin'), layers)
water = [v for r in merge_rects(blocked) for v in r]

world = {
    'tile': 16, 'width': W, 'height': H, 'seed': 7, 'chunk': CHUNK,
    'cliffs': cliffs, 'pois': pois, 'water': water,
    'fences': {k: [c for cell in sorted(v) for c in cell] for k, v in fences.items()},
    'persistent': persistent, 'chunks': chunks,
}
blob = json.dumps(world, separators=(',', ':')).encode()
with open(os.path.join(DATA, 'world.dat'), 'wb') as f:
    f.write(zlib.compress(blob, 9))

# the in-game map: one pixel per two tiles
COL = {'.': (104, 156, 72), ':': (170, 132, 88), '=': (160, 158, 150), '~': (72, 124, 196), '*': (226, 232, 242)}
FOREST_COL = {1: (48, 96, 52), 2: (168, 96, 44), 3: (164, 190, 204), 4: (110, 96, 72)}
tile_col = []
for y in range(H):
    for x in range(W):
        c = COL[grid[y][x]]
        f = forest_id[y * W + x]
        if f:
            c = FOREST_COL[f]
        tile_col.append(c)
for c in cliffs:
    for y in range(max(0, c['y']), min(H, c['y'] + c['top'] + c['face'] + 3)):
        for x in range(max(0, c['x']), min(W, c['x'] + c['w'])):
            tile_col[y * W + x] = (118, 118, 124)
for d in decks:
    for y in range(d['y'], d['y'] + d['h']):
        for x in range(d['x'], d['x'] + d['w']):
            if inside(x, y):
                tile_col[y * W + x] = (150, 100, 60)
for o in objs:
    if o['t'] in ('house', 'cabin'):
        g = o.get('gables', 1)
        tx, ty = o['x'] // 16, o['y'] // 16
        for y in range(ty - 6, ty):
            for x in range(tx - 4 * g, tx + 4 * g):
                if inside(x, y):
                    tile_col[y * W + x] = (150, 70, 50) if o['t'] == 'house' else (230, 170, 60)
# spread each forest tree over its crown so the woods read as masses
for y in range(H - 1, 0, -1):
    for x in range(W):
        f = forest_id[y * W + x]
        if f:
            for k in (1, 2):
                if y - k >= 0 and grid[y - k][x] in '.*':
                    tile_col[(y - k) * W + x] = FOREST_COL[f]
MW, MH = W // 2, H // 2
pix = []
for y in range(MH):
    for x in range(MW):
        cs = [tile_col[(y * 2 + j) * W + x * 2 + i] for j in (0, 1) for i in (0, 1)]
        pix.append(tuple(sum(c[k] for c in cs) // 4 for k in range(3)))
write_png(os.path.join(DATA, 'world_map.png'), MW, MH, pix)

n_chunk = sum(len(v) for v in chunks.values())
print(f'world {W}x{H}: {len(objs)} objects ({len(persistent)} persistent, {n_chunk} in {len(chunks)} chunks), '
      f'{len(cliffs)} cliffs, {len(decks)} decks, {sum(len(v) for v in fences.values())} fence cells, '
      f'{len(water) // 4} water boxes, tiles {raw // 1024} KB raw, world.dat {len(blob) // 1024} KB raw')
