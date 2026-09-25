"""The building blocks every area is made from.

An Area is one map, like a Stardew location: a grid of ground characters, the things standing on
it, fences, cliffs, bridges, and the exits to other areas. The helpers here are about making
things look grown rather than placed:

  * smooth noise (fbm) drives density, so woods have thick and thin parts and natural clearings
  * Poisson-disc sampling spaces things like nature does: never on a grid, never clumped on top
    of each other, with the spacing itself varying across the map
  * clusters put things where they gather in life: weeds in patches, stones in piles, twigs under
    trees, flowers in drifts
  * lakes are blobs with coves and headlands, rivers meander and swell, paths wind between
    waypoints

Everything is seeded, so an area comes out the same on every run.

Terrain characters: '.' grass, ':' dirt, '=' cobblestone, '~' water, '*' snow over grass."""
import json, math, os, random, zlib

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, '..', '..', 'data')
CAT = json.load(open(os.path.join(DATA, 'catalog.json')))


def smooth(t):
    return t * t * (3 - 2 * t)


class Noise:
    """Value noise on an integer lattice, smoothly interpolated; fbm sums a few octaves."""

    def __init__(self, seed):
        self.seed = seed

    def _h(self, i, j):
        x = (i * 374761393 + j * 668265263 + self.seed * 982451653) & 0xffffffff
        x = ((x ^ (x >> 13)) * 1274126177) & 0xffffffff
        return ((x ^ (x >> 16)) & 0xffff) / 65535.0

    def value(self, x, y):
        i, j = math.floor(x), math.floor(y)
        fx, fy = smooth(x - i), smooth(y - j)
        a = self._h(i, j) + (self._h(i + 1, j) - self._h(i, j)) * fx
        b = self._h(i, j + 1) + (self._h(i + 1, j + 1) - self._h(i, j + 1)) * fx
        return a + (b - a) * fy

    def fbm(self, x, y, scale=16.0, octaves=3):
        total, amp, norm, f = 0.0, 1.0, 0.0, 1.0 / scale
        for _ in range(octaves):
            total += self.value(x * f, y * f) * amp
            norm += amp
            amp *= 0.5
            f *= 2.0
        return total / norm


class Area:
    def __init__(self, aid, name, w, h, seed, biome='meadow', snowy=False, regrow=4):
        self.id, self.name, self.w, self.h, self.seed = aid, name, w, h, seed
        self.biome, self.snowy, self.regrow = biome, snowy, regrow
        self.grid = [['.'] * w for _ in range(h)]
        self.reserved = bytearray(w * h)      # laid out: no nature grows here
        self.path = bytearray(w * h)          # paths: keep trees a step away
        self.objs, self.cliffs, self.decks, self.exits, self.pois = [], [], [], [], []
        self.fences = {'rail': set()}
        self.gates = []
        self.spawns = {}
        self.farmable = []                    # rectangles where the hoe works
        self.gaps = []                        # (side, lo, hi, to): openings in the rim to other areas
        self.rng = random.Random(seed)
        self.noise = Noise(seed)
        self._occ = {}                        # spatial hash of placed things: (cell) -> [(x, y, r)]

    # ------------------------------------------------------------ the ground
    def inside(self, x, y):
        return 0 <= x < self.w and 0 <= y < self.h

    def put(self, x, y, ch):
        if self.inside(x, y):
            self.grid[y][x] = ch

    def get(self, x, y):
        return self.grid[y][x] if self.inside(x, y) else '#'

    def reserve(self, x0, y0, x1, y1):
        for y in range(max(0, int(y0)), min(self.h, int(math.ceil(y1)))):
            for x in range(max(0, int(x0)), min(self.w, int(math.ceil(x1)))):
                self.reserved[y * self.w + x] = 1

    def is_reserved(self, x, y):
        return not self.inside(x, y) or self.reserved[y * self.w + x]

    def rect(self, x0, y0, x1, y1, ch, keep=None):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                if keep is None or self.get(x, y) in keep:
                    self.put(x, y, ch)

    def blob(self, cx, cy, r, rough=0.28, k=0, ry=None):
        """A test for an irregular round shape: radius wobbles with three slow harmonics."""
        rng = random.Random(self.seed * 31 + k)
        ph = [rng.uniform(0, math.tau) for _ in range(4)]
        amp = [rough * 0.55, rough * 0.3, rough * 0.2]
        ry = ry or r

        noise = self.noise

        def test(x, y):
            dx, dy = (x - cx) / r, (y - cy) / ry
            d = math.hypot(dx, dy)
            a = math.atan2(dy, dx)
            k2 = 1 + amp[0] * math.sin(2 * a + ph[0]) + amp[1] * math.sin(3 * a + ph[1]) + amp[2] * math.sin(5 * a + ph[2])
            # small bays and points along the shore, so no two lakes share an outline
            k2 += (noise.fbm(x * 1.7 + k * 31, y * 1.7, 5.0, 2) - 0.5) * rough * 1.5
            return d <= k2
        return test

    def paint(self, test, ch, box, keep=None):
        x0, y0, x1, y1 = box
        for y in range(max(0, int(y0)), min(self.h, int(y1) + 1)):
            for x in range(max(0, int(x0)), min(self.w, int(x1) + 1)):
                if test(x + 0.5, y + 0.5) and (keep is None or self.grid[y][x] in keep):
                    self.grid[y][x] = ch

    def lake(self, cx, cy, r, ry=None, rough=0.3, k=0, islands=()):
        ry = ry or r
        self.paint(self.blob(cx, cy, r, rough, k, ry), '~', (cx - r * 1.6, cy - ry * 1.6, cx + r * 1.6, cy + ry * 1.6))
        for (ix, iy, ir) in islands:
            self.paint(self.blob(ix, iy, ir, 0.25, k + 7), '.', (ix - ir * 1.5, iy - ir * 1.5, ix + ir * 1.5, iy + ir * 1.5))

    def smooth_water(self, passes=2):
        """Water shaped by a few rules of thumb: no lone puddles or one-tile spits of land, no
        pinholes of land in open water, and no channels thinner than two tiles."""
        for _ in range(passes):
            flips = []
            for y in range(self.h):
                for x in range(self.w):
                    ch = self.grid[y][x]
                    n = sum(1 for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dx or dy) and self.get(x + dx, y + dy) == '~')
                    if ch == '~' and n <= 2:
                        flips.append((x, y, '.'))
                    elif ch in '.*' and n >= 6 and not self.is_reserved(x, y):
                        flips.append((x, y, '~'))
            for (x, y, ch) in flips:
                if ch == '.' and self.snowy:
                    ch = '*'
                self.grid[y][x] = ch
        # a water cell needs a 2x2 block of water around it somewhere, or the shore tiles can't
        # draw it: thin it away
        for y in range(self.h):
            for x in range(self.w):
                if self.grid[y][x] != '~':
                    continue
                ok = False
                for oy in (-1, 0):
                    for ox in (-1, 0):
                        if all(self.get(x + ox + i, y + oy + j) == '~' for i in (0, 1) for j in (0, 1)):
                            ok = True
                if not ok:
                    self.grid[y][x] = '*' if self.snowy else '.'

    def spline(self, points, steps=10):
        pts = [points[0]] + list(points) + [points[-1]]
        out = []
        for i in range(1, len(pts) - 2):
            p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
            seg = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
            n = max(steps, int(seg * 2))
            for s in range(n):
                t = s / n
                out.append(tuple(0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t
                                        + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t ** 3) for k in (0, 1)))
        out.append(points[-1])
        return out

    def wander(self, points, amount=3.0, scale=14.0, k=0):
        """Points along a spline through `points`, pushed sideways by slow noise so the line winds."""
        pts = self.spline(points)
        out = []
        for i, (x, y) in enumerate(pts):
            j0, j1 = max(0, i - 1), min(len(pts) - 1, i + 1)
            tx, ty = pts[j1][0] - pts[j0][0], pts[j1][1] - pts[j0][1]
            tl = math.hypot(tx, ty) or 1
            nx, ny = -ty / tl, tx / tl
            # fade the wobble in and out so the ends stay where they were asked to be
            fade = min(1.0, i / 12.0, (len(pts) - 1 - i) / 12.0)
            off = (self.noise.fbm(i * 0.5 + k * 97, k * 13.0, scale, 2) - 0.5) * 2 * amount * fade
            out.append((x + nx * off, y + ny * off))
        return out

    def river(self, points, w0, w1, amount=4.0, k=0):
        pts = self.wander(points, amount, 18.0, k)
        for i, (x, y) in enumerate(pts):
            f = i / max(1, len(pts) - 1)
            w = w0 + (w1 - w0) * f + (self.noise.fbm(i * 0.4, 50 + k, 10.0, 2) - 0.5) * 2.4
            r = max(1.4, w / 2)
            for yy in range(int(y - r) - 1, int(y + r) + 2):
                for xx in range(int(x - r) - 1, int(x + r) + 2):
                    if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r:
                        self.put(xx, yy, '~')
        return pts

    def trail(self, points, width=2.0, ch=':', amount=2.0, k=0, keep='.*:'):
        """A winding footpath. Returns the centre line."""
        pts = self.wander(points, amount, 12.0, k)
        r = width / 2
        for (x, y) in pts:
            for yy in range(int(y - r) - 1, int(y + r) + 2):
                for xx in range(int(x - r) - 1, int(x + r) + 2):
                    if (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2 <= r * r and self.inside(xx, yy):
                        if self.grid[yy][xx] in keep:
                            self.grid[yy][xx] = ch
                        self.path[yy * self.w + xx] = 1
        return pts

    def bridges(self, pts, width=3):
        """Lay a plank bridge wherever the centre line `pts` (from trail()) crosses water: across
        the direction of travel, over every water cell of the crossing."""
        i = 0
        hw = width // 2
        while i < len(pts):
            x, y = int(pts[i][0]), int(pts[i][1])
            if self.get(x, y) != '~':
                i += 1
                continue
            j0, j1 = max(0, i - 3), min(len(pts) - 1, i + 3)
            dx, dy = pts[j1][0] - pts[j0][0], pts[j1][1] - pts[j0][1]
            if abs(dx) >= abs(dy):
                xs = [x]
                while self.get(xs[0] - 1, y) == '~' or any(self.get(xs[0] - 1, y + k) == '~' for k in (-hw, hw)):
                    xs.insert(0, xs[0] - 1)
                while self.get(xs[-1] + 1, y) == '~' or any(self.get(xs[-1] + 1, y + k) == '~' for k in (-hw, hw)):
                    xs.append(xs[-1] + 1)
                for xx in xs:
                    for yy in range(y - hw, y + hw + 1):
                        self.put(xx, yy, '~')
                self.deck(xs[0], y - hw, len(xs), width, 'bridge_ew')
                for yy in range(y - hw, y + hw + 1):
                    self.put(xs[0] - 1, yy, ':')
                    self.put(xs[-1] + 1, yy, ':')
            else:
                ys = [y]
                while self.get(x, ys[0] - 1) == '~' or any(self.get(x + k, ys[0] - 1) == '~' for k in (-hw, hw)):
                    ys.insert(0, ys[0] - 1)
                while self.get(x, ys[-1] + 1) == '~' or any(self.get(x + k, ys[-1] + 1) == '~' for k in (-hw, hw)):
                    ys.append(ys[-1] + 1)
                for yy in ys:
                    for xx in range(x - hw, x + hw + 1):
                        self.put(xx, yy, '~')
                self.deck(x - hw, ys[0], width, len(ys), 'bridge_ns')
                for xx in range(x - hw, x + hw + 1):
                    self.put(xx, ys[0] - 1, ':')
                    self.put(xx, ys[-1] + 1, ':')
            # walk on past the water
            while i < len(pts) and (self.get(int(pts[i][0]), int(pts[i][1])) == '~'):
                i += 1

    def road(self, points, width=3, ch=':'):
        """Straight segments (for streets in town). Water is left alone for a bridge."""
        hw = width / 2
        for (ax, ay), (bx, by) in zip(points, points[1:]):
            x0, x1 = min(ax, bx) - hw, max(ax, bx) + hw
            y0, y1 = min(ay, by) - hw, max(ay, by) + hw
            for y in range(int(y0) - 1, int(y1) + 2):
                for x in range(int(x0) - 1, int(x1) + 2):
                    if x0 < x + 0.5 < x1 and y0 < y + 0.5 < y1 and self.get(x, y) not in '~#':
                        self.put(x, y, ch)
                        self.path[y * self.w + x] = 1

    def near_char(self, x, y, chars, r=1):
        cx, cy = int(x), int(y)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if self.get(cx + dx, cy + dy) in chars:
                    return True
        return False

    def near_path(self, x, y, r=1):
        cx, cy = int(x), int(y)
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                qx, qy = cx + dx, cy + dy
                if self.inside(qx, qy) and self.path[qy * self.w + qx]:
                    return True
        return False

    def open_ground(self, x, y, margin=0, ground='.*'):
        cx, cy = int(x), int(y)
        for dy in range(-margin, margin + 1):
            for dx in range(-margin, margin + 1):
                qx, qy = cx + dx, cy + dy
                if self.get(qx, qy) not in ground or self.is_reserved(qx, qy):
                    return False
        return True

    # ------------------------------------------------------------ things
    def add(self, t, x, y, v=None, r=0.0, **extra):
        """Place something with its feet at tile coordinates (x, y); r is its footprint radius in
        tiles, used to keep other things from being placed on top of it."""
        o = {'t': t, 'x': int(round(x * 16)), 'y': int(round(y * 16)), 'id': len(self.objs)}
        if v is not None:
            o['v'] = v
        o.update(extra)
        self.objs.append(o)
        if r > 0:
            key = (int(x) // 4, int(y) // 4)
            self._occ.setdefault(key, []).append((x, y, r))
        return o

    def free(self, x, y, r):
        kx, ky = int(x) // 4, int(y) // 4
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for (ox, oy, orr) in self._occ.get((kx + dx, ky + dy), ()):
                    if (x - ox) ** 2 + (y - oy) ** 2 < (r + orr) ** 2:
                        return False
        return True

    def sprite_h(self, t, v=0):
        r = CAT['sprites'][t][v]['region']
        return (r[3] - r[1]) / 16.0

    def crown_clear(self, x, y, t, v):
        """A tall sprite must not hide anything laid out behind it (yards, graves, stalls)."""
        rise = int(self.sprite_h(t, v)) + 1
        cx, cy = int(x), int(y)
        for dy in range(2, rise):
            for dx in (-2, -1, 0, 1, 2):
                gx, gy = cx + dx, cy - dy
                if self.inside(gx, gy) and self.reserved[gy * self.w + gx] and self.grid[gy][gx] not in ':~':
                    return False
        return True

    def poisson(self, box, spacing, test, k=18):
        """Bridson's Poisson-disc sampling in box (x0, y0, x1, y1); spacing(x, y) gives the local
        minimum distance. Yields accepted points in the order they're found."""
        x0, y0, x1, y1 = box
        rng = self.rng
        cell = 0.9
        grid = {}
        active = []
        pts = []

        def near_ok(x, y, r):
            gx, gy = int(x / cell), int(y / cell)
            n = int(r / cell) + 2
            for yy in range(gy - n, gy + n + 1):
                for xx in range(gx - n, gx + n + 1):
                    for (px, py, pr) in grid.get((xx, yy), ()):
                        if (x - px) ** 2 + (y - py) ** 2 < min(r, pr) ** 2:
                            return False
            return True

        def insert(x, y, r):
            grid.setdefault((int(x / cell), int(y / cell)), []).append((x, y, r))
            active.append((x, y, r))
            pts.append((x, y))

        # seed a few starting points so disconnected regions all get filled
        for _ in range(int((x1 - x0) * (y1 - y0) / 40) + 1):
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            if test(x, y):
                r = spacing(x, y)
                if near_ok(x, y, r):
                    insert(x, y, r)
        while active:
            i = rng.randrange(len(active))
            ax, ay, ar = active[i]
            placed = False
            for _ in range(k):
                ang = rng.uniform(0, math.tau)
                d = rng.uniform(ar, 2 * ar)
                x, y = ax + math.cos(ang) * d, ay + math.sin(ang) * d
                if not (x0 <= x < x1 and y0 <= y < y1) or not test(x, y):
                    continue
                r = spacing(x, y)
                if near_ok(x, y, r):
                    insert(x, y, r)
                    placed = True
                    break
            if not placed:
                active[i] = active[-1]
                active.pop()
        return pts

    def cluster(self, cx, cy, n, spread, make, min_gap=0.8, test=None, tries=6):
        """Put up to n things around (cx, cy), thick in the middle and thinning out."""
        placed = 0
        for i in range(n * tries):
            if placed >= n:
                break
            x = cx + self.rng.gauss(0, spread)
            y = cy + self.rng.gauss(0, spread * 0.8)
            if test and not test(x, y):
                continue
            if not self.free(x, y, min_gap / 2):
                continue
            if make(x, y, placed) is not False:
                placed += 1
        return placed

    # ------------------------------------------------------------ fixtures
    def cliff(self, x, y, w, top=7, face=1, base='grass', colour=1, mine=None):
        c = {'x': x, 'y': y, 'w': w, 'top': top, 'face': face, 'base': base, 'colour': colour}
        if mine is not None:
            c['mine'] = mine
        self.cliffs.append(c)
        self.reserve(x, y, x + w, y + top + face + 5)
        return c

    def deck(self, x, y, w, h, kind='pier'):
        self.decks.append({'x': x, 'y': y, 'w': w, 'h': h})
        self.add('deck', x, y, kind=kind, w=w, h=h)
        self.reserve(x, y, x + w, y + h)

    def fence_line(self, x0, y0, x1, y1, style='rail'):
        pts = []
        if y0 == y1:
            pts = [(x, y0) for x in range(min(x0, x1), max(x0, x1) + 1)]
        else:
            pts = [(x0, y) for y in range(min(y0, y1), max(y0, y1) + 1)]
        for (x, y) in pts:
            self.fences[style].add((x, y))
            self.reserve(x, y, x + 1, y + 1)

    def gate(self, x, y, width=1, style='rail'):
        """Open a gateway of `width` cells in a fence row at (x, y) and hang a gate in it."""
        for i in range(width):
            self.fences[style].discard((x + i, y))
        self.gates.append({'x': x, 'y': y, 'w': width, 'style': style})

    def exit(self, x, y, w, h, to, at, facing='down'):
        """Walking into this rectangle (tiles) takes you to area `to`, arriving at its spawn `at`."""
        self.exits.append({'x': x, 'y': y, 'w': w, 'h': h, 'to': to, 'at': at, 'facing': facing})

    def spawn(self, name, x, y):
        self.spawns[name] = [int(round(x * 16)), int(round(y * 16))]

    def gap(self, to):
        """(side, lo, hi) of the opening that leads to area `to`."""
        for (side, lo, hi, other) in self.gaps:
            if other == to:
                return side, lo, hi
        raise KeyError(f'{self.id} has no way to {to}')

    def gap_point(self, to, depth=0.0):
        """The middle of the opening to `to`, `depth` tiles in from the map's edge."""
        side, lo, hi = self.gap(to)
        mid = (lo + hi + 1) / 2
        if side == 'N':
            return (mid, depth)
        if side == 'S':
            return (mid, self.h - depth)
        if side == 'W':
            return (depth, mid)
        return (self.w - depth, mid)

    def edge_gaps(self):
        return [(side, lo - 1, hi + 1) for (side, lo, hi, _) in self.gaps]

    def poi(self, name, x, y, kind='place'):
        self.pois.append({'name': name, 'x': x, 'y': y, 'kind': kind})
