import urllib.request, json, time, requests, io, os
from PIL import Image

KEY = os.environ["PIXELLAB_API_KEY"]
ASSETS_DIR = 'game/assets/pixellab_items'
ARTIFACT_DIR = r'C:\Users\lil_c\.gemini\antigravity\brain\433fa0e9-d043-4a36-88b6-c820d8b1c3ab'

BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Referer': 'https://app.pixellab.ai/',
    'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
}

DIRECTIONS = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east']

ITEMS = [
    {
        'name': 'health_potion_large',
        'description': (
            'A large round glass bottle filled with glowing bright red liquid, '
            'big cork stopper, magical health potion, pixel art item, '
            'NO background, NO UI, NO text, NO grid, NO shadow on ground'
        ),
        'size': 168,
    },
    {
        'name': 'health_potion_small',
        'description': (
            'A small glass vial filled with glowing red liquid, '
            'tiny cork stopper, health potion, pixel art item, '
            'NO background, NO UI, NO text, NO grid, NO shadow on ground'
        ),
        'size': 84,
    },
]

def create_object(description, size):
    payload = json.dumps({'description': description, 'size': size}).encode()
    req = urllib.request.Request(
        'https://api.pixellab.ai/v2/create-8-direction-object',
        data=payload,
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    )
    resp = json.loads(urllib.request.urlopen(req).read())
    return resp['object_id']

def poll_object(object_id, timeout=300):
    for _ in range(timeout // 5):
        time.sleep(5)
        req = urllib.request.Request(
            f'https://api.pixellab.ai/v2/objects/{object_id}',
            headers={'Authorization': f'Bearer {KEY}'}
        )
        resp = json.loads(urllib.request.urlopen(req).read())
        status = resp.get('status')
        pct = resp.get('progress_percent') or '...'
        print(f'  [{object_id[:8]}] {status} ({pct}%)')
        if status == 'completed':
            return resp
    raise TimeoutError(f'Object {object_id} did not complete in time')

def download_directions(rotation_urls):
    frames = {}
    for d in DIRECTIONS:
        r = requests.get(rotation_urls[d], headers=BROWSER_HEADERS)
        frames[d] = Image.open(io.BytesIO(r.content)).convert('RGBA')
    return frames

def save_sheet(frames, name, out_dir):
    # Save individual direction PNGs
    item_dir = os.path.join(out_dir, name)
    os.makedirs(item_dir, exist_ok=True)
    for d, img in frames.items():
        img.save(os.path.join(item_dir, f'{d}.png'))

    # Save a sprite sheet (all 8 in a row)
    w, h = list(frames.values())[0].size
    sheet = Image.new('RGBA', (w * 8, h))
    for i, d in enumerate(DIRECTIONS):
        sheet.alpha_composite(frames[d], (i * w, 0))
    sheet_path = os.path.join(out_dir, f'{name}_sheet.png')
    sheet.save(sheet_path)

    # Also save the south (front) view as the item icon
    icon_path = os.path.join(ASSETS_DIR, f'{name}.png')
    south = frames['south'].copy()
    south.thumbnail((24, 24), Image.LANCZOS)
    icon = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
    icon.alpha_composite(south, ((24 - south.width)//2, (24 - south.height)//2))
    icon.save(icon_path)

    print(f'  Saved sheet: {sheet_path}')
    print(f'  Saved icon: {icon_path}')
    return sheet_path

# --- Main ---
os.makedirs(ASSETS_DIR, exist_ok=True)

object_ids = []
for item in ITEMS:
    print(f'Submitting: {item["name"]} (size={item["size"]})')
    oid = create_object(item['description'], item['size'])
    object_ids.append((item['name'], oid))
    print(f'  -> object_id: {oid}')

for name, oid in object_ids:
    print(f'Polling: {name}')
    resp = poll_object(oid)
    frames = download_directions(resp['rotation_urls'])
    sheet_path = save_sheet(frames, name, ARTIFACT_DIR)

    # Copy sheet to artifacts for preview
    print(f'Done: {name}')

print('\nAll done! Both health potions generated.')
