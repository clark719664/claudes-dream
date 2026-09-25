"""Downloads all completed characters/NPCs from the user's PixelLab account (PIXELLAB_API_KEY in
the environment) and extracts their full 8-directional sprite sheets + JSON metadata into:
    game/assets/pixellab_npcs/<slug>/
then runs tools/pixellab/import_actors.py, which turns them into the game's atlases and catalog
entries, and writes a roster preview.
"""
import concurrent.futures
import io
import json
import os
import re
import urllib.request
import zipfile
from PIL import Image, ImageDraw

KEY = os.environ.get("PIXELLAB_API_KEY", "")
OUT_ROOT = os.path.join(os.path.dirname(__file__), "..", "assets", "pixellab_npcs")
CATALOG_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "catalog.json")
ROSTER_PREVIEW = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "media", "pixellab_npcs_roster.png")
ARTIFACT_DIR = r"C:\Users\lil_c\.gemini\antigravity\brain\433fa0e9-d043-4a36-88b6-c820d8b1c3ab"


def api_get_json(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def api_get_bytes(path: str) -> bytes:
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=35) as r:
        return r.read()


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9_]+", "_", name.strip().lower())
    return re.sub(r"_+", "_", s).strip("_")


def make_game_sheets(full_sheet: Image.Image, meta: dict, dest_dir: str) -> dict:
    """From PixelLab's 8-direction sheet (Row 0 = rotations, Rows 1..8 = walking in 8 dirs),
    creates crisp 64x64 frame sheets (`Idle-Sheet.png` and `Walk-Sheet.png` + directional strips)
    scaled so the character stands ~28px tall (matching Hearthwild's houses & doorways) with
    exact feet anchor at [32, 63]."""
    sp = meta.get("spritesheet", {})
    cw = sp.get("cell_size", {}).get("width", 92)
    ch = sp.get("cell_size", {}).get("height", 92)
    rows = sp.get("rows", [])

    # Measure opaque height of Row 0 Col 0 (south rotation)
    cell0 = full_sheet.crop((0, 0, cw, ch))
    bb = cell0.getchannel("A").getbbox() or (cw // 4, ch // 4, cw * 3 // 4, ch * 3 // 4)
    orig_h = max(1, bb[3] - bb[1])
    # Target character height in Hearthwild: ~28px (matches Tilda/Merlo/Player & 40px house doors)
    scale = min(1.0, 28.0 / orig_h)

    def place_in_64(cell_im: Image.Image, dy_bob: int = 0) -> Image.Image:
        c_bb = cell_im.getchannel("A").getbbox()
        out = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        if not c_bb:
            return out
        cropped = cell_im.crop(c_bb)
        nw = max(1, int(round(cropped.width * scale)))
        nh = max(1, int(round(cropped.height * scale)))
        resized = cropped.resize((nw, nh), Image.Resampling.NEAREST)
        # Anchor feet at (32, 62) so bottom outline sits at y = 62..63
        dst_x = 32 - nw // 2
        dst_y = 62 - nh + dy_bob
        out.alpha_composite(resized, (dst_x, dst_y))
        return out

    # Find row index for east / south-east / south walking
    walk_rows = {}
    for r_info in rows:
        if r_info.get("type") == "animation":
            d = r_info.get("direction", "south")
            walk_rows[d] = (r_info.get("row", 1), r_info.get("frame_count", 6))

    # Build 4-frame Idle-Sheet.png (using east/south-east rotation with subtle 1px breathing bob)
    # Direction indices in Row 0: 0=south, 1=south-east, 2=east, 4=north, 6=west
    rot_east = full_sheet.crop((2 * cw, 0, 3 * cw, ch))
    rot_south = full_sheet.crop((0 * cw, 0, 1 * cw, ch))
    idle_sheet = Image.new("RGBA", (64 * 4, 64), (0, 0, 0, 0))
    for i, bob in enumerate([0, -1, -1, 0]):
        base_cell = rot_east if i in (1, 2) else rot_south
        idle_sheet.alpha_composite(place_in_64(base_cell, dy_bob=bob), (i * 64, 0))
    idle_path = os.path.join(dest_dir, "Idle-Sheet.png")
    idle_sheet.save(idle_path)

    # Build 6-frame Walk-Sheet.png (using East walk row if available, fallback to South)
    w_row, w_cnt = walk_rows.get("east", walk_rows.get("south-east", walk_rows.get("south", (1, 6))))
    w_cnt = max(1, min(8, w_cnt))
    walk_sheet = Image.new("RGBA", (64 * w_cnt, 64), (0, 0, 0, 0))
    for i in range(w_cnt):
        w_cell = full_sheet.crop((i * cw, w_row * ch, (i + 1) * cw, (w_row + 1) * ch))
        walk_sheet.alpha_composite(place_in_64(w_cell, dy_bob=0), (i * 64, 0))
    walk_path = os.path.join(dest_dir, "Walk-Sheet.png")
    walk_sheet.save(walk_path)

    return {
        "idle_frames": 4,
        "walk_frames": w_cnt,
        "south_thumb": place_in_64(rot_south, 0),
    }


def download_one(char_summary: dict) -> dict | None:
    cid = char_summary["id"]
    raw_name = str(char_summary.get("name") or cid).strip()
    # Skip the desktop pet prompt paragraph
    if len(raw_name) > 40 or "cartoon pig" in raw_name.lower():
        return None
    slug = slugify(raw_name)
    dest_dir = os.path.join(OUT_ROOT, slug)
    os.makedirs(dest_dir, exist_ok=True)

    full_png = os.path.join(dest_dir, f"{slug}.png")
    full_json = os.path.join(dest_dir, f"{slug}.json")

    try:
        if not (os.path.exists(full_png) and os.path.exists(full_json)):
            zbytes = api_get_bytes(f"v2/characters/{cid}/spritesheet")
            with zipfile.ZipFile(io.BytesIO(zbytes)) as zf:
                png_names = [n for n in zf.namelist() if n.endswith(".png")]
                json_names = [n for n in zf.namelist() if n.endswith(".json")]
                if not png_names or not json_names:
                    return None
                with open(full_png, "wb") as f:
                    f.write(zf.read(png_names[0]))
                with open(full_json, "wb") as f:
                    f.write(zf.read(json_names[0]))

        with open(full_json, "r", encoding="utf-8") as f:
            meta = json.load(f)
        im = Image.open(full_png).convert("RGBA")
        cw = meta.get("spritesheet", {}).get("cell_size", {}).get("width", 92)
        return {
            "slug": slug,
            "name": raw_name,
            "id": cid,
            "prompt": char_summary.get("prompt") or meta.get("character", {}).get("prompt", ""),
            "thumb": im.crop((0, 0, cw, cw)).resize((64, 64), Image.Resampling.NEAREST),
        }
    except Exception as e:
        print(f"  [WARN] Failed {slug} ({cid}): {e}")
        return None


def main():
    os.makedirs(OUT_ROOT, exist_ok=True)
    all_chars = []
    for off in (0, 50, 100, 150):
        batch = api_get_json(f"v2/characters?limit=50&offset={off}").get("characters", [])
        if not batch:
            break
        all_chars.extend(batch)

    completed = [c for c in all_chars if c.get("status") == "completed" and (c.get("animation_count") or 0) > 0]
    # Deduplicate by slug (keep newest/first)
    seen = set()
    unique_chars = []
    for c in completed:
        s = slugify(str(c.get("name") or ""))
        if s and s not in seen and len(s) <= 32:
            seen.add(s)
            unique_chars.append(c)

    print(f"Downloading & converting {len(unique_chars)} animated PixelLab characters with 10 threads...")
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        futs = [ex.submit(download_one, c) for c in unique_chars]
        for fut in concurrent.futures.as_completed(futs):
            res = fut.result()
            if res:
                results.append(res)

    results.sort(key=lambda r: r["slug"])
    print(f"Successfully imported {len(results)} PixelLab characters into {OUT_ROOT}!")

    # Turn the exports into game atlases and catalog entries (real walks, no invented frames)
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "pixellab"))
    import import_actors
    import_actors.main()

    # Build a visual Roster Preview Sheet showing all imported PixelLab NPCs
    cols = 9
    rows = (len(results) + cols - 1) // cols
    pw = 40 + cols * 150
    ph = 80 + rows * 136
    board = Image.new("RGBA", (pw, ph), (24, 22, 28, 255))
    draw = ImageDraw.Draw(board)
    draw.rectangle([20, 16, pw - 20, 56], fill=(42, 34, 32, 255), outline=(214, 182, 138, 255), width=2)
    draw.text((34, 28), f"IMPORTED PIXELLAB NPC & CHARACTER ROSTER ({len(results)} COMPLETE 8-DIR ANIMATED ACTORS IN HEARTHWILD)", fill=(246, 228, 194, 255))

    for idx, r in enumerate(results):
        c_idx = idx % cols
        r_idx = idx // cols
        bx = 24 + c_idx * 150
        by = 72 + r_idx * 136
        draw.rectangle([bx, by, bx + 142, by + 126], fill=(42, 60, 34, 255), outline=(112, 76, 52, 255), width=2)
        draw.ellipse([bx + 46, by + 94, bx + 96, by + 108], fill=(12, 16, 10, 110))
        thumb_up = r["thumb"].resize((128, 128), Image.Resampling.NEAREST)
        board.alpha_composite(thumb_up, (bx + 7, by - 20))
        draw.rectangle([bx, by + 104, bx + 142, by + 126], fill=(32, 26, 24, 240))
        draw.text((bx + 6, by + 109), r["slug"][:18], fill=(255, 244, 140, 255))

    os.makedirs(os.path.dirname(ROSTER_PREVIEW), exist_ok=True)
    board.save(ROSTER_PREVIEW)
    if os.path.isdir(ARTIFACT_DIR):
        board.save(os.path.join(ARTIFACT_DIR, "pixellab_npcs_roster.png"))
    print("Saved roster preview to:", ROSTER_PREVIEW)


if __name__ == "__main__":
    main()
