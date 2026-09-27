import os
import json
import base64
import urllib.request
import time
from io import BytesIO
from PIL import Image

KEY = os.environ["PIXELLAB_API_KEY"]
CROPS_DIR = os.path.join("game", "assets", "pixellab_crops")
ITEMS_DIR = os.path.join("game", "assets", "pixellab_items")

crops = [
    ("tomato", "red tomato"),
    ("pumpkin", "orange pumpkin"),
    ("corn", "yellow corn cob"),
    ("strawberry", "red strawberry"),
    ("eggplant", "purple eggplant"),
    ("onion", "white onion"),
]

def api_post(path: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        data=data,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        if hasattr(e, 'read'):
            print(f"API Error: {e.read().decode('utf-8')}")
        else:
            print(f"API Error: {e}")
        return {}

def generate_icon(prompt: str, out_path: str):
    if os.path.exists(out_path):
        return
    print(f"Generating {out_path}...")
    res = api_post("v2/create-image-pixflux", {
        "description": f"16-bit RPG pixel art icon of {prompt}, single centered object, crisp 1px black outline, Stardew Valley and Pixel Crawler style",
        "image_size": {"width": 64, "height": 64},
        "no_background": True,
        "outline": "single color black outline",
        "shading": "medium shading",
        "detail": "medium detail",
    })
    b64 = res.get("image", {}).get("base64", "")
    if b64:
        Image.open(BytesIO(base64.b64decode(b64))).save(out_path)
    time.sleep(1)

def main():
    os.makedirs(CROPS_DIR, exist_ok=True)
    os.makedirs(ITEMS_DIR, exist_ok=True)

    for crop_id, crop_desc in crops:
        # Generate Item
        generate_icon(f"a harvested {crop_desc}", os.path.join(ITEMS_DIR, f"{crop_id}.png"))
        
        # Generate Seed
        generate_icon(f"a small brown seed bag with a {crop_desc} painted on it", os.path.join(ITEMS_DIR, f"{crop_id}_seeds.png"))
        
        # Generate 4 stages of growth
        stages = []
        for i in range(4):
            stage_path = os.path.join(CROPS_DIR, f"temp_{crop_id}_stage_{i}.png")
            if i == 0: stage_desc = f"a very small dirt mound with tiny green sprouts for a {crop_desc} plant"
            elif i == 1: stage_desc = f"a small growing green leafy {crop_desc} plant growing out of dirt"
            elif i == 2: stage_desc = f"a medium leafy {crop_desc} plant with unripe {crop_desc}s growing"
            else: stage_desc = f"a fully grown leafy {crop_desc} plant ready to harvest with ripe {crop_desc}s on it"
            
            generate_icon(stage_desc, stage_path)
            if os.path.exists(stage_path):
                # Resize to 16x32 so it fits in the tile
                img = Image.open(stage_path).convert("RGBA")
                # Crop to center 32x32 then resize to 16x32
                img = img.resize((16, 32), Image.Resampling.NEAREST)
                stages.append(img)
            else:
                stages.append(Image.new("RGBA", (16, 32), (0,0,0,0)))
        
        # Combine into spritesheet
        sheet_path = os.path.join(CROPS_DIR, f"crop_{crop_id}.png")
        if not os.path.exists(sheet_path) and len(stages) == 4:
            sheet = Image.new("RGBA", (16 * 4, 32))
            for i, img in enumerate(stages):
                sheet.paste(img, (i * 16, 0))
            sheet.save(sheet_path)
            print(f"Created spritesheet: {sheet_path}")

if __name__ == "__main__":
    main()
