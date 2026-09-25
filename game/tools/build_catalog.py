"""Builds data/catalog.json: exact sprite regions, anchors and animation layouts cut from the
Pixel Crawler free pack. Run it again if you swap in a different version of the pack:

    python3 tools/build_catalog.py "assets/Pixel Crawler - Free Pack"

Needs Pillow. The game itself only reads the JSON this writes."""
import json, os, sys
from PIL import Image

PACK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'assets', 'Pixel Crawler - Free Pack')
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'catalog.json')

VEG = 'Environment/Props/Static/Vegetation.png'
ROCKS = 'Environment/Props/Static/Rocks.png'
FARM = 'Environment/Props/Static/Farm.png'
RES = 'Environment/Props/Static/Resources.png'
SHADOWS = 'Environment/Props/Static/Shadows.png'
DPROPS = 'Environment/Props/Static/Dungeon_Props.png'
BPROPS = 'Environment/Structures/Buildings/Props.png'
T1_4 = 'Environment/Props/Static/Trees/Model_01/Size_04.png'
T1_5 = 'Environment/Props/Static/Trees/Model_01/Size_05.png'
T2_4 = 'Environment/Props/Static/Trees/Model_02/Size_04.png'
T2_5 = 'Environment/Props/Static/Trees/Model_02/Size_05.png'
ST = 'Environment/Structures/Stations/'
WOOD = 'Weapons/Wood/Wood.png'
BONE = 'Weapons/Bone/Bone.png'
MEAT = 'Environment/Props/Static/Meat.png'

_cache = {}
def img(path):
    if path not in _cache:
        _cache[path] = Image.open(os.path.join(PACK, path)).convert('RGBA')
    return _cache[path]

def trim(path, rect):
    """Shrink a rough rectangle to the opaque pixels inside it."""
    im = img(path).crop(tuple(rect))
    bb = im.getchannel('A').getbbox()
    if not bb:
        raise ValueError(f'empty region {path} {rect}')
    return [rect[0] + bb[0], rect[1] + bb[1], rect[0] + bb[2], rect[1] + bb[3]]

def sprite(path, rect, anchor='feet', **extra):
    r = trim(path, rect)
    w, h = r[2] - r[0], r[3] - r[1]
    if anchor == 'feet':
        # feet: centre of the opaque pixels on the lowest few rows
        a = img(path).crop(tuple(r)).getchannel('A').load()
        xs = [x for y in range(max(0, h - 3), h) for x in range(w) if a[x, y] > 0]
        ax = round((min(xs) + max(xs) + 1) / 2) if xs else w // 2
        anc = [ax, h - 1]
    else:
        anc = [w // 2, h // 2]
    d = {'sheet': path, 'region': r, 'anchor': anc}
    d.update(extra)
    return d

def variants(path, rects, **extra):
    return [sprite(path, r, **extra) for r in rects]

def anim(path, frame_w, frame_h, frames=None, fps=10, loop=True, centre=False):
    im = img(path)
    n = frames or im.width // frame_w
    # union of opaque pixels over all frames gives a stable feet anchor
    box = None
    for i in range(n):
        bb = im.crop((i * frame_w, 0, (i + 1) * frame_w, frame_h)).getchannel('A').getbbox()
        if bb:
            box = bb if box is None else (min(box[0], bb[0]), min(box[1], bb[1]), max(box[2], bb[2]), max(box[3], bb[3]))
    # horizontal anchor from the first frame's feet so idle and run line up
    first = im.crop((0, 0, frame_w, frame_h)).getchannel('A')
    fb = first.getbbox()
    a = first.load()
    xs = [x for y in range(fb[3] - 3, fb[3]) for x in range(frame_w) if a[x, y] > 0]
    ax = round((min(xs) + max(xs) + 1) / 2)
    if centre:
        ax = round((box[0] + box[2]) / 2)
    return {'sheet': path, 'frame': [frame_w, frame_h], 'frames': n, 'fps': fps, 'loop': loop, 'anchor': [ax, box[3] - 1]}

def actor(folder, idle=(32, 32), run=(64, 64), death=(64, 64)):
    return {
        'idle': anim(f'{folder}/Idle/Idle-Sheet.png', *idle, fps=6),
        'run': anim(f'{folder}/Run/Run-Sheet.png', *run, fps=10),
        'death': anim(f'{folder}/Death/Death-Sheet.png', *death, fps=10, loop=False),
    }

cat = {'sprites': {}, 'actors': {}, 'items': {}}
S = cat['sprites']

# ---- trees: [x0, y0, x1, y1] rough boxes from the sheet layout, trimmed automatically
S['oak'] = variants(T1_4, [[0, 0, 80, 128], [80, 0, 160, 128], [0, 128, 80, 256], [80, 128, 160, 256]], solid=6, shadow='shadow_tree', hp=5, drop='wood', stump='oak_stump')
S['oak_dead'] = variants(T1_4, [[160, 0, 240, 128]], solid=6, shadow='shadow_tree', hp=3, drop='wood', stump='oak_stump')
S['oak_stump'] = variants(T1_4, [[320, 0, 360, 32]], solid=6, shadow='shadow_small')
S['oak_big'] = variants(T1_5, [[0, 0, 112, 160], [112, 0, 224, 160], [0, 160, 112, 320], [112, 160, 224, 320]], solid=9, shadow='shadow_big', hp=8, drop='wood', stump='oak_big_stump')
S['oak_big_stump'] = variants(T1_5, [[16, 320, 96, 368]], solid=9, shadow='shadow_tree')
S['pine'] = variants(T2_4, [[0, 0, 64, 112], [64, 0, 128, 112], [0, 112, 64, 224], [64, 112, 128, 224]], solid=5, shadow='shadow_tree', hp=4, drop='wood', stump='pine_stump')
S['pine_dead'] = variants(T2_4, [[136, 0, 192, 112]], solid=4, shadow='shadow_small', hp=2, drop='wood', stump='pine_stump')
S['pine_stump'] = variants(T2_4, [[144, 208, 176, 224]], solid=5, shadow='shadow_small')
S['pine_big'] = variants(T2_5, [[0, 0, 96, 160], [96, 0, 192, 160], [0, 160, 96, 320], [96, 160, 192, 320]], solid=7, shadow='shadow_big', hp=6, drop='wood', stump='pine_stump')
# ---- bushes and plants
S['bush'] = variants(VEG, [[0, 0, 48, 32], [48, 0, 96, 32], [96, 0, 144, 32], [144, 0, 192, 32]], solid=5, shadow='shadow_small', hp=1, drop='fiber')
S['bush_big'] = variants(VEG, [[0, 96, 48, 144], [48, 96, 96, 144], [96, 96, 144, 144], [144, 96, 192, 144]], solid=9, shadow='shadow_tree', hp=2, drop='fiber')
S['dead_shrub'] = variants(VEG, [[192, 64, 240, 96], [192, 96, 240, 144]], solid=4, shadow='shadow_small', hp=1, drop='wood')
S['cattail'] = variants(VEG, [[112, 160, 144, 192], [144, 160, 160, 192], [160, 160, 176, 192], [176, 176, 192, 192]])
S['foxglove'] = variants(VEG, [[192, 160, 208, 192], [208, 160, 224, 192], [224, 176, 240, 192]])
S['fern'] = variants(VEG, [[64, 144, 80, 160], [80, 144, 112, 176], [64, 192, 80, 208], [80, 192, 112, 224]])
S['tuft'] = variants(VEG, [[0, 144, 16, 160], [16, 144, 32, 160], [32, 144, 48, 160], [48, 144, 64, 160], [0, 160, 16, 176], [16, 160, 32, 176], [32, 160, 48, 176], [80, 176, 96, 192], [96, 176, 112, 192]])
S['tuft_dry'] = variants(VEG, [[0, 192, 16, 208], [16, 192, 32, 208], [32, 192, 48, 208], [80, 224, 96, 240], [96, 224, 112, 240]])
S['twig'] = variants(VEG, [[240, 0, 256, 16], [256, 0, 272, 16], [272, 0, 288, 16], [288, 0, 304, 16], [288, 16, 304, 32], [304, 16, 320, 32], [320, 16, 336, 32]])
S['mushroom'] = variants(VEG, [[16, 336, 32, 352], [32, 336, 48, 352], [48, 336, 64, 352], [96, 336, 112, 352], [112, 336, 128, 352]])
S['mushroom_tall'] = variants(VEG, [[0, 352, 16, 368], [16, 352, 32, 368]])
S['leaves'] = variants(VEG, [[64, 352, 96, 368], [96, 352, 112, 368]])
for i, colour in enumerate(['orange', 'white', 'blue', 'yellow']):
    S['flower_' + colour] = variants(VEG, [[x * 16, 368 + i * 16, x * 16 + 16, 384 + i * 16] for x in range(3, 11)])
# ---- rocks, ore and crystals
S['boulder'] = variants(ROCKS, [[96, 16, 128, 64], [128, 16, 160, 48]], solid=9, shadow='shadow_tree', hp=6, drop='stone')
S['boulder_brown'] = variants(ROCKS, [[0, 16, 32, 64], [32, 16, 64, 48]], solid=9, shadow='shadow_tree', hp=6, drop='stone')
S['rock'] = variants(ROCKS, [[64, 16, 80, 32], [80, 16, 96, 32], [160, 16, 176, 32], [176, 16, 192, 32]], solid=5, shadow='shadow_actor', hp=3, drop='stone')
S['ore_rock'] = variants(ROCKS, [[160, 16, 176, 32], [176, 16, 192, 32]], solid=6, shadow='shadow_actor', hp=5, drop='iron_ore', overlay='ore_bits')
S['pebble'] = variants(ROCKS, [[32, 48, 48, 64], [48, 48, 64, 64], [128, 48, 144, 64], [144, 48, 160, 64], [64, 64, 80, 80], [80, 64, 96, 80], [160, 64, 176, 80], [176, 64, 192, 80]])
S['crystal'] = variants(ROCKS, [[144, 272, 160, 304], [160, 288, 176, 304], [176, 288, 192, 304]], solid=4, shadow='shadow_actor', hp=4, drop='crystal')
S['ore_bits'] = variants(ROCKS, [[96, 112, 112, 128], [112, 112, 128, 128], [128, 112, 144, 128], [144, 112, 160, 128]])
# ---- farm
S['scarecrow'] = variants(FARM, [[240, 32, 272, 80]], solid=3, shadow='shadow_small')
crops = ['carrot', 'beet', 'cabbage', 'lettuce', 'cauliflower', 'broccoli', 'garlic']
for k, crop in enumerate(crops):
    S['crop_' + crop] = variants(FARM, [[32 + s * 16, 32 * k, 48 + s * 16, 32 * k + 32] for s in range(4)])
S['soil'] = variants(FARM, [[352, 112, 368, 128]], anchor='centre')
S['crate_crops'] = variants(FARM, [[160, 32 * k, 176, 32 * k + 32] for k in range(len(crops))], solid=6, shadow='shadow_small')
S['sack'] = variants(FARM, [[256, 0, 272, 16], [256, 16, 272, 32]], solid=4, shadow='shadow_small')
S['fence'] = variants(BPROPS, [[16, 176, 64, 192]], solid=0)
S['fence_post'] = variants(BPROPS, [[0, 192, 16, 240], [48, 192, 64, 240]], solid=0)
# ---- camp and crafting stations (solid = half width of the blocking footprint)
S['workbench'] = variants(ST + 'Workbench/Workbench.png', [[48, 64, 96, 112]], solid=18, shadow='shadow_tree', station='workbench')
S['anvil'] = variants(ST + 'Anvil/Anvil.png', [[0, 32, 64, 80]], solid=16, shadow='shadow_tree', station='anvil')
S['furnace'] = variants(ST + 'Furnace/Furnace.png', [[48, 64, 96, 128]], solid=14, shadow='shadow_tree', station='furnace')
S['sawmill'] = variants(ST + 'Sawmill/Base.png', [[48, 0, 128, 58]], solid=30, shadow='shadow_big', station='sawmill')
S['cookpot'] = variants(ST + 'Cooking Station/Cooking Station.png', [[0, 64, 64, 120]], solid=12, shadow='shadow_tree', station='cookpot')
S['spit'] = variants(ST + 'Cooking Station/Cooking Station.png', [[0, 16, 64, 58]], solid=14, shadow='shadow_tree')
S['log_seat'] = variants(ST + 'Bonfire/Bonfire.png', [[0, 112, 32, 144], [32, 112, 64, 144]], solid=0)
S['banner'] = variants(DPROPS, [[64, 64, 80, 96], [80, 64, 96, 96], [96, 64, 112, 96]], solid=3)
S['coffin'] = variants(DPROPS, [[112, 0, 128, 32], [128, 0, 144, 32]], solid=6, shadow='shadow_small')
S['weapon_rack'] = variants(DPROPS, [[0, 0, 56, 32]], solid=16, shadow='shadow_tree')
S['gate'] = variants(DPROPS, [[96, 0, 112, 24]], solid=6)
# ---- shadows (drawn under objects, black at low alpha in the pack)
S['shadow_big'] = variants(SHADOWS, [[0, 0, 112, 48]], anchor='centre')
S['shadow_tree'] = variants(SHADOWS, [[0, 49, 80, 80]], anchor='centre')
S['shadow_small'] = variants(SHADOWS, [[0, 80, 48, 97]], anchor='centre')
S['shadow_actor'] = variants(SHADOWS, [[0, 104, 32, 120]], anchor='centre')
# ---- animated props
cat['anims'] = {
    'campfire': anim(ST + 'Bonfire/Bonfire_01-Sheet.png', 32, 32, fps=10, centre=True),
    'flames': anim(ST + 'Bonfire/Fire_01-Sheet.png', 32, 48, fps=10, centre=True),
    'water': {'fps': 10},
}
# ---- characters
cat['actors'] = {
    'rogue': actor("Entities/Npc's/Rogue", death=(64, 32)),
    'knight': actor("Entities/Npc's/Knight", death=(48, 32)),
    'wizard': actor("Entities/Npc's/Wizzard", death=(64, 32)),
    'orc': actor('Entities/Mobs/Orc Crew/Orc'),
    'orc_rogue': actor('Entities/Mobs/Orc Crew/Orc - Rogue'),
    'orc_shaman': actor('Entities/Mobs/Orc Crew/Orc - Shaman'),
    'orc_warrior': actor('Entities/Mobs/Orc Crew/Orc - Warrior', death=(96, 80)),
    'skeleton': actor('Entities/Mobs/Skeleton Crew/Skeleton - Base', death=(96, 64)),
    'skeleton_rogue': actor('Entities/Mobs/Skeleton Crew/Skeleton - Rogue'),
    'skeleton_mage': actor('Entities/Mobs/Skeleton Crew/Skeleton - Mage'),
    'skeleton_warrior': actor('Entities/Mobs/Skeleton Crew/Skeleton - Warrior', death=(64, 48)),
}
# the slash crescent drawn in the base body's swing animation (frames 3-4 of Slice_Side)
cat['slash'] = {'sheet': 'Entities/Characters/Body_A/Animations/Slice_Base/Slice_Side-Sheet.png', 'frame': [64, 64], 'frames': [3, 4]}

# ---- item icons (used for pickups and the UI)
I = cat['items']
def icon(path, rect):
    return sprite(path, rect, anchor='centre')
I['wood'] = icon(RES, [32, 64, 64, 80])
I['stone'] = icon(ROCKS, [48, 48, 64, 64])
I['fiber'] = icon(VEG, [16, 144, 32, 160])
I['iron_ore'] = icon(ROCKS, [160, 16, 176, 32])
I['iron_bar'] = icon(RES, [64, 16, 80, 32])
I['crystal'] = icon(ROCKS, [160, 288, 176, 304])
I['coal'] = icon(RES, [0, 16, 48, 48])
I['plank'] = icon(RES, [16, 80, 48, 96])
I['meat'] = icon(MEAT, [16, 80, 32, 96])
I['bone'] = icon(BONE, [96, 16, 112, 64])
for k, crop in enumerate(crops):
    I[crop] = icon(FARM, [128, 32 * k, 144, 32 * k + 32])
I['sword_wood'] = icon(WOOD, [0, 16, 16, 48])
I['sword_bone'] = icon(BONE, [0, 0, 16, 48])
I['sword_iron'] = icon(WOOD, [0, 16, 16, 48])  # tinted steel in game
I['axe'] = icon(WOOD, [48, 16, 64, 48])
I['pickaxe'] = icon(WOOD, [0, 48, 16, 80])
I['shield'] = icon(WOOD, [128, 0, 144, 16])
I['poultice'] = icon(VEG, [64, 144, 80, 160])
I['stew'] = icon('Environment/Props/Static/Pan.png', [80, 112, 96, 128])
I['cooked_meat'] = icon(MEAT, [32, 64, 64, 80])

json.dump(cat, open(OUT, 'w'), indent=1)
print('wrote', OUT)
