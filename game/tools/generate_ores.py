import os
import time
from generate_crops import generate_icon

ITEMS_DIR = "game/assets/pixellab_items"

new_items = {
    "copper_ore": "A raw lump of orange copper ore",
    "gold_ore": "A raw lump of shiny yellow gold ore",
    "geode": "A round rocky geode with purple crystals inside",
    "copper_bar": "A shiny rectangular orange copper ingot",
    "gold_bar": "A shiny rectangular yellow gold ingot"
}

def main():
    os.makedirs(ITEMS_DIR, exist_ok=True)
    
    for name, prompt in new_items.items():
        out_path = os.path.join(ITEMS_DIR, f"{name}.png")
        if not os.path.exists(out_path):
            generate_icon(prompt, out_path)
            time.sleep(1) # rate limit

if __name__ == "__main__":
    main()
