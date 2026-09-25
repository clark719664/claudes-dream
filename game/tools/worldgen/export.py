"""Writes a finished Area for the game: data/areas/<id>.dat (zlib JSON: everything but the ground),
<id>.bin (the baked ground layers) and, for areas that aren't snowbound all year, <id>_winter.bin
with the same ground under snow. Also a small map picture of every area for the in-game map."""
import json, os, zlib
from core import CAT, DATA
from terrain_bake import Baker, write_tiles, merge_rects, write_png

CHUNK = 32
PERSISTENT = {'player_start', 'cabin', 'npc', 'villager', 'station', 'deck', 'ship_crate', 'spring', 'mine_entrance', 'shopkeeper'}
OUT = os.path.join(DATA, 'areas')
EDGES = {tuple(int(v) for v in k.split(',')): e for k, e in CAT['floor_edges'].items()}


def link(areas, a_id, a_side, a_lo, a_hi, b_id, b_side, b_lo, b_hi):
    """Two areas joined by an opening in each one's rim."""
    areas[a_id].gaps.append((a_side, a_lo, a_hi, b_id))
    areas[b_id].gaps.append((b_side, b_lo, b_hi, a_id))


def finish_links(a):
    """Exit rectangles along each opening and the spot where you arrive coming from there."""
    for (side, lo, hi, to) in a.gaps:
        n = hi - lo + 1
        mid = (lo + hi + 1) / 2
        if side == 'N':
            a.exit(lo, 0, n, 1, to, 'from_' + a.id, 'up')
            a.spawn('from_' + to, mid, 2.6)
        elif side == 'S':
            a.exit(lo, a.h - 1, n, 1, to, 'from_' + a.id, 'down')
            a.spawn('from_' + to, mid, a.h - 1.6)
        elif side == 'W':
            a.exit(0, lo, 1, n, to, 'from_' + a.id, 'left')
            a.spawn('from_' + to, 2.0, mid + 0.4)
        else:
            a.exit(a.w - 1, lo, 1, n, to, 'from_' + a.id, 'right')
            a.spawn('from_' + to, a.w - 2.0, mid + 0.4)


MAP_COL = {'.': (104, 156, 72), ':': (170, 132, 88), '=': (160, 158, 150), '~': (72, 124, 196), '*': (226, 232, 242)}


def write(a):
    os.makedirs(OUT, exist_ok=True)
    finish_links(a)
    chunks, persistent = {}, []
    for o in a.objs:
        if o['t'] in PERSISTENT:
            persistent.append(o)
            continue
        key = f"{o['x'] // (CHUNK * 16)},{o['y'] // (CHUNK * 16)}"
        chunks.setdefault(key, []).append(o)
    for k in chunks:
        chunks[k].sort(key=lambda o: (o['y'], o['x']))
    rows = [''.join(r) for r in a.grid]
    layers, blocked = Baker(rows, EDGES, seed=a.seed).bake(a.decks)
    raw = write_tiles(os.path.join(OUT, a.id + '.bin'), layers)
    if not a.snowy:
        wrows = [r.replace('.', '*') for r in rows]
        wl, _ = Baker(wrows, EDGES, seed=a.seed).bake(a.decks)
        write_tiles(os.path.join(OUT, a.id + '_winter.bin'), wl)
    water = [v for r in merge_rects(blocked) for v in r]
    data = {
        'id': a.id, 'name': a.name, 'width': a.w, 'height': a.h, 'seed': a.seed, 'chunk': CHUNK,
        'biome': a.biome, 'snowy': a.snowy, 'regrow': a.regrow, 'farmable': a.farmable,
        'exits': a.exits, 'spawns': a.spawns, 'cliffs': a.cliffs, 'water': water, 'pois': a.pois,
        'fences': {k: [c for cell in sorted(v) for c in cell] for k, v in a.fences.items()},
        'gates': a.gates, 'persistent': persistent, 'chunks': chunks, 'ground': ''.join(rows),
    }
    blob = json.dumps(data, separators=(',', ':')).encode()
    with open(os.path.join(OUT, a.id + '.dat'), 'wb') as f:
        f.write(zlib.compress(blob, 9))
    _map_png(a)
    print(f'{a.id:11s} {a.w}x{a.h}: {len(a.objs)} objects ({len(persistent)} persistent), {len(a.cliffs)} cliffs, '
          f'{len(a.decks)} decks, {sum(len(v) for v in a.fences.values())} fence cells, {len(a.exits)} exits, '
          f'tiles {raw // 1024} KB raw, dat {len(blob) // 1024} KB raw')


def _map_png(a):
    col = [MAP_COL[a.grid[y][x]] for y in range(a.h) for x in range(a.w)]
    for c in a.cliffs:
        for y in range(max(0, c['y']), min(a.h, c['y'] + c['top'] + c['face'] + 3)):
            for x in range(max(0, c['x']), min(a.w, c['x'] + c['w'])):
                col[y * a.w + x] = (118, 118, 124)
    for o in a.objs:
        t = o['t']
        x, y = o['x'] // 16, o['y'] // 16
        if t in ('house', 'cabin'):
            g = o.get('gables', 1)
            for yy in range(y - 6, y):
                for xx in range(x - 4 * g, x + 4 * g):
                    if a.inside(xx, yy):
                        col[yy * a.w + xx] = (150, 70, 50) if t == 'house' else (230, 170, 60)
        elif t.startswith(('oak', 'pine')) and not t.endswith('stump'):
            dark = (40, 84, 46) if o.get('wall') else (62, 112, 58)
            if a.snowy:
                dark = (150, 170, 176)
            for (dx, dy) in ((0, 0), (0, -1), (-1, -1), (1, -1), (0, -2)):
                if a.inside(x + dx, y + dy):
                    col[(y + dy) * a.w + x + dx] = dark
    write_png(os.path.join(OUT, a.id + '_map.png'), a.w, a.h, col)
