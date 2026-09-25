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

def composite(path, main, parts, **extra):
    """One sprite plus extra pieces from the same sheet. A part is a rough rect (kept where it sits
    on the sheet) or (rect, [dx, dy]) placed at an offset from the main sprite's top-left."""
    d = sprite(path, main, **extra)
    out = []
    for p in parts:
        rect, at = (p, None) if not isinstance(p, tuple) else p
        r = trim(path, rect)
        if at is None:
            at = [r[0] - d['region'][0], r[1] - d['region'][1]]
        out.append({'region': r, 'at': at})
    d['parts'] = out
    return d

def anim(path, frame_w, frame_h, frames=None, fps=10, loop=True, centre=False, cols=None):
    """An animation laid out left to right, top to bottom, on a grid of frames."""
    im = img(path)
    cols = cols or im.width // frame_w
    rows = im.height // frame_h
    n = frames or cols * rows
    def cell(i):
        x, y = (i % cols) * frame_w, (i // cols) * frame_h
        return im.crop((x, y, x + frame_w, y + frame_h))
    box = None
    for i in range(n):
        bb = cell(i).getchannel('A').getbbox()
        if bb:
            box = bb if box is None else (min(box[0], bb[0]), min(box[1], bb[1]), max(box[2], bb[2]), max(box[3], bb[3]))
    first = cell(0).getchannel('A')
    fb = first.getbbox()
    a = first.load()
    xs = [x for y in range(fb[3] - 3, fb[3]) for x in range(frame_w) if a[x, y] > 0]
    ax = round((min(xs) + max(xs) + 1) / 2)
    if centre:
        ax = round((box[0] + box[2]) / 2)
    return {'sheet': path, 'frame': [frame_w, frame_h], 'frames': n, 'cols': cols, 'fps': fps, 'loop': loop, 'anchor': [ax, box[3] - 1]}

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
S['fence'] = variants(BPROPS, [[16, 176, 64, 192]], block=[36, 6])
S['fence_post'] = variants(BPROPS, [[0, 192, 16, 240], [48, 192, 64, 240]], block=[8, 44])
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
# ---- v2: frozen and tall trees
T3_3 = 'Environment/Props/Static/Trees/Model_03/Size_03.png'
FURN = 'Environment/Props/Static/Furniture.png'
WALLS = 'Environment/Structures/Buildings/Walls.png'
S['oak_frozen'] = variants(T1_4, [[240, 0, 320, 128], [240, 128, 320, 256]], solid=6, shadow='shadow_tree', hp=5, drop='wood', stump='stump_frozen')
S['oak_big_frozen'] = variants(T1_5, [[336, 0, 448, 160], [336, 160, 448, 320]], solid=9, shadow='shadow_big', hp=8, drop='wood', stump='stump_frozen')
S['oak_big_dead'] = variants(T1_5, [[224, 0, 336, 160], [224, 160, 336, 320]], solid=8, shadow='shadow_tree', hp=5, drop='wood', stump='oak_big_stump')
S['stump_frozen'] = variants(T1_4, [[320, 64, 360, 96]], solid=6, shadow='shadow_small')
S['stump_mossy'] = variants(T1_5, [[352, 320, 432, 368]], solid=9, shadow='shadow_tree')
S['pine_tall'] = variants(T3_3, [[0, 0, 64, 144], [64, 0, 128, 144], [0, 144, 64, 288], [64, 144, 128, 288]], solid=5, shadow='shadow_tree', hp=5, drop='wood', stump='pine_stump')
# ---- v2: village, camp, ruin and mine props
S['lamp_post'] = [composite(FURN, [144, 448, 176, 496], [[176, 448, 192, 480]], solid=3, shadow='shadow_actor', light=1)]
S['signpost'] = [composite(FURN, [144, 448, 176, 496], [([96, 528, 144, 560], [-6, 5])], solid=3, shadow='shadow_actor', sign=1)]
S['lantern'] = variants(FURN, [[176, 480, 192, 496]], light=1)
S['bench'] = variants(FURN, [[80, 432, 144, 464], [16, 384, 48, 400]], solid=10, shadow='shadow_small')
S['planter'] = variants(FURN, [[16, 416, 48, 432], [48, 408, 80, 432]], solid=8, shadow='shadow_actor')
S['rope_fence'] = variants(FURN, [[144, 416, 240, 448]])
S['rope_post'] = variants(FURN, [[144, 416, 160, 448]], solid=3)
S['board'] = variants(FURN, [[80, 416, 112, 432]])
S['crate'] = variants(FURN, [[720, 64, 736, 96], [736, 64, 752, 96]], solid=6, shadow='shadow_actor', hp=1, drop='plank')
S['barrel'] = variants(FURN, [[752, 64, 768, 96]], solid=6, shadow='shadow_actor', hp=1, drop='wood')
S['pot'] = variants(FURN, [[768, 64, 784, 96], [784, 64, 800, 96], [768, 96, 784, 128], [784, 96, 800, 128]], solid=4, shadow='shadow_actor', hp=1, drop='coal')
S['bucket'] = variants(FURN, [[736, 16, 752, 32], [752, 16, 768, 32], [736, 48, 752, 64]], solid=0)
S['debris'] = variants(FURN, [[736, 96, 752, 128], [752, 96, 768, 128], [736, 128, 768, 144], [768, 128, 784, 144], [784, 128, 800, 144]])
S['chest'] = variants(FURN, [[752, 176, 768, 208]], solid=5, shadow='shadow_actor', chest=1)
S['chest_open'] = variants(FURN, [[736, 160, 752, 192]], solid=5, shadow='shadow_actor')
S['table'] = variants(FURN, [[0, 18, 30, 48]], solid=12, shadow='shadow_small')
S['shelf'] = variants(FURN, [[0, 96, 32, 144]], solid=12)
S['bed'] = variants(FURN, [[32, 144, 64, 208]], solid=12)
S['door'] = variants(FURN, [[128, 272, 160, 304], [160, 272, 192, 304]])
S['doorway'] = variants(FURN, [[0, 272, 32, 304], [32, 272, 64, 304], [64, 272, 96, 304]])
S['chimney'] = variants(FURN, [[0, 320, 32, 384]], solid=8)
S['window'] = variants(FURN, [[64, 320, 96, 352], [32, 352, 64, 384], [128, 352, 160, 384]])
S['ruin_back'] = variants(WALLS, [[0, 0, 96, 96], [96, 0, 192, 96], [288, 0, 384, 80]])
S['ruin_front'] = variants(WALLS, [[0, 96, 96, 176], [96, 96, 192, 176], [288, 96, 384, 176]])
S['palisade'] = variants(WALLS, [[0, 192, 96, 240]], block=[96, 12])
S['palisade_side'] = variants(WALLS, [[0, 16, 16, 96]], block=[14, 76])
S['mine_carts'] = variants(DPROPS, [[0, 0, 56, 32], [72, 8, 96, 32]], solid=10, shadow='shadow_small')
S['tombstone'] = variants(DPROPS, [[96, 0, 112, 24]], solid=5)
# ---- shadows (drawn under objects, black at low alpha in the pack)
S['shadow_big'] = variants(SHADOWS, [[0, 0, 112, 48]], anchor='centre')
S['shadow_tree'] = variants(SHADOWS, [[0, 49, 80, 80]], anchor='centre')
S['shadow_small'] = variants(SHADOWS, [[0, 80, 48, 97]], anchor='centre')
S['shadow_actor'] = variants(SHADOWS, [[0, 104, 32, 120]], anchor='centre')
# ---- animated props
cat['stations'] = {
    'workbench': [
        dict(sprite(ST + 'Workbench/Workbench.png', [48, 64, 96, 112]), name='Workbench', solid=18),
        dict(sprite(ST + 'Workbench/Workbench.png', [96, 64, 176, 112]), name="Carpenter's Bench", solid=32),
        dict(sprite(ST + 'Workbench/Workbench.png', [112, 112, 192, 176]), name='Steel Workbench', solid=34),
    ],
    'sawmill': [
        dict(sprite(ST + 'Sawmill/Level_1.png', [0, 0, 32, 32]), name='Chopping Block', solid=10),
        dict(anim(ST + 'Sawmill/Level_2-Sheet.png', 80, 64, cols=8, frames=60, fps=12, centre=True), name='Sawmill', solid=30),
        dict(anim(ST + 'Sawmill/Level_3-Sheet.png', 112, 80, cols=8, frames=60, fps=12, centre=True), name='Lumber Mill', solid=44),
    ],
    'furnace': [
        dict(anim(ST + 'Furnace/Stone_02-Sheet.png', 48, 64, cols=2, frames=4, fps=8, centre=True), name='Stone Kiln', solid=16, fire=[0, -12]),
        dict(anim(ST + 'Furnace/Bricks_03-Sheet.png', 48, 64, cols=2, frames=4, fps=8, centre=True), name='Brick Furnace', solid=20, fire=[0, -14], smoke=[[-12, -60], [12, -60]]),
        dict(anim(ST + 'Furnace/Iron_03-Sheet.png', 48, 64, cols=2, frames=4, fps=8, centre=True), name='Iron Foundry', solid=20, fire=[0, -14], smoke=[[0, -62]]),
    ],
    'anvil': [
        dict(anim(ST + 'Anvil/Anvil_01-Sheet.png', 64, 80, cols=8, frames=35, fps=10, centre=True), name='Anvil', solid=22),
        dict(anim(ST + 'Anvil/Anvil_02-Sheet.png', 80, 80, cols=6, frames=35, fps=10, centre=True), name='Smithy', solid=32),
        dict(anim(ST + 'Anvil/Anvil_03-Sheet.png', 96, 112, cols=8, frames=35, fps=10, centre=True), name='Forge', solid=40, fire=[0, -20]),
    ],
    'cookpot': [
        dict(sprite(ST + 'Cooking Station/Cooking Station.png', [0, 64, 64, 120]), name='Cooking Pot', solid=12, fire=[0, -8], flames=[0, -2]),
        dict(anim(ST + 'Cooking Station/Grill/Grill_02-Sheet.png', 64, 64, fps=8, centre=True), name='Spit Grill', solid=22, fire=[0, -10]),
        dict(anim(ST + 'Cooking Station/Grill/Grill_04-Sheet.png', 80, 64, fps=8, centre=True), name="Butcher's Grill", solid=30, fire=[0, -10]),
    ],
}
cat['anims'] = {
    'campfire': anim(ST + 'Bonfire/Bonfire_01-Sheet.png', 32, 32, fps=10, centre=True),
    'flames': anim(ST + 'Bonfire/Fire_01-Sheet.png', 32, 48, fps=10, centre=True),
    'flames_small': anim(ST + 'Bonfire/Fire_02-Sheet.png', 32, 48, fps=10, centre=True),
    'smoke': anim(ST + 'Bonfire/Smoke-Sheet.png', 32, 48, fps=6, centre=True),
    'fire_pit': anim(ST + 'Bonfire/Bonfire_09-Sheet.png', 80, 32, fps=8, centre=True),
    'fire_logs': anim(ST + 'Bonfire/Bonfire_05-Sheet.png', 32, 32, fps=8, centre=True),
    'fire_ring': anim(ST + 'Bonfire/Bonfire_02-Sheet.png', 32, 32, fps=8, centre=True),
    'grill_camp': anim(ST + 'Cooking Station/Grill/Grill_01-Sheet.png', 64, 64, fps=8, centre=True),
    'alchemy': anim(ST + 'Alchemy/Alchemy_Table_02-Sheet.png', 48, 64, cols=11, frames=51, fps=10, centre=True),
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
    'peasant': {'idle': anim("Entities/Npc's/Citizen_F/Peasant_A/Idle/Idle-Sheet.png", 64, 64, fps=6),
                'run': anim("Entities/Npc's/Citizen_F/Peasant_A/Walk/Walk-Sheet.png", 64, 64, fps=8)},
    'tavern_a': {'idle': anim("Entities/Npc's/Citizen_F/Tavern_A/Idle/Idle_Side-Sheet.png", 64, 64, fps=6),
                 'run': anim("Entities/Npc's/Citizen_F/Tavern_A/Walk/Walk_Side-Sheet.png", 64, 64, fps=8)},
    'tavern_b': {'idle': anim("Entities/Npc's/Citizen_F/Tavern_B/Idle/Idle_Side-Sheet.png", 64, 64, fps=6),
                 'run': anim("Entities/Npc's/Citizen_F/Tavern_B/Walk/Walk_Side-Sheet.png", 64, 64, fps=8)},
}
# the slash crescent drawn in the base body's swing animation (frames 3-4 of Slice_Side)
cat['slash'] = {'sheet': 'Entities/Characters/Body_A/Animations/Slice_Base/Slice_Side-Sheet.png', 'frame': [64, 64], 'frames': [3, 4]}

# ---- item icons (used for pickups and the UI)
I = cat['items']
def icon(path, rect):
    return sprite(path, rect, anchor='centre')
TOOLS = 'Environment/Props/Static/Tools.png'
IPROPS = 'Environment/Structures/Buildings/Interior/Interior_Props_01.png'
FLOORS = 'Environment/Tilesets/Floors_Tiles.png'
I['wood'] = icon(RES, [32, 64, 64, 80])
I['stick'] = icon(RES, [80, 64, 96, 80])
I['twine'] = icon(RES, [16, 96, 48, 112])
I['cloth'] = icon(IPROPS, [96, 272, 128, 288])
I['resin'] = icon(RES, [0, 48, 16, 64])
I['herb'] = icon(RES, [32, 112, 48, 128])
I['mushroom'] = icon(VEG, [48, 336, 64, 352])
I['nails'] = icon(TOOLS, [96, 80, 112, 96])
I['brick'] = icon(FLOORS, [256, 16, 272, 32])
I['glass'] = icon(TOOLS, [0, 240, 16, 256])
I['steel_bar'] = icon(RES, [64, 16, 80, 32])
I['gem'] = icon(RES, [80, 16, 96, 32])
I['ring'] = icon(RES, [96, 16, 112, 32])
I['bread'] = icon(RES, [16, 128, 48, 144])
I['lantern'] = icon('Environment/Props/Static/Furniture.png', [176, 480, 192, 496])
I['tonic_health'] = icon(RES, [16, 48, 32, 64])
I['tonic_strength'] = icon(RES, [48, 48, 64, 64])
I['tonic_swift'] = icon(RES, [32, 48, 48, 64])
I['skewer'] = icon(MEAT, [0, 48, 16, 64])
I['hearty_meal'] = icon(MEAT, [64, 32, 80, 48])
I['axe_iron'] = icon(WOOD, [48, 16, 64, 48])
I['pickaxe_iron'] = icon(WOOD, [0, 48, 16, 80])
I['sword_steel'] = icon(WOOD, [0, 16, 16, 48])
I['shield_iron'] = icon(WOOD, [112, 16, 144, 48])
I['backpack'] = icon(FARM, [256, 16, 272, 32])
I['stone'] = icon(ROCKS, [48, 48, 64, 64])
I['fiber'] = icon(VEG, [16, 144, 32, 160])
I['iron_ore'] = icon(ROCKS, [160, 16, 176, 32])
I['iron_bar'] = icon(TOOLS, [32, 240, 48, 256])
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
