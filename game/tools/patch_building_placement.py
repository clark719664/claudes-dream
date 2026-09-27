import os

with open('game/scripts/player.gd', 'r') as f:
    content = f.read()

target = """	elif item.begins_with("kit_") or item == "fence":"""

replacement = """	elif item in ["barn", "coop", "silo", "windmill", "greenhouse", "well"]:
		if w.area_id == "farm" and not w.cell_blocked(cell):
			var o := {"t": "custom_building", "kind": item, "x": cell.x * 16 + 84, "y": cell.y * 16 + 144}
			Game.area_state(w.area_id).placed.append(o)
			var node = w.spawn(o)
			w.entities.add_child(node)
			Inventory.take(item)
			Game.say("Built the %s!" % item.capitalize())
		else:
			Game.say("Can't build it there.")
	elif item.begins_with("kit_") or item == "fence":"""

if target in content and "custom_building" not in content.split("func use_selected")[1]:
    content = content.replace(target, replacement)
    with open('game/scripts/player.gd', 'w') as f:
        f.write(content)
    print("Patched player.gd")


with open('game/scripts/inventory.gd', 'r') as f:
    inv = f.read()

target_inv = """{"item": "coop", "gold": 4000, "cost": {"wood": 300, "stone": 100}},"""
if target_inv in inv and '"silo"' not in inv:
    inv = inv.replace(target_inv, target_inv + """
		{"item": "silo", "gold": 3000, "cost": {"wood": 100, "stone": 100}},
		{"item": "windmill", "gold": 5000, "cost": {"wood": 200, "stone": 200}},
		{"item": "greenhouse", "gold": 10000, "cost": {"wood": 500, "stone": 500}},
		{"item": "well", "gold": 1000, "cost": {"wood": 50, "stone": 100}},""")
    with open('game/scripts/inventory.gd', 'w') as f:
        f.write(inv)
    print("Patched inventory.gd")
