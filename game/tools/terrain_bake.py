"""Bakes the terrain of a world into ready-to-load tile layers, so a very large map loads instantly.

This is the offline twin of the autotiler that used to run in scripts/terrain.gd. It reads the
character grid (. grass, : dirt, = cobblestone, ~ water, * snow) and works out, for every cell,
which piece of the pack's hand-painted 5x5 ground stamps goes there:

  * grass and cobblestone are cell based: a cell of the material picks the stamp piece whose
    rim faces its open neighbours (13 pieces, like a reduced 47-blob set)
  * snow uses the same pieces on the complement (the pack draws snow as islands)
  * water is corner based ("dual grid"): each tile comes from the land/water state of its
    four corners
  * shapes the stamps can't draw (1-wide strips and so on) are opened up first
  * among a piece's variants, the one whose edge pixels line up with the neighbours already
    placed (left and above) wins, so rims run on without seams

The result is each layer in the byte format of Godot's TileMapLayer.tile_map_data: a 2-byte
format header, then 12 bytes per cell (int16 x, int16 y, uint16 source, uint16 atlas x,
uint16 atlas y, uint16 alternative). Only the standard library is used."""
import random, struct, zlib

GRASS, DIRT, STONE = 0, 1, 2
SRC_FLOORS, SRC_WATER, SRC_FURNITURE = 0, 1, 4
LAYERS = ['Water', 'Ground', 'Cobbles', 'Grass', 'Snow', 'Decks']

RING = {
    'S': [(2, 0)], 'N': [(2, 4)], 'E': [(0, 2)], 'W': [(4, 2)],
    'ES': [(1, 1)], 'WS': [(3, 1)], 'NE': [(1, 3)], 'NW': [(3, 3)],
    'iSE': [(1, 0), (0, 1)], 'iSW': [(3, 0), (4, 1)],
    'iNE': [(0, 3), (1, 4)], 'iNW': [(4, 3), (3, 4)],
}
GRASS_STAMPS = [(0, 0), (0, 5)]
STONE_STAMPS = [(5, 0), (5, 5)]
SNOW_STAMPS = [(0, 12), (0, 17)]
SNOW_FILL = [(x, 22) for x in range(5)] + [(x, 23) for x in range(5)]
GRASS_FILL = [(1, 10), (2, 10), (3, 10)]
DIRT_FILL = [(11, 10), (12, 10), (13, 10)]
STONE_FILL = [(6, 10), (7, 10), (8, 10)]
SHORE = {
    '0001': [(1, 0), (0, 1)], '0010': [(3, 0), (4, 1)], '0011': [(2, 0)],
    '0100': [(0, 3), (1, 4)], '0101': [(0, 2)], '0111': [(1, 1)],
    '1000': [(4, 3), (3, 4)], '1010': [(4, 2)], '1011': [(3, 1)],
    '1100': [(2, 4)], '1101': [(1, 3)], '1110': [(3, 3)],
    '1111': [(2, 1), (1, 2), (2, 2), (3, 2), (2, 3)],
}
WATER_PLAIN = [(5, 2), (5, 3), (0, 4), (5, 4)]
WATER_RIPPLE = [(0, 0), (4, 0), (5, 0), (5, 1), (4, 4)]
D8 = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]
B_NW, B_N, B_NE, B_W, B_E, B_SW, B_S, B_SE = 1, 2, 4, 8, 16, 32, 64, 128


def role(m):
    """Which stamp piece a cell needs, from a bitmask of open neighbours. '' = no piece exists."""
    n, s, e, w = m & B_N, m & B_S, m & B_E, m & B_W
    ne, nw, se, sw = m & B_NE, m & B_NW, m & B_SE, m & B_SW
    k = (n > 0) + (s > 0) + (e > 0) + (w > 0)
    if k == 0:
        d = (ne > 0) + (nw > 0) + (se > 0) + (sw > 0)
        if d == 0:
            return 'full'
        if d > 1:
            return ''
        return 'iNE' if ne else ('iNW' if nw else ('iSE' if se else 'iSW'))
    if k == 1:
        if s and not ne and not nw: return 'S'
        if n and not se and not sw: return 'N'
        if e and not nw and not sw: return 'E'
        if w and not ne and not se: return 'W'
        return ''
    if k == 2:
        if e and s and not nw: return 'ES'
        if w and s and not ne: return 'WS'
        if n and e and not sw: return 'NE'
        if n and w and not se: return 'NW'
    return ''


class Baker:
    def __init__(self, rows, edges, seed=1):
        self.rows = rows
        self.h = len(rows)
        self.w = len(rows[0])
        self.edges = edges
        self.rng = random.Random(seed)

    def ch(self, x, y):
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.rows[y][x]
        return '.'

    # ---------------------------------------------------------------- solving the materials
    def solve(self):
        w, h = self.w, self.h
        W1 = w + 1
        self.vwater = vw = bytearray(W1 * (h + 1))
        for j in range(h + 1):
            for i in range(W1):
                if self.ch(i - 1, j - 1) == '~' and self.ch(i, j - 1) == '~' and self.ch(i - 1, j) == '~' and self.ch(i, j) == '~':
                    vw[j * W1 + i] = 1
        self.shore = shore = bytearray(w * h)
        self.mat = mat = bytearray(w * h)
        for y in range(h):
            row = self.rows[y]
            for x in range(w):
                wet = vw[y * W1 + x] or vw[y * W1 + x + 1] or vw[(y + 1) * W1 + x] or vw[(y + 1) * W1 + x + 1]
                shore[y * w + x] = 1 if wet else 0
                c = row[x]
                mat[y * w + x] = GRASS if (wet or c in '.~*') else (DIRT if c == ':' else STONE)
        # dirt and cobbles never touch the shore; grass never meets dirt and cobbles at once
        for y in range(h):
            for x in range(w):
                if mat[y * w + x] != GRASS and self.touches(shore, x, y):
                    mat[y * w + x] = GRASS
        for y in range(h):
            for x in range(w):
                if mat[y * w + x] == GRASS and not shore[y * w + x] and self.borders(x, y, DIRT) and self.borders(x, y, STONE):
                    mat[y * w + x] = DIRT
        # snow: only on grass away from the water; grow drifts where their rim has no piece
        self.snow = snow = bytearray(w * h)
        for y in range(h):
            row = self.rows[y]
            for x in range(w):
                if row[x] == '*' and not shore[y * w + x] and not self.touches(shore, x, y):
                    snow[y * w + x] = 1
        todo = set((x, y) for y in range(h) for x in range(w) if not snow[y * w + x] and self.near(snow, x, y))
        while todo:
            nxt = set()
            for (x, y) in todo:
                i = y * w + x
                if not snow[i] and not shore[i] and role(self.snow_mask(x, y)) == '':
                    snow[i] = 1
                    for dx, dy in D8:
                        if 0 <= x + dx < w and 0 <= y + dy < h:
                            nxt.add((x + dx, y + dy))
            todo = nxt
        # open up shapes the stamps cannot draw, until everything is drawable
        todo = set((x, y) for y in range(h) for x in range(w) if mat[y * w + x] != GRASS or self.borders_open(x, y))
        while todo:
            nxt = set()
            for (x, y) in todo:
                i = y * w + x
                m = mat[i]
                changed = False
                if m == GRASS and not shore[i] and role(self.mask(x, y, -1)) == '':
                    mat[i] = self.open_neighbour(x, y)
                    changed = True
                elif m == STONE and role(self.mask(x, y, DIRT)) == '':
                    mat[i] = DIRT
                    changed = True
                if changed:
                    for dx, dy in D8:
                        if 0 <= x + dx < w and 0 <= y + dy < h:
                            nxt.add((x + dx, y + dy))
            todo = nxt

    def touches(self, arr, x, y):
        w, h = self.w, self.h
        for dx, dy in D8:
            qx, qy = x + dx, y + dy
            if 0 <= qx < w and 0 <= qy < h and arr[qy * w + qx]:
                return True
        return False

    near = touches

    def borders(self, x, y, material):
        w, h, mat = self.w, self.h, self.mat
        for dx, dy in D8:
            qx, qy = x + dx, y + dy
            if 0 <= qx < w and 0 <= qy < h and mat[qy * w + qx] == material:
                return True
        return False

    def borders_open(self, x, y):
        return self.borders(x, y, DIRT) or self.borders(x, y, STONE)

    def mask(self, x, y, open_):
        w, h, mat = self.w, self.h, self.mat
        m = 0
        for k, (dx, dy) in enumerate(D8):
            qx, qy = x + dx, y + dy
            mm = mat[qy * w + qx] if (0 <= qx < w and 0 <= qy < h) else GRASS
            if (open_ == -1 and mm != GRASS) or (open_ != -1 and mm == open_):
                m |= 1 << k
        return m

    def snow_mask(self, x, y):
        w, h, snow = self.w, self.h, self.snow
        m = 0
        for k, (dx, dy) in enumerate(D8):
            qx, qy = x + dx, y + dy
            if 0 <= qx < w and 0 <= qy < h and snow[qy * w + qx]:
                m |= 1 << k
        return m

    def open_neighbour(self, x, y):
        w, h, mat = self.w, self.h, self.mat
        dirt = stone = 0
        for dx, dy in D8:
            qx, qy = x + dx, y + dy
            if 0 <= qx < w and 0 <= qy < h:
                mm = mat[qy * w + qx]
                if mm == DIRT:
                    dirt += 1
                elif mm == STONE:
                    stone += 1
        if dirt == 0 and stone == 0:
            return GRASS
        return DIRT if dirt >= stone else STONE

    def corner_key(self, x, y):
        W1, vw = self.w + 1, self.vwater
        return ''.join('0' if vw[(y + dy) * W1 + x + dx] else '1' for dx, dy in ((0, 0), (1, 0), (0, 1), (1, 1)))

    # ---------------------------------------------------------------- picking tiles
    def pick(self, options):
        return options[self.rng.randrange(len(options))]

    def variant(self, r, stamps, placed, x, y):
        w = self.w
        left = placed[y * w + x - 1] if x > 0 else None
        up = placed[(y - 1) * w + x] if y > 0 else None
        best, best_cost = None, 1e9
        for sx, sy in stamps:
            for ox, oy in RING[r]:
                t = (sx + ox, sy + oy)
                cost = self.rng.random() * 0.5
                if left is not None:
                    cost += bin(self.edges[left][1] ^ self.edges[t][3]).count('1')
                if up is not None:
                    cost += bin(self.edges[up][2] ^ self.edges[t][0]).count('1')
                if cost < best_cost:
                    best_cost, best = cost, t
        return best

    def bake(self, decks):
        """Returns ({layer: [(x, y, source, ax, ay)]}, set of blocked water cells)."""
        self.solve()
        w, h = self.w, self.h
        out = {k: [] for k in LAYERS}
        placed = {k: [None] * (w * h) for k in ('Cobbles', 'Grass', 'Snow')}
        blocked = set()
        mat, shore, snow = self.mat, self.shore, self.snow
        for y in range(h):
            for x in range(w):
                i = y * w + x
                if shore[i]:
                    key = self.corner_key(x, y)
                    if key == '0000':
                        at = self.pick(WATER_PLAIN) if self.rng.random() < 0.9 else self.pick(WATER_RIPPLE)
                    else:
                        at = self.pick(SHORE[key])
                    out['Water'].append((x, y, SRC_WATER) + at)
                    if key.count('0') >= 3:
                        blocked.add((x, y))
                    continue
                m = mat[i]
                if m == STONE:
                    r = role(self.mask(x, y, DIRT))
                    if r == 'full':
                        out['Ground'].append((x, y, SRC_FLOORS) + self.pick(STONE_FILL))
                    else:
                        out['Ground'].append((x, y, SRC_FLOORS) + self.pick(DIRT_FILL))
                        t = self.variant(r, STONE_STAMPS, placed['Cobbles'], x, y)
                        placed['Cobbles'][i] = t
                        out['Cobbles'].append((x, y, SRC_FLOORS) + t)
                elif m == DIRT:
                    out['Ground'].append((x, y, SRC_FLOORS) + self.pick(DIRT_FILL))
                else:
                    under = self.open_neighbour(x, y)
                    if under == DIRT:
                        out['Ground'].append((x, y, SRC_FLOORS) + self.pick(DIRT_FILL))
                    elif under == STONE:
                        out['Ground'].append((x, y, SRC_FLOORS) + self.pick(STONE_FILL))
                    gr = role(self.mask(x, y, -1))
                    if gr == 'full':
                        t = self.pick(GRASS_FILL)
                    else:
                        t = self.variant(gr, GRASS_STAMPS, placed['Grass'], x, y)
                    placed['Grass'][i] = t
                    out['Grass'].append((x, y, SRC_FLOORS) + t)
                if snow[i]:
                    t = self.pick(SNOW_FILL)
                    placed['Snow'][i] = t
                    out['Snow'].append((x, y, SRC_FLOORS) + t)
                else:
                    sr = role(self.snow_mask(x, y))
                    if sr not in ('full', ''):
                        t = self.variant(sr, SNOW_STAMPS, placed['Snow'], x, y)
                        placed['Snow'][i] = t
                        out['Snow'].append((x, y, SRC_FLOORS) + t)
        # bridges and piers are drawn by scripts/deck.gd; here they only make the water walkable
        for d in decks:
            for j in range(d['h']):
                for i in range(d['w']):
                    blocked.discard((d['x'] + i, d['y'] + j))
        return out, blocked


def encode_layer(cells):
    """Godot's TileMapLayer.tile_map_data byte format."""
    parts = [struct.pack('<H', 0)]
    pack = struct.Struct('<hhHHHH').pack
    for (x, y, src, ax, ay) in cells:
        parts.append(pack(x, y, src, ax, ay, 0))
    return b''.join(parts)


def write_tiles(path, layers):
    """All layers in one zlib-compressed file: 'HWT1', then per layer a uint32 length and its bytes."""
    body = [b'HWT1']
    for name in LAYERS:
        data = encode_layer(layers[name])
        body.append(struct.pack('<I', len(data)))
        body.append(data)
    raw = b''.join(body)
    with open(path, 'wb') as f:
        f.write(zlib.compress(raw, 9))
    return len(raw)


def merge_rects(cells):
    """Blocked cells as few rectangles: runs along each row, then stacked where runs line up."""
    rows = {}
    for (x, y) in cells:
        rows.setdefault(y, []).append(x)
    runs = {}
    for y, xs in rows.items():
        xs.sort()
        start = prev = xs[0]
        for x in xs[1:] + [None]:
            if x is not None and x == prev + 1:
                prev = x
                continue
            runs.setdefault(y, []).append((start, prev - start + 1))
            if x is not None:
                start = prev = x
    rects = []
    open_ = {}
    for y in sorted(runs):
        cur = {}
        for (x, n) in runs[y]:
            key = (x, n)
            if key in open_ and open_[key][1] + open_[key][3] == y:
                r = open_[key]
                r[3] += 1
                cur[key] = r
            else:
                r = [x, y, n, 1]
                rects.append(r)
                cur[key] = r
        open_ = cur
    return rects


def write_png(path, width, height, pixels):
    """A plain RGB PNG from a flat list of (r, g, b) tuples."""
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixels[y * width + x])
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
