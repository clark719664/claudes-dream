import urllib.request, json, time, os
from PIL import Image
import io

KEY = os.environ["PIXELLAB_API_KEY"]
url = 'https://api.pixellab.ai/v2/create-8-direction-object'
headers = {'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
BROWSER = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://app.pixellab.ai/'}

os.makedirs('game/assets/pixellab_objects', exist_ok=True)

objects = {
    'greenhouse': 'beautiful glass greenhouse building for growing crops in winter, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'silo': 'tall red farm silo building for storing hay, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'windmill': 'rustic wooden windmill building with large cloth sails, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'well': 'stone wishing well structure with a wooden roof and bucket, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'npc_house_3': 'cozy cottage building with a blue roof and a small flower garden, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'npc_house_4': 'sturdy stone house building with a slate roof and a chimney, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'npc_house_5': 'small log cabin building with a porch, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'barn': 'large red wooden barn building with double doors and a hayloft, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'coop': 'small wooden chicken coop building with a wire fence, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND'
}

jobs = {}
for name, prompt in objects.items():
    print(f'Starting {name}...')
    try:
        size = 168
        data = json.dumps({'description': prompt, 'size': size}).encode()
        req = urllib.request.Request(url, data=data, headers=headers)
        resp = json.loads(urllib.request.urlopen(req).read())
        jobs[name] = resp['object_id']
    except Exception as e:
        print(f'Failed {name}:', e)
        time.sleep(10)
    time.sleep(1) # Stagger

dirs = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east']

def poll(oid):
    req = urllib.request.Request(f'https://api.pixellab.ai/v2/objects/{oid}', headers=headers)
    return json.loads(urllib.request.urlopen(req).read())

for name, oid in jobs.items():
    print(f'Polling {name}...')
    while True:
        try:
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
        except Exception as e:
            print(f"Error polling {name}: {e}")
        time.sleep(2)

# Update catalog.json
import json
with open('game/data/catalog.json', 'r') as f:
    data = json.load(f)

for b in objects.keys():
    if os.path.exists(f'game/assets/pixellab_objects/{b}.png'):
        data['sprites'][b] = [{"sheet": f"pixellab_objects/{b}.png", "region": [0, 0, 168, 168]}]

with open('game/data/catalog.json', 'w') as f:
    json.dump(data, f, indent=2)

print('Done generating farm buildings and NPC houses!')
