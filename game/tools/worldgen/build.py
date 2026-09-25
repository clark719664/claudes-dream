"""Things people make: houses on fenced lots, yards, streets, lamps, stalls, graveyards.

Settlements are laid out by hand (streets are straight, lots are square, that's how people build),
but what people keep in them isn't: a woodpile leans where it leans, flowerbeds are uneven, weeds
come up along the fence line, and no two yards are dressed the same."""
import math

HOUSE_STYLES = ['log', 'plank', 'dark', 'plaster', 'brick']
COLOURS = ['white', 'yellow', 'blue', 'orange']


def house(a, door_x, feet_y, style, name, gables=1, t='house'):
    """A house whose doorstep is at (door_x, feet_y); door_x is the seam between the two door
    columns. 8 tiles wide per gable, 10 tall."""
    o = a.add(t, door_x, feet_y, style=style, name=name, gables=gables)
    a.reserve(door_x - 4 * gables, feet_y - 10, door_x + 4 * gables, feet_y)
    return o


def lamp(a, x, y):
    a.add('lamp_post', x, y, 0, 0.4)
    a.reserve(x - 0.5, y - 0.5, x + 0.5, y + 0.3)


def sign(a, x, y, text):
    a.add('signpost', x, y, 0, 0.5, text=text)
    a.reserve(x - 1, y - 1, x + 1, y + 0.4)


def jitter(a, amount=0.25):
    return a.rng.uniform(-amount, amount)


def bed(a, x0, y0, w, h, colour=None):
    """A flowerbed: dug earth with flowers set roughly in rows, a few missing, a few volunteers."""
    colour = colour or a.rng.choice(COLOURS)
    other = a.rng.choice(COLOURS)
    a.rect(x0, y0, x0 + w, y0 + h, ':')
    for y in range(h):
        for x in range(w):
            for k in range(2):
                if a.rng.random() < 0.15:
                    continue
                c = colour if a.rng.random() < 0.85 else other
                a.add('flower_' + c, x0 + x + 0.25 + k * 0.5 + jitter(a, 0.12), y0 + y + 0.55 + jitter(a, 0.15), a.rng.randrange(8))


def patch(a, x0, y0, w, h, kind, stages=(1, 2, 3, 3)):
    """A kitchen-garden patch: tilled rows with crops at mixed stages (just for looks)."""
    for y in range(h):
        for x in range(w):
            a.add('soil', x0 + x + 0.5, y0 + y + 0.5)
            if a.rng.random() < 0.88:
                a.add('crop_' + kind, x0 + x + 0.5 + jitter(a, 0.08), y0 + y + 0.85, a.rng.choice(stages))


def weeds_along(a, cells, share=0.18):
    """Weeds and tufts come up against fences and walls, where nobody mows."""
    for (x, y) in cells:
        if a.rng.random() < share:
            px, py = x + a.rng.uniform(0.1, 0.9), y + a.rng.uniform(0.7, 1.0)
            if a.get(int(px), int(py)) in '.*':
                a.add('tuft', px, py, a.rng.randrange(9))


YARD_KINDS = ['flowers', 'veg', 'laundry', 'woodpile', 'herbs', 'orchard', 'wild']


def lot(a, left, street_y, width, style, name, kind=None, gables=1, depth=15, back=True, dress=True):
    """A fenced lot on the north side of a street whose first row is street_y: the house at the
    back, its door on the lot's middle column, a front yard down to the street fence, which has a
    gate in line with the door. Returns the door column."""
    door = left + width // 2
    feet = street_y - 4
    fy1 = street_y - 1
    fy0 = street_y - depth
    house(a, door, feet, style, name, gables)
    a.fence_line(left, fy1, left + width, fy1)
    a.fence_line(left, fy0 if back else feet - 1, left, fy1)
    a.fence_line(left + width, fy0 if back else feet - 1, left + width, fy1)
    if back:
        a.fence_line(left, fy0, left + width, fy0)
    a.gate(door - 1, fy1, 2)
    # a worn path from the door to the gate, a little wider at the step
    a.rect(door - 1, feet, door + 1, fy1 + 1, ':')
    a.reserve(left, fy0, left + width + 1, street_y)
    if dress:
        yard(a, left, street_y, width, door, kind or a.rng.choice(YARD_KINDS), gables)
        weeds_along(a, [(x, fy1 - 1) for x in range(left + 1, left + width)] + [(left + 1, y) for y in range(feet, fy1)] +
                    [(left + width - 1, y) for y in range(feet, fy1)])
    return door


def yard(a, left, street_y, width, door, kind, gables=1):
    """Dress a front yard: rows street_y-4 .. street_y-2, either side of the door path."""
    y0 = street_y - 4
    bw = max(0, min(3, door - left - 3))
    lx0, lx1 = door - 2 - bw, door - 2
    rx0, rx1 = door + 2, door + 2 + bw
    c1, c2 = a.rng.choice(COLOURS), a.rng.choice(COLOURS)
    if kind == 'flowers':
        if bw >= 1:
            bed(a, lx0, y0 + 1, bw, 2, c1)
            bed(a, rx0, y0 + 1 + a.rng.randrange(2), bw, 1 + a.rng.randrange(2), c2)
    elif kind == 'veg':
        if bw >= 1:
            patch(a, lx0, y0 + 1, bw, 2, a.rng.choice(['carrot', 'cabbage', 'lettuce', 'beet']))
            bed(a, rx0, y0 + 2, bw, 1, c2)
        a.add('water_bucket', rx1 - 0.6 + jitter(a), y0 + 1.2, 0, 0.4)
    elif kind == 'laundry':
        if bw >= 2:
            a.add('pole', lx0 + 0.3, y0 + 1.9, 0, 0.3)
            a.add('rope_line', lx0 + 2.1, y0 + 1.9)
            bed(a, rx0, y0 + 1, bw, 2, c2)
        a.add('bucket', lx1 - 0.4 + jitter(a), y0 + 2.6, 1, 0.3)
    elif kind == 'woodpile':
        if bw >= 2:
            a.add('log_pile', lx0 + 1.0 + jitter(a), y0 + 2.2, 0, 0.9)
            a.add('chopping_block', lx1 - 0.3, y0 + 2.6 + jitter(a, 0.15), 0, 0.5)
            for i in range(a.rng.randint(1, 3)):
                a.add('branch', lx0 + a.rng.uniform(0.3, bw), y0 + a.rng.uniform(2.6, 3.4), a.rng.randrange(5))
            bed(a, rx0, y0 + 1, bw, 2, c2)
    elif kind == 'herbs':
        if bw >= 1:
            bed(a, lx0, y0 + 1, bw, 1, c1)
            patch(a, lx0, y0 + 2, bw, 1, 'garlic', (2, 3))
            bed(a, rx0, y0 + 1, bw, 2, c2)
    elif kind == 'orchard':
        if bw >= 2:
            a.add('sapling', lx0 + bw / 2 + jitter(a), y0 + 2.6, a.rng.randrange(4), 0.6)
            a.add('sapling', rx0 + bw / 2 + jitter(a), y0 + 2.6, a.rng.randrange(4), 0.6)
    elif kind == 'wild':
        # let go a bit: long grass, a bush, dandelions
        for i in range(a.rng.randint(5, 9)):
            side = a.rng.choice([(lx0, lx1), (rx0, rx1)])
            if side[1] - side[0] < 1:
                continue
            a.add('tuft', a.rng.uniform(side[0] + 0.2, side[1]), a.rng.uniform(y0 + 0.8, y0 + 3.4), a.rng.randrange(9))
        if bw >= 2:
            a.add('bush', rx0 + bw / 2 + jitter(a), y0 + 2.4, a.rng.randrange(2), 0.8)
            for i in range(a.rng.randint(3, 6)):
                a.add('flower_yellow', a.rng.uniform(lx0 + 0.2, lx1), a.rng.uniform(y0 + 1, y0 + 3.4), a.rng.randrange(8))
    # beside the house: a barrel or trough on one side, a bin or hay on the other
    hl, hr = door - 4 * gables, door + 4 * gables
    if hl - left >= 2:
        a.add(a.rng.choice(['barrel', 'hedge_box', 'water_bucket', 'bin']), left + 1.2 + jitter(a, 0.2), street_y - 5.2, 0, 0.5)
    if left + width - hr >= 2:
        a.add(a.rng.choice(['barrel', 'jar', 'trough', 'bin', 'hay']), left + width - 0.9 + jitter(a, 0.2), street_y - 5.2, 0, 0.5)


def street(a, y, x0, x1, ch='=', rows=3):
    """An east-west street, `rows` tall from row y. Water is left alone for a bridge."""
    a.rect(x0, y, x1 + 1, y + rows, ch, keep='.:=*')
    a.reserve(x0, y, x1 + 1, y + rows)
    for x in range(x0, x1 + 1):
        a.path[y * a.w + x] = 1 if a.inside(x, y) else 0
        for r in range(rows):
            if a.inside(x, y + r):
                a.path[(y + r) * a.w + x] = 1


def avenue(a, x, y0, y1, ch='=', cols=3):
    x0 = x - cols // 2
    a.rect(x0, y0, x0 + cols, y1 + 1, ch, keep='.:=*')
    a.reserve(x0, y0, x0 + cols, y1 + 1)
    for y in range(y0, y1 + 1):
        for c in range(cols):
            if a.inside(x0 + c, y):
                a.path[y * a.w + x0 + c] = 1


def lamps_along(a, y, x0, x1, step=11):
    x = x0 + 2
    while x < x1 - 1:
        lamp(a, x + 0.5, y + 0.2)
        x += step + a.rng.choice([-1, 0, 0, 1])


def villager(a, x, y, actor, name, span=40, say=None, lines=None, **extra):
    o = {'actor': actor, 'name': name, 'span': span}
    if say:
        o['say'] = say
    if lines:
        o['lines'] = lines
    o.update(extra)
    return a.add('villager', x, y, None, 0.6, **o)


def shopkeeper(a, x, y, actor, name, shop, say=None):
    """Someone who sells things from behind a counter. Talking to them opens their shop."""
    o = a.add('shopkeeper', x, y, None, 0.6, actor=actor, name=name, shop=shop)
    if say:
        o['say'] = say
    return o


def stall(a, x, y, goods):
    """A market stall: the covered counter, crates of produce in front, sacks to one side."""
    a.add('stall', x, y, a.rng.randrange(2), 1.6)
    for i, g in enumerate(goods):
        a.add('crate_crops', x - 1.6 + i * 1.1 + jitter(a, 0.1), y + 1.0 + jitter(a, 0.1), g % 7, 0.4)
    a.add('sack', x + 1.8 + jitter(a, 0.2), y + 0.4, a.rng.randrange(2), 0.4)
    a.reserve(x - 2, y - 2, x + 3, y + 2)


def bench_pair(a, x, y):
    a.add('bench', x - 2.2, y, 0, 1.0)
    a.add('bench', x + 2.2, y, 0, 1.0)


def graveyard(a, x0, y0, w, h, name='Brindle churchyard'):
    """A churchyard that has been in use for a long time: a crooked lych-gate path, old rows that
    have drifted out of line, a few stones fallen or missing, fresh mounds in a newer corner, a
    crypt at the back under dead trees, a caretaker's shed, and life going on at the edges."""
    x1, y1 = x0 + w, y0 + h
    # the wall: a rail fence with the gate in the middle of the south side
    gx = x0 + w // 2
    a.fence_line(x0, y0, x1, y0)
    a.fence_line(x0, y0, x0, y1)
    a.fence_line(x1, y0, x1, y1)
    a.fence_line(x0, y1, x1, y1)
    a.gate(gx - 1, y1, 2)
    a.reserve(x0, y0, x1 + 1, y1 + 1)
    # the crypt at the back, the caretaker's shed in the corner
    crypt_x = x0 + w // 2 + a.rng.choice([-3, 3])
    # the old chapel: roofless now, its doorway still standing
    a.add('ruin_back', crypt_x, y0 + 6.5, 1, 0)
    a.add('ruin_front', crypt_x, y0 + 11.5, 1, 0)
    a.add('doorway', crypt_x, y0 + 11.5, 2)
    a.add('debris', crypt_x - 1.6, y0 + 9.2, 0)
    a.add('coffin', crypt_x + 1.2, y0 + 8.8, 1, 0.4)
    shed_x = x1 - 6
    # a path from the gate that bends towards the crypt, with a branch to the shed
    pts = [(gx, y1 + 0.5), (gx + a.rng.uniform(-1.5, 1.5), y1 - h * 0.35), (crypt_x + 0.0, y0 + 12.0)]
    a.trail(pts, 2.0, ':', 0.8, k=x0 + y0, keep='.*')
    # gravestones in rows that have drifted: every row bends a little, stones lean left and right
    rows = []
    y = y0 + 13
    while y < y1 - 2:
        rows.append(y)
        y += a.rng.choice([2.6, 3.0, 3.2])
    stones = 0
    for ri, ry in enumerate(rows):
        bend = a.rng.uniform(-0.4, 0.4)
        x = x0 + 2.0 + a.rng.uniform(0, 1.2)
        while x < x1 - 1.5:
            if a.near_path(x, ry, 1) or abs(x - shed_x) < 4 and ry > y1 - 8:
                x += 1.6
                continue
            t = (x - x0) / w
            yy = ry + bend * math.sin(t * math.pi * 2 + ri) + jitter(a, 0.18)
            r = a.rng.random()
            if r < 0.08:
                pass                                   # a gap where a stone once stood
            elif r < 0.16:
                a.add('stone_slab', x + 0.4, yy + 0.2, 0, 0.8)   # a flat ledger stone
                x += 0.8
            elif r < 0.22:
                a.add('rock', x, yy, a.rng.randrange(4), 0.4, regrow=0)   # a toppled, broken stone
            else:
                a.add('tombstone', x, yy, 0, 0.5)
                stones += 1
                # what's left at a grave: flowers, a candle jar, a mound on a new one
                q = a.rng.random()
                if q < 0.28:
                    for k in range(a.rng.randint(2, 4)):
                        a.add('flower_' + a.rng.choice(['white', 'blue', 'yellow']), x + a.rng.uniform(-0.5, 0.5), yy + a.rng.uniform(0.35, 0.9),
                              a.rng.randrange(8))
                elif q < 0.36:
                    a.add('jar', x + 0.5, yy + 0.5, a.rng.randrange(4), 0.2)
                elif q < 0.46 and ri >= len(rows) - 2:
                    a.rect(int(x), int(yy + 0.6), int(x) + 1, int(yy + 0.6) + 2, ':')     # fresh earth
                elif q < 0.6:
                    a.add('tuft', x + a.rng.uniform(-0.5, 0.5), yy + 0.6, a.rng.randrange(9))
            x += a.rng.uniform(1.7, 2.4)
    # the old corner: coffins stacked by the crypt, urns, iron railings round a family plot
    for i in range(a.rng.randint(2, 3)):
        a.add('coffin', crypt_x + 5.2 + i * 1.1 + jitter(a, 0.2), y0 + 10.6 + jitter(a, 0.3), a.rng.randrange(2), 0.5)
    a.add('urn', crypt_x - 5.0, y0 + 11.2, 0, 0.4)
    a.add('urn', crypt_x - 6.1, y0 + 11.5, 1, 0.4)
    px = x0 + 3
    for i in range(6):
        a.add('iron_bars', px + i * 0.68, y0 + 5.0, i % 8, 0.2)
    for i in range(2):
        a.add('tombstone', px + 1.2 + i * 1.6, y0 + 4.2, 0, 0.4)
    # dead trees at the back, their roots in long grass; weeds and mushrooms under them
    for i, (tx, ty) in enumerate([(x0 + 2.5, y0 + 2.5), (x1 - 2.5, y0 + 3.0), (x0 + w * 0.3, y0 + 2.0)]):
        t = a.rng.choice(['oak_dead', 'oak_big_dead', 'oak_young_dead'])
        a.add(t, tx + jitter(a, 0.8), ty + 1.0 + jitter(a, 0.5), 0 if t == 'oak_dead' else a.rng.randrange(2), 1.0, wall=1, solid=6)
        a.cluster(tx, ty + 1.5, 4, 1.2, lambda px_, py_, k: a.add(a.rng.choice(['mushroom', 'tuft', 'fern']), px_, py_, a.rng.randrange(4)), 0.3,
                  lambda px_, py_: a.get(int(px_), int(py_)) in '.*')
    # lanterns on the path, a bench under the yew for mourners
    a.add('lantern', gx - 1.6, y1 - 1.2, 0, 0.2, light=1)
    a.add('lantern', crypt_x + 2.4, y0 + 12.6, 0, 0.2, light=1)
    a.add('bench', x0 + 4.5, y1 - 2.0, 1, 0.9)
    # the caretaker's corner: shovel-work, a barrow of earth, a woodpile
    a.add('cart_tipped', shed_x - 1.0, y1 - 3.0, 0, 0.8)
    a.add('log_pile', shed_x + 2.0, y1 - 2.2, 0, 0.9)
    a.add('bucket', shed_x + 0.4, y1 - 1.6, 0, 0.3)
    a.rect(int(shed_x - 2), int(y1 - 4), int(shed_x + 1), int(y1 - 2), ':')
    # weeds along the fence
    weeds_along(a, [(x, y0 + 1) for x in range(x0 + 1, x1)] + [(x0 + 1, y) for y in range(y0, y1)] + [(x1 - 1, y) for y in range(y0, y1)], 0.35)
    a.poi(name, x0 + w / 2, y0 + h / 2)
    return stones
