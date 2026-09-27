with open('game/scripts/crop.gd', 'r') as f:
    lines = f.read()

old_refresh = """	if sprite:
		sprite.queue_free()
	sprite = Pack.sprite("crop_" + kind, stage_of(info))
	sprite.show_behind_parent = true
	add_child(sprite)
	if Game.world.soil and Game.world.soil.state.soil.get(Soil.key_of(cell) + "_f", 0) == 1 and stage_of(info) == 3:
		sprite.scale = Vector2(2.0, 2.0)
		sprite.position.y -= 8
	queue_redraw()"""

new_refresh = """	var is_weed = kind in ["hemp", "indica", "sativa", "hybrid"]
	var base_kind = "corn" if is_weed else kind

	if sprite:
		sprite.queue_free()
	sprite = Pack.sprite("crop_" + base_kind, stage_of(info))
	sprite.show_behind_parent = true
	add_child(sprite)

	if is_weed and stage_of(info) == 3:
		var nug = Sprite2D.new()
		nug.texture = Pack.icon(kind)
		if Inventory.TINTS.has(kind):
			nug.modulate = Inventory.TINTS[kind]
		nug.scale = Vector2(0.8, 0.8)
		nug.position.y -= 10
		sprite.add_child(nug)

	if Game.world.soil and Game.world.soil.state.soil.get(Soil.key_of(cell) + "_f", 0) == 1 and stage_of(info) == 3:
		sprite.scale = Vector2(2.0, 2.0)
		sprite.position.y -= 8
	queue_redraw()"""

lines = lines.replace(old_refresh, new_refresh)
with open('game/scripts/crop.gd', 'w') as f:
    f.write(lines)
print("patched crop.gd")
