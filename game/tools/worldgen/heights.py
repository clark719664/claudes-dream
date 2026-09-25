"""The high country north of Brindle.

The Mountain: the road climbs out of town between pines, past a tarn, to the Old Mine in the foot
of a rock ridge. A quarry works the lower slopes in the east. Snow comes in patches as you climb
and lies deep along the ridges; the path north to the summit leaves between two of them.

The Summit: snow all year. A frozen tarn, crystal outcrops, dead and frosted trees, the old Frost
Shrine (and whatever guards it), and a hot spring steaming in a hollow."""
import math
from core import Area
import nature as N
import build as B


def frosty(a, x, y):
    return N.frozen(a, x, y) if a.rng.random() < 0.6 else N.pines(a, x, y)


# ================================================================== the Mountain
def make_mountain():
    return Area('mountain', 'The Mountain', 110, 80, seed=6606, biome='mountain', regrow=4)


def gen_mountain(a):
    W, H = a.w, a.h
    s = a.gap_point('town', -1)
    w = a.gap_point('pinewood', -1)
    n = a.gap_point('summit', -1)
    # rock ridges across the north; the Old Mine opens in the middle one
    a.cliff(3, 2, 32, top=6, face=2, base='snow')
    mine = a.cliff(38, 5, 18, top=6, face=2, base='snow', mine=7)
    a.cliff(70, 1, 36, top=7, face=2, base='snow')
    a.cliff(80, 30, 22, top=5, face=1, base='grass')
    mx, my = 38 + 7 + 1.5, 5 + 6 + 2 + 4 + 1          # the mine mouth (the game finds it from the cliff)
    # the tarn
    a.lake(22, 38, 6.0, 4.2, 0.32, k=61)
    a.lake(27, 41, 3.0, 2.2, 0.3, k=62)
    a.smooth_water()
    # the road up from town, the mine spur, the way to the summit, the path from the Pinewood
    a.trail([s, (s[0], 70), (46, 58), (44, 44), (mx, my + 3), (mx, my + 0.5)], 2.4, ':', 2.4, k=63)
    a.trail([(44, 44), (56, 36), (62, 24), (n[0] - 1, 12), n], 2.0, ':', 1.8, k=64)
    a.trail([w, (12, w[1] - 2), (30, 50), (44, 46)], 2.0, ':', 2.4, k=65)
    # the quarry: bare ground, cut stone, carts and the tools left out
    qx, qy = 82, 58
    a.paint(a.blob(qx, qy, 12, 0.35, 66, 8), ':', (qx - 16, qy - 12, qx + 16, qy + 12), keep='.*')
    a.trail([(46, 58), (60, 60), (qx - 8, qy)], 2.2, ':', 1.6, k=67)
    a.reserve(qx - 4, qy - 3, qx + 4, qy + 3)
    a.add('mine_carts', qx - 1, qy, 0, 1.6)
    a.add('tripod', qx + 3.5, qy - 1.5, 0, 1.0)
    a.add('ore_crate', qx + 2.6, qy + 1.4, 1, 0.4)
    a.add('crate', qx - 3.8, qy + 1.8, 0, 0.5)
    for i in range(10):
        a.add('rail_h', qx - 12 + i, qy + 0.5)
    B.villager(a, mx + 3.5, my + 2.0, 'peasant', 'Gorran the miner', 0,
               say=['The Old Mine goes down a long way. Every fifth level there is a ladder shaft - get that far and you can ride straight back down.',
                    'Iron below the first few floors, coal all the way, and crystal deeper still. Bring a pickaxe - and bring food.'])
    B.sign(a, mx - 3.2, my + 2.6, 'THE OLD MINE\nEnter at your own risk.')
    # snow thickens with height, in patches first
    N.snow_line(a, lambda x, y: 1.05 - y / 34.0, 0.2)
    # trees: pine lower down, frosted and dead trees higher up
    species = N.blend(N.pines, lambda a_, x, y: frosty(a_, x, y), lambda x, y: 1.1 - y / 36.0)
    N.edge_wall(a, 4, a.edge_gaps(), species, (1.3, 1.9))
    inside = lambda x, y: min(x, y, W - x, H - y) > 4 and not a.is_reserved(int(x), int(y))
    N.woods(a, inside, species, spacing=(2.2, 6.0), clearing=0.45, wall_at=0.9, undergrowth=0.4, chop_near=3)
    # rock: outcrops all over, iron ore more often up high and round the quarry
    N.outcrops(a, inside, 14, ('boulder', 'boulder_brown'), ore=0.3, crystal=0.1)
    for (x, y) in a.poisson((qx - 13, qy - 9, qx + 13, qy + 9), lambda x, y: 2.2, lambda x, y: a.get(int(x), int(y)) == ':' and a.open_ground(x, y, 0, ':') and a.free(x, y, 0.6)):
        r = a.rng.random()
        a.add('ore_rock' if r < 0.3 else ('boulder' if r < 0.38 else 'rock'), x, y, a.rng.randrange(2), 0.7)
    N.debris(a, inside, 40, ('stones', 'stones', 'twigs', 'stumps'), 2.0, 0.3)
    N.reeds(a, (10, 28, 36, 48), 0.5)
    N.grass(a, lambda x, y: inside(x, y) and y > 30, 30)
    N.flowers(a, lambda x, y: inside(x, y) and y > 40, 8, ['blue', 'white'], (3, 8))
    N.hidden_chest(a, 104, 72, 'mountain_ledge', 1)
    a.poi('The Old Mine', mx, my)
    a.poi('The quarry', qx, qy)


# ================================================================== the Summit
def make_summit():
    a = Area('summit', 'The Summit', 90, 70, seed=7707, biome='snow', snowy=True, regrow=6)
    for row in a.grid:
        for i in range(len(row)):
            row[i] = '*'
    return a


def gen_summit(a):
    W, H = a.w, a.h
    s = a.gap_point('mountain', -1)
    a.lake(46, 32, 8.5, 5.0, 0.3, k=71)
    a.lake(38, 35, 4.0, 3.0, 0.3, k=72)
    a.smooth_water()
    # the shrine: a ruined chapel in the north, the Frost chest inside
    sx, sy = 46, 12
    a.trail([s, (s[0], 60), (52, 48), (58, 38), (58, 24), (sx, sy + 7)], 2.0, ':', 2.2, k=73)
    N.ruin(a, sx, sy, 1)
    N.hidden_chest(a, sx + 0.5, sy + 2.5, 'frost', 0)
    for (x, y, actor) in [(sx - 5, sy + 9, 'skeleton_mage'), (sx + 6, sy + 9, 'skeleton_mage'), (sx, sy + 12, 'skeleton_warrior')]:
        N.enemy(a, actor, x, y)
    for (x, y) in [(sx - 4.5, sy + 6.8), (sx + 4.5, sy + 6.8)]:
        a.add('banner', x, y, 2, 0.3)
    # the hot spring: steam rising off it day and night
    hx, hy = 74, 50
    N.spring(a, hx, hy, 'The Hot Spring')
    for (dx, dy) in [(-1.5, -0.5), (1.2, 0.3), (0, -1.2)]:
        a.add('anim', hx + dx, hy + dy, None, 0, name='smoke', solid=0, light=False)
    a.trail([(52, 48), (64, 52), (hx - 5, hy + 2)], 1.4, ':', 1.8, k=74)
    # the lookout: a bench on the edge where the path comes up
    a.add('bench', s[0] - 5, H - 9, 0, 1.0)
    N.edge_wall(a, 4, a.edge_gaps(), frosty, (1.4, 2.0))
    inside = lambda x, y: min(x, y, W - x, H - y) > 4 and not a.is_reserved(int(x), int(y))
    N.woods(a, inside, frosty, spacing=(2.6, 7.0), clearing=0.5, wall_at=0.95, undergrowth=0.2, chop_near=3)
    N.outcrops(a, inside, 12, ('boulder',), ore=0.2, crystal=0.6)
    N.debris(a, inside, 26, ('stones', 'stones', 'twigs'), 1.8, 0.3)
    a.poi('The Frost Shrine', sx, sy)
