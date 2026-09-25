"""The Deepways: the old mine railway under the valley.

Long tunnels, rails still in them, run between four stations: under the Mountain, under Brindle,
under Reedwater and, far to the east beneath the badlands, under Stonegate. You can walk every
tunnel (they're long, and not empty), and once a station's cart is working again you can ride
from any working station to any other. Each station has a ladder up to its town.

Side caverns open off the tunnels: a crystal grotto, an ore vein, a flooded-out dig, and the camp
of the Deep Company, scavengers who've taken the east tunnel for themselves.

Terrain here: '#' rock, '.' packed earth, '=' flagstone (the stations)."""
import math
from core import Area
import nature as N
import build as B

W, H = 196, 92
STATIONS = {
    # id: (x, y, name, surface area)
    'mountain': (50, 13, 'Mountain station', 'mountain'),
    'town': (56, 46, 'Brindle station', 'town'),
    'riverlands': (48, 80, 'Reedwater station', 'riverlands'),
    'stonegate': (176, 44, 'Stonegate station', 'stonegate'),
}


def make():
    a = Area('deepways', 'The Deepways', W, H, seed=4242, biome='cave', regrow=3)
    for row in a.grid:
        for i in range(len(row)):
            row[i] = '#'
    a.cave = True
    return a


def _carve(a, test, ch, box):
    x0, y0, x1, y1 = box
    for y in range(max(1, int(y0)), min(a.h - 1, int(y1) + 1)):
        for x in range(max(1, int(x0)), min(a.w - 1, int(x1) + 1)):
            if test(x + 0.5, y + 0.5) and (ch == '=' or a.grid[y][x] == '#'):
                a.grid[y][x] = ch


def tunnel(a, points, width, k):
    """A winding tunnel with a railway down the middle. Returns the centre line."""
    pts = a.wander(points, 2.6, 16.0, k)
    r = width / 2
    for i, (x, y) in enumerate(pts):
        rr = r + (a.noise.fbm(i * 0.3, k * 7.0, 8.0, 2) - 0.5) * 2.2
        for yy in range(int(y - rr) - 1, int(y + rr) + 2):
            for xx in range(int(x - rr) - 1, int(x + rr) + 2):
                if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= rr * rr and 1 <= xx < a.w - 1 and 1 <= yy < a.h - 1:
                    if a.grid[yy][xx] == '#':
                        a.grid[yy][xx] = '.'
                    a.path[yy * a.w + xx] = 1
    # rails: one sleeper-and-rail tile per cell of the centre line
    laid = set()
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        c = (int(x), int(y))
        if c in laid:
            continue
        laid.add(c)
        dx = pts[i + 1][0] - pts[i - 1][0]
        dy = pts[i + 1][1] - pts[i - 1][1]
        a.add('rail_h' if abs(dx) >= abs(dy) else 'rail_v', c[0] + 0.5, c[1] + 0.5)
    return pts


def cavern(a, x, y, rx, ry, k, ch='.'):
    test = a.blob(x, y, rx, 0.35, k, ry)
    _carve(a, test, ch, (x - rx * 1.6, y - ry * 1.6, x + rx * 1.6, y + ry * 1.6))


def station(a, sid):
    x, y, name, surface = STATIONS[sid]
    cavern(a, x, y, 8.5, 5.5, hash(sid) % 97, '=')
    a.reserve(x - 6, y - 3, x + 7, y + 4)
    a.add('minecart_stop', x, y + 1, None, 1.4, id='dw_' + sid, name=name)
    a.add('ladder', x - 5.5, y - 2.0, None, 0.6, to=surface, at='deepways')
    a.add('lantern', x - 3.5, y - 2.6, 0, 0.2, light=1)
    a.add('lantern', x + 4.5, y - 2.6, 0, 0.2, light=1)
    a.add('crate', x + 6.0, y - 1.0, 0, 0.5)
    a.add('barrel', x + 6.6, y + 0.4, 0, 0.5)
    a.add('ore_crate', x - 6.2, y + 2.4, 1, 0.5)
    B.sign(a, x + 2.8, y - 2.3, name.upper() + '\nThe old mine railway.')
    a.spawn(sid, x - 5.5, y - 0.6)
    a.poi(name, x, y, 'town')


def generate(a):
    for sid in STATIONS:
        station(a, sid)
    m, t, r, s = (STATIONS[k][:2] for k in ('mountain', 'town', 'riverlands', 'stonegate'))
    lines = [
        tunnel(a, [(m[0] + 4, m[1] + 3), (58, 24), (54, 36), (t[0] - 2, t[1] - 3)], 4.4, 1),
        tunnel(a, [(t[0] - 2, t[1] + 4), (60, 58), (50, 68), (r[0] + 2, r[1] - 3)], 4.4, 2),
        tunnel(a, [(t[0] + 7, t[1] + 1), (84, 50), (112, 40), (140, 50), (160, 44), (s[0] - 7, s[1] + 1)], 4.8, 3),
    ]
    # side caverns off the tunnels
    grotto = (132, 70)
    camp = (108, 22)
    vein = (26, 34)
    dig = (84, 78)
    for (cx, cy), (rx, ry), k in [(grotto, (9, 6), 11), (camp, (11, 7), 12), (vein, (8, 6), 13), (dig, (9, 5), 14)]:
        cavern(a, cx, cy, rx, ry, k)
        via = min((p for line in lines for p in line), key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
        tunnel(a, [via, ((via[0] + cx) / 2, (via[1] + cy) / 2 + 2), (cx, cy)], 3.2, k + 20)
    # a few dead ends and alcoves so the tunnels aren't just pipes
    for i, (x, y, rx, ry) in enumerate([(70, 30, 4, 3), (96, 56, 5, 3), (150, 34, 4, 3), (160, 58, 5, 4), (36, 60, 4, 3), (120, 46, 4, 3)]):
        cavern(a, x, y, rx, ry, 30 + i)
        near = min((p for line in lines for p in line), key=lambda p: (p[0] - x) ** 2 + (p[1] - y) ** 2)
        tunnel(a, [near, (x, y)], 3.0, 40 + i)
    # the Deep Company's camp: tents of crates, a fire, their leader
    cx, cy = camp
    a.add('campfire', cx, cy + 0.5, None, 1.0, style='ring')
    for (dx, dy) in [(-3, 1.5), (3, -1), (0, 3)]:
        a.add('log_seat', cx + dx, cy + dy, 0, 0.8)
    for i in range(6):
        a.add(a.rng.choice(['crate', 'barrel', 'sack', 'ore_crate']), cx - 7 + i * 1.3 + B.jitter(a, 0.3), cy - 4.2 + B.jitter(a, 0.4), a.rng.randrange(2), 0.5)
    a.add('weapon_rack', cx + 6, cy - 3.6, 0, 1.0)
    N.enemy(a, 'venn', cx + 1, cy - 1)
    for (dx, dy, actor) in [(-6, 2, 'rust_juno'), (6, 3, 'scrap_yadi'), (-2, -3, 'hacker_rem'), (5, -2, 'jax'), (-7, -1, 'vale')]:
        N.enemy(a, actor, cx + dx, cy + dy)
    N.hidden_chest(a, cx + 8, cy + 3, 'deep_company', 0)
    # the crystal grotto, the ore vein and the old dig
    for (x, y) in a.poisson((grotto[0] - 9, grotto[1] - 6, grotto[0] + 9, grotto[1] + 6), lambda x, y: 2.0,
                            lambda x, y: a.get(int(x), int(y)) == '.' and a.free(x, y, 0.6)):
        a.add('crystal', x, y, a.rng.randrange(3), 0.6)
    N.enemy(a, 'technomancer_f', grotto[0] - 3, grotto[1])
    N.enemy(a, 'neon_pix', grotto[0] + 4, grotto[1] + 2)
    N.hidden_chest(a, grotto[0] + 6, grotto[1] - 2, 'grotto', 3)
    for (x, y) in a.poisson((vein[0] - 8, vein[1] - 6, vein[0] + 8, vein[1] + 6), lambda x, y: 1.8,
                            lambda x, y: a.get(int(x), int(y)) == '.' and a.free(x, y, 0.6)):
        a.add('ore_rock' if a.rng.random() < 0.6 else 'rock', x, y, a.rng.randrange(2), 0.6)
    N.enemy(a, 'cave_goblin', vein[0] + 2, vein[1] + 1)
    N.enemy(a, 'cave_goblin', vein[0] - 3, vein[1] - 2)
    a.add('mine_carts', dig[0], dig[1], 0, 1.6)
    a.add('tripod', dig[0] + 4, dig[1] - 2, 0, 1.0)
    N.enemy(a, 'magma_golem', dig[0] - 4, dig[1] + 1)
    N.enemy(a, 'scientist_m', dig[0] + 5, dig[1] + 2)
    N.hidden_chest(a, dig[0] - 5, dig[1] + 0.5, 'old_dig', 1)
    # the tunnel between Brindle and Reedwater has slimes in it; the long east tunnel has worse
    for (x, y) in [(58, 60), (54, 66), (50, 72)]:
        N.enemy(a, 'emerald_slime', x, y)
    for (x, y, actor) in [(84, 50, 'cave_goblin'), (100, 44, 'scrap_yadi'), (126, 46, 'technomancer_m'), (146, 48, 'rust_juno'), (156, 44, 'lyric'),
                          (60, 28, 'myconid'), (56, 34, 'cave_goblin')]:
        N.enemy(a, actor, x, y)
    # rubble and loose rock everywhere off the rails
    open_ = lambda x, y: a.get(int(x), int(y)) == '.' and not a.is_reserved(int(x), int(y)) and not a.near_path(x, y, 0)
    for (x, y) in a.poisson((0, 0, W, H), lambda x, y: 3.2, lambda x, y: a.get(int(x), int(y)) in '.=' and not a.is_reserved(int(x), int(y))):
        if a.near_path(x, y, 0) and a.rng.random() < 0.8:
            continue
        r = a.rng.random()
        if r < 0.45:
            a.add('rock', x, y, a.rng.randrange(4), 0.5)
        elif r < 0.6:
            a.add('stone', x, y, a.rng.randrange(4), 0.4)
        elif r < 0.8:
            a.add('pebble', x, y, a.rng.randrange(8))
        elif r < 0.9:
            a.add('pot', x, y, a.rng.randrange(4), 0.4)
        else:
            a.add('debris', x, y, a.rng.randrange(5))
    # lamps along the rails, every so often
    for line in lines:
        for i in range(20, len(line) - 20, 34):
            x, y = line[i]
            for off in (2.6, -2.6):
                px, py = x, y + off
                if a.get(int(px), int(py)) == '.' and a.get(int(px), int(py) - 1) == '#':
                    a.add('lantern', px, py, 0, 0.2, light=1)
                    break
