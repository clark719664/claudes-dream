import os

# Update build.py name_map
with open('game/tools/worldgen/build.py', 'r') as f:
    build_py = f.read()

old_map = """    name_map = {
        'General Store': 'general_store',
        'Smithy': 'blacksmith_shop',
        "Tilda's Carpentry": 'npc_house_1',
        'The Wayfarer Inn': 'saloon',
        "Merlo's house": 'wizard_tower',
        'Brindle churchyard': 'church',
        'The Millers': 'npc_house_2',
        'The Hollins': 'school'
    }"""

new_map = """    name_map = {
        'General Store': 'general_store',
        'Smithy': 'blacksmith_shop',
        "Tilda's Carpentry": 'npc_house_1',
        'The Stardrop Saloon': 'saloon',
        "Merlo's house": 'wizard_tower',
        'Brindle churchyard': 'church',
        'The Millers': 'npc_house_2',
        'The Hollins': 'school',
        'The Wayfarer Inn': 'inn',
        'Town Library': 'library',
        'Medical Clinic': 'clinic',
        'Town Museum': 'museum',
        "Mayor's Manor": 'mayors_manor',
        'The Coopers': 'npc_house_3',
        'Pen Ridge Ranch': 'npc_house_4',
        'The Weavers': 'npc_house_5',
        'Town Bathhouse': 'bathhouse'
    }"""

build_py = build_py.replace(old_map, new_map)
with open('game/tools/worldgen/build.py', 'w') as f:
    f.write(build_py)


# Update town.py
with open('game/tools/worldgen/town.py', 'r') as f:
    town_py = f.read()

# Add Library, Clinic, Museum, Mayor's Manor, Bathhouse, Saloon
additions = """    # Additional town buildings
    door = B.lot(a, 40, SOUTH, 20, 'brick', 'Town Library', 'flowers', depth=16)
    door = B.lot(a, 55, SOUTH, 20, 'plaster', 'Town Museum', depth=16)
    door = B.lot(a, 82, MAIN, 20, 'brick', 'Medical Clinic', depth=16)
    door = B.lot(a, 35, MAIN, 20, 'dark', 'The Stardrop Saloon', depth=16)
    B.shopkeeper(a, door + 2.6, MAIN - 3.4, 'barkeep_cass', 'Cass', 'barkeep')
    door = B.lot(a, 82, SOUTH, 20, 'plaster', "Mayor's Manor", 'flowers', gables=2, depth=16)
    B.shopkeeper(a, door + 2.6, SOUTH - 3.4, 'mayor_holt', 'Mayor Holt', 'mayor')
    door = B.lot(a, 80, 16, 20, 'plank', 'Town Bathhouse', depth=16)
"""

target = "B.lamps_along(a, SOUTH + 3, 8, 102, 13)"
if "Medical Clinic" not in town_py:
    town_py = town_py.replace(target, target + "\n" + additions)
    
    # Also fix shopkeepers
    town_py = town_py.replace("'tavern_b', 'Tilda', 'carpenter'", "'peasant', 'Tilda', 'carpenter'")
    town_py = town_py.replace("'player_male', 'Pen Ridge', 'rancher'", "'peasant', 'Pen Ridge', 'rancher'")
    
    with open('game/tools/worldgen/town.py', 'w') as f:
        f.write(town_py)

print("Updated town.py and build.py")
