class_name Harvestable
extends StaticBody2D
## Trees, rocks, ore, crystals, bushes, weeds, stumps and logs: hit them for materials. A felled
## tree leaves its stump to be cleared too. Some need a better tool: big stumps and fallen logs an
## iron axe, boulders a pickaxe. What you clear is remembered by the area (see World.note_removed)
## and grows back after the area's regrow days, or never on your farm.

var sprite_name: String
var variant := 0
var spec: Dictionary
var kind := "wood"      # which tool helps: wood -> axe, stone -> pickaxe
var hp := 1
var sprite: Sprite2D
var shadow: Sprite2D
var stump: Node2D
var stumped := false
var _tall := false


func _init(name_: String, v := 0) -> void:
	sprite_name = name_
	variant = v
	spec = Pack.spec(name_, v)
	var drop: String = spec.get("drop", "wood")
	kind = "stone" if drop in ["stone", "iron_ore", "crystal"] else ("fiber" if drop == "fiber" else "wood")


func _ready() -> void:
	collision_layer = 1
	collision_mask = 0
	add_child(World.foot_shape(float(spec.get("solid", 4))))
	shadow = World.add_shadow(self, spec)
	sprite = Pack.sprite(sprite_name, variant)
	sprite.material = FX.flash_material()
	add_child(sprite)
	if spec.has("overlay"):
		var bits := Pack.sprite(spec.overlay, randi() % Pack.variant_count(spec.overlay))
		bits.position = Vector2(randi_range(-3, 3), -3)
		sprite.add_child(bits)
	_tall = sprite.texture.get_size().y > 40
	if _tall:
		set_meta("tall", sprite)   # the world fades it while the player is behind it
	_grow()


func _grow() -> void:
	hp = int(spec.hp)
	add_to_group("hittable")


func hit_centre() -> Vector2:
	return global_position + Vector2(0, -6)


func hit_radius() -> float:
	return float(spec.get("solid", 4)) + 2.0


## The tool this needs and doesn't have, or "".
func missing_tool() -> String:
	var needs: String = spec.get("needs", "")
	if needs == "" or stumped:
		return ""
	if needs == "axe" and Inventory.best(Inventory.AXES) == "":
		return "an axe"
	if needs == "axe_iron" and not Inventory.has("axe_iron"):
		return "an iron axe (Brom the smith sells them)"
	if needs == "pickaxe" and Inventory.best(Inventory.PICKAXES) == "":
		return "a pickaxe"
	return ""


func hit(damage: int, dir: Vector2, _by: Node) -> void:
	var power := 1
	var drop: String = spec.drop
	var missing := missing_tool()
	if missing != "":
		Game.say("Too big to shift by hand. You need %s." % missing)
		FX.chips(get_parent(), hit_centre(), Color(0.6, 0.5, 0.4), 2)
		_wobble(dir)
		return
	if kind == "wood":
		power = Inventory.tool_power(Inventory.AXES)
	elif kind == "stone":
		if drop == "iron_ore" and Inventory.best(Inventory.PICKAXES) == "":
			Game.say("Too hard. You need a pickaxe (workbench).")
			FX.chips(get_parent(), hit_centre(), Color(0.6, 0.6, 0.6), 2)
			return
		if drop == "crystal" and not Inventory.has("pickaxe_iron"):
			Game.say("The crystal rings but won't split. An iron pickaxe might do it.")
			FX.chips(get_parent(), hit_centre(), Color(0.5, 0.75, 1.0), 2)
			return
		power = Inventory.tool_power(Inventory.PICKAXES)
	else:
		power = 2
	if spec.get("hp", 1) <= 1:
		power = 99
	hp -= power
	FX.flash(sprite, 0.08)
	var colour := Color(0.55, 0.35, 0.2) if kind == "wood" else (Color(0.6, 0.62, 0.66) if kind == "stone" else Color(0.4, 0.6, 0.2))
	if drop == "crystal":
		colour = Color(0.4, 0.7, 1.0)
	FX.chips(get_parent(), hit_centre() + Vector2(0, -4), colour, 5)
	_wobble(dir)
	if hp <= 0:
		_break(dir)


func _wobble(dir: Vector2) -> void:
	var tw := sprite.create_tween()
	var lean := 0.06 if dir.x >= 0 else -0.06
	if not _tall:
		lean *= 2.0
	tw.tween_property(sprite, "rotation", lean, 0.05)
	tw.tween_property(sprite, "rotation", -lean * 0.5, 0.08)
	tw.tween_property(sprite, "rotation", 0.0, 0.08)


func _break(dir: Vector2) -> void:
	var drop: String = spec.drop
	var at := global_position + Vector2(0, -4) + dir * 6.0
	Game.shake(2.0)
	if stumped:
		# the stump of a felled tree: a last log, and it's gone
		Game.world.drop("wood", 1, at)
		_gone()
		return
	remove_from_group("hittable")
	var n := 1
	match sprite_name:
		"oak_big", "pine_big", "oak_big_frozen", "oak_big_dead", "pine_grand", "pine_giant": n = 5
		"oak", "pine", "pine_tall", "oak_frozen": n = 3
		"boulder", "boulder_brown": n = 4
		"stump_big", "fallen_log": n = 6
		"stump": n = 2
		"ore_rock": n = 2
		"bush_big": n = 3
		"crate", "barrel", "pot": n = 1 + randi() % 2
		"weed", "weed_dry", "branch", "stone": n = 1
		_: n = 2 if drop != "crystal" else 1
	Game.world.drop(drop, n, at)
	# side products make the crafting tree go round
	if sprite_name.begins_with("pine") and randf() < 0.6:
		Game.world.drop("resin", 1, at)
	if kind == "wood" and not sprite_name.begins_with("pine") and randf() < 0.3:
		Game.world.drop("stick", 1 + randi() % 2, at)
	if kind == "fiber" and randf() < (0.15 if sprite_name.begins_with("weed") else 0.55):
		Game.world.drop("herb", 1, at)
	if kind == "stone" and drop == "stone" and randf() < 0.25:
		Game.world.drop("coal", 1, at)
	if drop == "crystal" and randf() < 0.2:
		Game.world.drop("gem", 1, at)
	if spec.has("stump"):
		# the tree comes down; its stump stays to be cleared
		stumped = true
		sprite.visible = false
		stump = Pack.sprite(spec.stump)
		add_child(stump)
		hp = 2
		_tall = false
		add_to_group("hittable")
		return
	_gone()


func _gone() -> void:
	remove_from_group("hittable")
	Game.world.note_removed(self)
	collision_layer = 0
	var tw := create_tween()
	tw.tween_property(self, "modulate:a", 0.0, 0.2)
	tw.tween_callback(queue_free)
