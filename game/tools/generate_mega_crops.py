import os
import time
import urllib.request
import urllib.error

API_KEY = os.environ["PIXELLAB_API_KEY"]

items = {
    "mega_pumpkin": "a massive giant pumpkin sitting on the ground",
    "mega_melon": "a massive giant pink melon sitting on the ground",
    "mega_cauliflower": "a massive giant cauliflower sitting on the ground",
}

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://app.pixellab.ai/"
}

def get_image(url_str, out_path):
    req = urllib.request.Request(url_str, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req) as resp:
        with open(out_path, "wb") as f:
            f.write(resp.read())

for name, prompt in items.items():
    print(f"Starting {name}...")
    import json
    data = json.dumps({'description': f'{prompt}, 16-bit RPG top down pixel art', 'size': 84}).encode()
    req = urllib.request.Request("https://api.pixellab.ai/v2/create-8-direction-object", data=data, headers=headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            resp_data = json.loads(response.read().decode())
            obj_id = resp_data.get("object_id")
            
            while True:
                print(f"Polling {name} ({obj_id})...")
                status_req = urllib.request.Request(f"https://api.pixellab.ai/v2/objects/{obj_id}", headers=headers)
                with urllib.request.urlopen(status_req) as s_resp:
                    s_data = json.loads(s_resp.read().decode())
                    if s_data.get("status") == "completed":
                        urls = s_data.get("storage_urls", s_data.get("rotation_urls", []))
                        if urls:
                            # It's an 8-direction sprite, we need to stitch them
                            from PIL import Image
                            import io
                            frames = []
                            for u in urls:
                                req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
                                img_data = urllib.request.urlopen(req).read()
                                frames.append(Image.open(io.BytesIO(img_data)))
                            
                            w, h = frames[0].size
                            sheet = Image.new('RGBA', (w * 8, h))
                            for i, f in enumerate(frames):
                                sheet.paste(f, (i * w, 0))
                            sheet.save(f"game/assets/pixellab_objects/{name}.png")
                        print(f"Saved {name}")
                        break
                    elif s_data.get("status") == "failed":
                        print(f"Failed {name}")
                        break
                time.sleep(2)
    except urllib.error.HTTPError as e:
        print(f"Failed {name}: {e}")
    time.sleep(3)
