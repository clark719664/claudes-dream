import os

with open('game/scripts/interior.gd', 'r') as f:
    content = f.read()

target = """	if typeof(region) == TYPE_STRING:
		var d = Game.catalog.sprites[region]
		sp.texture = load("res://assets/" + d.sheet)
		sp.region_enabled = true
		sp.region_rect = Rect2(d.region[0], d.region[1], d.region[2], d.region[3])
		sz = sp.region_rect.size"""

replacement = """	if typeof(region) == TYPE_STRING:
		var d = Game.catalog.sprites[region]
		if typeof(d) == TYPE_ARRAY:
			d = d[0]
		sp.texture = load("res://assets/" + d.sheet)
		sp.region_enabled = true
		sp.region_rect = Rect2(d.region[0], d.region[1], d.region[2], d.region[3])
		sz = sp.region_rect.size"""

if target in content:
    content = content.replace(target, replacement)
    with open('game/scripts/interior.gd', 'w') as f:
        f.write(content)
    print("Patched interior.gd for list format")
