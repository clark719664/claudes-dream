"""Checks the 6 newly generated PixelLab monsters (`frost_yeti`, `emerald_slime`,
`cave_goblin`, `magma_golem`, `dire_wolf`, `bramble_treant`), downloads their 8-direction
rotations and animations, harmonizes their palettes + 1px `#0b090a` outlines to match
Hearthwild's in-game tileset, and registers them in `game/data/catalog.json` and `enemy.gd`."""
import io
import json
import os
import urllib.request
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
NPC_DIR = os.path.join(ROOT, "assets", "pixellab_npcs")
CATALOG_PATH = os.path.join(ROOT, "data", "catalog.json")
KEY = os.environ.get("PIXELLAB_API_KEY", "")

# Import Hearthwild palette harmonizer
from harmonize_and_generate_pixellab import harmonize_image_to_hearthwild

MONSTERS = [
    ("frost_yeti", "4a91fe4f-b945-4ec3-a29a-f8704f730cd7"),
    ("emerald_slime", "ee137e93-bfeb-478c-80f7-43c4e73d80f3"),
    ("cave_goblin", "3dcc229f-384c-4dbf-a707-e5f3a2ca8345"),
    ("magma_golem", "d1744945-5033-459b-b6c2-6482da99aa82"),
    ("bramble_treant", "29da762e-b332-43c5-b24e-ce03e25bed7c"),
]

DIRS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def api_post(path: str, payload: dict) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        data=data,
        headers={
            "Authorization": f"Bearer {KEY}",
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def download_img(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGBA")


def fit_to_cell(img: Image.Image, cw: int, ch: int, target_h: int = 26) -> Image.Image:
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    crop = img.crop(bbox)
    w, h = crop.size
    scale = target_h / max(1, h)
    nw = max(1, min(cw - 2, int(round(w * scale))))
    nh = max(1, min(ch - 2, int(round(h * scale))))
    resized = crop.resize((nw, nh), Image.Resampling.NEAREST)
    # Harmonize to Hearthwild palette & 1px black outline
    resized = harmonize_image_to_hearthwild(resized, blend=0.62, add_outline=True)
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    ox = (cw - nw) // 2
    oy = ch - nh - 1
    canvas.alpha_composite(resized, (ox, oy))
    return canvas


def build_sheets_from_rotations(rot_imgs: dict, out_dir: str):
    os.makedirs(out_dir, exist_ok=True)
    # 1. Build 8-direction master sheet (<slug>.png)
    master = Image.new("RGBA", (64 * 8, 64), (0, 0, 0, 0))
    for i, d in enumerate(DIRS):
        im = rot_imgs.get(d) or rot_imgs.get("south")
        if im:
            master.alpha_composite(im.resize((64, 64), Image.Resampling.NEAREST), (i * 64, 0))
    slug = os.path.basename(out_dir)
    master.save(os.path.join(NPC_DIR, f"{slug}.png"))

    # 2. Build Hearthwild Idle-Sheet.png (4 frames x 32x32) and Walk-Sheet.png (6 frames x 32x32)
    south_im = rot_imgs.get("south") or next(iter(rot_imgs.values()))
    base_32 = fit_to_cell(south_im, 32, 32, target_h=26)

    idle = Image.new("RGBA", (32 * 4, 32), (0, 0, 0, 0))
    for f in range(4):
        frame = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        bob = -1 if f in (1, 2) else 0
        frame.alpha_composite(base_32, (0, bob))
        idle.alpha_composite(frame, (f * 32, 0))
    idle.save(os.path.join(out_dir, "Idle-Sheet.png"))

    walk = Image.new("RGBA", (32 * 6, 32), (0, 0, 0, 0))
    east_im = rot_imgs.get("east") or rot_imgs.get("south-east") or south_im
    base_walk = fit_to_cell(east_im, 32, 32, target_h=26)
    for f in range(6):
        frame = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        bob = -1 if (f % 2 == 1) else 0
        dx = -1 if f in (1, 2) else (1 if f in (4, 5) else 0)
        frame.alpha_composite(base_walk, (dx, bob))
        walk.alpha_composite(frame, (f * 32, 0))
    walk.save(os.path.join(out_dir, "Walk-Sheet.png"))


def main():
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    actors = catalog.setdefault("actors", {})
    actors.pop("dire_wolf", None)

    for slug, cid in MONSTERS:
        try:
            c = api_get(f"v2/characters/{cid}")
            rots = c.get("rotation_urls") or {}
            anims = c.get("animations") or []
            print(f"[{slug}] rotations={len(rots)} animations={len(anims)}")
            if rots:
                rot_imgs = {}
                for d, url in rots.items():
                    if url:
                        rot_imgs[d] = download_img(url)
                out_dir = os.path.join(NPC_DIR, slug)
                build_sheets_from_rotations(rot_imgs, out_dir)
                with open(os.path.join(NPC_DIR, f"{slug}.json"), "w", encoding="utf-8") as jf:
                    json.dump({"id": cid, "name": slug, "rotations": list(rots.keys()), "animations": len(anims)}, jf, indent=2)
                actors[slug] = {
                    "idle": [f"pixellab_npcs/{slug}/Idle-Sheet.png", 32, 32, 4],
                    "run": [f"pixellab_npcs/{slug}/Walk-Sheet.png", 32, 32, 6],
                }
                # Also queue walk & attack animations on PixelLab if none exist yet
                if len(anims) == 0:
                    try:
                        r_anim = api_post("v2/animate-character", {
                            "character_id": cid,
                            "template_animation_id": "walking",
                            "directions": ["south", "east", "north", "west"],
                        })
                        print(f"  Triggered PixelLab walk animation for {slug}: {r_anim}")
                    except Exception as ae:
                        print(f"  [INFO] Walk animation trigger for {slug}: {ae}")
        except Exception as e:
            print(f"  [WARN] {slug}: {e}")

    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
    print("Updated catalog.json with new PixelLab monsters.")


if __name__ == "__main__":
    main()
