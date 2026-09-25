"""Growing things: woods, undergrowth, debris, flowers, rocks, springs and hidden chests.

Trees are sampled with Poisson discs whose spacing follows a density field (fbm noise times what
the caller asks for), so a wood has thickets, open glades and a ragged edge. Where the wood is
thickest, or along the map's rim, trees are "wall": they can't be chopped and they stop you, the
way Stardew's forest edges do. Everything on the ground comes in clusters with a theme."""
import math

FLOWER_COLOURS = ['white', 'yellow', 'blue', 'orange']


# ------------------------------------------------------------ species
def oaks(a, x, y):
    n = a.noise.fbm(x + 300, y, 22, 2)
    r = a.rng.random()
    v = 0 if n < 0.55 else 1
    if r < 0.30:
        return 'oak_big', v
    if r < 0.72:
        return 'oak', v
    if r < 0.86:
        return 'oak_young', v
    return 'pine', 0


def pines(a, x, y):
    r = a.rng.random()
    v = 0 if a.noise.fbm(x, y + 500, 20, 2) < 0.5 else 1
    if r < 0.36:
        return 'pine_big', v
    if r < 0.8:
        return 'pine', v
    if r < 0.94:
        return 'pine_young', v
    return 'pine_dead', 0


def old_pines(a, x, y):
    r = a.rng.random()
    v = 0 if a.noise.fbm(x + 90, y, 20, 2) < 0.5 else 1
    if r < 0.06:
        return 'pine_giant', v
    if r < 0.26:
        return 'pine_grand', v
    if r < 0.9:
        return 'pine_tall', v
    return 'pine_dead', 0


def blend(first, second, towards):
    """A species picker that turns from `first` into `second` as towards(x, y) goes 0 -> 1, with
    noise in the boundary so the change is gradual and ragged."""
    def pick(a, x, y):
        t = towards(x, y) + (a.noise.fbm(x, y + 777, 9, 2) - 0.5) * 0.5
        return second(a, x, y) if a.rng.random() < t else first(a, x, y)
    return pick


def dead_trees(a, x, y):
    r = a.rng.random()
    return ('oak_dead', 0) if r < 0.35 else ('oak_big_dead', a.rng.randrange(2)) if r < 0.5 else ('pine_dead', 0) if r < 0.8 else ('oak_young_dead', a.rng.randrange(2))


def frozen(a, x, y):
    r = a.rng.random()
    v = a.rng.randrange(2)
    return ('oak_big_frozen', v) if r < 0.3 else ('oak_frozen', v) if r < 0.7 else ('oak_young_frozen', v) if r < 0.85 else ('pine_dead', 0)


# ------------------------------------------------------------ woods
def woods(a, test, species, box=None, spacing=(1.6, 3.4), clearing=0.3, wall_at=0.64, undergrowth=0.55,
          chop_near=None):
    """Grow a wood wherever test(x, y) holds.

    density = fbm noise; below `clearing` nothing grows (glades), above `wall_at` the trees are
    wall. Trees within `chop_near` tiles of open, walkable ground are always choppable, so the
    wood's edges and path sides can be worked."""
    box = box or (0, 0, a.w, a.h)
    k = a.seed * 7 + len(a.objs)

    def dens(x, y):
        # fbm sits mostly between 0.3 and 0.7; stretch it so there are real thickets and real glades
        d = a.noise.fbm(x + k % 97, y + k % 53, 13, 3)
        t = min(1.0, max(0.0, (d - 0.36) / 0.28))
        return t * t * (3 - 2 * t)

    def sp(x, y):
        d = dens(x, y)
        return spacing[0] + (spacing[1] - spacing[0]) * (1 - min(1, max(0, (d - clearing) / (1 - clearing))))

    def ok(x, y):
        if not test(x, y) or dens(x, y) < clearing:
            return False
        if not a.open_ground(x, y, 1) or a.near_path(x, y, 1) or a.near_char(x, y, '~=', 1):
            return False
        return True

    trees = []
    for (x, y) in a.poisson(box, sp, ok):
        t, v = species(a, x, y)
        if not a.crown_clear(x, y, t, v) or not a.free(x, y, 0.6):
            continue
        d = dens(x, y)
        wall = d > wall_at
        if chop_near and wall and _near_open(a, x, y, chop_near, test):
            wall = False
        o = a.add(t, x, y, v, 0.7)
        if wall:
            o['wall'] = 1
            o['solid'] = 11
        trees.append((x, y, t, wall))
    for (x, y, t, wall) in trees:
        if a.rng.random() < undergrowth:
            _under(a, x, y, t)
    return trees


def _near_open(a, x, y, r, test):
    cx, cy = int(x), int(y)
    for dy in range(-r, r + 1, 2):
        for dx in range(-r, r + 1, 2):
            qx, qy = cx + dx, cy + dy
            if a.inside(qx, qy) and (a.path[qy * a.w + qx] or not test(qx + 0.5, qy + 0.5)):
                return True
    return False


def _under(a, x, y, t):
    """What grows around a trunk: ferns and tufts, a mushroom or two, fallen twigs, a bush."""
    pine = t.startswith('pine')
    for i in range(a.rng.randint(1, 3)):
        ang = a.rng.uniform(0, math.tau)
        d = a.rng.uniform(0.7, 1.8)
        px, py = x + math.cos(ang) * d, y + math.sin(ang) * d * 0.6 + 0.3
        if not a.open_ground(px, py) or a.near_path(px, py, 0) or not a.free(px, py, 0.3):
            continue
        r = a.rng.random()
        if r < 0.32:
            a.add('fern', px, py, a.rng.randrange(4), 0.3)
        elif r < 0.55:
            a.add('tuft', px, py, a.rng.randrange(9), 0.2)
        elif r < 0.66:
            a.add('mushroom', px, py, a.rng.randrange(5), 0.2)
        elif r < 0.76:
            a.add('twig' if not pine else 'pebble', px, py, a.rng.randrange(7 if not pine else 8), 0.2)
        elif r < 0.86:
            a.add('leaves', px, py, a.rng.randrange(2), 0.2)
        elif r < 0.96:
            a.add('bush', px, py, a.rng.randrange(2), 0.6)
        else:
            a.add('branch', px, py, a.rng.randrange(5), 0.4)


def edge_wall(a, depth=5, gaps=(), species=None, spacing=(1.3, 1.9)):
    """A band of thick, unchoppable woods along the map's rim, its inner edge ragged, broken only
    where an exit leads away. gaps: (side, from, to) with side in 'NSEW'."""
    species = species or oaks

    def in_gap(x, y):
        for side, g0, g1 in gaps:
            if side in 'NS' and g0 <= x <= g1 and ((side == 'N' and y < depth + 4) or (side == 'S' and y > a.h - depth - 4)):
                return True
            if side in 'EW' and g0 <= y <= g1 and ((side == 'W' and x < depth + 4) or (side == 'E' and x > a.w - depth - 4)):
                return True
        return False

    def band(x, y):
        edge = min(x, y, a.w - x, a.h - y)
        wob = (a.noise.fbm(x * 1.3, y * 1.3 + 33, 9, 2) - 0.5) * 4
        return edge < depth + wob and not in_gap(x, y)

    def ok(x, y):
        return band(x, y) and a.get(int(x), int(y)) in '.*' and not a.is_reserved(int(x), int(y)) and not a.near_path(x, y, 1)

    n = 0
    for (x, y) in a.poisson((0, 0, a.w, a.h), lambda x, y: a.rng.uniform(*spacing), ok):
        t, v = species(a, x, y)
        if not a.free(x, y, 0.5):
            continue
        o = a.add(t, x, y, v, 0.6)
        o['wall'] = 1
        o['solid'] = 11
        n += 1
    return n


# ------------------------------------------------------------ the ground
def debris(a, test, count, kinds=('weeds', 'stones', 'twigs', 'stumps', 'saplings'), spread=2.2, big=0.15):
    """Things to clear, in clumps with a theme: a patch of weeds, a pile of stones, twigs under a
    fallen log, a stump or two, young trees coming up. `big` is the share of heavy pieces
    (boulders, mossy stumps, fallen logs) that need better tools."""
    def ok(x, y):
        return test(x, y) and a.open_ground(x, y) and not a.near_path(x, y, 0)

    centres = a.poisson((0, 0, a.w, a.h), lambda x, y: 5.5, lambda x, y: ok(x, y))
    a.rng.shuffle(centres)
    placed = 0
    for (cx, cy) in centres[:count]:
        kind = kinds[a.rng.randrange(len(kinds))]
        if kind == 'weeds':
            placed += a.cluster(cx, cy, a.rng.randint(4, 10), spread,
                                lambda x, y, i: a.add('weed', x, y, a.rng.randrange(6), 0.45), 0.9, ok)
            if a.rng.random() < 0.4:
                a.cluster(cx, cy, 3, spread + 1, lambda x, y, i: a.add('tuft', x, y, a.rng.randrange(9)), 0.4, ok)
        elif kind == 'stones':
            if a.rng.random() < big:
                a.add(a.rng.choice(['boulder', 'boulder_brown']), cx, cy, a.rng.randrange(2), 1.2)
            placed += a.cluster(cx, cy, a.rng.randint(3, 7), spread * 0.8,
                                lambda x, y, i: a.add('stone', x, y, a.rng.randrange(4), 0.45), 0.9, ok)
            a.cluster(cx, cy, 3, spread, lambda x, y, i: a.add('pebble', x, y, a.rng.randrange(8)), 0.4, ok)
        elif kind == 'twigs':
            if a.rng.random() < big * 1.5:
                a.add('fallen_log', cx, cy, a.rng.randrange(2), 1.2)
            placed += a.cluster(cx, cy, a.rng.randint(2, 6), spread,
                                lambda x, y, i: a.add('branch', x, y, a.rng.randrange(5), 0.45), 0.9, ok)
        elif kind == 'stumps':
            if a.rng.random() < big * 1.5:
                a.add('stump_big', cx, cy, a.rng.randrange(2), 1.4)
            else:
                a.add('stump', cx, cy, 0, 0.9)
            a.cluster(cx, cy, a.rng.randint(1, 4), spread,
                      lambda x, y, i: a.add(a.rng.choice(['branch', 'weed']), x, y, a.rng.randrange(5), 0.45), 0.9, ok)
            placed += 1
        elif kind == 'saplings':
            placed += a.cluster(cx, cy, a.rng.randint(1, 3), spread * 1.3,
                                lambda x, y, i: a.add(a.rng.choice(['sapling', 'oak_young', 'pine_young']), x, y, a.rng.randrange(2), 0.8), 1.8, ok)
    return placed


def flowers(a, test, drifts, colours=None, size=(5, 16)):
    """Drifts of wildflowers: one or two colours each, thick in the middle, a few foxgloves."""
    colours = colours or FLOWER_COLOURS
    centres = a.poisson((0, 0, a.w, a.h), lambda x, y: 7.0, lambda x, y: test(x, y) and a.open_ground(x, y))
    a.rng.shuffle(centres)
    for (cx, cy) in centres[:drifts]:
        c1 = a.rng.choice(colours)
        c2 = a.rng.choice(colours) if a.rng.random() < 0.3 else c1
        n = a.rng.randint(*size)
        a.cluster(cx, cy, n, 1.6, lambda x, y, i: a.add('flower_' + (c1 if a.rng.random() < 0.75 else c2), x, y, a.rng.randrange(8)),
                  0.35, lambda x, y: test(x, y) and a.open_ground(x, y) and not a.near_path(x, y, 0))
        if a.rng.random() < 0.35:
            a.cluster(cx, cy, a.rng.randint(1, 3), 2.2, lambda x, y, i: a.add('foxglove', x, y, a.rng.randrange(3), 0.3), 0.8,
                      lambda x, y: test(x, y) and a.open_ground(x, y))


def grass(a, test, patches, size=(4, 12)):
    """Tufts of longer grass in loose patches, so open ground isn't a flat green sheet."""
    centres = a.poisson((0, 0, a.w, a.h), lambda x, y: 4.5, lambda x, y: test(x, y) and a.open_ground(x, y))
    a.rng.shuffle(centres)
    for (cx, cy) in centres[:patches]:
        a.cluster(cx, cy, a.rng.randint(*size), 1.8, lambda x, y, i: a.add('tuft', x, y, a.rng.randrange(9)), 0.3,
                  lambda x, y: test(x, y) and a.open_ground(x, y) and not a.near_path(x, y, 0))


def outcrop(a, x, y, big='boulder', ore=0.0):
    a.add(big, x, y, a.rng.randrange(2), 1.3)
    a.cluster(x, y + 0.5, a.rng.randint(2, 4), 1.6,
              lambda px, py, i: a.add('ore_rock' if a.rng.random() < ore else 'rock', px, py, a.rng.randrange(2 if ore else 4), 0.5), 1.0,
              lambda px, py: a.open_ground(px, py))
    a.cluster(x, y + 0.8, a.rng.randint(2, 5), 2.0, lambda px, py, i: a.add('pebble', px, py, a.rng.randrange(8)), 0.4,
              lambda px, py: a.open_ground(px, py))


def reeds(a, box, every=0.5):
    """Reeds and cattails in clumps along the water's edge."""
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            if a.get(x, y) != '.' or a.is_reserved(x, y):
                continue
            if not any(a.get(x + dx, y + dy) == '~' for dx, dy in ((0, 1), (1, 0), (-1, 0), (0, -1))):
                continue
            if a.noise.fbm(x * 2.0, y * 2.0 + 71, 6, 2) < 1 - every * 0.6:
                continue
            if a.free(x + 0.5, y + 0.6, 0.4):
                a.add('cattail' if a.rng.random() < 0.6 else 'reeds', x + a.rng.uniform(0.2, 0.8), y + a.rng.uniform(0.4, 0.9),
                      a.rng.randrange(4), 0.35)


def spring(a, x, y, name='A hidden spring'):
    """A small clear pool deep in the woods; drinking from it restores your energy."""
    a.lake(x, y, 2.6, 1.9, 0.18, int(x * 3 + y))
    a.add('spring', x, y + 2.7, name=name)
    for i in range(6):
        ang = i / 6 * math.tau + 0.4
        a.add('stone', x + math.cos(ang) * 3.4, y + math.sin(ang) * 2.6 + 0.4, i % 4, 0.4, regrow=0)
    a.cluster(x, y + 3.2, 6, 1.6, lambda px, py, i: a.add('flower_' + a.rng.choice(['blue', 'white']), px, py, a.rng.randrange(8)), 0.35,
              lambda px, py: a.open_ground(px, py))
    a.reserve(x - 4, y - 3, x + 5, y + 5)
    a.poi(name, x, y)


def hidden_chest(a, x, y, cid, loot):
    """A chest tucked away somewhere; `cid` names it in the save so it stays looted."""
    a.add('chest', x, y, 0, 0.5, loot=loot, cid=cid)
    a.reserve(x - 1, y - 1, x + 2, y + 1)
    a.cluster(x, y + 0.6, 4, 1.2, lambda px, py, i: a.add(a.rng.choice(['fern', 'mushroom', 'tuft']), px, py, a.rng.randrange(4)), 0.3,
              lambda px, py: a.open_ground(px, py))


# ------------------------------------------------------------ places in the wild
def camp(a, x, y, fire='logs'):
    """A clearing someone uses: a fire ring, logs to sit on, a woodpile, a drying rack."""
    a.paint(a.blob(x, y, 4.2, 0.35, int(x + y), 3.0), ':', (x - 6, y - 5, x + 6, y + 5), keep='.*')
    a.add('campfire', x, y + 0.4, None, 1.0, style=fire)
    a.add('log_seat', x - 2.2, y + 1.4, 0, 0.9)
    a.add('log_seat', x + 2.0, y - 0.9, 1, 0.9)
    a.add('stump_seat', x + 1.4, y + 2.1, 0, 0.5)
    a.add('log_pile', x - 3.4, y - 1.8, 0, 0.9)
    a.add('drying_rack', x + 3.6, y + 1.8, a.rng.randrange(4), 1.2)
    a.add('chopping_block', x - 1.0, y - 2.6, 0, 0.5)
    a.reserve(x - 5, y - 4, x + 6, y + 4)


def ruin(a, x, y, v=0):
    """A roofless cottage slowly going back to the woods."""
    a.add('ruin_back', x, y, v, 0)
    a.add('ruin_front', x, y + 5, v, 0)
    a.add('doorway', x, y + 5, a.rng.randrange(3))
    for i in range(a.rng.randint(2, 4)):
        a.add('debris', x + a.rng.uniform(-2, 2), y + a.rng.uniform(1.5, 3.8), a.rng.randrange(5))
    a.reserve(x - 3.5, y - 5.5, x + 3.5, y + 5.5)


def enemy(a, actor, x, y):
    return a.add('enemy', x, y, None, 0.6, actor=actor)


def forage(a, test, n, item='mushroom', sprite='mushroom'):
    pts = a.poisson((0, 0, a.w, a.h), lambda x, y: 6.0, lambda x, y: test(x, y) and a.open_ground(x, y) and a.free(x, y, 0.5))
    a.rng.shuffle(pts)
    for (x, y) in pts[:n]:
        a.add('forage', x, y, a.rng.randrange(3), 0.4, item=item, sprite=sprite)


def snow_line(a, amount, soft=0.18):
    """Snow over the grass where amount(x, y) (0..1, higher is colder) beats a noisy threshold, so
    the snow comes in patches before it covers everything."""
    for y in range(a.h):
        for x in range(a.w):
            if a.grid[y][x] != '.':
                continue
            n = (a.noise.fbm(x + 400, y + 90, 7, 3) - 0.5) * soft * 4
            if amount(x + 0.5, y + 0.5) + n > 0.5:
                a.grid[y][x] = '*'


def dirt_patches(a, test, share=0.3, scale=9.0):
    """Bare earth showing through in blotches (dry country, trampled ground)."""
    for y in range(a.h):
        for x in range(a.w):
            if a.grid[y][x] == '.' and test(x + 0.5, y + 0.5) and a.noise.fbm(x + 900, y + 40, scale, 3) < share and not a.is_reserved(x, y):
                a.grid[y][x] = ':'


def outcrops(a, test, n, big=('boulder',), ore=0.0, crystal=0.0):
    pts = a.poisson((0, 0, a.w, a.h), lambda x, y: 9.0, lambda x, y: test(x, y) and a.open_ground(x, y, 1) and not a.near_path(x, y, 2))
    a.rng.shuffle(pts)
    for (x, y) in pts[:n]:
        outcrop(a, x, y, a.rng.choice(big), ore)
        if crystal and a.rng.random() < crystal:
            a.cluster(x + 1, y + 1, 2, 1.0, lambda px, py, i: a.add('crystal', px, py, a.rng.randrange(3), 0.5), 0.9,
                      lambda px, py: a.open_ground(px, py))
