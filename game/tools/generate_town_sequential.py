import urllib.request, json, time, os
from PIL import Image
import io

KEY = os.environ["PIXELLAB_API_KEY"]
url = 'https://api.pixellab.ai/v2/create-8-direction-object'
headers = {'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
BROWSER = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://app.pixellab.ai/'}

os.makedirs('game/assets/pixellab_objects', exist_ok=True)

objects = {
    "mega_pumpkin": "a massive giant pumpkin sitting on the ground, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND",
    "mega_melon": "a massive giant pink melon sitting on the ground, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND",
    "mega_cauliflower": "a massive giant cauliflower sitting on the ground, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND",
}

dirs = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east']

def poll(oid):
    req = urllib.request.Request(f'https://api.pixellab.ai/v2/objects/{oid}', headers=headers)
    return json.loads(urllib.request.urlopen(req).read())

# Sequential generation
for name, prompt in objects.items():
    if os.path.exists(f'game/assets/pixellab_objects/{name}.png'):
        print(f'Skipping {name}, already exists.')
        continue
        
    print(f'Starting {name}...')
    try:
        size = 168 if 'building' in prompt or 'pool' in prompt else 84
        data = json.dumps({'description': prompt, 'size': size}).encode()
        req = urllib.request.Request(url, data=data, headers=headers)
        resp = json.loads(urllib.request.urlopen(req).read())
        oid = resp['object_id']
        
        # Wait for this one to finish before starting the next
        print(f'Polling {name} ({oid})...')
        while True:
            poll_resp = poll(oid)
            if poll_resp['status'] == 'completed':
                urls = poll_resp['storage_urls'] if 'storage_urls' in poll_resp else poll_resp['rotation_urls']
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
                
                # Update catalog
                with open('game/data/catalog.json', 'r') as f:
                    cat = json.load(f)
                cat['sprites'][name] = [0, 0, size, size]
                with open('game/data/catalog.json', 'w') as f:
                    json.dump(cat, f, indent=2)
                break
            elif poll_resp['status'] == 'failed':
                print(f'Failed {name}')
                break
            time.sleep(2)
            
    except Exception as e:
        print(f'Request failed for {name}: {e}')
        print('Sleeping 30 seconds before retrying next item due to rate limit...')
        time.sleep(30)
    
    # Sleep between successful jobs to be safe on requests per minute limit
    print('Resting 5 seconds before next request...')
    time.sleep(5)

print('Done generating town and interiors!')
