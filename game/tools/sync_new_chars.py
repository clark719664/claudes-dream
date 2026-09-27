import io
import json
import os
import time
import urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
NPC_DIR = os.path.join(ROOT, "assets", "pixellab_npcs")
KEY = os.environ.get("PIXELLAB_API_KEY", "")

CHARS = [
    ("magma_slime", "fb2e1a95-3bac-4c64-bd81-d9697598e845"),
    ("chicken", "71feb45d-4325-409e-9822-2e3cf50bcda6"),
    ("ferret", "ee56faf3-c832-4d03-94c1-2fcd499a8435"),
    ("polar_bear", "98550dca-3683-4148-b6f7-6e1b98ced413"),
    ("artic_wolf", "955800a7-46dd-4ee3-b099-17f1e4ff0fbe"),
    ("bear", "88ddaff5-e4b9-4b29-a4d6-ba1c41d6eac5"),
    ("green_forest_slime", "eec4222c-9c8d-4341-84f7-ce1040ba493f"),
    ("radioactive_centipede", "263008bc-7929-411b-b1b9-4e6015664844"),
    ("dog", "23faf074-86fe-4bdf-90d9-00518ffc3768"),
    ("tabby_cat", "d0e25a1e-050a-4b0c-905a-24ab55eecdfe"),
    ("forest_wolf", "16e1696b-59eb-49fe-bac8-1567fcf705d2"),
    ("stone_based_slime", "8eb206db-95b0-41c4-a34f-3ea0ec3f278b")
]

DIRS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]

def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))

def download_img(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGBA")

def build_master_sheet(rot_imgs: dict, out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    master = Image.new("RGBA", (64 * 8, 64), (0, 0, 0, 0))
    for i, d in enumerate(DIRS):
        im = rot_imgs.get(d) or rot_imgs.get("south")
        if im:
            master.alpha_composite(im.resize((64, 64), Image.Resampling.NEAREST), (i * 64, 0))
    slug = os.path.basename(out_dir)
    master.save(os.path.join(NPC_DIR, f"{slug}.png"))
    print(f"Saved master sheet for {slug}")

def main():
    while True:
        all_done = True
        for slug, cid in CHARS:
            out_dir = os.path.join(NPC_DIR, slug)
            if os.path.exists(os.path.join(NPC_DIR, f"{slug}.png")):
                continue
            
            try:
                c = api_get(f"v2/characters/{cid}")
                status = c.get("status")
                print(f"[{slug}] Status: {status}")
                if status == "completed":
                    rots = c.get("rotation_urls") or {}
                    if rots:
                        print(f"  Downloading rotations for {slug}...")
                        rot_imgs = {}
                        for d, url in rots.items():
                            if url:
                                rot_imgs[d] = download_img(url)
                        build_master_sheet(rot_imgs, out_dir)
                else:
                    all_done = False
            except Exception as e:
                print(f"  [WARN] {slug}: {e}")
                all_done = False
        
        if all_done:
            print("All characters downloaded successfully!")
            break
        print("Waiting 10 seconds before next check...")
        time.sleep(10)

if __name__ == "__main__":
    main()
