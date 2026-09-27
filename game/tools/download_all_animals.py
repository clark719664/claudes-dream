"""Download all completed PixelLab characters via the /zip endpoint,
extract rotation PNGs and compose them into 8-direction master sheets
saved to assets/pixellab_npcs/<name>.png."""

import urllib.request, json, os, io, zipfile, sys, re
from PIL import Image

KEY = os.environ.get("PIXELLAB_API_KEY", "")
API = "https://api.pixellab.ai/v2"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "pixellab_npcs")
os.makedirs(OUT, exist_ok=True)

DIRECTIONS = ["south", "south-east", "east", "north-east", "north", "north-west", "west", "south-west"]

def api_get(path):
    req = urllib.request.Request(f"{API}/{path}", headers={"Authorization": f"Bearer {KEY}"})
    return urllib.request.urlopen(req, timeout=30)

def api_json(path):
    return json.loads(api_get(path).read().decode("utf-8"))


def download_character(char):
    name = (char.get("name") or "").lower().strip().replace(" ", "_")
    # Strip trailing underscores and leading "a_"
    name = name.rstrip("_")
    if name.startswith("a_"):
        name = name[2:]
    cid = char["id"]

    # Skip junk characters with absurdly long names (prompt-as-name test entries)
    if len(name) > 60:
        print(f"  [{name[:40]}...] Skipping (name too long)")
        return True

    # Check if we already have a proper 8-direction master sheet
    master_path = os.path.join(OUT, f"{name}.png")
    if os.path.isfile(master_path):
        img = Image.open(master_path)
        if img.width >= 64 * 8:  # Already have full 8-dir sheet
            print(f"  [{name}] Already have master sheet ({img.size}), skipping.")
            return True

    print(f"  [{name}] Downloading zip...")
    try:
        data = api_get(f"characters/{cid}/zip").read()
    except Exception as e:
        print(f"    FAILED zip download: {e}")
        return False

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        print(f"    FAILED: not a valid zip ({len(data)} bytes)")
        return False

    names_in_zip = zf.namelist()
    png_files = [n for n in names_in_zip if n.lower().endswith(".png")]

    # Build a map: direction -> image
    # PixelLab zips use patterns like:
    #   Idle/rotations/south.png
    #   rotations/south.png
    #   south.png
    rotation_imgs = {}
    for d in DIRECTIONS:
        for pf in png_files:
            basename = os.path.basename(pf).lower().replace(".png", "")
            # Match if the filename is exactly the direction name
            if basename == d:
                try:
                    rotation_imgs[d] = Image.open(io.BytesIO(zf.read(pf))).convert("RGBA")
                    break
                except Exception:
                    pass

    if len(rotation_imgs) >= 4:
        # Got enough directions to compose a master sheet
        cell_w = max(img.width for img in rotation_imgs.values())
        cell_h = max(img.height for img in rotation_imgs.values())
        master = Image.new("RGBA", (cell_w * 8, cell_h), (0, 0, 0, 0))

        for i, d in enumerate(DIRECTIONS):
            if d in rotation_imgs:
                master.alpha_composite(rotation_imgs[d], (i * cell_w, 0))
            elif d == "south-west" and "south-east" in rotation_imgs:
                # Mirror south-east
                master.alpha_composite(rotation_imgs["south-east"].transpose(Image.FLIP_LEFT_RIGHT), (i * cell_w, 0))
            elif d == "north-west" and "north-east" in rotation_imgs:
                master.alpha_composite(rotation_imgs["north-east"].transpose(Image.FLIP_LEFT_RIGHT), (i * cell_w, 0))
            elif d == "west" and "east" in rotation_imgs:
                master.alpha_composite(rotation_imgs["east"].transpose(Image.FLIP_LEFT_RIGHT), (i * cell_w, 0))

        master.save(master_path)
        print(f"    Saved 8-dir master sheet: {name}.png ({master.size}) [{len(rotation_imgs)} directions found]")
        return True
    else:
        # Fallback: check for any animation frame PNGs and compose what we can
        # Some zips may have animation frames instead of simple rotations
        # Try to find frame_000 files for each direction
        anim_rotation_imgs = {}
        for d in DIRECTIONS:
            for pf in png_files:
                # Match patterns like: .../south/frame_000.png or .../south.png
                parts = pf.replace("\\", "/").split("/")
                for part_idx, part in enumerate(parts):
                    if part.lower() == d and part_idx + 1 < len(parts):
                        frame_name = parts[part_idx + 1].lower()
                        if "frame_000" in frame_name or "frame_00" in frame_name:
                            try:
                                anim_rotation_imgs[d] = Image.open(io.BytesIO(zf.read(pf))).convert("RGBA")
                            except Exception:
                                pass
                            break

        if len(anim_rotation_imgs) >= 4:
            cell_w = max(img.width for img in anim_rotation_imgs.values())
            cell_h = max(img.height for img in anim_rotation_imgs.values())
            master = Image.new("RGBA", (cell_w * 8, cell_h), (0, 0, 0, 0))
            for i, d in enumerate(DIRECTIONS):
                if d in anim_rotation_imgs:
                    master.alpha_composite(anim_rotation_imgs[d], (i * cell_w, 0))
            master.save(master_path)
            print(f"    Saved 8-dir master sheet (from anim frames): {name}.png ({master.size})")
            return True

        print(f"    Only found {len(rotation_imgs)} directions, not enough. PNG files: {png_files[:10]}")
        return False


def main():
    if not KEY:
        print("ERROR: Set PIXELLAB_API_KEY environment variable")
        sys.exit(1)

    print("Fetching character list from PixelLab...")
    all_chars = []
    offset = 0
    while True:
        resp = api_json(f"characters?limit=30&offset={offset}")
        chars = resp.get("characters", [])
        if not chars:
            break
        all_chars.extend(chars)
        offset += len(chars)
        if len(chars) < 30:
            break

    print(f"Found {len(all_chars)} total characters.")

    completed = [c for c in all_chars if c.get("status") == "completed"]
    pending = [c for c in all_chars if c.get("status") in ("pending", "processing", "queued")]

    print(f"  Completed: {len(completed)}")
    print(f"  Pending:   {len(pending)}")
    if pending:
        print(f"  Still generating: {[c['name'] for c in pending]}")

    success = 0
    failed = 0
    for char in completed:
        ok = download_character(char)
        if ok:
            success += 1
        else:
            failed += 1

    print(f"\nDone! Downloaded {success} characters, {failed} failures, {len(pending)} still pending.")


if __name__ == "__main__":
    main()
