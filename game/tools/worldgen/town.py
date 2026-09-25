"""Brindle, the market town east of your farm.

Main Street runs east-west through the middle. On its north side stand the general store, the
smithy with its forge in the yard, Tilda's carpentry and lumber yard, and a few homes; behind the
smithy a back lane leads to the churchyard. The square below Main Street is where the market
stalls stand and where the festivals are held. South Street has more homes and the inn, and past
it a river winds through the meadow under a plank bridge on the road south to the Riverlands. The
road north climbs to the mountain; the road east leaves for the badlands."""
import math
from core import Area
import nature as N
import build as B

W, H = 110, 90
MAIN = 44          # first row of Main Street
SOUTH = 66         # first row of South Street
AVE = 54           # the north road's middle column
SQ = (42, 48, 68, 63)


def make():
    return Area('town', 'Brindle', W, H, seed=2202, biome='town', regrow=3)


def generate(a):
    wx, wy = a.gap_point('farm', -1)
    ex, ey = a.gap_point('badlands', -1)
    nx, ny = a.gap_point('mountain', -1)
    sx, sy = a.gap_point('riverlands', -1)
    # ---- the river first: streets are laid over it and leave it for a bridge
    river = a.river([(-3, 79), (18, 81.5), (40, 77.5), (62, 79.5), (84, 76.5), (113, 78)], 3.4, 4.6, 2.8, k=7)
    a.smooth_water()
    # ---- streets
    a.trail([(wx, wy), (6, wy), (9, MAIN + 1.5)], 3.0, ':', 0.5, k=11)
    B.street(a, MAIN, 8, 100)
    a.trail([(100, MAIN + 1), (105, MAIN - 1), (ex, ey)], 3.0, ':', 0.8, k=12)
    B.avenue(a, AVE, 0, MAIN - 1)
    B.street(a, SOUTH, 8, 102)
    B.avenue(a, 62, SQ[3], SOUTH - 1)
    road_s = [(62, SOUTH + 3), (62.5, 73), (61.5, 86), (sx, sy)]
    a.road([(62, SOUTH + 3), (62, 86)], 3, ':')
    a.trail([(62, 86), (sx, sy)], 3.0, ':', 0.3, k=13)
    _bridge(a, 61, 64)
    # ---- the square
    x0, y0, x1, y1 = SQ
    a.rect(x0, y0, x1, y1, '=')
    for (cx, cy) in [(x0, y0), (x1 - 1, y0), (x0, y1 - 1), (x1 - 1, y1 - 1)]:
        a.put(cx, cy, '.')
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    green = a.blob(cx, cy, 5.2, 0.12, k=21, ry=3.4)
    a.paint(green, '.', (cx - 7, cy - 5, cx + 7, cy + 5))
    a.reserve(x0, y0, x1, y1)
    a.add('oak_big', cx, cy + 1.6, 0, 1.4, wall=1)
    for i in range(22):
        ang = i / 22 * math.tau
        fx, fy = cx + math.cos(ang) * 4.4, cy + math.sin(ang) * 2.7 + 0.3
        a.add('flower_' + ('yellow' if i % 3 else 'white'), fx + B.jitter(a, 0.2), fy, a.rng.randrange(8))
    B.bench_pair(a, cx, cy + 4.9)
    a.add('bench', cx - 7.0, cy - 0.5, 1, 1.0)
    for (lx, ly) in [(cx - 6.2, cy - 3.6), (cx + 6.2, cy - 3.6), (cx - 6.2, cy + 4.4), (cx + 6.2, cy + 4.4)]:
        B.lamp(a, lx, ly)
    # market stalls on the square's west side, a notice board by the street
    B.stall(a, x0 + 3.5, y0 + 4.5, [1, 3, 5])
    B.stall(a, x0 + 3.5, y0 + 10.5, [0, 2, 6])
    a.add('board', x0 + 1.8, y0 + 1.2, 0, 0.8)
    B.sign(a, x0 + 4.2, y0 + 1.4, 'BRINDLE NOTICES\nSpring 13: Blossom Fair.  Summer 11: Midsummer Bonfire.\nFall 16: Harvest Fair.  Winter 25: Night of Lanterns.')
    _festivals(a, cx, cy)
    # ---- Main Street, north side
    door = B.lot(a, 12, MAIN, 12, 'plank', 'The Millers', 'veg')
    door = B.lot(a, 25, MAIN, 20, 'plaster', 'General Store', 'flowers', gables=2)
    B.shopkeeper(a, door + 2.6, MAIN - 3.4, 'peasant', 'Pell', 'general')
    a.add('crate_crops', door - 3.2, MAIN - 2.6, 1, 0.4)
    a.add('crate_crops', door - 4.3, MAIN - 2.4, 4, 0.4)
    a.add('sack', door + 4.2, MAIN - 2.7, 0, 0.4)
    door = B.lot(a, 57, MAIN, 12, 'brick', 'Smithy', dress=False)
    B.shopkeeper(a, door + 2.4, MAIN - 3.3, 'knight', 'Brom', 'smith')
    a.add('station_deco', door - 3.6, MAIN - 2.2, station='anvil', tier=2)
    a.add('station_deco', door + 4.3, MAIN - 5.0, station='furnace', tier=2)
    a.add('ore_crate', door - 1.9, MAIN - 5.2, 0, 0.4)
    a.add('water_bucket', door + 1.8, MAIN - 1.6, 2, 0.3)
    door = B.lot(a, 70, MAIN, 20, 'dark', "Tilda's Carpentry", dress=False, gables=2)
    B.shopkeeper(a, door + 2.6, MAIN - 3.4, 'tavern_b', 'Tilda', 'carpenter')
    for (lx, ly) in [(door - 6.5, MAIN - 2.4), (door - 6.2, MAIN - 3.6), (door + 6.5, MAIN - 2.6)]:
        a.add('log_pile', lx + B.jitter(a, 0.2), ly, 0, 0.9)
    a.add('station_deco', door - 3.0, MAIN - 4.6, station='sawmill', tier=2)
    a.add('chopping_block', door + 4.0, MAIN - 1.8, 0, 0.5)
    for i in range(4):
        a.add('branch', door + a.rng.uniform(3, 8), MAIN - a.rng.uniform(1.4, 3.5), a.rng.randrange(5))
    B.lot(a, 91, MAIN, 12, 'log', 'The Coopers', 'woodpile')
    B.lamps_along(a, MAIN + 3, 8, 100, 12)
    # ---- the back lane to the churchyard
    lane_y = MAIN - 17
    B.street(a, lane_y, AVE + 1, 74, ':', rows=2)
    B.graveyard(a, 60, 4, 26, lane_y - 5, 'Brindle churchyard')
    # ---- South Street, north side (the square sits in the middle)
    B.lot(a, 9, SOUTH, 12, 'plaster', "Merlo's house", 'herbs', depth=16)
    B.lot(a, 22, SOUTH, 12, 'log', 'The Hollins', 'laundry', depth=16)
    door = B.lot(a, 71, SOUTH, 20, 'brick', 'The Wayfarer Inn', 'flowers', gables=2, depth=16)
    for (tx, ty) in [(door - 5.5, SOUTH - 2.2), (door + 5.5, SOUTH - 2.2)]:
        a.add('table_small', tx, ty, 0, 0.9)
        a.add('stool', tx - 1.4, ty + 0.2, 0, 0.3)
        a.add('stool', tx + 1.4, ty + 0.2, 0, 0.3)
    B.lot(a, 92, SOUTH, 12, 'plank', 'The Weavers', 'wild', depth=16)
    B.lamps_along(a, SOUTH + 3, 8, 102, 13)
    # ---- people
    B.villager(a, cx - 4, cy + 6.5, 'wizard', 'Merlo', 50, lines='merlo')
    B.villager(a, 98, MAIN + 1.6, 'knight', 'Captain Brann', 0, lines='guard')
    B.villager(a, 30, MAIN + 1.8, 'peasant', 'Ada', 70)
    B.villager(a, 80, SOUTH + 1.6, 'tavern_a', 'Rosa', 40,
               say=['The Wayfarer is open all hours. Well, most hours.', 'Ship your crops in the crate by your door. The carter pays at dawn.'])
    B.villager(a, cx + 7, cy - 1, 'peasant', 'Wick', 30,
               say=['I sell nothing, I buy nothing, I just like the square.', 'The Blossom Fair is on the 13th of spring. Everybody comes.'])
    # ---- the town park and pond in the north-west, the meadow by the river
    a.lake(28, 15, 6.5, 3.8, 0.3, k=31)
    a.lake(33, 18, 3.2, 2.4, 0.3, k=32)
    a.smooth_water()
    a.add('bench', 28, 22.5, 0, 1.0)
    a.add('bench', 19.5, 20.5, 1, 1.0)
    a.trail([(AVE - 2, 24), (38, 23.5), (26, 23.5), (16, 19)], 1.6, ':', 0.8, k=33)
    N.reeds(a, (18, 8, 42, 24), 0.6)
    N.reeds(a, (0, 70, W, 88), 0.45)
    # ---- nature: the rim, trees in the park and by the river, flowers and grass
    N.edge_wall(a, 4, a.edge_gaps(), N.oaks, (1.6, 2.3))
    park = lambda x, y: (y < MAIN - 16 and x < AVE - 2) or y > SOUTH + 4
    park_open = lambda x, y: park(x, y) and not a.is_reserved(int(x), int(y)) and min(x, y, W - x, H - y) > 5
    N.woods(a, lambda x, y: park_open(x, y) and y < MAIN, N.oaks, spacing=(4.0, 9.0), clearing=0.55, wall_at=9, undergrowth=0.5)
    # the riverside meadow: a willow-ish oak here and there, mostly open so you can see the water
    N.woods(a, lambda x, y: park_open(x, y) and y > SOUTH + 4, N.oaks, spacing=(7.0, 16.0), clearing=0.7, wall_at=9, undergrowth=0.5)
    N.flowers(a, park_open, 14)
    N.grass(a, lambda x, y: not a.is_reserved(int(x), int(y)) and min(x, y, W - x, H - y) > 5, 50)
    N.debris(a, lambda x, y: park_open(x, y) and y > SOUTH + 4, 10, ('weeds', 'stones', 'twigs'), 1.8, 0.0)
    a.poi('Brindle', 55, 46, 'town')
    return a


def _bridge(a, x0, x1):
    """A plank bridge where the south road crosses the river: find the water rows under the road
    and lay the deck over them, a row of bank at each end."""
    rows = [y for y in range(SOUTH + 3, a.h) if any(a.get(x, y) == '~' for x in range(x0, x1))]
    if not rows:
        return
    y0, y1 = rows[0], rows[-1]
    for y in range(y0, y1 + 1):
        for x in range(x0 - 1, x1 + 1):
            if a.get(x, y) != '~' and x0 <= x < x1:
                a.put(x, y, '~')
    a.deck(x0, y0, x1 - x0, y1 - y0 + 1, 'bridge_ns')
    a.add('rope_post', x0 - 0.1, y0 - 0.2, 0, 0.3)
    a.add('rope_post', x1 + 0.1, y0 - 0.2, 0, 0.3)
    a.add('rope_post', x0 - 0.1, y1 + 1.0, 0, 0.3)
    a.add('rope_post', x1 + 0.1, y1 + 1.0, 0, 0.3)


def _festivals(a, cx, cy):
    """Decorations that only go up on festival days (the game shows objects tagged `festival`
    only on that day)."""
    x0, y0, x1, y1 = SQ
    # spring: the Blossom Fair - flower stalls, banners, benches round the green
    for i, (bx, by) in enumerate([(x0 + 1.5, y0 + 1.0), (x1 - 1.5, y0 + 1.0), (x0 + 1.5, y1 - 0.5), (x1 - 1.5, y1 - 0.5)]):
        a.add('banner', bx, by, i % 3, 0, festival='spring')
    B.stall(a, x1 - 4.0, y0 + 4.5, [4, 4, 1])
    for o in a.objs[-5:]:
        o['festival'] = 'spring'
    # summer: the Midsummer Bonfire on the cobbles north of the green, log seats around it
    fy = y0 + 2.8
    a.add('campfire', cx, fy, None, 0, style='bonfire', festival='summer')
    for (dx, dy) in [(-2.6, 0.5), (2.6, 0.5), (0, -1.4)]:
        a.add('log_seat', cx + dx, fy + dy, 0, 0, festival='summer')
    # fall: the Harvest Fair - produce crates, hay bales and pumpkin-coloured banners
    for i in range(6):
        a.add('crate_crops', x1 - 4.5 + (i % 3) * 1.2, y0 + 9.0 + (i // 3) * 1.4, i % 7, 0, festival='fall')
    for (hx, hy) in [(x1 - 6.5, y0 + 12.4), (x1 - 2.4, y0 + 12.8)]:
        a.add('hay', hx, hy, 0, 0, festival='fall')
    # winter: the Night of Lanterns - lanterns all round the square
    for i in range(12):
        t = i / 12
        lx = x0 + 1 + (x1 - x0 - 2) * t
        a.add('lantern', lx, y0 + 0.6, 0, 0, light=1, festival='winter')
        a.add('lantern', lx, y1 - 0.4, 0, 0, light=1, festival='winter')
