import json, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'catalog.json')
with open(OUT, 'r') as f:
    cat = json.load(f)

items = [
    "sword_shadow", "axe_shadow", "pickaxe_shadow", "shield_shadow", "chest_shadow",
    "frost_core", "magma_core", "shadow_core", "basilisk_scale",
    "bandage", "elixir_life", "potion_stoneskin"
]

for item in items:
    # A single frame sprite
    sheet = 'pixellab_items/' + item + '.png'
    # Use full 16x16 or whatever image size. Pixellab returns 16x16 for items usually.
    cat['sprites'][item] = [
        {"sheet": sheet, "region": [0, 0, 16, 16], "anchor": [8, 8]}
    ]

with open(OUT, 'w') as f:
    json.dump(cat, f)
print("Updated catalog.json with custom items")
