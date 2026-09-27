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
    'saloon': 'large rustic wooden tavern building with a swinging sign, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'blacksmith_shop': 'stone blacksmith forge building with a smoking chimney, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'general_store': 'quaint village general store building with colorful awnings, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'clinic': 'clean white brick village clinic building with a red cross sign, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'mayors_manor': 'large fancy stone manor house with pillars and a red roof, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'wizard_tower': 'tall purple stone wizard tower with a glowing crystal on top, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'library': 'grand library building with stained glass windows, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'npc_house_1': 'small cozy wooden cottage with a thatch roof, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    'npc_house_2': 'sturdy log cabin home with flower boxes, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND',
    
    # Interiors / Items
    'sunforged_ring': 'glowing golden ring with a blazing sun emblem, 16-bit RPG item icon pixel art, NO UI, NO BACKGROUND',
    'tavern_bar': 'long polished wooden tavern bar counter with stools, 16-bit RPG top down pixel art, NO UI',
    'forge_anvil': 'heavy iron blacksmith anvil, 16-bit RPG top down pixel art, NO UI',
    'store_counter': 'wooden shop counter with a cash register, 16-bit RPG top down pixel art, NO UI',
}

jobs = {}
for name, prompt in objects.items():
    print(f'Starting {name}...')
    try:
        size = 168 if 'building' in prompt or 'house' in prompt or 'tower' in prompt or 'cabin' in prompt else 84
        data = json.dumps({'description': prompt, 'size': size}).encode()
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
            print(f'Failed {name}')
            break
        time.sleep(2)

print('Done generating town and interiors!')
