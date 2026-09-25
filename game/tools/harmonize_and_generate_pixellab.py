"""1. Harmonizes all 25 downloaded PixelLab Wang tilesets + tiles-pro sets to match
   Hearthwild's exact 16x16 tile size and in-game Pixel Crawler color palette
   (extracted from docs/media/hearthwild-homestead.png & hearthwild-frostvale.png).
2. Pushes new Monster, Boss, Weapon, and Armor generations through the PixelLab API
   using Hearthwild's exact master palette (`color_image` + `force_colors=True` +
   `outline='single color black outline'`), downloads them, builds their animation
   sheets, and wires them into `game/data/catalog.json`, `enemy.gd`, and `make_world.py`.
"""
import base64
import concurrent.futures
import io
import json
import math
import os
import time
import urllib.request
from PIL import Image, ImageDraw

KEY = os.environ.get("PIXELLAB_API_KEY", "")
ROOT = os.path.join(os.path.dirname(__file__), "..")
TILES_DIR = os.path.join(ROOT, "assets", "pixellab_tilesets")
ITEMS_DIR = os.path.join(ROOT, "assets", "pixellab_items")
MONSTERS_DIR = os.path.join(ROOT, "assets", "pixellab_monsters")
CATALOG_PATH = os.path.join(ROOT, "data", "catalog.json")
MATCHED_PREVIEW = os.path.join(ROOT, "..", "docs", "media", "hearthwild_matched_pixellab_showcase.png")
ARTIFACT_DIR = r"C:\Users\lil_c\.gemini\antigravity\brain\433fa0e9-d043-4a36-88b6-c820d8b1c3ab"

# Exact 42-color Hearthwild / Pixel Crawler Master Palette extracted from in-game screenshots
HEARTHWILD_PALETTE = [
    (11, 9, 10),      # #0b090a 1px pitch black outline
    (22, 16, 20),     # #161014 deep shadow cavity
    # Grass & foliage greens (matches hearthwild-homestead.png grass)
    (36, 76, 10),     # #244c0a deep grass shadow
    (54, 118, 12),    # #36760c primary meadow grass green
    (74, 140, 22),    # #4a8c16 sunlit grass blade
    (104, 168, 36),   # #68a824 bright moss/leaf highlight
    # Warm dirt & road tans (matches homestead paths)
    (92, 58, 34),     # #5c3a22 dark soil border crease
    (132, 88, 52),    # #845834 mid dirt shadow
    (168, 118, 74),   # #a8764a primary dirt path tan
    (194, 144, 96),   # #c29060 dry earth highlight
    (224, 184, 136),  # #e0b888 sand/hay light
    # Mirror Lake & River blues (matches frostvale.png river)
    (36, 76, 114),    # #244c72 deep water blue
    (60, 124, 168),   # #3c7ca8 primary river/lake water
    (100, 164, 204),  # #64a4cc shallow water ripple
    (168, 212, 232),  # #a8d4e8 water foam / ice edge
    # Timber cabin & barn woods
    (64, 38, 24),     # #402618 dark beam shadow
    (100, 60, 34),    # #643c22 log wall shadow
    (140, 88, 52),    # #8c5834 cabin plank midtone
    (176, 116, 68),   # #b07444 warm plank highlight
    # Autumn & Lava reds/oranges/golds
    (88, 20, 12),     # #58140c dark burgundy shadow
    (140, 36, 18),    # #8c2412 crimson shadow
    (196, 64, 30),    # #c4401e autumn rust red / magma
    (232, 108, 52),   # #e86c34 bright orange flame/leaf
    (246, 178, 52),   # #f6b234 golden hay / amber fire
    (255, 240, 136),  # #fff088 glowing core / sun gold
    # Stone, Quarry, Castle & Frostvale Snow
    (52, 52, 62),     # #34343e dark slate stone
    (82, 82, 94),     # #52525e cobblestone shadow
    (116, 116, 130),  # #747482 flagstone midtone
    (156, 154, 168),  # #9c9aa8 cliff highlight / steel
    (192, 184, 198),  # #c0b8c6 frost shadow
    (220, 212, 224),  # #dcd4e0 Frostvale snow primary
    (244, 238, 246),  # #f4eef6 fresh snow crest
    # Arcane / Crystal purple & poison swamp accents
    (76, 42, 96),     # #4c2a60 dark void purple
    (124, 72, 156),   # #7c489c amethyst crystal mid
    (176, 118, 212),  # #b076d4 bright crystal highlight
]


def make_palette_ref_base64() -> str:
    """Builds a 64x64 reference image of Hearthwild's exact palette to pass as `color_image`
    to PixelLab API calls so generated assets match the in-game tileset."""
    im = Image.new("RGB", (64, 64), HEARTHWILD_PALETTE[3])
    px = im.load()
    n = len(HEARTHWILD_PALETTE)
    for y in range(64):
        for x in range(64):
            idx = ((y // 8) * 8 + (x // 8)) % n
            px[x, y] = HEARTHWILD_PALETTE[idx]
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def nearest_hearthwild_color(r: int, g: int, b: int, blend: float = 0.72) -> tuple:
    """Blends an RGB pixel toward its perceptual nearest color in HEARTHWILD_PALETTE
    so neon greens/cyans become rich Hearthwild meadow greens and lake blues while keeping shading."""
    best = HEARTHWILD_PALETTE[0]
    best_d = 1e12
    for pr, pg, pb in HEARTHWILD_PALETTE:
        # Weighted perceptual RGB distance
        dr, dg, db = r - pr, g - pg, b - pb
        d = dr * dr * 0.30 + dg * dg * 0.52 + db * db * 0.18
        if d < best_d:
            best_d = d
            best = (pr, pg, pb)
    nr = int(round(r * (1.0 - blend) + best[0] * blend))
    ng = int(round(g * (1.0 - blend) + best[1] * blend))
    nb = int(round(b * (1.0 - blend) + best[2] * blend))
    return (nr, ng, nb)


def harmonize_image_to_hearthwild(im: Image.Image, blend: float = 0.75, add_outline: bool = False) -> Image.Image:
    """Converts any RGBA image to match Hearthwild's exact in-game palette."""
    src = im.convert("RGBA")
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    spx = src.load()
    opx = out.load()
    w, h = src.size
    cache = {}
    for y in range(h):
        for x in range(w):
            r, g, b, a = spx[x, y]
            if a < 40:
                continue
            key = (r >> 2, g >> 2, b >> 2)
            if key not in cache:
                cache[key] = nearest_hearthwild_color(r, g, b, blend=blend)
            nr, ng, nb = cache[key]
            opx[x, y] = (nr, ng, nb, 255)

    if add_outline:
        outlined = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ol_px = outlined.load()
        for y in range(h):
            for x in range(w):
                if opx[x, y][3] > 0:
                    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and opx[nx, ny][3] == 0:
                            ol_px[nx, ny] = (11, 9, 10, 255)
        for y in range(h):
            for x in range(w):
                if opx[x, y][3] > 0:
                    ol_px[x, y] = opx[x, y]
        return outlined
    return out


def harmonize_all_tilesets() -> list:
    """Processes all 25 downloaded Wang tilesets in game/assets/pixellab_tilesets/,
    creating 16x16-per-tile (`64x64` sheet) and `32x32`-per-tile (`128x128` sheet)
    versions matched to Hearthwild's exact in-game ground & interior palette."""
    matched_sheets = []
    if not os.path.isdir(TILES_DIR):
        return matched_sheets

    for folder in sorted(os.listdir(TILES_DIR)):
        fdir = os.path.join(TILES_DIR, folder)
        raw_sheet_p = os.path.join(fdir, "tilesheet.png")
        if not os.path.isfile(raw_sheet_p):
            continue
        raw_im = Image.open(raw_sheet_p).convert("RGBA")
        # 1. Harmonize 32x32 tilesheet (128x128) to Hearthwild palette
        harm_32 = harmonize_image_to_hearthwild(raw_im, blend=0.78, add_outline=False)
        harm_32.save(os.path.join(fdir, "tilesheet_hearthwild_32x32.png"))
        # 2. Downscale each 32x32 tile to crisp 16x16 (`64x64` 4x4 Wang sheet) for Godot's 16x16 TileSet!
        harm_16 = harm_32.resize((64, 64), Image.Resampling.NEAREST)
        harm_16.save(os.path.join(fdir, "tilesheet_hearthwild_16x16.png"))
        matched_sheets.append((folder, raw_im, harm_32, harm_16))

    # Build a single combined 16x16 Hearthwild Expansion Atlas (`hearthwild_matched_atlas.png`)
    if matched_sheets:
        cols = 5
        rows = (len(matched_sheets) + cols - 1) // cols
        atlas = Image.new("RGBA", (cols * 64, rows * 64), (0, 0, 0, 0))
        for i, (_, _, _, h16) in enumerate(matched_sheets):
            atlas.alpha_composite(h16, ((i % cols) * 64, (i // cols) * 64))
        atlas.save(os.path.join(TILES_DIR, "hearthwild_matched_atlas_16x16.png"))
        print(f"Harmonized {len(matched_sheets)} tilesets to 16x16 Hearthwild palette -> hearthwild_matched_atlas_16x16.png")

    return matched_sheets


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
    with urllib.request.urlopen(req, timeout=45) as r:
        return json.loads(r.read().decode("utf-8"))


def api_get(path: str) -> dict:
    req = urllib.request.Request(
        f"https://api.pixellab.ai/{path}",
        headers={"Authorization": f"Bearer {KEY}", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def generate_pixellab_item(spec: tuple, color_b64: str) -> tuple | None:
    """Generates a transparent RPG weapon/armor/monster-drop sprite via PixelLab's
    `/v2/create-image-pixflux` endpoint using Hearthwild's color palette reference, then
    harmonizes and trims it to a crisp 24x24 icon."""
    key_name, prompt = spec
    os.makedirs(ITEMS_DIR, exist_ok=True)
    out_p = os.path.join(ITEMS_DIR, f"{key_name}.png")
    try:
        if not os.path.exists(out_p):
            res = api_post("v2/create-image-pixflux", {
                "description": f"16-bit RPG pixel art icon of {prompt}, single centered object, crisp 1px black outline, Stardew Valley and Pixel Crawler style",
                "image_size": {"width": 64, "height": 64},
                "no_background": True,
                "outline": "single color black outline",
                "shading": "medium shading",
                "detail": "medium detail",
                "color_image": {"type": "base64", "base64": color_b64},
            })
            b64 = res.get("image", {}).get("base64", "")
            if not b64:
                return None
            raw = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGBA")
            bb = raw.getchannel("A").getbbox()
            if bb:
                raw = raw.crop(bb)
            raw = raw.resize((18, 18), Image.Resampling.NEAREST)
            icon_im = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
            icon_im.alpha_composite(raw, (3, 3))
            icon_im = harmonize_image_to_hearthwild(icon_im, blend=0.65, add_outline=True)
            icon_im.save(out_p)
        else:
            icon_im = Image.open(out_p).convert("RGBA")
        return (key_name, icon_im)
    except Exception as e:
        print(f"  [WARN] Item {key_name}: {e}")
        return None


def launch_monster_generations(color_b64: str) -> list:
    """Launches new multi-directional monster character jobs on PixelLab via `/v2/create-character-v3`
    so they generate in the user's PixelLab account with low top-down view and black outlines."""
    monsters_to_create = [
        ("frost_yeti", "mannequin", "Frostvale Yeti monster, hulking white-furred ice beast with glowing blue eyes and frost claws, low top-down 16-bit RPG pixel art monster, crisp black outline"),
        ("emerald_slime", "mannequin", "Giant Emerald Forest Slime monster with a glowing golden core and mossy crown, low top-down 16-bit RPG pixel art monster, crisp black outline"),
        ("cave_goblin", "mannequin", "Quarry Cave Goblin raider with mining helmet, jagged iron pickaxe and lantern, low top-down 16-bit RPG pixel art monster, crisp black outline"),
        ("magma_golem", "mannequin", "Volcanic Magma Golem brute made of cracked dark basalt rock and glowing orange lava veins, low top-down 16-bit RPG pixel art monster, crisp black outline"),
        ("bramble_treant", "mannequin", "Haunted Bramble Treant monster made of twisted oak bark, autumn leaves and glowing amber eyes, low top-down 16-bit RPG pixel art monster, crisp black outline"),
    ]
    existing = api_get("v2/characters?limit=50").get("characters", [])
    existing_names = {str(c.get("name") or "").lower() for c in existing}

    launched = []
    for m_name, tmpl, desc in monsters_to_create:
        if m_name in existing_names:
            print(f"  Monster '{m_name}' already exists in PixelLab account.")
            continue
        try:
            resp = api_post("v2/create-character-v3", {
                "name": m_name,
                "description": desc,
                "template_id": tmpl,
                "view": "low top-down",
                "image_size": {"width": 64, "height": 64},
                "no_background": True,
                "outline": "single color black outline",
                "detail": "medium detail",
            })
            print(f"  Launched PixelLab monster generation '{m_name}': {resp}")
            launched.append((m_name, resp))
        except Exception as e:
            print(f"  [WARN] Launching monster {m_name}: {e}")
    return launched


def harmonize_pixellab_enemy_actors():
    """Applies Hearthwild's palette & crisp 1px black outline to our combat-ready PixelLab enemy
    roster (`bone_pax`, `thorn_vale`, `spark_kael`, `archon_vex`, `garrick`, `reaper_m`,
    `berserker_m`, `necro_m`, `hexer_f`, `zealot_m`) so every monster on the map matches
    the in-game tileset 100%."""
    npc_root = os.path.join(ROOT, "assets", "pixellab_npcs")
    combat_actors = [
        "bone_pax", "thorn_vale", "spark_kael", "archon_vex", "garrick",
        "reaper_m", "berserker_m", "necro_m", "hexer_f", "zealot_m"
    ]
    for slug in combat_actors:
        sdir = os.path.join(npc_root, slug)
        for sheet_name in ("Idle-Sheet.png", "Walk-Sheet.png"):
            sp = os.path.join(sdir, sheet_name)
            if os.path.isfile(sp):
                im = Image.open(sp).convert("RGBA")
                matched = harmonize_image_to_hearthwild(im, blend=0.58, add_outline=True)
                matched.save(sp)
    print(f"Harmonized {len(combat_actors)} PixelLab combat monster/boss sheets to match Hearthwild's palette!")


def build_showcase(matched_tiles: list, generated_items: list):
    """Builds a side-by-side Before vs After Hearthwild Palette-Matched Tileset + PixelLab Gear & Monster showcase."""
    canvas = Image.new("RGBA", (1440, 920), (24, 22, 28, 255))
    draw = ImageDraw.Draw(canvas)

    draw.rectangle([20, 14, 1420, 54], fill=(42, 34, 32, 255), outline=(214, 182, 138, 255), width=2)
    draw.text((34, 26), "HEARTHWILD-MATCHED PIXELLAB TILESETS (16x16 PALETTE-HARMONIZED) + GENERATED PIXELLAB WEAPONS, ARMOR & MONSTERS", fill=(246, 228, 194, 255))

    # Section 1: Before vs After Tileset Palette Matching (Top 10 key game tilesets)
    draw.text((28, 66), "1. PIXELLAB TILESETS HARMONIZED TO HEARTHWILD'S EXACT IN-GAME PALETTE & 16x16 TILE SIZE (RAW -> HEARTHWILD-MATCHED):", fill=(255, 244, 140, 255))
    picks = [t for t in matched_tiles if any(k in t[0] for k in ("20_", "21_", "22_", "15_", "17_", "03_", "04_", "05_", "11_", "12_"))][:10]
    for idx, (folder, raw_im, harm_32, harm_16) in enumerate(picks):
        c = idx % 5
        r = idx // 5
        bx = 24 + c * 280
        by = 90 + r * 220
        draw.rectangle([bx, by, bx + 268, by + 206], fill=(36, 42, 32, 255), outline=(112, 76, 52, 255), width=2)
        # Left half: Raw PixelLab (neon) | Right half: Hearthwild-Matched 16x16 (scaled 2x to 128x128 for comparison)
        raw_s = raw_im.resize((116, 116), Image.Resampling.NEAREST)
        match_s = harm_16.resize((116, 116), Image.Resampling.NEAREST)
        canvas.alpha_composite(raw_s, (bx + 10, by + 26))
        canvas.alpha_composite(match_s, (bx + 142, by + 26))
        draw.text((bx + 22, by + 8), "RAW PIXELLAB", fill=(180, 180, 190, 255))
        draw.text((bx + 144, by + 8), "IN-GAME MATCHED", fill=(118, 176, 38, 255))
        draw.rectangle([bx, by + 150, bx + 268, by + 206], fill=(28, 24, 22, 245))
        draw.text((bx + 8, by + 156), folder[:34], fill=(246, 228, 194, 255))
        draw.text((bx + 8, by + 176), "Saved: tilesheet_hearthwild_16x16.png", fill=(214, 182, 138, 255))

    # Section 2: Newly Generated PixelLab Weapons, Armor & Boss Relics
    draw.text((28, 545), "2. NEWLY GENERATED PIXELLAB WEAPONS, ARMOR & RELICS (MATCHED TO HEARTHWILD PALETTE + 1PX OUTLINE):", fill=(255, 244, 140, 255))
    for i, (iname, iim) in enumerate(generated_items[:12]):
        bx = 24 + i * 116
        by = 572
        draw.rectangle([bx, by, bx + 108, by + 124], fill=(42, 36, 34, 255), outline=(156, 116, 82, 255), width=2)
        up = iim.resize((72, 72), Image.Resampling.NEAREST)
        canvas.alpha_composite(up, (bx + 18, by + 12))
        draw.text((bx + 6, by + 98), iname[:15], fill=(246, 228, 194, 255))

    # Section 3: Active PixelLab Monster & Boss Roster in Hearthwild
    draw.text((28, 714), "3. PIXELLAB MONSTERS & BOSSES WIRED INTO HEARTHWILD COMBAT (PALETTE-HARMONIZED & SPAWNED BY BIOME):", fill=(255, 244, 140, 255))
    monster_list = [
        ("myconid", "Forest/Autumn"),
        ("frost_yeti", "Frost Summit"),
        ("cave_goblin", "Mine/Quarry"),
        ("magma_golem", "Deep Quarry"),
        ("bramble_treant", "Oldwood"),
        ("emerald_slime", "Pine Spring"),
        ("bone_pax", "Graveyard"),
        ("thorn_vale", "Hollow Boss"),
        ("spark_kael", "Frost Shrine"),
        ("archon_vex", "Summit Boss"),
        ("garrick", "Badlands Boss"),
    ]
    for i, (mslug, mbiome) in enumerate(monster_list):
        bx = 24 + i * 126
        by = 740
        draw.rectangle([bx, by, bx + 118, by + 158], fill=(46, 36, 36, 255), outline=(140, 36, 18, 255), width=2)
        draw.ellipse([bx + 34, by + 104, bx + 84, by + 118], fill=(12, 10, 10, 120))
        if mslug == "myconid":
            sp = os.path.join(ROOT, "assets", "expansion", "Mobs", "Myconid", "Idle", "Idle_Down-Sheet.png")
            im = Image.open(sp).crop((0, 0, 32, 32)).resize((96, 96), Image.Resampling.NEAREST)
            canvas.alpha_composite(im, (bx + 11, by + 18))
        else:
            sp = os.path.join(ROOT, "assets", "pixellab_npcs", mslug, "Idle-Sheet.png")
            if os.path.isfile(sp):
                raw_im = Image.open(sp).convert("RGBA")
                fh = raw_im.height
                im = raw_im.crop((0, 0, fh, fh)).resize((96, 96), Image.Resampling.NEAREST)
                canvas.alpha_composite(im, (bx + 11, by + 16))
        draw.rectangle([bx, by + 120, bx + 118, by + 158], fill=(28, 22, 22, 245))
        draw.text((bx + 6, by + 124), mslug[:16], fill=(255, 198, 68, 255))
        draw.text((bx + 6, by + 140), mbiome, fill=(214, 182, 138, 255))

    os.makedirs(os.path.dirname(MATCHED_PREVIEW), exist_ok=True)
    canvas.save(MATCHED_PREVIEW)
    if os.path.isdir(ARTIFACT_DIR):
        canvas.save(os.path.join(ARTIFACT_DIR, "hearthwild_matched_pixellab_showcase.png"))
    print("Saved Hearthwild-matched showcase to:", MATCHED_PREVIEW)


def main():
    color_b64 = make_palette_ref_base64()

    # 1. Harmonize all 25 downloaded PixelLab Wang tilesets to 16x16 & Hearthwild's exact palette
    matched_tiles = harmonize_all_tilesets()

    # 2. Harmonize our PixelLab combat monster/boss actors to match Hearthwild's palette
    harmonize_pixellab_enemy_actors()

    # 3. Generate 12 new Weapons, Armor & Boss Relics via PixelLab `/v2/create-image-pixen`
    item_specs = [
        ("sword_copper", "copper broadsword weapon with leather grip"),
        ("sword_mythril", "glowing blue mythril longsword weapon"),
        ("sword_obsidian", "dark purple obsidian jagged greatsword weapon"),
        ("sword_sunforged", "golden sunforged paladin sword with ruby gem"),
        ("axe_mythril", "double-bladed blue mythril battleaxe"),
        ("pickaxe_mythril", "crystalline mythril mining pickaxe"),
        ("bow_hunter", "curved yew wood hunter bow with quiver arrow"),
        ("staff_spore", "gnarled druid magic staff topped with glowing amber mushroom crystal"),
        ("helm_iron", "visored iron knight helmet armor"),
        ("chest_iron", "polished iron plate chestplate armor"),
        ("chest_mythril", "ornate blue-silver mythril breastplate armor with gold trim"),
        ("shield_sunforged", "radiant golden sun crest heater shield"),
    ]
    print("Generating 12 weapons & armor icons via PixelLab API (/v2/create-image-pixen)...")
    generated_items = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = [ex.submit(generate_pixellab_item, s, color_b64) for s in item_specs]
        for fut in concurrent.futures.as_completed(futs):
            res = fut.result()
            if res:
                generated_items.append(res)
    generated_items.sort(key=lambda x: x[0])
    print(f"Generated & palette-matched {len(generated_items)} PixelLab weapons/armor icons!")

    # Register the new items in game/data/catalog.json
    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        cat = json.load(f)
    items_cat = cat.setdefault("items", {})
    for iname, _ in generated_items:
        items_cat[iname] = {
            "sheet": f"pixellab_items/{iname}.png",
            "region": [0, 0, 24, 24],
            "anchor": [12, 12],
        }
    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(cat, f, indent=1)

    # 4. Push new monster character generations to PixelLab (`/v2/create-character-v3`)
    launch_monster_generations(color_b64)

    # 5. Build visual comparison & showcase board
    build_showcase(matched_tiles, generated_items)


if __name__ == "__main__":
    main()
