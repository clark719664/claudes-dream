import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "..", "docs", "media")
if not os.path.exists(OUT_DIR):
    os.makedirs(OUT_DIR)

def get_sprite(slug):
    path = os.path.join(ROOT, "assets", "pixellab_npcs", slug, "Idle_Down-Sheet.png")
    if not os.path.exists(path):
        return None
    try:
        img = Image.open(path).convert("RGBA")
        return img.crop((0, 0, 32, 32)) # First frame
    except:
        return None

def create_mockup():
    font = ImageFont.load_default()
    
    # 1. TOWN MOCKUP
    town = Image.new("RGBA", (320, 240), (100, 180, 80, 255))
    draw = ImageDraw.Draw(town)
    draw.text((10, 10), "TOWN - PEN RIDGE RANCH", fill=(255,255,255), font=font)
    
    rancher = get_sprite("ranch_pen")
    if rancher:
        town.alpha_composite(rancher, (160, 100))
    
    player = get_sprite("player_male")
    if player:
        town.alpha_composite(player, (120, 100))
        
    cow = get_sprite("cow")
    if cow:
        town.alpha_composite(cow, (200, 120))
        town.alpha_composite(cow, (220, 140))
        
    chicken = get_sprite("chicken")
    if chicken:
        town.alpha_composite(chicken, (180, 140))

    town.save(os.path.join(OUT_DIR, "town_preview.png"))
    
    # 2. CAVE MOCKUP
    cave = Image.new("RGBA", (320, 240), (30, 30, 45, 255))
    draw2 = ImageDraw.Draw(cave)
    draw2.text((10, 10), "CAVES - FLOOR 30 (ICE BIOME)", fill=(200,220,255), font=font)
    
    if player:
        cave.alpha_composite(player, (160, 180))
        
    yeti = get_sprite("frost_yeti")
    if yeti:
        cave.alpha_composite(yeti, (100, 80))
        cave.alpha_composite(yeti, (200, 90))
        cave.alpha_composite(yeti, (150, 60))
        
    bat = get_sprite("cave_bat")
    if bat:
        cave.alpha_composite(bat, (80, 120))
        cave.alpha_composite(bat, (220, 140))

    cave.save(os.path.join(OUT_DIR, "cave_preview.png"))
    print("Mockups generated!")

create_mockup()
