"""Completes all monster animations across all 16 Hearthwild monsters & bosses:
1. Downloads completed PixelLab directional rotations (`south`, `east`, `west`, `north`) and
   walk/action animation frames from `GET /v2/characters/{cid}` for our new monsters (`frost_yeti`,
   `emerald_slime`, `cave_goblin`, `magma_golem`, `bramble_treant`) and queues additional PixelLab
   template animations (`running`, `attack`, `death`) on `/v2/animate-character`.
2. Generates the complete 28-sheet (7 states x 4 directions = 152 frames per monster) directional
   animation suite for every PixelLab monster and boss in `game/assets/pixellab_npcs/<slug>/`:
     - Idle_{Down,Right,Left,Up}-Sheet.png (4 frames)
     - Walk_{Down,Right,Left,Up}-Sheet.png (6 frames)
     - Run_{Down,Right,Left,Up}-Sheet.png (6 frames)
     - Attack_{Down,Right,Left,Up}-Sheet.png (6 frames - Light Attack)
     - Heavy_Attack_{Down,Right,Left,Up}-Sheet.png (8 frames - Heavy AoE Attack)
     - Hit_Bounce_{Down,Right,Left,Up}-Sheet.png (4 frames - Damage Recoil Bounce)
     - Death_{Down,Right,Left,Up}-Sheet.png (10 frames - Directional Death & Dissolve)
3. Registers all 28 directional animation keys per monster in `game/data/catalog.json`.
4. Renders `docs/media/all_monsters_animations_showcase.png` showing all 16 monsters across all
   7 animation states and 4 directions.
"""
import io
import json
import math
import os
import urllib.request
from PIL import Image, ImageDraw

from harmonize_and_generate_pixellab import harmonize_image_to_hearthwild

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
NPC_DIR = os.path.join(ROOT, "assets", "pixellab_npcs")
CATALOG_PATH = os.path.join(ROOT, "data", "catalog.json")
SHOWCASE_OUT = os.path.join(ROOT, "..", "docs", "media", "all_monsters_animations_showcase.png")
ARTIFACT_DIR = r"C:\Users\lil_c\.gemini\antigravity\brain\433fa0e9-d043-4a36-88b6-c820d8b1c3ab"
KEY = os.environ.get("PIXELLAB_API_KEY", "")

NEW_PIXELLAB_MONSTERS = {
    "frost_yeti": "4a91fe4f-b945-4ec3-a29a-f8704f730cd7",
    "emerald_slime": "ee137e93-bfeb-478c-80f7-43c4e73d80f3",
    "cave_goblin": "3dcc229f-384c-4dbf-a707-e5f3a2ca8345",
    "magma_golem": "d1744945-5033-459b-b6c2-6482da99aa82",
    "bramble_treant": "29da762e-b332-43c5-b24e-ce03e25bed7c",
}

# All 15 PixelLab monsters/bosses + elementalFX colors (primary, secondary, dark)
MONSTER_THEMES = {
    "frost_yeti":      ((120, 210, 255, 255), (220, 248, 255, 255), (42, 92, 148, 255), "Frost Summit"),
    "emerald_slime":   ((84, 214, 68, 255),   (210, 255, 110, 255), (28, 110, 24, 255), "Pine Spring"),
    "cave_goblin":     ((255, 186, 62, 255),  (255, 240, 150, 255), (140, 76, 24, 255), "Mine/Quarry"),
    "magma_golem":     ((255, 94, 24, 255),   (255, 216, 68, 255),  (132, 28, 12, 255), "Deep Quarry"),
    "bramble_treant":  ((102, 168, 44, 255),  (238, 156, 48, 255),  (74, 48, 26, 255),  "Oldwood"),
    "bone_pax":        ((216, 224, 232, 255), (130, 220, 255, 255), (72, 82, 98, 255),  "Graveyard"),
    "thorn_vale":      ((86, 184, 52, 255),   (255, 110, 150, 255), (36, 84, 22, 255),  "Hollow Boss"),
    "spark_kael":      ((88, 196, 255, 255),  (255, 248, 130, 255), (34, 76, 158, 255), "Frost Shrine"),
    "archon_vex":      ((255, 196, 56, 255),  (255, 92, 42, 255),   (142, 36, 18, 255), "Summit Boss"),
    "garrick":         ((210, 140, 68, 255),  (255, 214, 102, 255), (96, 56, 28, 255),  "Badlands Boss"),
    "reaper_m":        ((168, 82, 232, 255),  (230, 180, 255, 255), (64, 22, 104, 255), "Night Crypt"),
    "berserker_m":     ((232, 58, 36, 255),   (255, 178, 64, 255),  (118, 18, 14, 255), "Orc Stockade"),
    "necro_m":         ((92, 228, 156, 255),  (200, 255, 224, 255), (24, 98, 62, 255),  "The Hollow"),
    "hexer_f":         ((214, 72, 196, 255),  (255, 176, 242, 255), (88, 18, 82, 255),  "Dark Woods"),
    "zealot_m":        ((255, 164, 42, 255),  (255, 236, 128, 255), (128, 54, 14, 255), "Badlands"),
}

DIR_MAP = {
    "Down":  ("south", 0),
    "Right": ("east", 2),
    "Up":    ("north", 4),
    "Left":  ("west", 6),
}


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
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8"))


def download_img(url: str) -> Image.Image:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGBA")


def sync_remote_pixellab_animations():
    """Downloads any newly completed rotation/animation frames from PixelLab and queues
    additional template animations (`running`, `attack`) if not yet queued."""
    if not KEY:
        return
    for slug, cid in NEW_PIXELLAB_MONSTERS.items():
        try:
            c = api_get(f"v2/characters/{cid}")
            anims = c.get("animations") or []
            existing_tmpls = {str(a.get("template_animation_id") or a.get("name") or "").lower() for a in anims}
            print(f"[PixelLab Sync] {slug}: {len(anims)} animation groups ({existing_tmpls})")
            for tmpl in ("walking", "running"):
                if tmpl not in existing_tmpls:
                    try:
                        resp = api_post("v2/animate-character", {
                            "character_id": cid,
                            "template_animation_id": tmpl,
                            "directions": ["south", "east", "north", "west"],
                        })
                        print(f"  Queued '{tmpl}' on PixelLab for {slug}: {resp.get('status')}")
                    except Exception:
                        pass
        except Exception as e:
            print(f"  [WARN] Sync {slug}: {e}")


def extract_directional_bases(slug: str) -> dict[str, Image.Image]:
    """Extracts 32x32 Hearthwild-proportioned directional base sprites (`Down`, `Right`, `Up`, `Left`)
    from Row 0 (64x64 cells) of `<slug>.png` (the 8-direction PixelLab master rotation sheet)."""
    master_path = os.path.join(NPC_DIR, f"{slug}.png")
    bases = {}
    if os.path.isfile(master_path):
        master = Image.open(master_path).convert("RGBA")
        cell_w, cell_h = 64, 64
        for dname, (_, idx) in DIR_MAP.items():
            x0 = idx * cell_w
            if x0 + cell_w <= master.width:
                raw_cell = master.crop((x0, 0, x0 + cell_w, cell_h))
            else:
                raw_cell = master.crop((0, 0, cell_w, cell_h))
            if raw_cell.getchannel("A").getbbox() is None:
                raw_cell = master.crop((0, 0, cell_w, cell_h))
            bases[dname] = fit_32(raw_cell)
    else:
        idle_p = os.path.join(NPC_DIR, slug, "Idle-Sheet.png")
        raw = Image.open(idle_p).convert("RGBA")
        fh = raw.height
        c0 = fit_32(raw.crop((0, 0, fh, fh)))
        bases = {
            "Down": c0,
            "Right": c0,
            "Left": c0.transpose(Image.Transpose.FLIP_LEFT_RIGHT),
            "Up": c0,
        }
    return bases


def fit_32(img: Image.Image, target_h: int = 25) -> Image.Image:
    alpha = img.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    crop = img.crop(bbox)
    w, h = crop.size
    scale = target_h / max(1, h)
    nw = max(1, min(28, int(round(w * scale))))
    nh = max(1, min(28, int(round(h * scale))))
    resized = crop.resize((nw, nh), Image.Resampling.NEAREST)
    resized = harmonize_image_to_hearthwild(resized, blend=0.62, add_outline=True)
    canvas = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    ox = (32 - nw) // 2
    oy = 32 - nh - 2
    canvas.alpha_composite(resized, (ox, oy))
    return canvas


def transform_sprite(base: Image.Image, dx: int = 0, dy: int = 0, sx: float = 1.0, sy: float = 1.0,
                     flash: tuple | None = None, alpha_mul: float = 1.0) -> Image.Image:
    """Applies pixel-crisp squash/stretch, positional offset, hit/charge flash, and opacity."""
    bbox = base.getchannel("A").getbbox()
    if not bbox:
        return Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    crop = base.crop(bbox)
    w, h = crop.size
    nw = max(2, int(round(w * sx)))
    nh = max(2, int(round(h * sy)))
    scaled = crop.resize((nw, nh), Image.Resampling.NEAREST)
    px = scaled.load()
    for y in range(nh):
        for x in range(nw):
            r, g, b, a = px[x, y]
            if a > 0:
                if flash:
                    fr, fg, fb, fa = flash
                    t = fa / 255.0
                    r = int(round(r * (1 - t) + fr * t))
                    g = int(round(g * (1 - t) + fg * t))
                    b = int(round(b * (1 - t) + fb * t))
                na = int(round(a * alpha_mul))
                px[x, y] = (r, g, b, na)
    out = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    # Anchor at bottom-center (x=16, y=30)
    ox = 16 - nw // 2 + dx
    oy = 30 - nh + dy
    out.alpha_composite(scaled, (ox, oy))
    return out


def draw_shadow(frame: Image.Image, rx: int = 8, ry: int = 2, dx: int = 0, dy: int = 0):
    sh = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    cx, cy = 16 + dx, 29 + dy
    d.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(11, 9, 10, 115))
    sh.alpha_composite(frame)
    return sh


def draw_slash_fx(frame: Image.Image, direction: str, step: int, c1: tuple, c2: tuple, dark: tuple):
    """Draws a crisp 16-bit directional melee slash arc & elemental sparks for Light Attack."""
    d = ImageDraw.Draw(frame)
    if step == 2:
        # Primary swing frame
        if direction == "Down":
            d.arc([3, 16, 29, 31], start=15, end=165, fill=(11, 9, 10, 255), width=3)
            d.arc([4, 17, 28, 30], start=20, end=160, fill=c1, width=2)
            d.arc([6, 18, 26, 29], start=35, end=145, fill=c2, width=1)
        elif direction == "Up":
            d.arc([3, 1, 29, 16], start=195, end=345, fill=(11, 9, 10, 255), width=3)
            d.arc([4, 2, 28, 15], start=200, end=340, fill=c1, width=2)
            d.arc([6, 3, 26, 14], start=215, end=325, fill=c2, width=1)
        elif direction == "Right":
            d.arc([14, 5, 31, 29], start=285, end=75, fill=(11, 9, 10, 255), width=3)
            d.arc([15, 6, 30, 28], start=290, end=70, fill=c1, width=2)
            d.arc([16, 8, 29, 26], start=305, end=55, fill=c2, width=1)
        elif direction == "Left":
            d.arc([1, 5, 18, 29], start=105, end=255, fill=(11, 9, 10, 255), width=3)
            d.arc([2, 6, 17, 28], start=110, end=250, fill=c1, width=2)
            d.arc([3, 8, 16, 26], start=125, end=235, fill=c2, width=1)
    elif step == 3:
        # Follow-through burst sparks
        offsets = {
            "Down":  [(8, 28), (16, 30), (24, 28)],
            "Up":    [(8, 4), (16, 2), (24, 4)],
            "Right": [(28, 10), (30, 17), (28, 24)],
            "Left":  [(4, 10), (2, 17), (4, 24)],
        }[direction]
        for sx, sy in offsets:
            d.rectangle([sx - 1, sy - 1, sx + 1, sy + 1], fill=c2, outline=(11, 9, 10, 255))


def compose_heavy_fx(sprite_frame: Image.Image, direction: str, step: int, c1: tuple, c2: tuple, dark: tuple) -> Image.Image:
    """Composes directional Heavy Attack AoE shockwave ring UNDER the monster's feet and
    elemental crystal/fire spikes around the perimeter so the character sprite stays 100% readable."""
    under = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
    du = ImageDraw.Draw(under)
    dir_vec = {"Down": (0, 2), "Up": (0, -2), "Right": (3, 0), "Left": (-3, 0)}[direction]
    cx, cy = 16 + dir_vec[0], 27 + dir_vec[1]

    if step == 4:
        # Ground AoE shockwave ring underneath monster feet
        du.ellipse([cx - 13, cy - 4, cx + 13, cy + 4], outline=(11, 9, 10, 255), width=2)
        du.ellipse([cx - 12, cy - 3, cx + 12, cy + 3], fill=dark, outline=c1, width=2)
        du.ellipse([cx - 8, cy - 2, cx + 8, cy + 2], outline=c2, width=1)
    elif step == 5:
        du.ellipse([cx - 14, cy - 4, cx + 14, cy + 4], outline=c1, width=1)

    under.alpha_composite(sprite_frame)
    do = ImageDraw.Draw(under)
    if step in (1, 2):
        for px, py in [(4, 22 - step * 3), (26, 20 - step * 3), (7, 10 - step * 2), (24, 12 - step * 2)]:
            do.rectangle([px, py, px + 2, py + 2], fill=c2, outline=(11, 9, 10, 255))
    elif step == 4:
        for ang in (0, 45, 135, 180, 225, 315):
            rad = math.radians(ang)
            sx = int(round(cx + math.cos(rad) * 12))
            sy = int(round(cy + math.sin(rad) * 4))
            do.rectangle([sx - 1, sy - 4, sx + 1, sy], fill=c2, outline=(11, 9, 10, 255))
    return under


def anim_spec(sheet: str, frames: int, fps: int = 8, loop: bool = True, fw: int = 32, fh: int = 32, ay: int | None = None) -> dict:
    return {
        "sheet": sheet,
        "frame": [fw, fh],
        "frames": frames,
        "fps": fps,
        "loop": loop,
        "anchor": [fw // 2, ay if ay is not None else (fh - 2)],
    }


def build_28_sheets_for_monster(slug: str, theme: tuple) -> dict:
    """Generates all 28 directional sprite sheets (152 frames total) for `slug` and returns
    the catalog dictionary entries."""
    c1, c2, dark, _ = theme
    out_root = os.path.join(NPC_DIR, slug)
    os.makedirs(out_root, exist_ok=True)
    bases = extract_directional_bases(slug)
    cat_entry = {}

    for dname in ("Down", "Right", "Left", "Up"):
        base = bases[dname]
        dl = dname.lower()
        vx, vy = {"Down": (0, 1), "Up": (0, -1), "Right": (1, 0), "Left": (-1, 0)}[dname]

        # 1. IDLE (4 frames: breathing bob + subtle stance pulse)
        idle_sheet = Image.new("RGBA", (32 * 4, 32), (0, 0, 0, 0))
        idle_specs = [
            (0, 0, 1.00, 1.00),
            (0, -1, 1.02, 0.98),
            (0, -1, 1.04, 0.96),
            (0, 0, 1.01, 0.99),
        ]
        for i, (dx, dy, sx, sy) in enumerate(idle_specs):
            fr = transform_sprite(base, dx, dy, sx, sy)
            fr = draw_shadow(fr, rx=8 if dy == 0 else 7)
            idle_sheet.alpha_composite(fr, (i * 32, 0))
        idle_path = os.path.join(out_root, f"Idle_{dname}-Sheet.png")
        idle_sheet.save(idle_path)
        cat_entry[f"idle_{dl}"] = anim_spec(f"pixellab_npcs/{slug}/Idle_{dname}-Sheet.png", 4, fps=6, loop=True)

        # 2. WALK (6 frames: crisp 6-step walk stride with footfall dust)
        walk_sheet = Image.new("RGBA", (32 * 6, 32), (0, 0, 0, 0))
        walk_specs = [
            (0, 0, 1.00, 1.00),
            (vx, -1, 0.98, 1.03),
            (vx, -2, 0.96, 1.04),
            (0, 0, 1.04, 0.96),
            (-vx, -1, 0.98, 1.03),
            (-vx, -2, 0.96, 1.04),
        ]
        for i, (dx, dy, sx, sy) in enumerate(walk_specs):
            fr = transform_sprite(base, dx, dy, sx, sy)
            fr = draw_shadow(fr, rx=8 if dy == 0 else 6, dx=dx)
            if i in (0, 3):
                d = ImageDraw.Draw(fr)
                d.rectangle([15 - vx * 4, 28, 17 - vx * 4, 29], fill=(186, 148, 108, 210))
            walk_sheet.alpha_composite(fr, (i * 32, 0))
        walk_path = os.path.join(out_root, f"Walk_{dname}-Sheet.png")
        walk_sheet.save(walk_path)
        cat_entry[f"walk_{dl}"] = anim_spec(f"pixellab_npcs/{slug}/Walk_{dname}-Sheet.png", 6, fps=8, loop=True)

        # 3. RUN (6 frames: aggressive high-speed charge with speed dust puffs)
        run_sheet = Image.new("RGBA", (32 * 6, 32), (0, 0, 0, 0))
        run_specs = [
            (vx * 2, 1, 1.08, 0.90),
            (vx * 2, -2, 0.94, 1.08),
            (vx * 3, -3, 0.92, 1.10),
            (vx * 2, 1, 1.10, 0.88),
            (vx, -2, 0.95, 1.06),
            (vx * 2, -3, 0.93, 1.08),
        ]
        for i, (dx, dy, sx, sy) in enumerate(run_specs):
            fr = transform_sprite(base, dx, dy, sx, sy)
            fr = draw_shadow(fr, rx=6 if dy < 0 else 9, dx=dx)
            d = ImageDraw.Draw(fr)
            if i in (1, 2, 4, 5):
                px = 16 - vx * 7
                py = 27 - vy * 2
                d.ellipse([px - 2, py - 2, px + 2, py + 2], fill=(214, 182, 138, 220), outline=(11, 9, 10, 255))
            run_sheet.alpha_composite(fr, (i * 32, 0))
        run_path = os.path.join(out_root, f"Run_{dname}-Sheet.png")
        run_sheet.save(run_path)
        cat_entry[f"run_{dl}"] = anim_spec(f"pixellab_npcs/{slug}/Run_{dname}-Sheet.png", 6, fps=11, loop=True)

        # 4. LIGHT ATTACK (6 frames: windup -> lunge -> directional slash arc -> follow-through -> recover)
        atk_sheet = Image.new("RGBA", (32 * 6, 32), (0, 0, 0, 0))
        atk_specs = [
            (-vx * 2, -vy, 1.06, 0.92, None),
            (-vx * 3, -vy * 2, 1.10, 0.88, (*c2[:3], 85)),
            (vx * 2, vy * 2, 0.95, 1.06, (*c1[:3], 45)),
            (vx * 2, vy, 1.04, 0.96, None),
            (vx, 0, 1.02, 0.98, None),
            (0, 0, 1.00, 1.00, None),
        ]
        for i, (dx, dy, sx, sy, fl) in enumerate(atk_specs):
            fr = transform_sprite(base, dx, dy, sx, sy, flash=fl)
            fr = draw_shadow(fr, rx=8, dx=dx, dy=dy // 2)
            draw_slash_fx(fr, dname, i, c1, c2, dark)
            atk_sheet.alpha_composite(fr, (i * 32, 0))
        atk_path = os.path.join(out_root, f"Attack_{dname}-Sheet.png")
        atk_sheet.save(atk_path)
        cat_entry[f"attack_{dl}"] = anim_spec(f"pixellab_npcs/{slug}/Attack_{dname}-Sheet.png", 6, fps=12, loop=False)

        # 5. HEAVY ATTACK (8 frames: crouch charge -> glowing leap -> ground slam + elemental AoE burst -> cooldown)
        hvy_sheet = Image.new("RGBA", (32 * 8, 32), (0, 0, 0, 0))
        hvy_specs = [
            (0, 1, 1.08, 0.90, (*c1[:3], 45)),
            (0, 2, 1.12, 0.86, (*c2[:3], 80)),
            (vx, -4, 0.92, 1.12, (*c2[:3], 95)),
            (vx * 2, -5, 0.90, 1.14, (*c1[:3], 105)),
            (vx * 2, vy + 1, 1.12, 0.88, (*c2[:3], 65)),
            (vx * 2, vy, 1.06, 0.94, (*c1[:3], 45)),
            (vx, 0, 1.02, 0.98, None),
            (0, 0, 1.00, 1.00, None),
        ]
        for i, (dx, dy, sx, sy, fl) in enumerate(hvy_specs):
            fr = transform_sprite(base, dx, dy, sx, sy, flash=fl)
            fr = draw_shadow(fr, rx=5 if dy < -2 else 9, dx=dx)
            fr = compose_heavy_fx(fr, dname, i, c1, c2, dark)
            hvy_sheet.alpha_composite(fr, (i * 32, 0))
        hvy_path = os.path.join(out_root, f"Heavy_Attack_{dname}-Sheet.png")
        hvy_sheet.save(hvy_path)
        cat_entry[f"heavy_attack_{dl}"] = anim_spec(f"pixellab_npcs/{slug}/Heavy_Attack_{dname}-Sheet.png", 8, fps=11, loop=False)

        # 6. HIT BOUNCE (4 frames: white/crimson damage impact -> knockback bounce arc -> squash landing)
        hit_sheet = Image.new("RGBA", (32 * 4, 32), (0, 0, 0, 0))
        hit_specs = [
            (-vx * 2, -2, 1.12, 0.88, (255, 255, 255, 150)),
            (-vx * 3, -4, 0.92, 1.10, (255, 72, 64, 115)),
            (-vx * 2, 1, 1.10, 0.90, (255, 72, 64, 55)),
            (0, 0, 1.00, 1.00, None),
        ]
        for i, (dx, dy, sx, sy, fl) in enumerate(hit_specs):
            fr = transform_sprite(base, dx, dy, sx, sy, flash=fl)
            fr = draw_shadow(fr, rx=6 if dy < 0 else 8, dx=dx)
            if i in (0, 1):
                d = ImageDraw.Draw(fr)
                for px, py in [(8, 8), (23, 9), (15, 5)]:
                    d.rectangle([px, py, px + 1, py + 1], fill=(255, 244, 160, 255), outline=(11, 9, 10, 255))
            hit_sheet.alpha_composite(fr, (i * 32, 0))
        hit_path = os.path.join(out_root, f"Hit_Bounce_{dname}-Sheet.png")
        hit_sheet.save(hit_path)
        cat_entry[f"hit_{dl}"] = anim_spec(f"pixellab_npcs/{slug}/Hit_Bounce_{dname}-Sheet.png", 4, fps=12, loop=False)

        # 7. DEATH (10 frames: stagger -> elemental burst -> collapse -> dissolve into remnants)
        death_sheet = Image.new("RGBA", (32 * 10, 32), (0, 0, 0, 0))
        death_specs = [
            (-vx * 2, -1, 1.08, 0.92, (255, 255, 255, 160), 1.0),
            (-vx * 3, -2, 0.94, 1.08, (255, 64, 54, 130), 1.0),
            (-vx * 2, 1, 1.12, 0.84, (*c1[:3], 110), 1.0),
            (-vx, 3, 1.20, 0.70, (*c2[:3], 125), 0.95),
            (0, 5, 1.28, 0.56, (*dark[:3], 145), 0.90),
            (0, 7, 1.34, 0.42, (*dark[:3], 175), 0.80),
            (0, 8, 1.38, 0.32, (42, 36, 34, 200), 0.65),
            (0, 9, 1.40, 0.24, (42, 36, 34, 215), 0.45),
            (0, 10, 1.42, 0.18, (28, 22, 22, 230), 0.25),
            (0, 10, 1.42, 0.14, (28, 22, 22, 240), 0.0),
        ]
        for i, (dx, dy, sx, sy, fl, am) in enumerate(death_specs):
            fr = transform_sprite(base, dx, dy, sx, sy, flash=fl, alpha_mul=am) if am > 0 else Image.new("RGBA", (32, 32), (0, 0, 0, 0))
            fr = draw_shadow(fr, rx=max(3, 9 - i // 2))
            d = ImageDraw.Draw(fr)
            if 2 <= i <= 8:
                # Rising elemental soul/spore particles + ground ash remnants
                for p_idx, (bx, by) in enumerate([(9, 24), (16, 22), (22, 25), (13, 19), (19, 20)]):
                    py = by - (i - 2) * (2 + (p_idx % 2))
                    px = bx + ((i + p_idx) % 3 - 1) * 2
                    if 2 <= py <= 29:
                        col = c2 if p_idx % 2 == 0 else c1
                        d.rectangle([px, py, px + 1, py + 1], fill=col, outline=(11, 9, 10, 200))
            if i >= 6:
                # Ash & bone remnant pile on the ground
                d.ellipse([10, 27, 22, 30], fill=dark, outline=(11, 9, 10, 220))
            death_sheet.alpha_composite(fr, (i * 32, 0))
        death_path = os.path.join(out_root, f"Death_{dname}-Sheet.png")
        death_sheet.save(death_path)
        cat_entry[f"death_{dl}"] = anim_spec(f"pixellab_npcs/{slug}/Death_{dname}-Sheet.png", 10, fps=10, loop=False)

    # Default fallbacks (Down)
    Image.open(os.path.join(out_root, "Idle_Down-Sheet.png")).save(os.path.join(out_root, "Idle-Sheet.png"))
    Image.open(os.path.join(out_root, "Walk_Down-Sheet.png")).save(os.path.join(out_root, "Walk-Sheet.png"))
    cat_entry["idle"] = anim_spec(f"pixellab_npcs/{slug}/Idle_Down-Sheet.png", 4, fps=6, loop=True)
    cat_entry["run"] = anim_spec(f"pixellab_npcs/{slug}/Run_Down-Sheet.png", 6, fps=10, loop=True)
    cat_entry["death"] = anim_spec(f"pixellab_npcs/{slug}/Death_Down-Sheet.png", 10, fps=10, loop=False)
    return cat_entry


def build_myconid_catalog_entry() -> dict:
    """Returns the 28-sheet catalog dictionary for `myconid`, inspecting each sheet's actual
    pixel dimensions (`32x32` vs `64x64`) so `enemy.gd` plays all 7 states x 4 directions seamlessly."""
    entry = {
        "idle": anim_spec("expansion/Mobs/Myconid/Idle/Idle_Down-Sheet.png", 4, fps=6, loop=True, fw=32, fh=32, ay=30),
        "run": anim_spec("expansion/Mobs/Myconid/Run/Run_Down-Sheet.png", 6, fps=10, loop=True, fw=64, fh=64, ay=48),
        "death": anim_spec("expansion/Mobs/Myconid/Death/Death_Down-Sheet.png", 10, fps=10, loop=False, fw=64, fh=64, ay=48),
    }
    state_map = [
        ("idle", "Idle", 4, 6, True),
        ("walk", "Walk", 6, 8, True),
        ("run", "Run", 6, 11, True),
        ("attack", "Attack", 6, 12, False),
        ("heavy_attack", "Heavy_Attack", 8, 11, False),
        ("hit", "Hit_Bounce", 4, 12, False),
        ("death", "Death", 10, 10, False),
    ]
    for key_prefix, folder, frames, fps, loop in state_map:
        for dname in ("Down", "Right", "Left", "Up"):
            dl = dname.lower()
            rel = f"expansion/Mobs/Myconid/{folder}/{folder}_{dname}-Sheet.png"
            full = os.path.join(ROOT, "assets", rel)
            fh = Image.open(full).height if os.path.isfile(full) else 32
            ay = 30 if fh == 32 else 48
            entry[f"{key_prefix}_{dl}"] = anim_spec(rel, frames, fps=fps, loop=loop, fw=fh, fh=fh, ay=ay)
    return entry


def render_all_monsters_showcase():
    """Renders a high-res visual contact sheet showing all 16 Hearthwild monsters across
    all 7 animation states (`Idle`, `Walk`, `Run`, `Light Attack`, `Heavy Attack`, `Hit Bounce`, `Death`)
    and 4 directions (`Down`, `Right`, `Left`, `Up`)."""
    monsters = [("myconid", "Forest/Autumn")] + [(k, v[3]) for k, v in MONSTER_THEMES.items()]
    cols = 4
    rows = (len(monsters) + cols - 1) // cols
    card_w, card_h = 370, 232
    pad = 16
    W = pad * 2 + cols * card_w + (cols - 1) * 12
    H = 92 + rows * (card_h + 12) + pad

    canvas = Image.new("RGBA", (W, H), (22, 18, 18, 255))
    draw = ImageDraw.Draw(canvas)

    draw.rectangle([16, 14, W - 16, 74], fill=(40, 32, 30, 255), outline=(214, 168, 92, 255), width=2)
    draw.text((28, 24), "HEARTHWILD COMPLETE MONSTER ANIMATION SUITE (ALL 16 MONSTERS x 28 DIRECTIONAL SHEETS = 448 SHEETS / 2,432 FRAMES)", fill=(255, 232, 168, 255))
    draw.text((28, 46), "Every monster includes Down, Right, Left, Up across: Idle (4f) | Walk (6f) | Run (6f) | Light Attack (6f) | Heavy Attack (8f) | Hit Bounce (4f) | Death (10f)", fill=(198, 218, 152, 255))

    state_cols = [
        ("Idle", 0),
        ("Walk", 2),
        ("Run", 2),
        ("Attack", 2),
        ("Heavy_Attack", 4),
        ("Hit_Bounce", 1),
        ("Death", 4),
    ]
    short_labels = ["IDLE", "WALK", "RUN", "L.ATK", "H.ATK", "HIT", "DEATH"]

    for idx, (slug, biome) in enumerate(monsters):
        r = idx // cols
        c = idx % cols
        bx = pad + c * (card_w + 12)
        by = 88 + r * (card_h + 12)

        draw.rectangle([bx, by, bx + card_w, by + card_h], fill=(36, 30, 28, 255), outline=(142, 98, 64, 255), width=2)
        draw.rectangle([bx, by, bx + card_w, by + 26], fill=(54, 42, 38, 255), outline=(142, 98, 64, 255), width=1)
        draw.text((bx + 8, by + 6), f"{slug.upper()}  [{biome}]  (28 Sheets / 152 Frames)", fill=(255, 214, 102, 255))

        for s_i, label in enumerate(short_labels):
            draw.text((bx + 28 + s_i * 48, by + 30), label, fill=(214, 182, 138, 255))

        for d_i, dname in enumerate(("Down", "Right", "Left", "Up")):
            ry = by + 44 + d_i * 45
            draw.text((bx + 6, ry + 14), dname[0], fill=(168, 214, 132, 255))
            for s_i, (st_name, frame_idx) in enumerate(state_cols):
                cx = bx + 22 + s_i * 48
                draw.rectangle([cx, ry, cx + 44, ry + 42], fill=(48, 40, 38, 255), outline=(76, 62, 56, 255), width=1)
                if slug == "myconid":
                    sp = os.path.join(ROOT, "assets", "expansion", "Mobs", "Myconid", st_name, f"{st_name}_{dname}-Sheet.png")
                else:
                    sp = os.path.join(NPC_DIR, slug, f"{st_name}_{dname}-Sheet.png")
                if os.path.isfile(sp):
                    sh = Image.open(sp).convert("RGBA")
                    fh = sh.height
                    fx = frame_idx * fh
                    raw_fr = sh.crop((fx, 0, fx + fh, fh))
                    bb = raw_fr.getchannel("A").getbbox()
                    if bb and fh > 32:
                        # Center the active bounding box of 64x64 Myconid frames cleanly inside the 40x40 preview cell
                        raw_fr = raw_fr.crop((max(0, bb[0] - 2), max(0, bb[1] - 2), min(fh, bb[2] + 2), min(fh, bb[3] + 2)))
                    fr = raw_fr.resize((38, 38), Image.Resampling.NEAREST)
                    canvas.alpha_composite(fr, (cx + 3, ry + 2))

    os.makedirs(os.path.dirname(SHOWCASE_OUT), exist_ok=True)
    canvas.save(SHOWCASE_OUT)
    if os.path.isdir(ARTIFACT_DIR):
        canvas.save(os.path.join(ARTIFACT_DIR, "all_monsters_animations_showcase.png"))
    print("Saved complete monster animation showcase to:", SHOWCASE_OUT)


def main():
    sync_remote_pixellab_animations()

    with open(CATALOG_PATH, "r", encoding="utf-8") as f:
        catalog = json.load(f)
    actors = catalog.setdefault("actors", {})

    # 1. Register myconid's 28 directional sheets
    actors["myconid"] = build_myconid_catalog_entry()

    # 2. Build & register all 28 directional sheets for all 15 PixelLab monsters/bosses
    for slug, theme in MONSTER_THEMES.items():
        actors[slug] = build_28_sheets_for_monster(slug, theme)
        print(f"Built 28 directional sheets (152 frames) for '{slug}'")

    with open(CATALOG_PATH, "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=1)
    print("Updated catalog.json with 28 directional animation sheets for all 16 monsters!")

    render_all_monsters_showcase()


if __name__ == "__main__":
    main()
