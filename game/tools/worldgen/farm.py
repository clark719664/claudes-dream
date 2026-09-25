"""Your farm: an old homestead gone wild. A one-room log cabin with a shipping crate by the door,
a pond in the south-west, and every other tile given over to weeds, stones, fallen branches,
stumps and young trees coming up where the fields used to be. Clearing it is the work of a
season or two. Thick woods close it in; worn paths lead out east to Brindle, north into the
Pinewood and south into the Oldwood."""
import math
from core import Area
import nature as N
import build as B

W, H = 80, 64
HOUSE = (52, 17)           # door seam and doorstep row


def make():
    a = Area('farm', 'Your Farm', W, H, seed=1101, biome='meadow', regrow=0)
    return a


def generate(a):
    hx, hy = HOUSE
    # ---- the pond first, so paths bend around it
    # three overlapping lobes make a pond with a bay and a point, not an oval
    a.lake(18, 44, 5.6, 4.0, 0.34, k=3)
    a.lake(23.5, 46.6, 3.9, 3.0, 0.3, k=4)
    a.lake(13.8, 41.8, 3.1, 2.4, 0.3, k=5)
    a.smooth_water()
    # ---- the house, its yard and the crate
    B.house(a, hx, hy, 'log', 'Your cabin', 1, t='cabin')
    a.add('ship_crate', hx + 5.6, hy + 0.9, 0, 1.2)
    a.reserve(hx + 4, hy - 1, hx + 8, hy + 2)
    yard = a.blob(hx + 0.5, hy + 2.6, 5.2, 0.35, k=9, ry=2.8)
    a.paint(yard, ':', (hx - 7, hy - 1, hx + 8, hy + 7))
    a.reserve(hx - 6, hy, hx + 7, hy + 5)
    # the previous owner's leavings: a tipped cart, a chopping block, an old rain barrel, a
    # fallen-down garden fence around a plot gone to weeds
    a.add('cart_tipped', hx - 6.2, hy + 1.4, 0, 1.0)
    a.add('chopping_block', hx + 3.5, hy + 3.8, 0, 0.6)
    a.add('barrel', hx - 4.8, hy - 0.2, 0, 0.5)
    a.add('water_bucket', hx - 3.9, hy + 0.5, 1, 0.3)
    gx0, gy0 = hx - 16, hy + 4
    for (x0, y0, x1, y1) in [(gx0, gy0, gx0 + 3, gy0), (gx0 + 6, gy0, gx0 + 8, gy0), (gx0, gy0, gx0, gy0 + 2), (gx0 + 8, gy0 + 3, gx0 + 8, gy0 + 5),
                             (gx0 + 2, gy0 + 6, gx0 + 5, gy0 + 6)]:
        a.fence_line(x0, y0, x1, y1)
    for i in range(10):
        x, y = gx0 + a.rng.uniform(1, 7.5), gy0 + a.rng.uniform(1, 5.5)
        if a.free(x, y, 0.4):
            a.add('weed', x, y, a.rng.randrange(6), 0.45)
    a.add('scarecrow', gx0 + 4.3, gy0 + 3.2, 0, 0.4)
    # ---- worn paths out to the three openings
    door = (hx, hy + 1.5)
    east = a.gap_point('town', -1)
    north = a.gap_point('pinewood', -1)
    south = a.gap_point('oldwood', -1)
    a.trail([door, (hx + 8, hy + 5), (63, 26), (72, east[1] - 0.5), east], 2.2, ':', 2.2, k=1)
    a.trail([(hx - 3, hy + 2), (hx - 9, hy - 2), (north[0] + 2, 10), north], 1.8, ':', 1.6, k=2)
    a.trail([(hx - 2, hy + 4), (hx - 8, 30), (34, 41), (31, 54), south], 1.8, ':', 1.8, k=3)
    B.sign(a, 70.5, east[1] - 2.2, 'East: Brindle, the market town.\nNorth: the Pinewood.  South: the Oldwood.')
    # ---- the rim: woods you can't get through, broken only where the paths leave
    # the crowns are four or five tiles across, so a thin band of trees already makes a wall
    N.edge_wall(a, 4, a.edge_gaps(), N.blend(N.oaks, N.pines, lambda x, y: 1 - y / 30), (1.6, 2.3))
    # a few trees on the old fields, standing alone or in twos and threes, and saplings coming up
    fields = lambda x, y: min(x, y, W - x, H - y) >= 8 and not a.is_reserved(int(x), int(y)) and math.hypot(x - hx, (y - hy) * 1.4) > 10
    N.woods(a, fields, N.oaks, spacing=(6.0, 16.0), clearing=0.8, wall_at=9, undergrowth=0.7)
    # ---- the pond's edge
    N.reeds(a, (8, 34, 32, 54), 0.7)
    for (x, y) in [(12.5, 39.2), (27.8, 43.5), (15.2, 50.6)]:
        a.cluster(x, y, 3, 0.8, lambda px, py, i: a.add('stone', px, py, a.rng.randrange(4), 0.45), 0.9, lambda px, py: a.open_ground(px, py))
    # ---- all the clearing work: weeds, stones, branches, stumps, saplings, a few big ones
    open_farm = lambda x, y: min(x, y, W - x, H - y) > 5.5 and not a.is_reserved(int(x), int(y)) and math.hypot(x - hx, (y - hy - 2) * 1.3) > 6.5
    N.debris(a, open_farm, 150, ('weeds', 'weeds', 'weeds', 'stones', 'stones', 'twigs', 'twigs', 'stumps', 'saplings'), 2.2, 0.2)
    for (x, y) in [(30, 22), (64, 44), (44, 52), (20, 28), (60, 34)]:
        if a.open_ground(x, y, 1):
            a.add(a.rng.choice(['boulder', 'boulder_brown']), x, y, a.rng.randrange(2), 1.3)
    for (x, y) in [(40, 30), (58, 50), (14, 22)]:
        if a.open_ground(x, y, 1):
            a.add('stump_big', x, y, a.rng.randrange(2), 1.5)
    for (x, y) in [(46, 40), (26, 30)]:
        if a.open_ground(x, y, 1):
            a.add('fallen_log', x, y, a.rng.randrange(2), 1.3)
    N.grass(a, open_farm, 70, (4, 12))
    N.flowers(a, open_farm, 9, size=(4, 10))
    # things that grow back each morning for you to pick
    for (x, y) in [(33, 14), (24, 20), (66, 20), (70, 52), (38, 58)]:
        if a.open_ground(x, y) and a.free(x, y, 0.5):
            a.add('forage', x, y, a.rng.randrange(3), 0.4, item=a.rng.choice(['mushroom', 'herb']), sprite='mushroom')
    # ---- the fields you're allowed to dig
    a.farmable.append([7, 7, W - 7, H - 7])
    a.spawn('door', hx, hy + 0.7)
    a.poi('Your farm', hx, hy - 4, 'home')
    return a
