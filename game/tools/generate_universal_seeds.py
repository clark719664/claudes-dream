import os
from PIL import Image, ImageDraw

ASSETS_DIR = "game/assets/pixellab_items"
SEED_SUFFIX = "_seeds.png"
CROP_NAMES = ["pumpkin", "corn", "strawberry", "eggplant", "onion", "tomato"]

# Generate a plain sack background (24x24)
def create_sack_background():
    size = (24, 24)
    sack = Image.new('RGBA', size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(sack)
    # Simple brown sack shape: rectangle with a top flap triangle
    brown = (139, 69, 19, 255)  # saddle brown
    # Main body
    draw.rectangle([4, 6, 20, 22], fill=brown)
    # Flap (triangle)
    draw.polygon([(4, 6), (12, 0), (20, 6)], fill=brown)
    return sack

sack_bg = create_sack_background()

for crop in CROP_NAMES:
    crop_path = os.path.join(ASSETS_DIR, f"{crop}.png")
    seed_path = os.path.join(ASSETS_DIR, f"{crop}{SEED_SUFFIX}")
    if not os.path.exists(crop_path):
        print(f"Crop image missing: {crop_path}")
        continue
    crop_img = Image.open(crop_path).convert('RGBA')
    # Resize crop to fit inside sack (max 12x12)
    crop_img.thumbnail((12, 12), Image.LANCZOS)
    # Create a copy of sack background
    new_seed = sack_bg.copy()
    # Center the crop within the sack
    cx = (24 - crop_img.width) // 2
    cy = (24 - crop_img.height) // 2 + 2  # slight offset downwards
    new_seed.alpha_composite(crop_img, (cx, cy))
    # Save over existing seed file
    new_seed.save(seed_path)
    print(f"Generated universal seed icon: {seed_path}")
