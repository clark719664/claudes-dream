"""East of Brindle.

The Badlands: dry, rolling country: bare earth in blotches, brown grass, dead trees, and the orcs.
The Grimtusk warband has walled itself into a stockade in the north-east; its warlord camps inside.
An old farmstead lies abandoned in the south-west, and a small oasis keeps a few trees alive.

Stonegate: a walled town at the end of the east road. A palisade all round, a gate in the west
wall, a market square, the garrison, and townsfolk who don't get many visitors."""
import math
from core import Area
import nature as N
import build as B


def dry(a, x, y):
    r = a.rng.random()
    if r < 0.55:
        return N.dead_trees(a, x, y)
    if r < 0.8:
        return 'oak_young_dead', a.rng.randrange(2)
    return N.oaks(a, x, y)


# ================================================================== the Badlands
def make_badlands():
    return Area('badlands', 'The Badlands', 120, 90, seed=8808, biome='badlands', regrow=4)


def stockade(a, x0, y0, x1, y1, name, orcs, boss=None):
    """A palisade ring with its gate in the south wall, a fire pit, meat on the spit and loot."""
    a.paint(a.blob((x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2 + 1, 0.15, 81, (y1 - y0) / 2 + 1), ':', (x0 - 3, y0 - 3, x1 + 3, y1 + 3))
    gx = (x0 + x1) // 2
    for x in range(x0, x1, 6):
        a.add('palisade', x + 3, y0 + 0.9)
        if not (gx - 5 <= x + 3 <= gx + 3):
            a.add('palisade', x + 3, y1 + 0.4)
    for ty in range(y0 + 5, y1 + 2, 4):
        a.add('palisade_side', x0 - 0.4, ty)
        a.add('palisade_side', x1 + 0.6, ty)
    a.add('banner', gx - 3.4, y1 + 1.2, 0, 0.3)
    a.add('banner', gx + 3.4, y1 + 1.2, 0, 0.3)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    a.add('campfire', cx, cy + 1, None, 1.0, style='pit')
    a.add('log_seat', cx - 2.5, cy + 2.6, 0)
    a.add('log_seat', cx + 2.5, cy + 2.6, 1)
    a.add('anim', x0 + 5, y1 - 2, None, 1.0, name='grill_camp', solid=12)
    a.add('anim', x1 - 5, y1 - 2, None, 1.0, name='meat_rack', solid=12)
    a.add('butcher_table', x0 + 5, y0 + 4.4, 0, 1.0)
    a.add('weapon_rack', x1 - 6, y0 + 4.2, 0, 1.0)
    for i in range(3):
        a.add('crate', x0 + 3 + i * 1.2 + B.jitter(a, 0.2), y1 - 5, i % 2, 0.5)
        a.add('barrel', x1 - 3 - i * 1.2, y0 + 7 + B.jitter(a, 0.3), 0, 0.5)
    a.add('chest', x1 - 3, cy, 0, 0.5, loot=0, cid=name)
    for i, actor in enumerate(orcs):
        N.enemy(a, actor, x0 + 5 + (i % 3) * ((x1 - x0 - 10) / 2), y0 + 8 + (i // 3) * 6)
    if boss:
        N.enemy(a, boss, cx, cy - 3)
    a.reserve(x0 - 2, y0 - 1, x1 + 2, y1 + 2)
    for x in range(x0, x1 + 1):
        a.path[(y1 + 1) * a.w + x] = 0


def gen_badlands(a):
    W, H = a.w, a.h
    w = a.gap_point('town', -1)
    e = a.gap_point('stonegate', -1)
    a.lake(38, 68, 4.5, 3.2, 0.3, k=81)
    a.smooth_water()
    road = a.trail([w, (20, w[1] - 1), (46, 40), (74, 46), (100, e[1] + 1), e], 3.0, ':', 3.0, k=82)
    a.trail([(74, 46), (88, 36), (92, 31)], 2.0, ':', 1.6, k=83)
    a.trail([(46, 40), (40, 56), (30, 70), (22, 74)], 1.6, ':', 2.2, k=84)
    stockade(a, 78, 8, 106, 30, 'grimtusk', ['orc', 'berserker_m', 'orc_shaman', 'zealot_m', 'berserker_f', 'zealot_f'], boss='garrick')
    B.sign(a, 70, 44, 'Beyond this point: ORCS. Turn back, friend.')
    for (x, y) in [(66, 30), (70, 20), (60, 38), (96, 44), (104, 52)]:
        N.enemy(a, a.rng.choice(['orc_rogue', 'acolyte_m', 'acolyte_f', 'inquisitor_m', 'inquisitor_f']), x, y)
    # the old farmstead
    fx, fy = 18, 70
    a.paint(a.blob(fx, fy + 3, 7, 0.3, 85, 5), ':', (fx - 10, fy - 6, fx + 10, fy + 12))
    N.ruin(a, fx, fy, 2)
    a.add('cart_tipped', fx + 5.5, fy + 5.5, 0, 0.9)
    for (x0, y0, x1, y1) in [(fx - 8, fy + 8, fx - 4, fy + 8), (fx + 2, fy + 8, fx + 5, fy + 8), (fx - 8, fy + 4, fx - 8, fy + 8)]:
        a.fence_line(x0, y0, x1, y1)
    N.hidden_chest(a, fx + 0.5, fy + 2.6, 'farmstead', 3)
    # dry country
    N.dirt_patches(a, lambda x, y: True, 0.42, 8.0)
    N.edge_wall(a, 4, a.edge_gaps(), dry, (1.4, 2.2))
    inside = lambda x, y: min(x, y, W - x, H - y) > 4 and not a.is_reserved(int(x), int(y))
    N.woods(a, inside, dry, spacing=(3.0, 8.0), clearing=0.55, wall_at=0.97, undergrowth=0.2, chop_near=3)
    N.woods(a, lambda x, y: math.hypot(x - 38, y - 68) < 10, N.oaks, spacing=(2.2, 3.0), clearing=0.0, wall_at=9, undergrowth=0.6)
    N.reeds(a, (30, 60, 48, 76), 0.8)
    N.outcrops(a, inside, 16, ('boulder_brown',), ore=0.3)
    for (x, y) in a.poisson((0, 0, W, H), lambda x, y: 5.0, lambda x, y: inside(x, y) and a.open_ground(x, y, 0, '.:') and not a.near_path(x, y, 0))[:160]:
        r = a.rng.random()
        if r < 0.55:
            a.add('tuft_dry', x, y, a.rng.randrange(5))
        elif r < 0.75:
            a.add('weed_dry', x, y, a.rng.randrange(4), 0.45)
        elif r < 0.9:
            a.add('dead_shrub', x, y, a.rng.randrange(2), 0.6)
        else:
            a.add('bush_dry', x, y, 0)
    N.debris(a, inside, 30, ('stones', 'stones', 'twigs'), 2.0, 0.3)
    a.poi('Grimtusk stockade', 92, 19)
    a.poi('The old farmstead', fx, fy)


# ================================================================== Stonegate
def make_stonegate():
    return Area('stonegate', 'Stonegate', 100, 80, seed=9909, biome='town', regrow=3)


def gen_stonegate(a):
    W, H = a.w, a.h
    w = a.gap_point('badlands', -1)
    x0, y0, x1, y1 = 16, 8, 92, 72
    a.trail([w, (10, w[1] + 1)], 3.0, ':', 0.2, k=91)
    gate_y = int(w[1])
    # the wall: palisade along the top and bottom, posts down the sides, the gate in the west
    for x in range(x0, x1, 6):
        a.add('palisade', x + 3, y0 + 0.9)
        a.add('palisade', x + 3, y1 + 0.4)
    for ty in range(y0 + 5, y1 + 2, 4):
        if not (gate_y - 3 <= ty <= gate_y + 4):
            a.add('palisade_side', x0 - 0.4, ty)
        a.add('palisade_side', x1 + 0.6, ty)
    a.reserve(x0 - 1, y0 - 1, x1 + 2, y0 + 2)
    a.reserve(x0 - 1, y1 - 1, x1 + 2, y1 + 2)
    a.reserve(x0 - 2, y0, x0 + 1, y1)
    a.reserve(x1 - 1, y0, x1 + 2, y1)
    for (bx, by) in [(x0 - 1.6, gate_y - 2.2), (x0 - 1.6, gate_y + 3.4)]:
        a.add('banner', bx, by, 1, 0.3)
    B.villager(a, x0 + 2.5, gate_y + 3.2, 'enforcer_m', 'Gate warden Hale', 0,
               say=['Stonegate. State your business - or don\'t, you look harmless.', 'The orcs haven\'t tried the wall in years. The wall is why.'])
    # streets: the high street from the gate, two cross streets
    hs = gate_y - 1
    B.street(a, hs, x0 + 1, x1 - 2)
    ss = 66
    B.street(a, ss, x0 + 3, x1 - 3)
    B.avenue(a, 54, hs + 3, ss - 1)
    B.lot(a, x0 + 3, hs, 12, 'brick', 'The Garrison', 'woodpile')
    B.lot(a, x0 + 16, hs, 20, 'plaster', 'Stonegate Hall', 'flowers', gables=2)
    B.lot(a, 58, hs, 12, 'dark', 'The Chandler', 'herbs')
    B.lot(a, 71, hs, 12, 'brick', 'The Vintners', 'veg')
    B.lot(a, x0 + 3, ss, 12, 'plank', 'The Marrows', 'laundry', depth=14)
    B.lot(a, x0 + 16, ss, 12, 'log', 'The Pikes', 'orchard', depth=14)
    B.lot(a, 58, ss, 20, 'brick', 'The Iron Kettle', 'flowers', gables=2, depth=14)
    B.lot(a, 79, ss, 11, 'plaster', 'The Reeves', 'wild', depth=14)
    # the Deepways shaft in the north of the town, up the lane between the lots
    B.shaft_house(a, 55, hs - 17, 'brick')
    a.trail([(55, hs - 15.5), (55, hs + 0.5)], 2.0, ':', 0.0, k=92)
    # the market between the high street and the southern lots
    mx0, my0, mx1, my1 = 22, hs + 4, 51, ss - 14
    a.rect(mx0, my0, mx1, my1, '=')
    for (cx_, cy_) in [(mx0, my0), (mx1 - 1, my0), (mx0, my1 - 1), (mx1 - 1, my1 - 1)]:
        a.put(cx_, cy_, '.')
    a.reserve(mx0, my0, mx1, my1)
    for i, goods in enumerate([[0, 1, 2], [3, 4, 5], [6, 2, 1]]):
        B.stall(a, mx0 + 5 + i * 8, my0 + 4, goods)
    a.add('water_bucket', mx1 - 2.5, my0 + 2.5, 3, 0.4)
    a.add('bench', mx1 - 4.5, my1 - 1.2, 0, 1.0)
    B.shopkeeper(a, mx0 + 15.4, my0 + 5.8, 'seraphine', 'Marta', 'general')
    B.villager(a, mx0 + 6, my1 - 1.5, 'samuel', 'Nim', 40)
    B.villager(a, mx0 + 22, my1 - 1.5, 'defector_lace', 'Lace', 30, say=['I came in from the badlands last month. I am not going back out there.'])
    B.villager(a, 40, ss + 1.6, 'grunt_f', 'Watchwoman Ley', 30, lines='guard')
    B.villager(a, 76, ss + 1.6, 'grunt_m', 'Watchman Dobb', 30, lines='guard')
    B.villager(a, 66, hs + 1.6, 'enforcer_f', 'Sergeant Voss', 30, lines='guard')
    B.lamps_along(a, hs + 3, x0 + 2, x1 - 2, 12)
    B.lamps_along(a, ss + 3, x0 + 4, x1 - 4, 12)
    # outside the walls: fields and scrub, woods round the rim
    N.edge_wall(a, 4, a.edge_gaps(), N.oaks, (1.4, 2.0))
    outside = lambda x, y: not (x0 - 2 < x < x1 + 2 and y0 - 2 < y < y1 + 2) and min(x, y, W - x, H - y) > 4 and not a.is_reserved(int(x), int(y))
    N.woods(a, outside, N.oaks, spacing=(2.6, 6.0), clearing=0.5, wall_at=9, undergrowth=0.5)
    inside_walls = lambda x, y: x0 + 1 < x < x1 - 1 and y0 + 1 < y < y1 - 1 and not a.is_reserved(int(x), int(y))
    N.woods(a, inside_walls, N.oaks, spacing=(4.0, 8.0), clearing=0.6, wall_at=9, undergrowth=0.4)
    N.flowers(a, lambda x, y: outside(x, y) or inside_walls(x, y), 14)
    N.grass(a, lambda x, y: not a.is_reserved(int(x), int(y)), 40)
    a.poi('Stonegate', 54, 40, 'town')
