import json, os

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'catalog.json')
with open(OUT, 'r') as f:
    cat = json.load(f)

items = [
    "pumpkin", "corn", "strawberry", "eggplant", "onion", "tomato",
    "pumpkin_seeds", "corn_seeds", "strawberry_seeds", "eggplant_seeds", "onion_seeds", "tomato_seeds",
    "fertilizer"
]

for item in items:
    cat['sprites'][item] = [{"sheet": 'pixellab_items/' + item + '.png', "region": [0, 0, 24, 24], "anchor": [12, 12]}]

with open(OUT, 'w') as f:
    json.dump(cat, f)
print("Fixed catalog sizes to 24x24 for crops!")
