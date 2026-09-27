import os

with open('game/scripts/interior.gd', 'r') as f:
    content = f.read()

target = """func _furniture(region: Rect2, feet: Vector2, solid: float, role: String) -> void:
	var node: Node2D
	if role in ["bed", "kitchen", "alchemy"]:
		node = CabinFixture.new(role)
	else:
		node = Node2D.new()
	node.position = feet
	var sp := Sprite2D.new()
	var t := AtlasTexture.new()
	t.atlas = Pack.texture(PROPS)
	t.region = region
	sp.texture = t
	sp.centered = false
	sp.offset = Vector2(-region.size.x / 2.0, -region.size.y)"""

replacement = """func _furniture(region, feet: Vector2, solid: float, role: String) -> void:
	var node: Node2D
	if role in ["bed", "kitchen", "alchemy"]:
		node = CabinFixture.new(role)
	else:
		node = Node2D.new()
	node.position = feet
	var sp := Sprite2D.new()
	var sz = Vector2()
	if typeof(region) == TYPE_STRING:
		var d = Game.catalog.sprites[region]
		sp.texture = load("res://assets/" + d.sheet)
		sp.region_enabled = true
		sp.region_rect = Rect2(d.region[0], d.region[1], d.region[2], d.region[3])
		sz = sp.region_rect.size
	else:
		var t := AtlasTexture.new()
		t.atlas = Pack.texture(PROPS)
		t.region = region
		sp.texture = t
		sz = region.size
	sp.centered = false
	sp.offset = Vector2(-sz.x / 2.0, -sz.y)"""

if target in content:
    content = content.replace(target, replacement)
    with open('game/scripts/interior.gd', 'w') as f:
        f.write(content)
    print("Patched interior.gd")
else:
    print("Could not find target in interior.gd")
