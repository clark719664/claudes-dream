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

from harmonize_and_generate_pixellab import harmonize_image_to_hearthwild

MONSTERS = [
    ("cave_bat", "b3bd8325-12bc-4a4b-912e-05e728fc935c"),
    ("rock_slime", "f91102e7-2dea-47f8-9556-8304aae2c623"),
    ("tunnel_spider", "dcfd3d38-660f-450d-b544-b1e201fea1f9"),
    ("crystal_basilisk", "37f03e82-d5c1-4c06-adb6-ac1c22deb16f"),
    ("abyssal_crawler", "c24fbc2e-b1ee-495f-89e2-b8596c6e763c"),
    ("shadow_fiend", "c4b57cf6-f5b6-4034-82f0-95939b905714"),
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
        for slug, cid in MONSTERS:
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
            print("All monsters downloaded successfully!")
            break
        print("Waiting 10 seconds before next check...")
        time.sleep(10)

if __name__ == "__main__":
    main()
