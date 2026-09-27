import os
import time
from generate_crops import generate_icon

ITEMS_DIR = "game/assets/pixellab_items"

new_items = {
    "sword_shadow": "A dark obsidian sword glowing with purple energy",
    "axe_shadow": "A heavy dark axe with a glowing purple edge",
    "pickaxe_shadow": "A mining pickaxe made of dark shadow crystal",
    "shield_shadow": "A dark round shield glowing with purple warding magic",
    "chest_shadow": "A cloak of dark shadow armor glowing with purple energy",
    "frost_core": "A glowing icy blue crystal core drop",
    "magma_core": "A glowing fiery red magma core drop",
    "shadow_core": "A swirling dark purple shadow core drop",
    "basilisk_scale": "A hard green reptilian scale",
    "bandage": "A clean white medical bandage roll",
    "elixir_life": "A glowing golden potion flask for life",
    "potion_stoneskin": "A glowing grey potion flask for stoneskin"
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
