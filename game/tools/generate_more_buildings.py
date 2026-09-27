import urllib.request, json, time, os
from PIL import Image
import io

KEY = os.environ["PIXELLAB_API_KEY"]
url = 'https://api.pixellab.ai/v2/create-8-direction-object'
headers = {'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
BROWSER = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://app.pixellab.ai/'}

os.makedirs('game/assets/pixellab_objects', exist_ok=True)

objects = {
    "bakery": "warm cozy bakery building with a brick oven chimney and bread sign, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND",
    "blacksmith_shop": "stone blacksmith shop building with a forge and anvil sign, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND",
    "library": "tall brick library building with large windows and a book sign, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND",
    "clinic": "clean white clinic building with a red cross sign, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND",
    "tailor_shop": "fancy tailor shop building with colorful awnings and a scissors sign, 16-bit RPG top down pixel art, NO UI, NO BACKGROUND",
}

dirs = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east']

def poll(oid):
    req = urllib.request.Request(f'https://api.pixellab.ai/v2/objects/{oid}', headers=headers)
    return json.loads(urllib.request.urlopen(req).read())

for name, prompt in objects.items():
    if os.path.exists(f'game/assets/pixellab_objects/{name}.png'):
        print(f'Skipping {name}, already exists.')
        continue
        
    print(f'Starting {name}...')
    try:
        req = urllib.request.Request(url, data=json.dumps({"prompt": prompt}).encode('utf-8'), headers=headers)
        res = json.loads(urllib.request.urlopen(req).read())
        oid = res['id']
        
        print(f'Polling {name} ({oid})...')
        while True:
            info = poll(oid)
            if info.get('status') == 'completed':
                urls = info['rotation_urls']
                
                sheet = Image.new('RGBA', (168 * 8, 168))
                for i, d in enumerate(dirs):
                    req_img = urllib.request.Request(urls[d], headers=BROWSER)
                    img_data = urllib.request.urlopen(req_img).read()
                    img = Image.open(io.BytesIO(img_data)).convert('RGBA')
                    sheet.paste(img, (i * 168, 0))
                
                sheet.save(f'game/assets/pixellab_objects/{name}.png')
                print(f'Saved {name}')
                break
            elif info.get('status') == 'failed':
                print(f'Failed {name}: {info}')
                break
            time.sleep(2)
            
    except Exception as e:
        print(f'Error on {name}: {e}')
    
    print('Resting 5 seconds before next request...')
    time.sleep(5)

print('Done generating buildings!')
