import sys
import os
os.environ["PIXELLAB_API_KEY"] = os.environ["PIXELLAB_API_KEY"]

sys.path.append('game/tools')
from harmonize_and_generate_pixellab import generate_pixellab_item, make_palette_ref_base64
import time

items = [
    ("pumpkin", "perfect round orange pumpkin vegetable crop"),
    ("corn", "yellow corn cob with green husks vegetable crop"),
    ("strawberry", "small ripe red strawberry fruit crop"),
    ("eggplant", "purple bulbous eggplant vegetable crop"),
    ("onion", "round white and brown onion vegetable crop"),
    ("tomato", "plump juicy red tomato vegetable crop"),
    
    ("pumpkin_seeds", "small brown paper seed packet showing a pumpkin on the front"),
    ("corn_seeds", "small brown paper seed packet showing corn on the front"),
    ("strawberry_seeds", "small brown paper seed packet showing a strawberry on the front"),
    ("eggplant_seeds", "small brown paper seed packet showing an eggplant on the front"),
    ("onion_seeds", "small brown paper seed packet showing an onion on the front"),
    ("tomato_seeds", "small brown paper seed packet showing a tomato on the front"),
    
    ("fertilizer", "brown sack of rich dark soil fertilizer")
]

def main():
    color_b64 = make_palette_ref_base64()
    for spec in items:
        # Delete first to ensure regeneration
        out_p = os.path.join("game/assets/pixellab_items", f"{spec[0]}.png")
        if os.path.exists(out_p):
            os.remove(out_p)
            
        generate_pixellab_item(spec, color_b64)
        print(f"Generated properly: {spec[0]}")
        time.sleep(1)

if __name__ == "__main__":
    main()
