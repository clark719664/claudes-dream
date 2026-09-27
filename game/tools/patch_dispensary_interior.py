import os

with open('game/scripts/world.gd', 'r') as f:
    w = f.read()

target = 'if id in ["house", "barn", "coop", "general_store", "saloon", "blacksmith_shop", "library", "clinic", "school", "church", "bathhouse", "museum", "inn", "mayors_manor", "npc_house_1", "npc_house_2"]:'
if target in w:
    w = w.replace(target, target.replace(']', ', "dispensary"]'))
    with open('game/scripts/world.gd', 'w') as f:
        f.write(w)
    print("Patched world.gd")

with open('game/scripts/interior.gd', 'r') as f:
    intg = f.read()

disp_layout = """
	"dispensary": {"wall": 3, "floor": 5, "w": 8, "h": 6, "props": [
		["counter", 5.0, 3.0, 20, ""],
		["plant", 2.0, 2.0, 10, ""],
		["plant", 7.0, 2.0, 10, ""]
	]},
"""

if '"dispensary":' not in intg:
    intg = intg.replace('"clinic": {', disp_layout + '\n\t"clinic": {')
    with open('game/scripts/interior.gd', 'w') as f:
        f.write(intg)
    print("Patched interior.gd")

