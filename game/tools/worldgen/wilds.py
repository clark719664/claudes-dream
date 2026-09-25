"""The woods and waters around the farm.

Pinewood (north of the farm): mixed woods by the farm that turn to pine and then to old, tall pine
towards the mountain. A woodcutter's camp in a clearing, a lake with a creek, an abandoned cottage
where skeletons walk, and, if you follow the deer tracks far enough west, a spring.

Oldwood (south of the farm): old broadleaf forest, dense and dim, with a stream. In the south-west
the trees die back into the Hollow, a ruined hamlet nobody goes to. A spring hides in the west.

Riverlands (south of town): open meadows, a river winding down into Mirror Lake, and Reedwater, a
fishing hamlet on the lake's west shore with its jetty."""
import math
from core import Area
import nature as N
import build as B


# ================================================================== Pinewood
def make_pinewood():
    return Area('pinewood', 'The Pinewood', 120, 100, seed=3303, biome='forest', regrow=5)


def gen_pinewood(a):
    W, H = a.w, a.h
    s = a.gap_point('farm', -1)
    e = a.gap_point('mountain', -1)
    # the lake in the west and its creek running off south under the trees
    a.lake(26, 42, 7.5, 5.2, 0.34, k=1)
    a.lake(33, 46, 4.2, 3.2, 0.3, k=2)
    a.lake(21, 37, 3.4, 2.6, 0.3, k=3)
    a.river([(30, 48), (28, 60), (33, 74), (27, 88), (29, 103)], 2.2, 3.2, 2.0, k=4)
    a.smooth_water()
    # trails: the main one north from the farm to the camp and east to the mountain; a loop to the
    # lake; a faint deer track into the far west where the spring is
    camp = (57, 55)
    a.trail([s, (s[0] - 1, 88), (54, 76), (camp[0] - 1, camp[1] + 4)], 2.2, ':', 3.0, k=11)
    a.trail([(camp[0] + 4, camp[1] - 1), (74, 50), (92, 42), (106, e[1] + 1), e], 2.0, ':', 3.0, k=12)
    a.trail([(camp[0] - 4, camp[1]), (44, 52), (38, 49.5)], 1.6, ':', 2.0, k=13)
    a.trail([(camp[0], camp[1] - 4), (60, 38), (66, 24), (70, 18)], 1.4, ':', 2.4, k=14)
    # the deer track: narrow and broken, so it reads as a track and not a path
    track = a.wander([(20, 50), (12, 40), (10, 26), (16, 14)], 2.5, 10, k=15)
    for i, (x, y) in enumerate(track):
        if (i // 7) % 3 != 2 and a.get(int(x), int(y)) == '.':
            a.put(int(x), int(y), ':')
        a.path[int(y) * W + int(x)] = 1 if a.inside(int(x), int(y)) else 0
    N.camp(a, *camp)
    B.villager(a, camp[0] + 1.5, camp[1] + 3.2, 'peasant', 'Rook the woodcutter', 20, lines='hunter')
    N.spring(a, 17, 11, 'The Pine Spring')
    N.ruin(a, 72, 13, 2)
    for (x, y) in [(69, 20), (76, 21), (73, 25)]:
        N.enemy(a, 'skeleton', x, y)
    N.hidden_chest(a, 72.5, 11.2, 'pinewood_ruin', 1)
    N.hidden_chest(a, 108, 84, 'pinewood_thicket', 0)
    # the woods: mixed by the farm (south), pine further in, old pine towards the mountain (NE)
    cold = lambda x, y: min(1.0, max(0.0, (x / W) * 0.6 + (1 - y / H) * 0.6 - 0.2))
    species = N.blend(N.blend(N.oaks, N.pines, lambda x, y: 1.2 - y / H * 1.4), N.old_pines, cold)
    N.edge_wall(a, 4, a.edge_gaps(), species, (1.3, 1.9))
    inside = lambda x, y: min(x, y, W - x, H - y) > 4 and not a.is_reserved(int(x), int(y))
    N.woods(a, inside, species, spacing=(1.7, 5.0), clearing=0.34, wall_at=0.84, undergrowth=0.6, chop_near=3)
    N.reeds(a, (8, 28, 44, 56), 0.7)
    N.reeds(a, (18, 46, 40, 100), 0.4)
    N.debris(a, inside, 60, ('twigs', 'twigs', 'stumps', 'stones', 'weeds', 'saplings'), 2.0, 0.3)
    N.outcrops(a, lambda x, y: inside(x, y) and x > 70 and y < 50, 7, ('boulder',), ore=0.35)
    N.flowers(a, inside, 10, ['white', 'blue', 'yellow'], (4, 9))
    N.grass(a, inside, 40)
    N.forage(a, inside, 14)
    a.poi('The Pinewood', 60, 50, 'town')


# ================================================================== Oldwood
def make_oldwood():
    return Area('oldwood', 'The Oldwood', 120, 100, seed=4404, biome='forest', regrow=5)


def gen_oldwood(a):
    W, H = a.w, a.h
    n = a.gap_point('farm', -1)
    e = a.gap_point('riverlands', -1)
    # a brook from the north-west that winds down to the south-east
    a.river([(-3, 22), (20, 30), (38, 44), (52, 62), (70, 70), (92, 84), (104, 103)], 2.4, 3.6, 3.0, k=21)
    # the Wellspring: a round, deep pool in the west
    a.smooth_water()
    a.bridges(a.trail([n, (n[0] + 1, 10), (68, 26), (74, 42), (84, 50), (100, e[1]), e], 2.0, ':', 3.2, k=22))
    a.bridges(a.trail([(74, 42), (60, 52), (44, 66), (34, 76)], 1.5, ':', 2.6, k=23))
    # the Hollow: a ruined hamlet under dead trees
    hx, hy = 26, 80
    N.ruin(a, hx, hy, 0)
    N.ruin(a, hx + 12, hy + 4, 1)
    for i in range(5):
        a.add('tombstone', hx - 6 + i * 1.9 + B.jitter(a, 0.3), hy + 9.0 + B.jitter(a, 0.4), 0, 0.5)
    a.add('coffin', hx + 5.5, hy + 8.8, 0, 0.5)
    N.enemy(a, 'skeleton', hx + 4, hy + 6)
    N.enemy(a, 'skeleton_rogue', hx + 10, hy + 9)
    N.enemy(a, 'skeleton_warrior', hx - 2, hy + 7)
    N.hidden_chest(a, hx + 12.5, hy + 2.2, 'hollow', 3)
    N.spring(a, 14, 40, 'The Wellspring')
    N.hidden_chest(a, 104, 14, 'oldwood_thicket', 2)
    # woods: old oaks, dead trees towards the Hollow
    hollow = lambda x, y: max(0.0, 1 - math.hypot(x - hx - 4, (y - hy - 4) * 1.2) / 26)
    species = N.blend(N.oaks, N.dead_trees, hollow)
    N.edge_wall(a, 4, a.edge_gaps(), N.oaks, (1.3, 1.8))
    inside = lambda x, y: min(x, y, W - x, H - y) > 4 and not a.is_reserved(int(x), int(y))
    N.woods(a, inside, species, spacing=(1.6, 4.6), clearing=0.28, wall_at=0.82, undergrowth=0.75, chop_near=3)
    # mossy old stumps and fallen giants
    for (x, y) in a.poisson((0, 0, W, H), lambda x, y: 11, lambda x, y: inside(x, y) and a.open_ground(x, y, 1) and not a.near_path(x, y, 1))[:18]:
        a.add(a.rng.choice(['stump_mossy', 'fallen_log', 'stump_big']), x, y, a.rng.randrange(2), 1.3)
    N.reeds(a, (0, 10, W, H), 0.35)
    N.debris(a, inside, 60, ('twigs', 'twigs', 'stumps', 'weeds', 'stones'), 2.0, 0.3)
    N.grass(a, inside, 40)
    N.flowers(a, lambda x, y: inside(x, y) and hollow(x, y) < 0.3, 8, ['blue', 'white'], (3, 7))
    N.forage(a, inside, 18)
    a.poi('The Oldwood', 70, 40, 'town')
    a.poi('The Hollow', hx + 4, hy + 4)


# ================================================================== Riverlands
def make_riverlands():
    return Area('riverlands', 'The Riverlands', 130, 90, seed=5505, biome='meadow', regrow=4)


def gen_riverlands(a):
    W, H = a.w, a.h
    n = a.gap_point('town', -1)
    w = a.gap_point('oldwood', -1)
    # Mirror Lake: a big lake of several lobes with an island, fed by the river from the north
    lake = [(92, 52, 15, 10), (104, 44, 9, 7), (80, 60, 8, 6), (100, 62, 9, 6)]
    for i, (cx, cy, rx, ry) in enumerate(lake):
        a.lake(cx, cy, rx, ry, 0.32, k=40 + i)
    a.paint(a.blob(97, 52, 3.2, 0.3, 47, 2.2), '.', (90, 46, 104, 58))
    a.river([(70, -3), (74, 12), (68, 26), (78, 38), (86, 46)], 3.0, 4.2, 3.0, k=48)
    a.river([(98, 66), (94, 78), (100, 93)], 3.0, 3.6, 2.0, k=49)
    a.smooth_water()
    # Reedwater on the west shore: three homes facing the lake path, a jetty, fish racks
    street_y = 58
    a.trail([n, (n[0], 12), (36, 26), (46, 40), (58, street_y + 1), (66, street_y + 1.5)], 2.2, ':', 2.5, k=51)
    a.trail([(46, 40), (24, 44), (10, w[1]), w], 2.0, ':', 2.5, k=52)
    a.bridges(a.trail([(36, 26), (56, 24), (66, 22), (84, 18), (100, 22)], 1.6, ':', 2.0, k=53))
    B.street(a, street_y, 40, 64, ':', rows=2)
    B.lot(a, 38, street_y, 12, 'log', "Fenn's house", 'woodpile', back=False)
    B.lot(a, 51, street_y, 12, 'plank', 'The Tulls', 'laundry', back=False)
    B.villager(a, 70, street_y + 4, 'peasant', 'Old Fenn', 0, lines='fisher')
    _jetty(a, street_y + 1)
    for (x, y) in [(60, street_y + 3.5), (63, street_y + 4.2)]:
        a.add('drying_rack', x, y, a.rng.randrange(4), 1.2)
    a.add('barrel', 57.5, street_y + 3.6, 0, 0.5)
    a.add('crate', 58.4, street_y + 3.9, 1, 0.5)
    B.sign(a, 44, street_y + 3.4, 'Reedwater.\nMirror Lake is deep and cold. Mind the jetty.')
    N.spring(a, 118, 80, 'The Reed Spring')
    N.hidden_chest(a, 12, 82, 'riverlands_marsh', 2)
    # meadows: open ground, trees in loose groups, woods round the rim
    N.edge_wall(a, 4, a.edge_gaps(), N.oaks, (1.4, 2.0))
    inside = lambda x, y: min(x, y, W - x, H - y) > 4 and not a.is_reserved(int(x), int(y))
    N.woods(a, inside, N.blend(N.oaks, N.pines, lambda x, y: 0.15), spacing=(2.4, 7.0), clearing=0.55, wall_at=0.95, undergrowth=0.5, chop_near=3)
    N.reeds(a, (0, 0, W, H), 0.8)
    N.flowers(a, inside, 34, size=(6, 18))
    N.grass(a, inside, 60)
    N.debris(a, inside, 30, ('weeds', 'stones', 'twigs', 'saplings'), 2.0, 0.15)
    N.forage(a, inside, 10, 'herb', 'fern')
    a.poi('Reedwater', 52, street_y - 6, 'town')
    a.poi('Mirror Lake', 92, 52)


def _jetty(a, y):
    """A jetty from the end of the street out into the lake: find the shore east of the street."""
    x = 64
    while x < a.w - 1 and a.get(x, y) != '~':
        x += 1
    a.deck(x - 1, y - 1, 7, 3, 'bridge_ew')
    for xx in range(x - 1, x + 6):
        for yy in (y - 1, y, y + 1):
            a.put(xx, yy, '~')
    a.add('rope_post', x - 1.1, y - 1.2, 0, 0.3)
    a.add('rope_post', x - 1.1, y + 2.0, 0, 0.3)

