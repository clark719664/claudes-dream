class_name Harvestable
extends StaticBody2D
## Trees, rocks, ore, crystals and bushes: hit them for materials, they grow back.

const REGROW := 180.0

var sprite_name: String
var variant := 0
var spec: Dictionary
var kind := "wood"      # which tool helps: wood -> axe, stone -> pickaxe
var hp := 1
var sprite: Sprite2D
var shadow: Sprite2D
var stump: Node2D
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
	sprite.visible = true
	if shadow:
		shadow.visible = true
	if stump:
		stump.queue_free()
		stump = null
	collision_layer = 1
	add_to_group("hittable")


func hit_centre() -> Vector2:
	return global_position + Vector2(0, -6)


func hit_radius() -> float:
	return float(spec.get("solid", 4)) + 2.0


func hit(damage: int, dir: Vector2, _by: Node) -> void:
	var power := 1
	var drop: String = spec.drop
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
	remove_from_group("hittable")
	Game.world.note_depleted(self)
	var drop: String = spec.drop
	var n := 1
	match sprite_name:
		"oak_big", "pine_big", "oak_big_frozen", "oak_big_dead": n = 5
		"oak", "pine", "pine_tall", "oak_frozen": n = 3
		"boulder", "boulder_brown": n = 4
		"ore_rock": n = 2
		"bush_big": n = 3
		"crate", "barrel", "pot": n = 1 + randi() % 2
		_: n = 2 if drop != "crystal" else 1
	var at := global_position + Vector2(0, -4) + dir * 6.0
	Game.world.drop(drop, n, at)
	# side products make the crafting tree go round
	if sprite_name.begins_with("pine") and randf() < 0.6:
		Game.world.drop("resin", 1, at)
	if kind == "wood" and not sprite_name.begins_with("pine") and randf() < 0.3:
		Game.world.drop("stick", 1 + randi() % 2, at)
	if kind == "fiber" and randf() < 0.55:
		Game.world.drop("herb", 1, at)
	if kind == "stone" and drop == "stone" and randf() < 0.35:
		Game.world.drop("coal", 1, at)
	if drop == "crystal" and randf() < 0.2:
		Game.world.drop("gem", 1, at)
	Game.shake(2.0)
	sprite.visible = false
	if spec.has("stump"):
		stump = Pack.sprite(spec.stump)
		add_child(stump)
	else:
		collision_layer = 0
		if shadow:
			shadow.visible = false
	await get_tree().create_timer(REGROW * randf_range(0.8, 1.3)).timeout
	# don't pop back on top of the player
	while Game.player and Game.player.global_position.distance_to(global_position) < 30.0:
		await get_tree().create_timer(2.0).timeout
	_grow()

