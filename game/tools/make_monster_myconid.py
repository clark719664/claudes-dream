"""Complete 4-Directional Pixel Crawler Sprite Sheet Generator for Monster #1:
The Elder Sporecap (Myconid).

Generates ALL 4 DIRECTIONS (Down/Front, Right/Side, Left/Side with true top-left lighting, Up/Back)
across ALL 4 ANIMATION STATES (16 total animation strips = 88 hand-crafted frames):
  1. IDLE   (Down, Right, Left, Up) - 4 frames each (32x32) @ 6 FPS
  2. RUN    (Down, Right, Left, Up) - 6 frames each (64x64) @ 10 FPS
  3. ATTACK (Down, Right, Left, Up) - 6 frames each (64x64) @ 12 FPS (Windup -> Slash Arc + Spore Burst -> Recover)
  4. DEATH  (Down, Right, Left, Up) - 6 frames each (64x64) @ 10 FPS (Directional Shock -> Tumble -> Slam -> Remains)

Outputs:
  - Individual directional sheets in game/assets/expansion/Mobs/Myconid/<State>/<State>_<Dir>-Sheet.png
  - Combined 4-row directional sheets <State>-Sheet.png
  - Master 4x Nearest-Neighbor Visual Inspection Sheet (docs/media/myconid_all_directions_sheet.png)
"""
import os
from PIL import Image, ImageDraw

BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "expansion", "Mobs", "Myconid")
PREVIEW_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "media", "myconid_all_directions_sheet.png")
ARTIFACT_DIR = r"C:\Users\lil_c\.gemini\antigravity\brain\433fa0e9-d043-4a36-88b6-c820d8b1c3ab"

# Exact Pixel Crawler palette extracted from Hearthwild screenshots
PAL = {
    "out": (11, 9, 10, 255),            # #0b090a 1px crisp outer outline
    "cav": (20, 12, 16, 255),           # #140c10 deep shadow hood/face cavity
    # Cap crimson-rust
    "cap_rim": (244, 142, 72, 255),     # #f48e48 warm sun rim highlight
    "cap_hi": (228, 102, 46, 255),      # #e4662e bright top-left sun highlight
    "cap_mid": (192, 60, 28, 255),      # #c03c1c rich red-orange midtone
    "cap_sh": (138, 34, 18, 255),       # #8a2212 deep crimson shadow
    "cap_dk": (86, 18, 12, 255),        # #56120c under-rim dark shadow
    # Cream spots & under-gills
    "spot_hi": (246, 228, 194, 255),    # #f6e4c2 warm cream highlight
    "spot_mid": (214, 182, 138, 255),   # #d6b68a tan-cream midtone
    "gill_hi": (188, 148, 108, 255),    # #bc946c lit gill pleat
    "gill_mid": (156, 116, 82, 255),    # #9c7452 gill shadow
    "gill_dk": (104, 70, 48, 255),      # #684630 deep gill crease
    # Mycelium stalk / torso bark
    "body_hi": (226, 198, 158, 255),    # #e2c69e upper torso light
    "body_mid": (186, 150, 110, 255),   # #ba966e sturdy stalk midtone
    "body_sh": (134, 98, 68, 255),      # #866244 lower/right shadow
    "body_dk": (84, 56, 38, 255),       # #543826 deep root shadow
    # Forest moss shoulder-mantle & dorsal cape
    "moss_hi": (118, 176, 38, 255),     # #76b026 bright leaf highlight
    "moss_mid": (74, 130, 20, 255),     # #4a8214 mid forest green
    "moss_sh": (40, 82, 12, 255),       # #28520c dark moss shadow
    # Glowing spore eyes & attack slash/burst FX
    "eye_hi": (255, 244, 140, 255),     # #fff48c bright yellow-gold core
    "eye_mid": (242, 168, 40, 255),     # #f2a828 warm amber glow
    "eye_dim": (164, 92, 28, 255),      # #a45c1c dying ember eye
    "slash_hi": (255, 250, 208, 255),   # #fffad0 white-gold slash edge
    "slash_mid": (255, 198, 68, 255),   # #ffc644 golden slash body
    "slash_trail": (228, 92, 36, 210),  # #e45c24 fiery spore trail
    "spore_soft": (242, 188, 64, 165),  # semi-transparent spore aura
    # Twisted wood club
    "wood_hi": (178, 118, 70, 255),
    "wood_mid": (134, 82, 46, 255),
    "wood_sh": (86, 48, 26, 255),
}

DIRS = ["down", "right", "left", "up"]


def put_px(im: Image.Image, x: int, y: int, col: tuple):
    if 0 <= x < im.width and 0 <= y < im.height and col[3] > 0:
        if col[3] == 255:
            im.putpixel((x, y), col)
        else:
            dst = im.getpixel((x, y))
            a = col[3] / 255.0
            if dst[3] == 0:
                im.putpixel((x, y), col)
            else:
                r = int(col[0] * a + dst[0] * (1 - a))
                g = int(col[1] * a + dst[1] * (1 - a))
                b = int(col[2] * a + dst[2] * (1 - a))
                na = min(255, int(dst[3] + col[3] * (1 - dst[3] / 255.0)))
                im.putpixel((x, y), (r, g, b, na))


def apply_1px_outline(layer: Image.Image, outline_col=PAL["out"]) -> Image.Image:
    """Wraps opaque pixels in `layer` with a crisp 1px 4-connected black outline."""
    out = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    px = layer.load()
    w, h = layer.size
    for y in range(h):
        for x in range(w):
            if px[x, y][3] >= 200:
                for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] < 100:
                        out.putpixel((nx, ny), outline_col)
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0:
                put_px(out, x, y, px[x, y])
    return out


def draw_cap_directional(
    w: int, h: int,
    cx: int, cy: int,
    direction: str = "down",
    tilt: int = 0,
    squash_y: int = 0,
    eye_mode: str = "normal",
    cavity_h: int = 4,
) -> Image.Image:
    """Draws the flared Toadstool/Sporecap dome in any of the 4 directions:
      - 'down':  Symmetrical front view, centered eyes, wide front gill arch
      - 'right': 3/4 right profile, eyes shifted +1px right, cap tilted slightly right
      - 'left':  3/4 left profile (with TRUE top-left sun lighting!), eyes shifted -1px left
      - 'up':    Rear dorsal view! Cap slopes down over the back of the head (no face cavity/eyes),
                 showing the rear spot cluster and lower dorsal gill rim!
    """
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    if direction == "up":
        # Rear dorsal dome: extends 2px lower in back to cover the head cavity
        rows = [
            (-8 + squash_y, -3 + tilt,  3 + tilt),
            (-7 + squash_y, -6 + tilt,  6 + tilt),
            (-6 + squash_y, -8 + tilt,  8 + tilt),
            (-5,            -9 + tilt,  9 + tilt),
            (-4,            -9,         9),
            (-3,            -10,       10),
            (-2,            -10,       10),
            (-1,            -9,         9),
            (0,             -8,         8),
            (1,             -6,         6),  # Low dorsal gill rim at back of neck
        ]
    else:
        rows = [
            (-8 + squash_y, -3 + tilt,  3 + tilt),
            (-7 + squash_y, -6 + tilt,  6 + tilt),
            (-6 + squash_y, -8 + tilt,  8 + tilt),
            (-5,            -9 + tilt,  9 + tilt),
            (-4,            -9,         9),
            (-3,            -10,       10),
            (-2,            -9,         9),
            (-1,            -7,         7),
        ]

    for dy, x0, x1 in rows:
        y = cy + dy
        for dx in range(x0, x1 + 1):
            x = cx + dx
            if (direction == "up" and dy == 1) or (direction != "up" and dy == -1):
                if dx < -3:
                    col = PAL["gill_hi"] if (dx % 2 == 0) else PAL["gill_mid"]
                elif dx < 3:
                    col = PAL["gill_mid"] if (dx % 2 == 0) else PAL["gill_dk"]
                else:
                    col = PAL["gill_dk"]
            elif (direction == "up" and dy == 0) or (direction != "up" and dy == -2):
                col = PAL["cap_dk"] if dx > 2 else (PAL["cap_sh"] if dx > -5 else PAL["cap_mid"])
            else:
                dist_tl = (dx + 4.5) * 0.62 + (dy + 6.2) * 0.85
                if dist_tl < -2.3:
                    col = PAL["cap_rim"]
                elif dist_tl < -0.6:
                    col = PAL["cap_hi"]
                elif dist_tl < 2.6:
                    col = PAL["cap_mid"]
                elif dist_tl < 5.4:
                    col = PAL["cap_sh"]
                else:
                    col = PAL["cap_dk"]
            put_px(layer, x, y, col)

    # Directional spot patterns so rotation reads unmistakably
    if direction == "down":
        spots = [
            # Big central-left front spot (3x2)
            (cx - 4 + tilt, cy - 6 + squash_y, PAL["spot_hi"]),
            (cx - 3 + tilt, cy - 6 + squash_y, PAL["spot_hi"]),
            (cx - 4 + tilt, cy - 5 + squash_y, PAL["spot_mid"]),
            (cx - 3 + tilt, cy - 5 + squash_y, PAL["spot_mid"]),
            # Right front spot (2x2)
            (cx + 3 + tilt, cy - 6 + squash_y, PAL["spot_hi"]),
            (cx + 4 + tilt, cy - 6 + squash_y, PAL["spot_mid"]),
            (cx + 3 + tilt, cy - 5 + squash_y, PAL["spot_mid"]),
            (cx + 4 + tilt, cy - 5 + squash_y, PAL["gill_mid"]),
            # Far left & right rim spots
            (cx - 7, cy - 4, PAL["spot_hi"]),
            (cx - 6, cy - 4, PAL["spot_mid"]),
            (cx + 6, cy - 3, PAL["spot_mid"]),
            (cx,     cy - 3, PAL["spot_hi"]),
        ]
    elif direction == "up":
        spots = [
            # Dorsal spots across the back of the cap
            (cx - 5 + tilt, cy - 5 + squash_y, PAL["spot_hi"]),
            (cx - 4 + tilt, cy - 5 + squash_y, PAL["spot_hi"]),
            (cx - 5 + tilt, cy - 4 + squash_y, PAL["spot_mid"]),
            (cx - 4 + tilt, cy - 4 + squash_y, PAL["spot_mid"]),
            # Center-back large spot
            (cx,     cy - 6 + squash_y, PAL["spot_hi"]),
            (cx + 1, cy - 6 + squash_y, PAL["spot_mid"]),
            (cx,     cy - 5 + squash_y, PAL["spot_mid"]),
            (cx + 1, cy - 5 + squash_y, PAL["spot_mid"]),
            # Lower dorsal spots near the back rim
            (cx - 2, cy - 2, PAL["spot_mid"]),
            (cx - 1, cy - 2, PAL["gill_mid"]),
            (cx + 5, cy - 3, PAL["spot_mid"]),
            (cx + 6, cy - 3, PAL["gill_mid"]),
        ]
    elif direction == "right":
        spots = [
            (cx - 6 + tilt, cy - 6 + squash_y, PAL["spot_hi"]),
            (cx - 5 + tilt, cy - 6 + squash_y, PAL["spot_hi"]),
            (cx - 6 + tilt, cy - 5 + squash_y, PAL["spot_mid"]),
            (cx - 5 + tilt, cy - 5 + squash_y, PAL["spot_mid"]),
            (cx + 1 + tilt, cy - 7 + squash_y, PAL["spot_hi"]),
            (cx + 2 + tilt, cy - 7 + squash_y, PAL["spot_mid"]),
            (cx + 1 + tilt, cy - 6 + squash_y, PAL["spot_mid"]),
            (cx + 6, cy - 4, PAL["spot_mid"]),
            (cx + 7, cy - 4, PAL["gill_mid"]),
            (cx - 1, cy - 3, PAL["spot_hi"]),
        ]
    else:  # left
        spots = [
            (cx - 2 + tilt, cy - 7 + squash_y, PAL["spot_hi"]),
            (cx - 1 + tilt, cy - 7 + squash_y, PAL["spot_hi"]),
            (cx - 2 + tilt, cy - 6 + squash_y, PAL["spot_mid"]),
            (cx + 4 + tilt, cy - 6 + squash_y, PAL["spot_hi"]),
            (cx + 5 + tilt, cy - 6 + squash_y, PAL["spot_mid"]),
            (cx + 4 + tilt, cy - 5 + squash_y, PAL["spot_mid"]),
            (cx - 7, cy - 4, PAL["spot_hi"]),
            (cx - 6, cy - 4, PAL["spot_mid"]),
            (cx + 1, cy - 3, PAL["spot_mid"]),
        ]

    for sx, sy, scol in spots:
        if 0 <= sx < w and 0 <= sy < h and layer.getpixel((sx, sy))[3] > 0:
            put_px(layer, sx, sy, scol)

    if direction == "up":
        # In UP view, draw a small shadow neck base under the dorsal cap if standing
        if cavity_h >= 2:
            for dy in range(2, min(4, cavity_h + 1)):
                for dx in range(-4, 5):
                    put_px(layer, cx + dx, cy + dy, PAL["moss_sh"] if dy == 2 else PAL["body_sh"])
        return apply_1px_outline(layer)

    # Face shadow cavity directly under the gill rim for DOWN, RIGHT, LEFT
    for dy in range(0, cavity_h):
        half_w = 5 if dy < cavity_h - 1 else 4
        for dx in range(-half_w, half_w + 1):
            put_px(layer, cx + dx, cy + dy, PAL["cav"])

    # Directional eyes inside the cavity
    if cavity_h >= 2 and eye_mode != "dead":
        eye_shift = 0 if direction == "down" else (1 if direction == "right" else -1)
        lx = cx - 2 + eye_shift
        rx = cx + 2 + eye_shift
        if eye_mode == "normal":
            put_px(layer, lx, cy + 1, PAL["eye_hi"])
            put_px(layer, lx, cy + 2, PAL["eye_mid"])
            put_px(layer, rx, cy + 1, PAL["eye_hi"])
            put_px(layer, rx, cy + 2, PAL["eye_mid"])
        elif eye_mode == "gleam":
            put_px(layer, lx, cy + 1, PAL["spot_hi"])
            put_px(layer, lx, cy + 2, PAL["eye_hi"])
            put_px(layer, rx, cy + 1, PAL["spot_hi"])
            put_px(layer, rx, cy + 2, PAL["eye_hi"])
        elif eye_mode in ("run", "attack"):
            put_px(layer, lx, cy + 1, PAL["spot_hi"] if eye_mode == "attack" else PAL["eye_hi"])
            put_px(layer, lx, cy + 2, PAL["eye_hi"] if eye_mode == "attack" else PAL["eye_mid"])
            put_px(layer, rx, cy + 1, PAL["spot_hi"] if eye_mode == "attack" else PAL["eye_hi"])
            put_px(layer, rx, cy + 2, PAL["eye_hi"] if eye_mode == "attack" else PAL["eye_mid"])
        elif eye_mode == "shock":
            for ex in (lx, rx):
                put_px(layer, ex, cy + 1, PAL["spot_hi"])
                put_px(layer, ex + (1 if direction != "left" else -1), cy + 1, PAL["eye_hi"])
                put_px(layer, ex, cy + 2, PAL["eye_hi"])
        elif eye_mode == "dying":
            put_px(layer, lx, cy + 1, PAL["eye_dim"])
            put_px(layer, rx, cy + 1, PAL["eye_dim"])

    return apply_1px_outline(layer)


def draw_torso_directional(
    w: int, h: int,
    cx: int, body_y: int,
    left_foot: tuple, right_foot: tuple,
    direction: str = "down",
    lean_x: int = 0,
) -> Image.Image:
    """Draws the mossy shoulder mantle, mycelium stalk torso, and two root-feet for any direction."""
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))

    # Draw feet
    feet_order = [(left_foot[0], left_foot[1], False), (right_foot[0], right_foot[1], True)]
    if direction == "left":
        feet_order = [(right_foot[0], right_foot[1], False), (left_foot[0], left_foot[1], True)]
    for fx, fy, is_front in feet_order:
        for dy in range(-2, 1):
            for dx in range(-1, 2):
                col = PAL["body_mid"] if (is_front and dy < 0 and dx <= 0) else (PAL["body_sh"] if is_front else PAL["body_dk"])
                put_px(layer, fx + dx, fy + dy, col)

    # Torso & mossy collar
    moss_depth = 3 if direction == "up" else 2
    for dy in range(0, 6):
        half_w = 4 if dy < 4 else 3
        for dx in range(-half_w, half_w + 1):
            tx = cx + lean_x + dx
            ty = body_y + dy
            if dy < moss_depth:
                if dx < -1:
                    col = PAL["moss_hi"]
                elif dx < 2:
                    col = PAL["moss_mid"]
                else:
                    col = PAL["moss_sh"]
            else:
                if dx < -1:
                    col = PAL["body_hi"]
                elif dx < 2:
                    col = PAL["body_mid"]
                else:
                    col = PAL["body_sh"]
            put_px(layer, tx, ty, col)

    # Moss fringe V-tips
    put_px(layer, cx + lean_x - 2, body_y + moss_depth, PAL["moss_hi"])
    put_px(layer, cx + lean_x,     body_y + moss_depth, PAL["moss_mid"])
    put_px(layer, cx + lean_x + 2, body_y + moss_depth, PAL["moss_sh"])

    return apply_1px_outline(layer)


def draw_club_directional(
    w: int, h: int,
    hx: int, hy: int,
    direction: str = "down",
    pose: str = "idle",
) -> Image.Image:
    """Draws the Myconid's gnarled wood club + glowing spore-bulb in any pose:
    pose:
      'idle'    = diagonal resting
      'raise'   = raised high above shoulder (windup / inhale)
      'swing'   = mid-swing extended
      'slam'    = low follow-through after attack
      'flat'    = lying horizontally on ground (death)
    """
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    flip_x = -1 if direction == "left" else 1

    if pose == "flat":
        for sx in range(0, 6):
            px = hx + sx * flip_x
            put_px(layer, px, hy, PAL["wood_hi"] if sx < 3 else PAL["wood_mid"])
            put_px(layer, px, hy + 1, PAL["wood_sh"])
        for dy in range(-1, 2):
            for dx in range(6, 9):
                px = hx + dx * flip_x
                col = PAL["cap_hi"] if (dy == -1 and dx < 8) else (PAL["cap_mid"] if dy <= 0 else PAL["cap_sh"])
                put_px(layer, px, hy + dy, col)
        return apply_1px_outline(layer)

    # Hand grip (3x2)
    for dx in range(-1, 2):
        for dy in range(0, 2):
            put_px(layer, hx + dx, hy + dy, PAL["body_mid"] if dx <= 0 else PAL["body_sh"])

    if pose == "idle":
        shaft = [(0, -1), (1 * flip_x, -2), (1 * flip_x, -3), (2 * flip_x, -4), (2 * flip_x, -5)]
        bulb_c = (hx + 2 * flip_x, hy - 6)
    elif pose == "raise":
        shaft = [(0, -1), (0, -2), (1 * flip_x, -3), (1 * flip_x, -4), (1 * flip_x, -5), (1 * flip_x, -6)]
        bulb_c = (hx + 1 * flip_x, hy - 8)
    elif pose == "swing":
        if direction == "down":
            shaft = [(0, 1), (-1, 2), (-2, 3), (-3, 4), (-4, 5)]
            bulb_c = (hx - 5, hy + 6)
        elif direction == "up":
            shaft = [(0, -1), (-1, -2), (-2, -3), (-3, -4), (-4, -5)]
            bulb_c = (hx - 5, hy - 6)
        else:
            shaft = [(1 * flip_x, 0), (2 * flip_x, -1), (3 * flip_x, -1), (4 * flip_x, -2), (5 * flip_x, -2)]
            bulb_c = (hx + 7 * flip_x, hy - 2)
    else:  # 'slam'
        if direction == "down":
            shaft = [(-1, 1), (-2, 2), (-3, 2), (-4, 3)]
            bulb_c = (hx - 6, hy + 3)
        elif direction == "up":
            shaft = [(-1, -1), (-2, -2), (-3, -2), (-4, -3)]
            bulb_c = (hx - 6, hy - 3)
        else:
            shaft = [(1 * flip_x, 1), (2 * flip_x, 1), (3 * flip_x, 2), (4 * flip_x, 2)]
            bulb_c = (hx + 6 * flip_x, hy + 2)

    for sx, sy in shaft:
        put_px(layer, hx + sx, hy + sy, PAL["wood_hi"])
        put_px(layer, hx + sx + flip_x, hy + sy, PAL["wood_sh"])

    bx, by = bulb_c
    for dy in range(-1, 2):
        for dx in range(-1, 2):
            if dx == -1 and dy == -1:
                col = PAL["eye_hi"]
            elif dx + dy <= 0:
                col = PAL["cap_hi"]
            else:
                col = PAL["cap_mid"]
            put_px(layer, bx + dx, by + dy, col)

    return apply_1px_outline(layer)


def draw_slash_fx(w: int, h: int, cx: int, cy: int, direction: str, phase: int) -> Image.Image:
    """Draws the Pixel Crawler crescent weapon slash + spore burst on Attack frames 2 and 3!
    phase: 0 = main wide slash crescent (Frame 2), 1 = dissipating arc + spore cloud (Frame 3)
    """
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    if direction == "down":
        # Wide horizontal crescent below the feet (cy + 3 to cy + 11)
        for dx in range(-12, 13):
            curve_y = cy + 6 + int((12 - abs(dx)) * 0.25)
            if phase == 0:
                put_px(layer, cx + dx, curve_y, PAL["slash_hi"])
                put_px(layer, cx + dx, curve_y - 1, PAL["slash_mid"])
                if abs(dx) < 9:
                    put_px(layer, cx + dx, curve_y + 1, PAL["slash_trail"])
            else:
                if abs(dx) % 2 == 0:
                    put_px(layer, cx + dx, curve_y + 1, PAL["slash_mid"])
                    put_px(layer, cx + dx, curve_y + 2, PAL["slash_trail"])
        # Spore burst particles
        for sx, sy in [(-10, 8), (-4, 11), (5, 10), (11, 7)]:
            put_px(layer, cx + sx, cy + sy + phase, PAL["eye_hi"])
    elif direction == "up":
        # Wide overhead crescent above the cap (cy - 22 to cy - 15)
        for dx in range(-12, 13):
            curve_y = cy - 18 - int((12 - abs(dx)) * 0.25)
            if phase == 0:
                put_px(layer, cx + dx, curve_y, PAL["slash_hi"])
                put_px(layer, cx + dx, curve_y + 1, PAL["slash_mid"])
                if abs(dx) < 9:
                    put_px(layer, cx + dx, curve_y - 1, PAL["slash_trail"])
            else:
                if abs(dx) % 2 == 0:
                    put_px(layer, cx + dx, curve_y - 1, PAL["slash_mid"])
                    put_px(layer, cx + dx, curve_y - 2, PAL["slash_trail"])
        for sx, sy in [(-10, -20), (-4, -23), (5, -22), (11, -19)]:
            put_px(layer, cx + sx, cy + sy - phase, PAL["eye_hi"])
    else:
        # Side crescent in front of right (+1) or left (-1)
        sgn = 1 if direction == "right" else -1
        for dy in range(-14, 6):
            curve_x = cx + sgn * (12 + int((10 - abs(dy + 4)) * 0.35))
            if phase == 0:
                put_px(layer, curve_x, cy + dy, PAL["slash_hi"])
                put_px(layer, curve_x - sgn, cy + dy, PAL["slash_mid"])
                if abs(dy + 4) < 7:
                    put_px(layer, curve_x + sgn, cy + dy, PAL["slash_trail"])
            else:
                if abs(dy) % 2 == 0:
                    put_px(layer, curve_x + sgn, cy + dy, PAL["slash_mid"])
                    put_px(layer, curve_x + 2 * sgn, cy + dy, PAL["slash_trail"])
        for sx, sy in [(15, -11), (18, -5), (16, 2), (13, 5)]:
            put_px(layer, cx + sgn * (sx + phase), cy + sy, PAL["eye_hi"])
    return layer


def draw_hand(w: int, h: int, lx: int, ly: int) -> Image.Image:
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for dy in range(0, 2):
        for dx in range(-1, 2):
            put_px(layer, lx + dx, ly + dy, PAL["body_hi"] if dx < 0 else PAL["body_mid"])
    return apply_1px_outline(layer)


def assemble_character(
    w: int, h: int,
    cx: int, body_y: int, cap_y: int,
    l_foot: tuple, r_foot: tuple,
    off_hand_pos: tuple, club_pos: tuple,
    direction: str,
    cap_tilt: int = 0,
    cap_squash: int = 0,
    eye_mode: str = "normal",
    cavity_h: int = 4,
    club_pose: str = "idle",
    lean_x: int = 0,
) -> Image.Image:
    """Composites layers in the correct directional Z-order (so hands/weapons behind the back
    are occluded by the torso/cap when facing Left or Up!)."""
    cell = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ohand = draw_hand(w, h, off_hand_pos[0], off_hand_pos[1])
    torso = draw_torso_directional(w, h, cx, body_y, l_foot, r_foot, direction=direction, lean_x=lean_x)
    cap = draw_cap_directional(w, h, cx + lean_x, cap_y, direction=direction, tilt=cap_tilt, squash_y=cap_squash, eye_mode=eye_mode, cavity_h=cavity_h)
    club = draw_club_directional(w, h, club_pos[0], club_pos[1], direction=direction, pose=club_pose)

    if direction == "down":
        order = [torso, ohand, cap, club]
    elif direction == "right":
        order = [ohand, torso, cap, club]
    elif direction == "left":
        order = [club, torso, cap, ohand]
    else:  # up
        order = [club, ohand, torso, cap]

    for lyr in order:
        cell.alpha_composite(lyr)
    return cell


def build_idle_dir(direction: str) -> Image.Image:
    """4 frames of 32x32 for a single direction."""
    sheet = Image.new("RGBA", (32 * 4, 32), (0, 0, 0, 0))
    sgn = -1 if direction == "left" else 1
    frames = [
        (0,  0,  0,  0,  0, "idle",  "normal", True),
        (-1, 0,  0, -1, -1, "raise", "normal", True),
        (-1, -1, 0, -1, -1, "raise", "gleam",  True),
        (0,  0,  1,  1,  1, "idle",  "normal", False),
    ]
    for idx, (tdy, cdy, csq, ldy, rdy, cpose, emode, spore) in enumerate(frames):
        cx = 16
        foot_y = 30
        body_y = 22 + tdy
        cap_y = 18 + cdy
        oh_x = cx - 6 * sgn
        cl_x = cx + 6 * sgn
        cell = assemble_character(
            32, 32, cx, body_y, cap_y,
            (cx - 3, foot_y), (cx + 3, foot_y),
            (oh_x, body_y + 2 + ldy), (cl_x, body_y + 2 + rdy),
            direction=direction, cap_squash=csq, eye_mode=emode, club_pose=cpose
        )
        if spore:
            sx = cx + (-9 if idx % 2 == 0 else 9)
            sy = cap_y - 4 - idx
            put_px(cell, sx, sy, PAL["eye_hi"])
            put_px(cell, sx + 1, sy, PAL["spore_soft"])
        sheet.alpha_composite(cell, (idx * 32, 0))
    return sheet


def build_run_dir(direction: str) -> Image.Image:
    """6 frames of 64x64 for a single direction."""
    sheet = Image.new("RGBA", (64 * 6, 64), (0, 0, 0, 0))
    sgn = -1 if direction == "left" else 1
    lean = 0 if direction in ("down", "up") else sgn

    for idx in range(6):
        cx = 32
        base_foot_y = 62
        # Stride vertical bob: F0=0, F1=+1(squash), F2=-2(leap), F3=0, F4=+1(squash), F5=-2(leap)
        tdy = [0, 1, -2, 0, 1, -2][idx]
        cdy = [0, 1, -1, -1, 1, -1][idx]
        body_y = 54 + tdy
        cap_y = 50 + cdy

        if direction in ("down", "up"):
            # Alternating vertical foot lift for front/back walk cycle!
            lf_dy = [-2, 0, -3, 0, 0, -1][idx]
            rf_dy = [0, 0, -1, -2, 0, -3][idx]
            l_foot = (cx - 3, base_foot_y + lf_dy)
            r_foot = (cx + 3, base_foot_y + rf_dy)
            oh_pos = (cx - 6, body_y + 2 + (1 if idx in (0, 1, 5) else -1))
            cl_pos = (cx + 6, body_y + 2 + (-1 if idx in (0, 1, 5) else 1))
            cpose = "raise" if idx in (0, 1, 5) else "idle"
            tilt = [-1, 0, 1, 1, 0, -1][idx]
        else:
            # Side stride cycle
            lf_dx = [-4, -2, 1, 4, 2, -1][idx] * sgn
            lf_dy = [-1, 0, -3, 0, 0, -2][idx]
            rf_dx = [4, 2, -1, -4, -2, 1][idx] * sgn
            rf_dy = [0, 0, -2, -1, 0, -3][idx]
            l_foot = (cx + lf_dx, base_foot_y + lf_dy)
            r_foot = (cx + rf_dx, base_foot_y + rf_dy)
            oh_pos = (cx - 5 * sgn, body_y + 2 + [-1, 0, -2, 0, 1, -2][idx])
            cl_pos = (cx + 6 * sgn, body_y + 1 + [-2, 0, -1, 1, 1, -2][idx])
            cpose = ["raise", "idle", "swing", "swing", "idle", "raise"][idx]
            tilt = sgn if idx in (0, 1, 3, 4) else 0

        cell = assemble_character(
            64, 64, cx, body_y, cap_y,
            l_foot, r_foot, oh_pos, cl_pos,
            direction=direction, cap_tilt=tilt,
            cap_squash=(1 if tdy > 0 else 0),
            eye_mode="run", club_pose=cpose, lean_x=lean
        )
        # Dust / spore trail
        if idx in (1, 4):
            put_px(cell, cx - 6 * sgn, base_foot_y - 1, PAL["spot_hi"])
            put_px(cell, cx - 7 * sgn, base_foot_y - 2, PAL["spot_mid"])
        else:
            put_px(cell, cx - 7 * sgn, cap_y - 4 + (idx % 2), PAL["eye_hi"])
        sheet.alpha_composite(cell, (idx * 64, 0))
    return sheet


def build_attack_dir(direction: str) -> Image.Image:
    """6 frames of 64x64 directional attack:
      F0: Anticipation crouch & windup pull-back
      F1: Peak high windup — eyes & club bulb flare white-gold!
      F2: Full Lunge & Cleave! Club swings across in direction + bright Crescent Slash FX + Spore Burst!
      F3: Follow-through impact! Dissipating slash arc + floating golden spores
      F4: Recoil settle back toward stance
      F5: Recovery to combat ready
    """
    sheet = Image.new("RGBA", (64 * 6, 64), (0, 0, 0, 0))
    sgn = -1 if direction == "left" else 1

    for idx in range(6):
        cx = 32
        foot_y = 62
        # Lunge offset in direction of attack on frames 2 & 3
        lunge_x, lunge_y = 0, 0
        if idx in (2, 3):
            if direction == "down":
                lunge_y = 2 if idx == 2 else 1
            elif direction == "up":
                lunge_y = -2 if idx == 2 else -1
            else:
                lunge_x = (3 if idx == 2 else 2) * sgn
        elif idx in (0, 1):
            # Windup lean back
            if direction == "down":
                lunge_y = -1
            elif direction == "up":
                lunge_y = 1
            else:
                lunge_x = -2 * sgn

        tdy = [1, -1, 0, 1, 0, 0][idx] + lunge_y
        cdy = [1, -2, 0, 1, 0, 0][idx] + lunge_y
        body_y = 54 + tdy
        cap_y = 50 + cdy
        acx = cx + lunge_x

        cpose = ["raise", "raise", "swing", "slam", "idle", "idle"][idx]
        emode = "gleam" if idx == 1 else ("attack" if idx in (2, 3) else "normal")

        # Club hand placement during swing
        if idx in (0, 1):
            cl_pos = (acx + 6 * sgn, body_y - 1)
            oh_pos = (acx - 6 * sgn, body_y + 1)
        elif idx == 2:
            if direction == "down":
                cl_pos = (acx + 3, body_y + 3)
                oh_pos = (acx - 7, body_y)
            elif direction == "up":
                cl_pos = (acx + 3, body_y - 2)
                oh_pos = (acx - 7, body_y + 1)
            else:
                cl_pos = (acx + 7 * sgn, body_y + 1)
                oh_pos = (acx - 6 * sgn, body_y + 1)
        elif idx == 3:
            cl_pos = (acx + 4 * sgn, body_y + 3)
            oh_pos = (acx - 6 * sgn, body_y + 2)
        else:
            cl_pos = (acx + 6 * sgn, body_y + 2)
            oh_pos = (acx - 6 * sgn, body_y + 2)

        cell = assemble_character(
            64, 64, acx, body_y, cap_y,
            (acx - 3, foot_y + lunge_y), (acx + 3, foot_y + lunge_y),
            oh_pos, cl_pos,
            direction=direction,
            cap_tilt=(sgn if idx in (2, 3) and direction in ("right", "left") else 0),
            cap_squash=(1 if idx in (0, 3) else 0),
            eye_mode=emode, club_pose=cpose
        )

        # Overlay directional Crescent Slash + Spore Burst on F2 & F3
        if idx in (2, 3):
            slash_lyr = draw_slash_fx(64, 64, acx, foot_y, direction, phase=(idx - 2))
            if direction == "up":
                # Behind cap when attacking UP
                under = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
                under.alpha_composite(slash_lyr)
                under.alpha_composite(cell)
                cell = under
            else:
                cell.alpha_composite(slash_lyr)

        sheet.alpha_composite(cell, (idx * 64, 0))
    return sheet


def build_death_dir(direction: str) -> Image.Image:
    """6 frames of 64x64 directional death collapse."""
    sheet = Image.new("RGBA", (64 * 6, 64), (0, 0, 0, 0))
    # Knockback direction: opposite of facing!
    kb_x = 0 if direction in ("down", "up") else (-1 if direction == "right" else 1)
    kb_y = -1 if direction == "down" else (1 if direction == "up" else 0)
    sgn = -1 if direction == "left" else 1

    for idx in range(6):
        cell = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        cx = 32 + kb_x * [1, 3, 4, 4, 4, 4][idx]
        cy_shift = kb_y * [1, 2, 2, 2, 2, 2][idx]

        if idx == 0:
            torso = draw_torso_directional(64, 64, cx, 51 + cy_shift, (cx - 4, 59), (cx + 2, 60), direction=direction)
            cap = draw_cap_directional(64, 64, cx, 44 + cy_shift, direction=direction, tilt=-sgn, squash_y=-1, eye_mode="shock", cavity_h=4)
            ohand = draw_hand(64, 64, cx - 9 * sgn, 50)
            club = draw_club_directional(64, 64, cx + 8 * sgn, 48, direction=direction, pose="raise")
            for lyr in [ohand, torso, cap, club]:
                cell.alpha_composite(lyr)
            put_px(cell, cx + 4, 43, PAL["eye_hi"])
            put_px(cell, cx - 5, 46, PAL["eye_hi"])
        elif idx == 1:
            torso = draw_torso_directional(64, 64, cx, 53 + cy_shift, (cx - 5, 60), (cx + 1, 58), direction=direction)
            cap = draw_cap_directional(64, 64, cx, 42 + cy_shift, direction=direction, tilt=-2 * sgn, squash_y=1, eye_mode="shock", cavity_h=3)
            club = draw_club_directional(64, 64, cx + 10 * sgn, 46, direction=direction, pose="swing")
            for lyr in [torso, cap, club]:
                cell.alpha_composite(lyr)
            for sx, sy in [(-2, 47), (4, 45), (-8, 44)]:
                put_px(cell, cx + sx, sy, PAL["eye_hi"])
        elif idx == 2:
            torso = draw_torso_directional(64, 64, cx, 57, (cx - 6, 62), (cx + 2, 62), direction=direction)
            cap = draw_cap_directional(64, 64, cx, 51, direction=direction, tilt=-sgn, squash_y=1, eye_mode="dying", cavity_h=3)
            club = draw_club_directional(64, 64, cx + 9 * sgn, 57, direction=direction, pose="slam")
            for lyr in [torso, cap, club]:
                cell.alpha_composite(lyr)
            for dx in (-11, -10, 8, 9):
                put_px(cell, cx + dx, 61, PAL["spot_hi"])
        elif idx == 3:
            torso = draw_torso_directional(64, 64, cx, 58, (cx - 6, 62), (cx + 2, 62), direction=direction)
            cap = draw_cap_directional(64, 64, cx, 57, direction=direction, tilt=-sgn, squash_y=1, eye_mode="dying", cavity_h=2)
            club = draw_club_directional(64, 64, cx + 8 * sgn, 61, direction=direction, pose="flat")
            for lyr in [torso, cap, club]:
                cell.alpha_composite(lyr)
        elif idx == 4:
            moss_base = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            for dx in range(-5, 6):
                put_px(moss_base, cx + dx, 61, PAL["moss_mid"] if dx < 0 else PAL["moss_sh"])
                put_px(moss_base, cx + dx, 62, PAL["body_sh"])
            moss_base = apply_1px_outline(moss_base)
            cap = draw_cap_directional(64, 64, cx, 60, direction=direction, tilt=-sgn, squash_y=1, eye_mode="dying", cavity_h=1)
            club = draw_club_directional(64, 64, cx + 8 * sgn, 61, direction=direction, pose="flat")
            for lyr in [moss_base, cap, club]:
                cell.alpha_composite(lyr)
            put_px(cell, cx - 3, 49, PAL["spore_soft"])
            put_px(cell, cx + 2, 47, PAL["spore_soft"])
        else:
            moss_base = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            for dx in range(-5, 6):
                put_px(moss_base, cx + dx, 61, PAL["moss_mid"] if dx < 0 else PAL["moss_sh"])
                put_px(moss_base, cx + dx, 62, PAL["body_sh"])
            moss_base = apply_1px_outline(moss_base)
            cap = draw_cap_directional(64, 64, cx, 61, direction=direction, tilt=-sgn, squash_y=1, eye_mode="dead", cavity_h=0)
            club = draw_club_directional(64, 64, cx + 8 * sgn, 61, direction=direction, pose="flat")
            for lyr in [moss_base, cap, club]:
                cell.alpha_composite(lyr)

        sheet.alpha_composite(cell, (idx * 64, 0))
    return sheet


def build_master_preview(sheets: dict) -> Image.Image:
    """Builds a high-clarity 16-row (grouped into 4 directional quadrants) inspection board
    showing IDLE, RUN, ATTACK, and DEATH for DOWN, RIGHT, LEFT, and UP."""
    canvas = Image.new("RGBA", (1480, 1080), (24, 22, 28, 255))
    draw = ImageDraw.Draw(canvas)

    for r in range(0, 1080, 20):
        for c in range(0, 1480, 20):
            col = (30, 28, 36, 255) if ((r // 20 + c // 20) % 2 == 0) else (26, 24, 31, 255)
            draw.rectangle([c, r, c + 19, r + 19], fill=col)

    # Header
    draw.rectangle([20, 14, 1460, 52], fill=(42, 34, 32, 255), outline=(214, 182, 138, 255), width=2)
    draw.text((34, 26), "ELDER SPORECAP (MYCONID) - COMPLETE 4-DIRECTIONAL ANIMATION SUITE (88 HAND-PIXELLED FRAMES: IDLE, RUN, ATTACK, DEATH)", fill=(246, 228, 194, 255))

    dir_labels = [
        ("down",  "SOUTH / DOWN (FRONT VIEW - SYMMETRIC CAP, FRONT GILLS & DOWNWARD CLEAVE)"),
        ("right", "EAST / RIGHT (3/4 RIGHT PROFILE - FORWARD CLUB SWING & SLASH CRESCENT)"),
        ("left",  "WEST / LEFT (3/4 LEFT PROFILE - TRUE TOP-LEFT SUNLIGHT & DEPTH-SWAPPED HANDS)"),
        ("up",    "NORTH / UP (DORSAL BACK VIEW - REAR DOME, MOSS CAPE & OVERHEAD ARC SLASH)"),
    ]

    for d_idx, (d_key, d_title) in enumerate(dir_labels):
        y_top = 64 + d_idx * 250
        draw.rectangle([20, y_top, 1460, y_top + 238], fill=(34, 42, 30, 220), outline=(112, 76, 52, 255), width=2)
        draw.rectangle([20, y_top, 1460, y_top + 24], fill=(52, 38, 32, 255))
        draw.text((30, y_top + 6), f"DIRECTION {d_idx + 1}: {d_title}", fill=(255, 244, 140, 255))

        # Column Group 1: IDLE (4 frames @ 3x = 96x96)
        draw.text((30, y_top + 30), "IDLE (4f @ 6fps)", fill=(214, 182, 138, 255))
        idle_im = sheets["idle"][d_key]
        for i in range(4):
            bx = 28 + i * 74
            by = y_top + 48
            draw.rectangle([bx, by, bx + 68, by + 76], fill=(46, 72, 34, 255), outline=(86, 56, 38, 255))
            draw.ellipse([bx + 18, by + 62, bx + 50, by + 72], fill=(12, 16, 10, 110))
            fr = idle_im.crop((i * 32, 0, (i + 1) * 32, 32)).resize((64, 64), Image.Resampling.NEAREST)
            canvas.alpha_composite(fr, (bx + 2, by + 6))

        # Column Group 2: RUN (6 frames @ 2.5x)
        draw.text((336, y_top + 30), "RUN / WALK (6f @ 10fps)", fill=(214, 182, 138, 255))
        run_im = sheets["run"][d_key]
        for i in range(6):
            bx = 334 + i * 62
            by = y_top + 48
            draw.rectangle([bx, by, bx + 58, by + 76], fill=(46, 72, 34, 255), outline=(86, 56, 38, 255))
            draw.ellipse([bx + 14, by + 62, bx + 44, by + 72], fill=(12, 16, 10, 110))
            fr = run_im.crop((i * 64 + 16, 32, i * 64 + 48, 64)).resize((56, 56), Image.Resampling.NEAREST)
            canvas.alpha_composite(fr, (bx + 1, by + 14))

        # Column Group 3: ATTACK (6 frames @ 3x, larger box to show Slash FX!)
        draw.text((718, y_top + 30), "ATTACK + SLASH FX (6f @ 12fps: Windup -> Cleave -> Recover)", fill=(255, 198, 68, 255))
        atk_im = sheets["attack"][d_key]
        for i in range(6):
            bx = 716 + i * 120
            by = y_top + 48
            draw.rectangle([bx, by, bx + 114, by + 180], fill=(42, 62, 32, 255), outline=(156, 116, 82, 255))
            draw.ellipse([bx + 34, by + 132, bx + 80, by + 146], fill=(12, 16, 10, 110))
            fr = atk_im.crop((i * 64 + 8, 22, i * 64 + 56, 64)).resize((108, 96), Image.Resampling.NEAREST)
            canvas.alpha_composite(fr, (bx + 3, by + 48))
            draw.text((bx + 6, by + 4), f"ATK F{i+1}", fill=(255, 244, 140, 255))

        # Sub-row under IDLE & RUN: DEATH (6 frames)
        draw.text((30, y_top + 130), "DEATH COLLAPSE IN THIS DIRECTION (6f @ 10fps: Shock -> Tumble -> Slam -> Remains)", fill=(244, 142, 72, 255))
        dth_im = sheets["death"][d_key]
        for i in range(6):
            bx = 28 + i * 112
            by = y_top + 148
            draw.rectangle([bx, by, bx + 106, by + 82], fill=(58, 44, 38, 255), outline=(112, 76, 52, 255))
            draw.ellipse([bx + 28, by + 68, bx + 78, by + 78], fill=(12, 10, 10, 110))
            fr = dth_im.crop((i * 64 + 12, 32, i * 64 + 52, 64)).resize((96, 76), Image.Resampling.NEAREST)
            canvas.alpha_composite(fr, (bx + 5, by + 2))
            draw.text((bx + 6, by + 4), f"DTH F{i+1}", fill=(246, 228, 194, 255))

    return canvas


def build_walk_dir(direction: str) -> Image.Image:
    """6 frames of 64x64 relaxed patrol walk cycle (slower upright gait vs fast forward-leaning Run)."""
    sheet = Image.new("RGBA", (64 * 6, 64), (0, 0, 0, 0))
    sgn = -1 if direction == "left" else 1
    for idx in range(6):
        cx = 32
        base_foot_y = 62
        tdy = [0, 0, -1, 0, 0, -1][idx]
        cdy = [0, 1, -1, 0, 1, -1][idx]
        body_y = 54 + tdy
        cap_y = 50 + cdy
        if direction in ("down", "up"):
            lf_dy = [-1, 0, -2, 0, 0, -1][idx]
            rf_dy = [0, 0, -1, -1, 0, -2][idx]
            l_foot = (cx - 3, base_foot_y + lf_dy)
            r_foot = (cx + 3, base_foot_y + rf_dy)
        else:
            lf_dx = [-2, -1, 1, 2, 1, -1][idx] * sgn
            rf_dx = [2, 1, -1, -2, -1, 1][idx] * sgn
            l_foot = (cx + lf_dx, base_foot_y + (0 if idx % 3 else -1))
            r_foot = (cx + rf_dx, base_foot_y + (-1 if idx % 3 else 0))
        oh_pos = (cx - 6 * sgn, body_y + 2 + (0 if idx < 3 else -1))
        cl_pos = (cx + 6 * sgn, body_y + 2 + (-1 if idx < 3 else 0))
        cell = assemble_character(
            64, 64, cx, body_y, cap_y, l_foot, r_foot, oh_pos, cl_pos,
            direction=direction, cap_squash=(1 if idx in (1, 4) else 0),
            eye_mode="normal", club_pose="idle"
        )
        sheet.alpha_composite(cell, (idx * 64, 0))
    return sheet


def build_heavy_attack_dir(direction: str) -> Image.Image:
    """6 frames of 64x64 Heavy Ground-Slam / Spore Nova Attack in all 4 directions."""
    sheet = Image.new("RGBA", (64 * 6, 64), (0, 0, 0, 0))
    sgn = -1 if direction == "left" else 1
    for idx in range(6):
        cx = 32
        foot_y = 62
        # F0-F1: Deep crouch then huge leap! F2-F3: Heavy crushing slam + 360 spore shockwave!
        jump_y = [1, -4, 1, 2, 1, 0][idx]
        body_y = 54 + jump_y
        cap_y = 50 + jump_y + (-1 if idx == 1 else (1 if idx in (2, 3) else 0))
        cpose = ["raise", "raise", "slam", "slam", "idle", "idle"][idx]
        emode = "shock" if idx == 1 else ("attack" if idx in (2, 3) else "normal")
        cell = assemble_character(
            64, 64, cx, body_y, cap_y,
            (cx - 4, foot_y + min(0, jump_y)), (cx + 4, foot_y + min(0, jump_y)),
            (cx - 7 * sgn, body_y + (0 if idx != 1 else -3)),
            (cx + 7 * sgn, body_y + (1 if idx in (2, 3) else -3)),
            direction=direction, cap_squash=(1 if idx in (0, 2, 3) else -1),
            eye_mode=emode, club_pose=cpose
        )
        if idx in (2, 3):
            slash = draw_slash_fx(64, 64, cx, foot_y, direction, phase=(idx - 2))
            cell.alpha_composite(slash)
            # Extra radial heavy shockwave ring around feet
            r_ring = 14 if idx == 2 else 18
            for deg in range(0, 360, 20):
                import math
                rx = cx + int(math.cos(math.radians(deg)) * r_ring)
                ry = foot_y - 2 + int(math.sin(math.radians(deg)) * (r_ring * 0.45))
                put_px(cell, rx, ry, PAL["slash_hi"] if idx == 2 else PAL["eye_mid"])
        sheet.alpha_composite(cell, (idx * 64, 0))
    return sheet


def build_hit_bounce_dir(direction: str) -> Image.Image:
    """4 frames of 64x64 Damage Bounce-Back Recoil effect in all 4 directions."""
    sheet = Image.new("RGBA", (64 * 4, 64), (0, 0, 0, 0))
    kb_x = 0 if direction in ("down", "up") else (-1 if direction == "right" else 1)
    kb_y = -1 if direction == "down" else (1 if direction == "up" else 0)
    sgn = -1 if direction == "left" else 1
    for idx in range(4):
        cx = 32 + kb_x * [2, 4, 3, 1][idx]
        cy_off = kb_y * [1, 3, 2, 0][idx] - [2, 4, 1, 0][idx]
        body_y = 54 + cy_off
        cap_y = 49 + cy_off - (2 if idx == 1 else 0)
        cell = assemble_character(
            64, 64, cx, body_y, cap_y,
            (cx - 4, 61 + min(0, cy_off)), (cx + 3, 61 + min(0, cy_off)),
            (cx - 8 * sgn, body_y), (cx + 8 * sgn, body_y - 1),
            direction=direction, cap_tilt=-sgn, cap_squash=(-1 if idx == 1 else 1),
            eye_mode="shock", club_pose="raise"
        )
        # Impact hit sparks on frame 0 and 1
        if idx in (0, 1):
            for sx, sy in [(-5, -4), (5, -6), (0, -9)]:
                put_px(cell, cx + sx, body_y + sy, PAL["slash_hi"])
        sheet.alpha_composite(cell, (idx * 64, 0))
    return sheet


def main():
    sheets = {
        "idle": {}, "walk": {}, "run": {},
        "attack": {}, "heavy_attack": {}, "hit_bounce": {}, "death": {}
    }
    for state in ("Idle", "Walk", "Run", "Attack", "Heavy_Attack", "Hit_Bounce", "Death"):
        os.makedirs(os.path.join(BASE_DIR, state), exist_ok=True)

    for d in DIRS:
        sheets["idle"][d] = build_idle_dir(d)
        sheets["walk"][d] = build_walk_dir(d)
        sheets["run"][d] = build_run_dir(d)
        sheets["attack"][d] = build_attack_dir(d)
        sheets["heavy_attack"][d] = build_heavy_attack_dir(d)
        sheets["hit_bounce"][d] = build_hit_bounce_dir(d)
        sheets["death"][d] = build_death_dir(d)

        for key, folder in [
            ("idle", "Idle"), ("walk", "Walk"), ("run", "Run"),
            ("attack", "Attack"), ("heavy_attack", "Heavy_Attack"),
            ("hit_bounce", "Hit_Bounce"), ("death", "Death"),
        ]:
            sheets[key][d].save(os.path.join(BASE_DIR, folder, f"{folder}_{d.capitalize()}-Sheet.png"))

    for state_key, folder, fw, fh, cols in [
        ("idle", "Idle", 32, 32, 4),
        ("walk", "Walk", 64, 64, 6),
        ("run", "Run", 64, 64, 6),
        ("attack", "Attack", 64, 64, 6),
        ("heavy_attack", "Heavy_Attack", 64, 64, 6),
        ("hit_bounce", "Hit_Bounce", 64, 64, 4),
        ("death", "Death", 64, 64, 6),
    ]:
        multi = Image.new("RGBA", (fw * cols, fh * 4), (0, 0, 0, 0))
        for r_idx, d in enumerate(DIRS):
            multi.alpha_composite(sheets[state_key][d], (0, r_idx * fh))
        multi.save(os.path.join(BASE_DIR, folder, f"{folder}_4Dir-Sheet.png"))
        sheets[state_key]["right"].save(os.path.join(BASE_DIR, folder, f"{folder}-Sheet.png"))

    # Register myconid in game/data/catalog.json
    cat_path = os.path.join(os.path.dirname(__file__), "..", "data", "catalog.json")
    if os.path.exists(cat_path):
        import json
        with open(cat_path, "r", encoding="utf-8") as f:
            cat = json.load(f)
        cat.setdefault("actors", {})["myconid"] = {
            "idle": {"sheet": "expansion/Mobs/Myconid/Idle/Idle-Sheet.png", "frame": [32, 32], "frames": 4, "cols": 4, "fps": 6, "loop": True, "anchor": [16, 31]},
            "walk": {"sheet": "expansion/Mobs/Myconid/Walk/Walk-Sheet.png", "frame": [64, 64], "frames": 6, "cols": 6, "fps": 8, "loop": True, "anchor": [32, 63]},
            "run": {"sheet": "expansion/Mobs/Myconid/Run/Run-Sheet.png", "frame": [64, 64], "frames": 6, "cols": 6, "fps": 10, "loop": True, "anchor": [32, 63]},
            "attack": {"sheet": "expansion/Mobs/Myconid/Attack/Attack-Sheet.png", "frame": [64, 64], "frames": 6, "cols": 6, "fps": 12, "loop": False, "anchor": [32, 63]},
            "heavy_attack": {"sheet": "expansion/Mobs/Myconid/Heavy_Attack/Heavy_Attack-Sheet.png", "frame": [64, 64], "frames": 6, "cols": 6, "fps": 11, "loop": False, "anchor": [32, 63]},
            "hit": {"sheet": "expansion/Mobs/Myconid/Hit_Bounce/Hit_Bounce-Sheet.png", "frame": [64, 64], "frames": 4, "cols": 4, "fps": 12, "loop": False, "anchor": [32, 63]},
            "death": {"sheet": "expansion/Mobs/Myconid/Death/Death-Sheet.png", "frame": [64, 64], "frames": 6, "cols": 6, "fps": 10, "loop": False, "anchor": [32, 63]},
        }
        with open(cat_path, "w", encoding="utf-8") as f:
            json.dump(cat, f, indent=1)

    preview = build_master_preview(sheets)
    os.makedirs(os.path.dirname(PREVIEW_PATH), exist_ok=True)
    preview.save(PREVIEW_PATH)
    if os.path.isdir(ARTIFACT_DIR):
        preview.save(os.path.join(ARTIFACT_DIR, "myconid_all_directions_sheet.png"))
    print("Saved all 28 directional sheets (152 frames) and master preview:", PREVIEW_PATH)


if __name__ == "__main__":
    main()
