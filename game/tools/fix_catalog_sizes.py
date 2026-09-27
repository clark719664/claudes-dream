import json, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'catalog.json')
with open(OUT, 'r') as f:
    cat = json.load(f)

items = [
    "sword_shadow", "axe_shadow", "pickaxe_shadow", "shield_shadow", "chest_shadow",
    "frost_core", "magma_core", "shadow_core", "basilisk_scale",
    "bandage", "elixir_life", "potion_stoneskin",
    "pumpkin_pie", "corn_on_cob", "strawberry_cake", "stuffed_eggplant", "onion_rings",
    "copper_ore", "gold_ore", "geode", "copper_bar", "gold_bar"
]

for item in items:
    cat['sprites'][item] = [{"sheet": 'pixellab_items/' + item + '.png', "region": [0, 0, 24, 24], "anchor": [12, 12]}]

with open(OUT, 'w') as f:
    json.dump(cat, f)
print("Fixed catalog sizes to 24x24!")
