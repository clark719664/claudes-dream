import sys
import os
os.environ["PIXELLAB_API_KEY"] = os.environ["PIXELLAB_API_KEY"]

sys.path.append('game/tools')
from harmonize_and_generate_pixellab import generate_pixellab_item, make_palette_ref_base64
import time

items = [
    ("sword_shadow", "dark obsidian sword glowing with purple energy"),
    ("axe_shadow", "heavy dark axe with a glowing purple edge"),
    ("pickaxe_shadow", "mining pickaxe made of dark shadow crystal"),
    ("shield_shadow", "dark round shield glowing with purple warding magic"),
    ("chest_shadow", "cloak of dark shadow armor glowing with purple energy"),
    ("frost_core", "glowing icy blue crystal core drop"),
    ("magma_core", "glowing fiery red magma core drop"),
    ("shadow_core", "swirling dark purple shadow core drop"),
    ("basilisk_scale", "hard green reptilian scale"),
    ("bandage", "clean white medical bandage roll"),
    ("elixir_life", "glowing golden potion flask for life"),
    ("potion_stoneskin", "glowing grey potion flask for stoneskin"),
    ("pumpkin_pie", "delicious slice of orange pumpkin pie"),
    ("corn_on_cob", "cooked yellow corn on the cob on a stick"),
    ("strawberry_cake", "slice of shortcake with hot pink strawberries and whipped cream"),
    ("stuffed_eggplant", "baked purple eggplant split open and stuffed with meat"),
    ("onion_rings", "basket of crispy golden fried onion rings"),
    ("copper_ore", "raw lump of orange copper ore"),
    ("gold_ore", "raw lump of shiny yellow gold ore"),
    ("geode", "round rocky geode with purple crystals inside"),
    ("copper_bar", "shiny rectangular orange copper ingot"),
    ("gold_bar", "shiny rectangular yellow gold ingot")
]

def main():
    color_b64 = make_palette_ref_base64()
    for spec in items:
        generate_pixellab_item(spec, color_b64)
        print(f"Generated {spec[0]}")
        time.sleep(1)

if __name__ == "__main__":
    main()
