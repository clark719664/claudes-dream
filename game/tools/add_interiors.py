import json

interior_gd_path = 'game/scripts/interior.gd'
world_gd_path = 'game/scripts/world.gd'

new_layouts = [
    '"general_store"', '"saloon"', '"blacksmith_shop"', '"library"', '"clinic"', 
    '"school"', '"church"', '"bathhouse"', '"museum"', '"inn"', 
    '"mayors_manor"', '"npc_house_1"', '"npc_house_2"'
]

with open(interior_gd_path, 'r') as f:
    c = f.read()

# Add layouts
if '"general_store"' not in c:
    target = '"coop": {"wall": 0, "floor": 0, "w": 8, "h": 5, "props": []},'
    replacement = target + '\n' + '\n'.join([f'\t{name}: {{"wall": 2, "floor": 4, "w": 10, "h": 8, "props": []}},' for name in new_layouts])
    c = c.replace(target, replacement)

# Fix tier type
c = c.replace('func build(tier_: int, sorted_parent: Node2D) -> void:', 'func build(tier_, sorted_parent: Node2D) -> void:')

with open(interior_gd_path, 'w') as f:
    f.write(c)


with open(world_gd_path, 'r') as f:
    c = f.read()

target2 = 'if id in ["house", "barn", "coop"]:'
replacement2 = 'if id in ["house", "barn", "coop", "general_store", "saloon", "blacksmith_shop", "library", "clinic", "school", "church", "bathhouse", "museum", "inn", "mayors_manor", "npc_house_1", "npc_house_2"]:'

if target2 in c:
    c = c.replace(target2, replacement2)

with open(world_gd_path, 'w') as f:
    f.write(c)

print('Updated interior.gd and world.gd!')
