"""
Hearthwild Master Object Generator
Generates all game items using PixelLab's 8-direction Object Creator.
Saves each item as:
  - game/assets/objects/<name>/south.png  (and all 8 directions)
  - game/assets/objects/<name>_sheet.png  (sprite sheet row)
  - game/assets/pixellab_items/<name>.png (24x24 UI icon from south view)
"""

import urllib.request, json, time, requests, io, os
from PIL import Image

KEY = os.environ["PIXELLAB_API_KEY"]
OBJECTS_DIR = 'game/assets/objects'
ITEMS_DIR   = 'game/assets/pixellab_items'
CATALOG     = 'game/data/catalog.json'

BROWSER_HDR = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36',
    'Referer': 'https://app.pixellab.ai/',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
}
DIRS = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east']

# ─── ITEM DEFINITIONS ────────────────────────────────────────────────────────
# (name, description, size_px)
# size: 84=small icon, 112=medium, 168=large world object

ITEMS = [
    # ── WEAPONS ──
    ("sword_wood",      "A rough wooden short sword with a simple hilt, pixel art game item, top-down view, NO background NO UI NO text NO grid", 84),
    ("sword_bone",      "A jagged bone blade weapon with carved handle, bleached white, pixel art, top-down view, NO background NO UI NO text", 84),
    ("sword_copper",    "A copper short sword with a reddish-orange metal blade and wooden handle, pixel art, top-down view, NO background NO UI NO text", 84),
    ("sword_iron",      "A grey iron longsword with cross guard, pixel art game item, top-down view, NO background NO UI NO text", 84),
    ("sword_steel",     "A polished silver steel sword with ornate cross-guard, pixel art, top-down view, NO background NO UI NO text", 84),
    ("sword_obsidian",  "A sleek black obsidian blade with jagged volcanic glass edges, pixel art, top-down view, NO background NO UI NO text", 84),
    ("sword_mythril",   "A glowing teal-blue mythril sword, magical aura, slender elegant blade, pixel art, top-down view, NO background NO UI NO text", 84),
    ("sword_sunforged", "A radiant golden sunforged sword glowing with warm light, ornate sun motifs on guard, pixel art, top-down view, NO background NO UI NO text", 84),
    ("sword_shadow",    "A dark jagged shadow sword wreathed in dark purple smoke, void-black blade, pixel art, top-down view, NO background NO UI NO text", 84),
    ("bow_hunter",      "A wooden recurve hunter's bow with a taut bowstring, pixel art game item, top-down view, NO background NO UI NO text", 84),
    ("staff_spore",     "A wooden druid staff topped with a glowing mushroom cap, magical green spores, pixel art, top-down view, NO background NO UI NO text", 84),
    ("axe",             "A stone-headed hand axe with a wooden handle, pixel art, top-down view, NO background NO UI NO text", 84),
    ("axe_iron",        "An iron wood-chopping axe with a grey metal head, pixel art, top-down view, NO background NO UI NO text", 84),
    ("axe_mythril",     "A shimmering teal mythril axe with elegant curved blade, pixel art, top-down view, NO background NO UI NO text", 84),
    ("axe_shadow",      "A dark shadow axe with a void-black blade dripping dark energy, pixel art, top-down view, NO background NO UI NO text", 84),
    ("pickaxe",         "A stone pickaxe with a wooden handle, mining tool, pixel art, top-down view, NO background NO UI NO text", 84),
    ("pickaxe_iron",    "An iron pickaxe with a grey metal head and wooden handle, pixel art, top-down view, NO background NO UI NO text", 84),
    ("pickaxe_mythril", "A glowing teal mythril pickaxe for mining hard rocks, pixel art, top-down view, NO background NO UI NO text", 84),
    ("pickaxe_shadow",  "A dark shadow pickaxe crackling with void energy, jagged obsidian tip, pixel art, top-down view, NO background NO UI NO text", 84),
    ("shield",          "A small round wooden buckler shield with a metal boss, pixel art, top-down view, NO background NO UI NO text", 84),
    ("shield_iron",     "A rectangular iron shield with a reinforced rim, pixel art, top-down view, NO background NO UI NO text", 84),
    ("shield_sunforged","A radiant golden sunforged shield with a sun emblem, glowing warm light, pixel art, top-down view, NO background NO UI NO text", 84),
    ("shield_shadow",   "A void-black shadow ward shield wreathed in dark purple mist, pixel art, top-down view, NO background NO UI NO text", 84),

    # ── TOOLS ──
    ("hoe",             "A simple wooden-handled hoe with a flat metal blade, farming tool, pixel art, top-down view, NO background NO UI NO text", 84),
    ("watering_can",    "A metal watering can with a long spout, slightly rusty, pixel art, top-down view, NO background NO UI NO text", 84),
    ("scythe",          "A long-handled wooden scythe with a curved metal blade, harvesting tool, pixel art, top-down view, NO background NO UI NO text", 84),

    # ── CROPS (produce items) ──
    ("pumpkin",         "A round bright orange pumpkin with a green stem, pixel art, top-down view, NO background NO UI NO text", 84),
    ("corn",            "A yellow ear of corn with green husk, pixel art, top-down view, NO background NO UI NO text", 84),
    ("strawberry",      "A bright red strawberry with green leaves, pixel art, top-down view, NO background NO UI NO text", 84),
    ("eggplant",        "A deep purple glossy eggplant with green stem, pixel art, top-down view, NO background NO UI NO text", 84),
    ("onion",           "A round yellow onion with papery skin, pixel art, top-down view, NO background NO UI NO text", 84),
    ("tomato",          "A round red tomato with a green stem, pixel art, top-down view, NO background NO UI NO text", 84),
    ("carrot",          "An orange carrot with green leafy tops, pixel art, top-down view, NO background NO UI NO text", 84),
    ("beet",            "A deep red beet root with purple leaves, pixel art, top-down view, NO background NO UI NO text", 84),
    ("cabbage",         "A round green cabbage head with leafy layers, pixel art, top-down view, NO background NO UI NO text", 84),
    ("lettuce",         "A leafy bright green lettuce head, pixel art, top-down view, NO background NO UI NO text", 84),
    ("cauliflower",     "A white cauliflower head with green leaves, pixel art, top-down view, NO background NO UI NO text", 84),
    ("broccoli",        "A dark green broccoli head on a thick stalk, pixel art, top-down view, NO background NO UI NO text", 84),
    ("garlic",          "A white bulb of garlic with papery skin, pixel art, top-down view, NO background NO UI NO text", 84),

    # ── COOKED FOOD ──
    ("pumpkin_pie",     "A slice of golden-orange pumpkin pie with a flaky crust, steaming hot, pixel art, top-down view, NO background NO UI NO text", 84),
    ("corn_on_cob",     "A roasted yellow corn on the cob on a wooden skewer, pixel art, top-down view, NO background NO UI NO text", 84),
    ("strawberry_cake", "A slice of layered shortcake with bright red strawberries and white whipped cream, pixel art, top-down view, NO background NO UI NO text", 84),
    ("stuffed_eggplant","A baked purple eggplant halved and stuffed with seasoned meat filling, pixel art, top-down view, NO background NO UI NO text", 84),
    ("onion_rings",     "A basket of golden crispy fried onion rings, pixel art, top-down view, NO background NO UI NO text", 84),
    ("cooked_meat",     "A roasted leg of meat on a bone, browned and steaming, pixel art, top-down view, NO background NO UI NO text", 84),
    ("bread",           "A rustic round loaf of hearth bread, golden-brown crust, pixel art, top-down view, NO background NO UI NO text", 84),
    ("stew",            "A wooden bowl of thick vegetable stew with herbs, steaming, pixel art, top-down view, NO background NO UI NO text", 84),
    ("skewer",          "A wooden skewer with grilled mushrooms and vegetables, pixel art, top-down view, NO background NO UI NO text", 84),
    ("hearty_meal",     "A full plate with roast meat, bread, and vegetables, hearty fantasy meal, pixel art, top-down view, NO background NO UI NO text", 84),

    # ── ORES & MINERALS ──
    ("copper_ore",      "A rough chunk of copper ore with reddish-orange metallic veins, pixel art, top-down view, NO background NO UI NO text", 84),
    ("gold_ore",        "A chunk of shiny gold ore with bright yellow metallic flecks, pixel art, top-down view, NO background NO UI NO text", 84),
    ("copper_bar",      "A smelted rectangular copper ingot bar, reddish-orange metal, pixel art, top-down view, NO background NO UI NO text", 84),
    ("gold_bar",        "A gleaming rectangular gold ingot bar, bright yellow metal, pixel art, top-down view, NO background NO UI NO text", 84),
    ("geode",           "A cracked open geode revealing purple crystal amethyst inside, pixel art, top-down view, NO background NO UI NO text", 84),
    ("meteorite",       "A jagged dark metallic meteorite rock with glowing orange cracks, pixel art, top-down view, NO background NO UI NO text", 84),
    ("crystal",         "A cluster of clear sparkling crystals, light refracting, pixel art, top-down view, NO background NO UI NO text", 84),

    # ── MONSTER DROPS / CRAFTING MATERIALS ──
    ("frost_core",      "A glowing ice-blue frost core crystal pulsing with cold magic, pixel art, top-down view, NO background NO UI NO text", 84),
    ("magma_core",      "A red-orange magma core glowing with internal fire, pixel art, top-down view, NO background NO UI NO text", 84),
    ("shadow_core",     "A swirling void-black shadow core emanating dark purple magic, pixel art, top-down view, NO background NO UI NO text", 84),
    ("basilisk_scale",  "A large iridescent green-grey basilisk scale, pixel art, top-down view, NO background NO UI NO text", 84),
    ("bat_wing",        "A dark leathery bat wing with bone structure visible, pixel art, top-down view, NO background NO UI NO text", 84),
    ("bone",            "A clean white animal bone, pixel art, top-down view, NO background NO UI NO text", 84),

    # ── POTIONS & CONSUMABLES ──
    ("health_potion_large", "A large round glass bottle filled with glowing bright red magical health potion liquid, big cork stopper, pixel art, top-down view, NO background NO UI NO text", 168),
    ("health_potion_small", "A small glass vial filled with glowing red liquid, tiny cork stopper, health potion, pixel art, top-down view, NO background NO UI NO text", 84),
    ("elixir_life",     "A glowing golden elixir in a fancy ornate bottle, life-restoring liquid, pixel art, top-down view, NO background NO UI NO text", 84),
    ("potion_stoneskin","A dark grey stone-coloured potion in a round bottle with a rocky texture, pixel art, top-down view, NO background NO UI NO text", 84),
    ("tonic_health",    "A small green healing tonic bottle with a leaf stopper, pixel art, top-down view, NO background NO UI NO text", 84),
    ("tonic_strength",  "A red-orange glowing strength tonic in a vial, pixel art, top-down view, NO background NO UI NO text", 84),
    ("tonic_swift",     "A bright blue haste tonic in a sleek bottle with energy swirls, pixel art, top-down view, NO background NO UI NO text", 84),

    # ── OTHER ITEMS ──
    ("bandage",         "A neatly rolled white cloth bandage, first aid item, pixel art, top-down view, NO background NO UI NO text", 84),
    ("lantern",         "A metal hand-held lantern with a flickering warm candle flame inside glass, pixel art, top-down view, NO background NO UI NO text", 84),
    ("fertilizer",      "A small brown sack of plant fertilizer with a green leaf symbol, pixel art, top-down view, NO background NO UI NO text", 84),
    ("wood",            "A bundle of brown wooden logs tied with twine, pixel art, top-down view, NO background NO UI NO text", 84),
    ("stone",           "A grey rough-hewn stone block, pixel art, top-down view, NO background NO UI NO text", 84),
    ("fiber",           "A small bundle of plant fiber strands tied together, pixel art, top-down view, NO background NO UI NO text", 84),
    ("resin",           "A golden drop of tree resin in a small vial, pixel art, top-down view, NO background NO UI NO text", 84),
    ("herb",            "A bundle of tied wild green herbs and flowers, pixel art, top-down view, NO background NO UI NO text", 84),
    ("mushroom",        "A round brown mushroom with a spotted cap, pixel art, top-down view, NO background NO UI NO text", 84),
    ("leather",         "A flat piece of tanned brown leather hide, pixel art, top-down view, NO background NO UI NO text", 84),
    ("gem",             "A multifaceted sparkling ruby red gem, pixel art, top-down view, NO background NO UI NO text", 84),
]

# ─── HELPERS ─────────────────────────────────────────────────────────────────

def create_object(description, size):
    payload = json.dumps({'description': description, 'size': size}).encode()
    req = urllib.request.Request(
        'https://api.pixellab.ai/v2/create-8-direction-object',
        data=payload,
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp['object_id']

def poll_object(object_id, timeout=600):
    for _ in range(timeout // 5):
        time.sleep(5)
        req = urllib.request.Request(
            f'https://api.pixellab.ai/v2/objects/{object_id}',
            headers={'Authorization': f'Bearer {KEY}'}
        )
        resp = json.loads(urllib.request.urlopen(req).read())
        status = resp.get('status')
        pct = resp.get('progress_percent') or '?'
        print(f'    [{object_id[:8]}] {status} {pct}%', flush=True)
        if status == 'completed':
            return resp
        if status in ('failed', 'error'):
            raise RuntimeError(f'Object {object_id} failed')
    raise TimeoutError(f'Object {object_id} timed out')

def download_directions(rotation_urls):
    frames = {}
    for d in DIRS:
        r = requests.get(rotation_urls[d], headers=BROWSER_HDR)
        frames[d] = Image.open(io.BytesIO(r.content)).convert('RGBA')
    return frames

def save_item(name, frames):
    # 1. Save per-direction PNGs
    obj_dir = os.path.join(OBJECTS_DIR, name)
    os.makedirs(obj_dir, exist_ok=True)
    for d, img in frames.items():
        img.save(os.path.join(obj_dir, f'{d}.png'))

    # 2. Save sprite sheet (8 dirs in a row)
    w, h = list(frames.values())[0].size
    sheet = Image.new('RGBA', (w * 8, h))
    for i, d in enumerate(DIRS):
        sheet.alpha_composite(frames[d], (i * w, 0))
    sheet.save(os.path.join(OBJECTS_DIR, f'{name}_sheet.png'))

    # 3. Save 24x24 icon for UI
    # For weapons and tools, 'north-east' (pointing top-right) works best with Godot's rotation animation.
    # For objects/food, 'south' (front-facing) is best.
    is_weapon = name.startswith(('sword_', 'axe', 'pickaxe', 'shield', 'bow_', 'staff_', 'hoe', 'watering_can', 'scythe'))
    icon_frame = frames['north-east'] if is_weapon else frames['south']
    
    icon_frame = icon_frame.copy()
    icon_frame.thumbnail((24, 24), Image.LANCZOS)
    icon = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
    icon.alpha_composite(icon_frame, ((24 - icon_frame.width)//2, (24 - icon_frame.height)//2))
    icon.save(os.path.join(ITEMS_DIR, f'{name}.png'))
    print(f'  DONE: {name}  ({w}x{h})', flush=True)

def update_catalog(name):
    with open(CATALOG) as f:
        cat = json.load(f)
    sprites = cat.setdefault('sprites', {})
    sprites[name] = {
        'path': f'assets/pixellab_items/{name}.png',
        'region': [0, 0, 24, 24],
        'anchor': [12, 12]
    }
    with open(CATALOG, 'w') as f:
        json.dump(cat, f, indent='\t')

# ─── MAIN ─────────────────────────────────────────────────────────────────────

os.makedirs(OBJECTS_DIR, exist_ok=True)
os.makedirs(ITEMS_DIR, exist_ok=True)

# Skip items that already have an object sheet saved
remaining = [(n, d, s) for n, d, s in ITEMS
             if not os.path.exists(os.path.join(OBJECTS_DIR, n, 'south.png'))]

print(f'Total items: {len(ITEMS)}  |  To generate: {len(remaining)}')

# Submit in batches of 5 to avoid overloading the queue
BATCH = 5
for batch_start in range(0, len(remaining), BATCH):
    batch = remaining[batch_start:batch_start + BATCH]
    batch_num = batch_start // BATCH + 1
    total_batches = (len(remaining) + BATCH - 1) // BATCH
    print(f'\n=== Batch {batch_num}/{total_batches} ===')

    # Submit all in batch
    jobs = []
    for name, desc, size in batch:
        try:
            oid = create_object(desc, size)
            jobs.append((name, oid))
            print(f'  Submitted {name} -> {oid[:8]}...')
            time.sleep(0.5)  # small delay between submissions
        except Exception as e:
            print(f'  SUBMIT ERROR {name}: {e}')

    # Poll all jobs to completion
    for name, oid in jobs:
        print(f'  Polling: {name}')
        try:
            resp = poll_object(oid)
            frames = download_directions(resp['rotation_urls'])
            save_item(name, frames)
            update_catalog(name)
        except Exception as e:
            print(f'  ERROR {name}: {e}')

print('\n=== ALL DONE ===')
