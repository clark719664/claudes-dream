import urllib.request, json, time, os
from PIL import Image
import io

KEY = os.environ["PIXELLAB_API_KEY"]
url = 'https://api.pixellab.ai/v2/create-8-direction-object'
headers = {'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
BROWSER = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://app.pixellab.ai/'}

os.makedirs('game/assets/pixellab_objects', exist_ok=True)

objects = {
    # Buildings
    'church': 'stone church building with stained glass and a steeple, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'school': 'red brick schoolhouse building with a bell tower, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'inn': 'large welcoming inn building with warm lit windows, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'museum': 'grand marble museum building with columns, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'bathhouse': 'traditional wooden bathhouse building with steam, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    
    # Interiors / Items
    'tavern_bar': 'long polished wooden tavern bar counter with stools, 16-bit RPG top down pixel art, NO UI',
    'forge_anvil': 'heavy iron blacksmith anvil, 16-bit RPG top down pixel art, NO UI',
    'store_counter': 'wooden shop counter with a cash register, 16-bit RPG top down pixel art, NO UI',
    'clinic_bed': 'white hospital clinic bed with fresh sheets, 16-bit RPG top down pixel art, NO UI',
    'church_pew': 'long wooden church bench seating, 16-bit RPG top down pixel art, NO UI',
    'school_desk': 'small wooden school desk with a chair, 16-bit RPG top down pixel art, NO UI',
    'museum_display': 'glass museum display case with a fossil, 16-bit RPG top down pixel art, NO UI',
    'bathhouse_pool': 'large tiled indoor hot spring pool, 16-bit RPG top down pixel art, NO UI',
    'inn_bed': 'luxurious inn bed with red blankets, 16-bit RPG top down pixel art, NO UI',
    'library_desk': 'large wooden library desk with scattered books, 16-bit RPG top down pixel art, NO UI',
    'tavern_table': 'round wooden tavern table with mugs on it, 16-bit RPG top down pixel art, NO UI',
}

jobs = {}
for name, prompt in objects.items():
    print(f'Starting {name}...')
    try:
        size = 168 if 'building' in prompt or 'pool' in prompt else 84
        data = json.dumps({'description': prompt, 'size': size}).encode()
        req = urllib.request.Request(url, data=data, headers=headers)
        resp = json.loads(urllib.request.urlopen(req).read())
        jobs[name] = resp['object_id']
    except Exception as e:
        print(f'Failed {name}:', e)
        # Sleep on rate limit to maybe recover for the next one
        time.sleep(10)

dirs = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east']

def poll(oid):
    req = urllib.request.Request(f'https://api.pixellab.ai/v2/objects/{oid}', headers=headers)
    return json.loads(urllib.request.urlopen(req).read())

for name, oid in jobs.items():
    print(f'Polling {name}...')
    while True:
        resp = poll(oid)
        if resp['status'] == 'completed':
            urls = resp['storage_urls'] if 'storage_urls' in resp else resp['rotation_urls']
            frames = []
            for d in dirs:
                u = urls[d]
                req = urllib.request.Request(u, headers=BROWSER)
                img = Image.open(io.BytesIO(urllib.request.urlopen(req).read())).convert('RGBA')
                frames.append(img)
            
            w, h = frames[0].size
            sheet = Image.new('RGBA', (w * 8, h))
            for i, frame in enumerate(frames):
                sheet.alpha_composite(frame, (i * w, 0))
            
            sheet.save(f'game/assets/pixellab_objects/{name}.png')
            print(f'Saved {name}')
            break
        elif resp['status'] == 'failed':
            print(f'Failed {name}')
            break
        time.sleep(2)

# Update catalog.json
import json
with open('game/data/catalog.json', 'r') as f:
    data = json.load(f)

for b in ['church', 'school', 'inn', 'museum', 'bathhouse', 'bathhouse_pool']:
    if os.path.exists(f'game/assets/pixellab_objects/{b}.png'):
        data['sprites'][b] = [0, 0, 168, 168]

for i in ['tavern_bar', 'forge_anvil', 'store_counter', 'clinic_bed', 'church_pew', 'school_desk', 'museum_display', 'inn_bed', 'library_desk', 'tavern_table']:
    if os.path.exists(f'game/assets/pixellab_objects/{i}.png'):
        data['sprites'][i] = [0, 0, 84, 84]

with open('game/data/catalog.json', 'w') as f:
    json.dump(data, f, indent=2)

print('Done generating buildings and interiors!')
