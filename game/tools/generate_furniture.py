import urllib.request, json, time, os
from PIL import Image
import io

KEY = os.environ["PIXELLAB_API_KEY"]
url = 'https://api.pixellab.ai/v2/create-8-direction-object'
headers = {'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
BROWSER = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://app.pixellab.ai/'}

os.makedirs('game/assets/pixellab_objects', exist_ok=True)

objects = {
    'bed': 'cozy wooden bed with red blankets and pillows, 16-bit RPG top down pixel art, NO UI, NO TEXT, NO BACKGROUND, NO GRID',
    'bookshelf': 'tall wooden bookshelf filled with colorful books, 16-bit RPG top down pixel art, NO UI, NO TEXT, NO BACKGROUND, NO GRID',
    'rug': 'large ornate red and gold rectangular rug, 16-bit RPG top down pixel art, NO UI, NO TEXT, NO BACKGROUND, NO GRID',
    'floor_lamp': 'tall brass floor lamp with a glowing white shade, 16-bit RPG top down pixel art, NO UI, NO TEXT, NO BACKGROUND, NO GRID',
    'house_plant': 'large green potted fern plant in a terracotta pot, 16-bit RPG top down pixel art, NO UI, NO TEXT, NO BACKGROUND, NO GRID'
}

jobs = {}
for name, prompt in objects.items():
    print(f'Starting {name}...')
    try:
        data = json.dumps({'description': prompt, 'size': 84}).encode()
        req = urllib.request.Request(url, data=data, headers=headers)
        resp = json.loads(urllib.request.urlopen(req).read())
        jobs[name] = resp['object_id']
    except Exception as e:
        print(f'Failed {name}:', e)

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
            break
        time.sleep(2)

print('Done generating furniture!')
