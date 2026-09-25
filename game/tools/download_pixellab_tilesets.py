"""Downloads all 25 Wang tilesets, tiles-pro sets, and map/UI objects from the user's
PixelLab account into:
  - game/assets/pixellab_tilesets/<idx>_<slug>/tilesheet.png (128x128 4x4 Wang sheet) + tileset.json
  - game/assets/pixellab_objects/<slug>.png
And creates a visual Master Showcase Sheet at docs/media/pixellab_tilesets_showcase.png.
"""
import base64
import concurrent.futures
import io
import json
import os
import re
import urllib.request
from PIL import Image, ImageDraw

KEY = os.environ.get("PIXELLAB_API_KEY", "")
OUT_TILES = os.path.join(os.path.dirname(__file__), "..", "assets", "pixellab_tilesets")
OUT_OBJS = os.path.join(os.path.dirname(__file__), "..", "assets", "pixellab_objects")
SHOWCASE_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "media", "pixellab_tilesets_showcase.png")
ARTIFACT_DIR = r"C:\Users\lil_c\.gemini\antigravity\brain\433fa0e9-d043-4a36-88b6-c820d8b1c3ab"


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def fetch_url_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return r.read()


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9_]+", "_", s.lower())
    return re.sub(r"_+", "_", s).strip("_")[:42]


def download_tileset(idx_and_summary: tuple) -> dict | None:
    idx, summary = idx_and_summary
    tid = summary["id"]
    lower = summary.get("lower_description") or "lower"
    upper = summary.get("upper_description") or "upper"
    slug = f"{idx:02d}_{slugify(lower[:18] + '_to_' + upper[:18])}"
    dest_dir = os.path.join(OUT_TILES, slug)
    os.makedirs(dest_dir, exist_ok=True)
    sheet_path = os.path.join(dest_dir, "tilesheet.png")
    meta_path = os.path.join(dest_dir, "tileset.json")

    try:
        det = api_get(f"v2/tilesets/{tid}")
        ts = det.get("tileset", {})
        tw = ts.get("tile_size", {}).get("width", 32)
        th = ts.get("tile_size", {}).get("height", 32)
        tiles = ts.get("tiles", [])
        if not tiles:
            return None

        # Assemble 4x4 (16-tile) Wang tilesheet PNG (128x128 for 32x32 tiles)
        sheet = Image.new("RGBA", (tw * 4, th * 4), (0, 0, 0, 0))
        clean_tiles_meta = []
        for i, t in enumerate(tiles[:16]):
            b64 = t.get("image", {}).get("base64", "")
            if b64:
                tile_im = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")
                gx, gy = (i % 4) * tw, (i // 4) * th
                sheet.alpha_composite(tile_im, (gx, gy))
                tile_im.save(os.path.join(dest_dir, f"tile_{t.get('id', i)}.png"))
            clean_tiles_meta.append({
                "index": i,
                "id": t.get("id"),
                "name": t.get("name"),
                "corners": t.get("corners"),
                "grid_pos": [(i % 4) * tw, (i // 4) * th, tw, th],
            })

        sheet.save(sheet_path)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({
                "id": tid,
                "slug": slug,
                "lower_description": lower,
                "upper_description": upper,
                "tile_size": [tw, th],
                "sheet_size": [tw * 4, th * 4],
                "tiles": clean_tiles_meta,
            }, f, indent=2)

        return {
            "idx": idx,
            "slug": slug,
            "lower": lower,
            "upper": upper,
            "sheet": sheet,
        }
    except Exception as e:
        print(f"  [WARN] Failed tileset {tid}: {e}")
        return None


def main():
    os.makedirs(OUT_TILES, exist_ok=True)
    os.makedirs(OUT_OBJS, exist_ok=True)

    # 1. Fetch all 25 Wang tilesets
    ts_list = api_get("v2/tilesets?limit=50").get("tilesets", [])
    completed_ts = [(i, t) for i, t in enumerate(ts_list) if t.get("status") == "completed"]
    print(f"Downloading {len(completed_ts)} Wang tilesets from PixelLab...")

    downloaded_ts = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(download_tileset, completed_ts):
            if res:
                downloaded_ts.append(res)
    downloaded_ts.sort(key=lambda x: x["idx"])
    print(f"Saved {len(downloaded_ts)} complete 4x4 Wang tilesheets to {OUT_TILES}!")

    # 2. Fetch tiles-pro sets
    tp_list = api_get("v2/tiles-pro?limit=50").get("tiles", [])
    for tp in tp_list:
        if tp.get("status") == "completed":
            tpid = tp["id"]
            det = api_get(f"v2/tiles-pro/{tpid}")
            urls = det.get("storage_urls", {})
            tp_dir = os.path.join(OUT_TILES, f"pro_{tpid[:8]}_interior_walls")
            os.makedirs(tp_dir, exist_ok=True)
            imgs = []
            for k, u in sorted(urls.items()):
                if u and u.endswith(".png"):
                    im = Image.open(io.BytesIO(fetch_url_bytes(u))).convert("RGBA")
                    im.save(os.path.join(tp_dir, f"{k}.png"))
                    imgs.append(im)
            if imgs:
                w, h = imgs[0].size
                cols = 4
                rows = (len(imgs) + cols - 1) // cols
                pro_sheet = Image.new("RGBA", (w * cols, h * rows), (0, 0, 0, 0))
                for idx, im in enumerate(imgs):
                    pro_sheet.alpha_composite(im, ((idx % cols) * w, (idx // cols) * h))
                pro_sheet.save(os.path.join(tp_dir, "tiles_pro_sheet.png"))
                print(f"Saved tiles-pro sheet ({len(imgs)} tiles) to {tp_dir}!")

    # 3. Fetch objects (dining table, gothic UI frames/buttons)
    obj_list = api_get("v2/objects?limit=50").get("objects", [])
    for ob in obj_list:
        if ob.get("status") == "completed":
            oid = ob["id"]
            oslug = slugify(ob.get("name") or oid)
            try:
                req = urllib.request.Request(
                    f"https://api.pixellab.ai/v2/objects/{oid}/spritesheet",
                    headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
                )
                raw = urllib.request.urlopen(req, timeout=25).read()
                import zipfile
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    for n in zf.namelist():
                        if n.endswith(".png"):
                            with open(os.path.join(OUT_OBJS, f"{oslug}.png"), "wb") as f:
                                f.write(zf.read(n))
                        elif n.endswith(".json"):
                            with open(os.path.join(OUT_OBJS, f"{oslug}.json"), "wb") as f:
                                f.write(zf.read(n))
                print(f"Saved PixelLab object: {oslug}")
            except Exception as e:
                print(f"  [WARN] Object {oslug}: {e}")

    # 4. Build a visual Master Showcase Sheet of all 25 Wang Tilesets
    cols = 5
    rows = (len(downloaded_ts) + cols - 1) // cols
    bw = 32 + cols * 280
    bh = 80 + rows * 190
    board = Image.new("RGBA", (bw, bh), (24, 22, 28, 255))
    draw = ImageDraw.Draw(board)
    draw.rectangle([20, 16, bw - 20, 56], fill=(42, 34, 32, 255), outline=(214, 182, 138, 255), width=2)
    draw.text((34, 28), f"IMPORTED PIXELLAB WANG TILESETS ({len(downloaded_ts)} COMPLETE 16-TILE SHEETS + PRO WALLS & OBJECTS)", fill=(246, 228, 194, 255))

    for i, item in enumerate(downloaded_ts):
        c = i % cols
        r = i // cols
        bx = 24 + c * 280
        by = 72 + r * 190
        draw.rectangle([bx, by, bx + 268, by + 178], fill=(36, 40, 34, 255), outline=(112, 76, 52, 255), width=2)
        scaled = item["sheet"].resize((128, 128), Image.Resampling.NEAREST)
        board.alpha_composite(scaled, (bx + 70, by + 8))
        draw.rectangle([bx, by + 140, bx + 268, by + 178], fill=(28, 24, 22, 245))
        draw.text((bx + 6, by + 144), f"#{item['idx']:02d}: {item['lower'][:34]}", fill=(255, 244, 140, 255))
        draw.text((bx + 6, by + 160), f" -> {item['upper'][:34]}", fill=(214, 182, 138, 255))

    os.makedirs(os.path.dirname(SHOWCASE_PATH), exist_ok=True)
    board.save(SHOWCASE_PATH)
    if os.path.isdir(ARTIFACT_DIR):
        board.save(os.path.join(ARTIFACT_DIR, "pixellab_tilesets_showcase.png"))
    print("Saved tileset showcase to:", SHOWCASE_PATH)


if __name__ == "__main__":
    main()
