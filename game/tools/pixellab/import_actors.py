"""Turns the PixelLab character exports in game/assets/pixellab_npcs/ into game-ready sprite atlases.

PixelLab exports each character as one sheet: a turnaround (the character facing eight ways) and,
for most, a six-frame walk in each of those eight directions, all drawn by PixelLab's animator.
Those are real animations, so this keeps them and only does what the game needs:

  * shrinks the art to the Pixel Crawler cast's scale (their people stand ~30 px tall; PixelLab's
    ~46) with pixelscale.shrink_sprite, which keeps the line work intact;
  * takes the four directions the game uses (south, east, north, west);
  * idle = the turnaround pose plus a breathing frame (the upper body settles one pixel), the way
    pixel-art villagers idle; walk = PixelLab's own walk cycle;
  * packs everything for one character into one atlas, all frames on the same feet anchor, and
    writes the catalog entries (actors.<slug>.idle_down ... walk_left).

Creatures exported as a bare turnaround (no walk yet) get the idle only; the game moves them with
a waddle in code until PixelLab animates them.

Nothing here invents frames: attacks, hits and deaths are played in code (lunge, slash, flash,
fall), the same way the player's attacks are.

    python3 tools/pixellab/import_actors.py
"""
import json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pixelscale import shrink_sprite, outline_colour

GAME = os.path.join(HERE, '..', '..')
SRC = os.path.join(GAME, 'assets', 'pixellab_npcs')
OUT = os.path.join(GAME, 'assets', 'pixellab_actors')
CATALOG = os.path.join(GAME, 'data', 'catalog.json')

DIRS = [('down', 'south'), ('right', 'east'), ('up', 'north'), ('left', 'west')]
STANDARD = ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west']
HUMAN_SCALE = 30.0 / 46.0          # PixelLab's ~46 px people -> the pack's ~30 px people
MAX_H = 33                          # tall prompts (128 px canvases) still end up person-sized
# creatures exported as a bare turnaround, and how tall they should stand in the game
CREATURES = {'bramble_treant': 44, 'frost_yeti': 42, 'magma_golem': 42, 'cave_goblin': 27, 'emerald_slime': 22}


def load(slug):
    """(sheet image, cell size, {direction: rotation cell (x, y)}, {direction: [walk cells]})"""
    folder = os.path.join(SRC, slug)
    meta_path = os.path.join(folder, slug + '.json')
    if os.path.exists(meta_path):
        meta = json.load(open(meta_path))
        sp = meta['spritesheet']
        cw, ch = sp['cell_size']['width'], sp['cell_size']['height']
        path = os.path.join(folder, sp.get('path', slug + '.png'))
        if not os.path.exists(path):
            path = os.path.join(folder, slug + '.png')
        img = Image.open(path).convert('RGBA')
        rot, walk = {}, {}
        for r in sp['rows']:
            if r['type'] == 'rotations':
                for i, d in enumerate(r.get('directions', STANDARD)):
                    rot[d] = (i * cw, r['row'] * ch)
            elif r['type'] == 'animation':
                name = str(r.get('animation', ''))
                if not name.startswith('walking'):
                    continue
                d = r.get('direction', 'south')
                if d in walk:              # keep the first walk if there are two
                    continue
                walk[d] = [(i * cw, r['row'] * ch) for i in range(r.get('frame_count', 6))]
        return img, (cw, ch), rot, walk
    sheet = os.path.join(SRC, slug + '.png')
    if os.path.exists(sheet):
        img = Image.open(sheet).convert('RGBA')
        c = img.height
        # the bare turnarounds are laid out in PixelLab's usual order
        rot = {d: (i * c, 0) for i, d in enumerate(STANDARD)}
        return img, (c, c), rot, {}
    return None


def breathe(frame, feet_y):
    """The upper body settles a pixel: everything above the waist moves down by one."""
    top = frame.getbbox()
    if not top:
        return frame
    w = frame.width
    waist = top[1] + int((feet_y - top[1]) * 0.55)
    upper = frame.crop((0, top[1], w, waist))
    out = frame.copy()
    out.paste((0, 0, 0, 0), (0, top[1], w, waist + 1))
    lower = frame.crop((0, waist, w, waist + 1))
    out.alpha_composite(lower, (0, waist))
    out.alpha_composite(upper, (0, top[1] + 1))
    return out


def build(slug):
    got = load(slug)
    if got is None:
        return None
    img, (cw, ch), rot, walk = got
    if not all(d in rot for _, d in DIRS):
        return None
    south = img.crop((rot['south'][0], rot['south'][1], rot['south'][0] + cw, rot['south'][1] + ch))
    bb = south.getchannel('A').getbbox()
    if not bb:
        return None
    body_h = bb[3] - bb[1]
    if slug in CREATURES:
        scale = CREATURES[slug] / body_h
    else:
        scale = min(HUMAN_SCALE, MAX_H / body_h)
    line = outline_colour(south)
    frames = {}                      # anim -> [images at full cell, shrunk]
    for game_dir, pl_dir in DIRS:
        x, y = rot[pl_dir]
        frames['idle_' + game_dir] = [shrink_sprite(img.crop((x, y, x + cw, y + ch)), scale, line)]
        if pl_dir in walk:
            frames['walk_' + game_dir] = [shrink_sprite(img.crop((fx, fy, fx + cw, fy + ch)), scale, line) for (fx, fy) in walk[pl_dir]]
    # one frame box for everything: the union of all the frames' pixels, feet on its bottom edge
    union = None
    for fl in frames.values():
        for f in fl:
            b = f.getbbox()
            if b:
                union = b if union is None else (min(union[0], b[0]), min(union[1], b[1]), max(union[2], b[2]), max(union[3], b[3]))
    x0, y0, x1, y1 = union
    x0, y0 = max(0, x0 - 1), max(0, y0 - 2)
    x1, y1 = x1 + 1, y1 + 1
    fw, fh = x1 - x0, y1 - y0
    # the feet: the bottom of the south-facing pose, and the middle of the canvas across
    sb = frames['idle_down'][0].getbbox()
    feet = (frames['idle_down'][0].width / 2.0 - x0, sb[3] - y0 - 1)
    for k in list(frames):
        frames[k] = [f.crop((x0, y0, x1, y1)) for f in frames[k]]
    for game_dir, _ in DIRS:
        frames['idle_' + game_dir].append(breathe(frames['idle_' + game_dir][0], int(feet[1])))
    order = [k for k in ['idle_down', 'idle_right', 'idle_up', 'idle_left', 'walk_down', 'walk_right', 'walk_up', 'walk_left'] if k in frames]
    cols = max(len(frames[k]) for k in order)
    atlas = Image.new('RGBA', (cols * fw, len(order) * fh), (0, 0, 0, 0))
    entries = {}
    rel = 'pixellab_actors/%s.png' % slug
    for row, k in enumerate(order):
        for i, f in enumerate(frames[k]):
            atlas.alpha_composite(f, (i * fw, row * fh))
        walk_anim = k.startswith('walk')
        entries[k] = {'sheet': rel, 'frame': [fw, fh], 'frames': len(frames[k]), 'cols': len(frames[k]), 'y': row * fh,
                      'fps': 9 if walk_anim else 2, 'loop': True, 'anchor': [round(feet[0]), round(feet[1])]}
        if walk_anim:
            run = dict(entries[k])
            run['fps'] = 13
            entries['run_' + k[5:]] = run
    # the old single-direction names still work (villagers facing the player, flipped)
    entries['idle'] = dict(entries['idle_right'])
    entries['run'] = dict(entries.get('walk_right', entries['idle_right']))
    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, slug + '.png'))
    return entries, (fw, fh), len(walk) > 0


def main():
    cat = json.load(open(CATALOG))
    slugs = sorted(set([d for d in os.listdir(SRC) if os.path.isdir(os.path.join(SRC, d))] +
                       [f[:-4] for f in os.listdir(SRC) if f.endswith('.png')]))
    done = 0
    for slug in slugs:
        r = build(slug)
        if r is None:
            print('skip', slug)
            continue
        entries, size, walks = r
        cat['actors'][slug] = entries
        done += 1
        if not walks:
            print('  %s: turnaround only (no walk from PixelLab yet)' % slug)
    json.dump(cat, open(CATALOG, 'w'), indent=1)
    print('imported %d PixelLab characters into %s' % (done, OUT))


if __name__ == '__main__':
    main()
