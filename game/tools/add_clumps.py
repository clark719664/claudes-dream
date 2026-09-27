import json, os, copy

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'catalog.json')
with open(OUT, 'r') as f:
    cat = json.load(f)

# Large marvelous clumps
boulder = cat['sprites']['boulder']

def make_boulder(name, drop, hp, needs):
    new_boulder = copy.deepcopy(boulder)
    for frame in new_boulder:
        frame['drop'] = drop
        frame['hp'] = hp
        frame['needs'] = needs
    cat['sprites'][name] = new_boulder

make_boulder('boulder_iron', 'iron_ore', 15, 'pickaxe')
make_boulder('boulder_copper', 'copper_ore', 25, 'pickaxe_iron')
make_boulder('boulder_gold', 'gold_ore', 40, 'pickaxe_mythril')
make_boulder('boulder_geode', 'geode', 50, 'pickaxe_mythril')
make_boulder('meteorite', 'shadow_core', 100, 'pickaxe_shadow')

# Normal ores
ore_rock = cat['sprites']['ore_rock']
def make_ore(name, drop, hp, needs):
    new_ore = copy.deepcopy(ore_rock)
    for frame in new_ore:
        frame['drop'] = drop
        frame['hp'] = hp
        if needs:
            frame['needs'] = needs
    cat['sprites'][name] = new_ore

make_ore('copper_rock', 'copper_ore', 6, 'pickaxe')
make_ore('gold_rock', 'gold_ore', 8, 'pickaxe_iron')
make_ore('geode_rock', 'geode', 10, 'pickaxe_iron')

items = ["copper_ore", "gold_ore", "geode", "copper_bar", "gold_bar"]
for item in items:
    cat['sprites'][item] = [{"sheet": 'pixellab_items/' + item + '.png', "region": [0, 0, 16, 16], "anchor": [8, 8]}]

with open(OUT, 'w') as f:
    json.dump(cat, f)
print("Added marvelous clumps and ores to catalog!")
